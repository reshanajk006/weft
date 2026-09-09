"""Deterministic, explainable root-cause ranking from telemetry already in WEFT."""

from __future__ import annotations

from dataclasses import dataclass

import networkx as nx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config.thresholds import get_thresholds
from app.db.models import Service, ServiceHealthHistory
from app.schemas.analysis import (
    RcaEvidenceItem,
    RootCauseCandidate,
    RootCauseResponse,
)
from app.schemas.simulation import SimulationResponse
from app.services.analysis_common import (
    HYPOTHETICAL_MESSAGE,
    INSUFFICIENT_BASELINE,
    OBSERVED_DISCLAIMER,
    active_dataset_or_none,
    hypothetical_scenario,
    selected_target_from_service,
)
from app.services.dataset_service import list_active_services
from app.services.graph_service import build_graph
from app.services.simulation_service import _get_active_simulation


@dataclass(frozen=True)
class BaselineStats:
    error_rate: float
    avg_latency_ms: float


@dataclass(frozen=True)
class ObservedScore:
    score: int
    evidence: list[RcaEvidenceItem]


def analyze_root_cause(db: Session, simulation_id: str) -> RootCauseResponse:
    """Hypothetical mode: the simulation target is not a confirmed root cause."""

    run = _get_active_simulation(db, simulation_id)
    result = SimulationResponse.model_validate(run.result_json)
    failed = db.get(Service, result.failed_service.id)
    dataset = active_dataset_or_none(db)
    if failed is None:
        return RootCauseResponse(
            simulation_id=simulation_id,
            mode="HYPOTHETICAL",
            root_cause_status="NOT_DETERMINED",
            status="NOT_DETERMINED",
            message=HYPOTHETICAL_MESSAGE,
            disclaimer=HYPOTHETICAL_MESSAGE,
            likely_root_cause=None,
            candidates=[],
            limitations=[
                "Jaeger traces indicate correlation, not guaranteed causation",
                "No deployment or infrastructure metrics were available",
            ],
        )
    target = selected_target_from_service(failed)
    scenario = hypothetical_scenario(failed, dataset)
    limitations = [
        "Jaeger traces indicate correlation, not guaranteed causation",
        "No deployment or infrastructure metrics were available",
        "Failure simulations are hypothetical",
        "No production remediation was executed",
    ]
    message = _hypothetical_message(failed)
    return RootCauseResponse(
        simulation_id=simulation_id,
        mode="HYPOTHETICAL",
        root_cause_status="NOT_DETERMINED",
        status="NOT_DETERMINED",
        message=message,
        disclaimer=HYPOTHETICAL_MESSAGE,
        likely_root_cause=None,
        candidates=[],
        selected_target=target,
        observed_status=failed.health_status,
        observed_health_score=failed.health_score,
        observed_error_rate=failed.error_rate,
        observed_latency_ms=failed.avg_latency_ms,
        limitations=limitations,
        scenario=scenario,
    )


def analyze_observed_root_cause(db: Session) -> RootCauseResponse:
    """Observed mode: rank services from actual telemetry in the active dataset."""

    graph = build_graph(db)
    thresholds = get_thresholds()
    services = {service.id: service for service in list_active_services(db)}
    baseline_limitation = False
    candidates: list[RootCauseCandidate] = []
    for service in services.values():
        baseline, missing_baseline = load_baseline(db, service.id)
        if missing_baseline:
            baseline_limitation = True
        scored = score_observed_service(
            service,
            graph,
            services,
            baseline=baseline,
            thresholds=thresholds,
        )
        if scored.score <= 0:
            continue
        callers: list[str] = []
        callees: list[str] = []
        if service.id in graph:
            callers = sorted(graph.nodes[nid]["name"] for nid in graph.predecessors(service.id))
            callees = sorted(graph.nodes[nid]["name"] for nid in graph.successors(service.id))
        confidence = classify_rca_confidence(
            scored.score,
            {item.factor for item in scored.evidence if item.points > 0},
            thresholds,
        )
        explanations = [item.explanation for item in scored.evidence]
        candidates.append(
            RootCauseCandidate(
                service_id=service.id,
                service=service.name,
                service_name=service.name,
                score=scored.score,
                confidence=confidence,
                health_status=service.health_status,
                health_score=service.health_score,
                error_rate=service.error_rate,
                avg_latency_ms=service.avg_latency_ms,
                criticality_score=service.effective_criticality_score(),
                called_by=callers,
                calls=callees,
                evidence=explanations,
                evidence_items=scored.evidence,
            )
        )
    candidates.sort(key=lambda item: (-item.score, -item.error_rate, item.service))
    top = candidates[0] if candidates else None
    limitations = [
        "Jaeger traces indicate correlation, not guaranteed causation",
        "No deployment or infrastructure metrics were available",
        "No production remediation was executed",
    ]
    if baseline_limitation:
        limitations.append(INSUFFICIENT_BASELINE)
    status = "SUSPECTED" if top else "NOT_DETERMINED"
    return RootCauseResponse(
        simulation_id="",
        mode="OBSERVED_INCIDENT",
        root_cause_status=status,
        status=status,
        message=OBSERVED_DISCLAIMER if top else "No service currently meets the evidence thresholds.",
        disclaimer=OBSERVED_DISCLAIMER,
        likely_root_cause=top,
        candidates=candidates[:8],
        limitations=limitations,
        scenario=None,
    )


def score_observed_service(
    service: Service,
    graph: nx.DiGraph,
    services: dict[str, Service],
    *,
    baseline: BaselineStats | None,
    thresholds,
) -> ObservedScore:
    rca = thresholds.root_cause
    evidence: list[RcaEvidenceItem] = []
    score = 0

    if service.error_rate >= thresholds.health.critical_error_rate:
        score += rca.error_rate_points
        evidence.append(
            RcaEvidenceItem(
                factor="error_rate",
                points=rca.error_rate_points,
                value=service.error_rate,
                explanation="Error rate exceeds the unhealthy threshold",
            )
        )

    if service.avg_latency_ms >= thresholds.latency.high_latency_ms:
        score += rca.latency_points
        evidence.append(
            RcaEvidenceItem(
                factor="latency",
                points=rca.latency_points,
                value=service.avg_latency_ms,
                explanation="Latency is above the configured high threshold",
            )
        )

    if baseline is not None:
        worse_error = service.error_rate > baseline.error_rate
        worse_latency = service.avg_latency_ms > baseline.avg_latency_ms
        if worse_error or worse_latency:
            score += rca.baseline_deviation_points
            evidence.append(
                RcaEvidenceItem(
                    factor="baseline_deviation",
                    points=rca.baseline_deviation_points,
                    value={
                        "current_error_rate": service.error_rate,
                        "baseline_error_rate": baseline.error_rate,
                        "current_latency_ms": service.avg_latency_ms,
                        "baseline_latency_ms": baseline.avg_latency_ms,
                    },
                    explanation="Error rate or latency is above the observed baseline",
                )
            )

    predecessor_count = 0
    if service.id in graph:
        predecessor_count = len(list(graph.predecessors(service.id)))
    if predecessor_count >= rca.min_upstream_callers and _shows_symptoms(service, thresholds):
        score += rca.upstream_origin_points
        evidence.append(
            RcaEvidenceItem(
                factor="blast_radius",
                points=rca.upstream_origin_points,
                value=predecessor_count,
                explanation=f"{predecessor_count} upstream callers are potentially affected",
            )
        )

    if _has_unhealthy_dependency_role(service, graph, services):
        score += rca.unhealthy_dependency_points
        evidence.append(
            RcaEvidenceItem(
                factor="unhealthy_dependency",
                points=rca.unhealthy_dependency_points,
                value=service.health_status,
                explanation="This dependency was already unhealthy relative to its callers",
            )
        )

    return ObservedScore(score=min(score, 100), evidence=evidence)


def classify_rca_confidence(score: float, factors: set[str], thresholds) -> str:
    rca = thresholds.root_cause
    if score >= rca.high_confidence_min_score and len(factors) >= rca.high_confidence_min_factors:
        return "HIGH"
    if score >= rca.medium_confidence_min_score:
        return "MEDIUM"
    return "LOW"


def load_baseline(db: Session, service_id: str) -> tuple[BaselineStats | None, bool]:
    """Average prior health-history windows. Do not fabricate a baseline."""

    min_windows = get_thresholds().root_cause.min_baseline_windows
    rows = list(
        db.execute(
            select(ServiceHealthHistory)
            .where(ServiceHealthHistory.service_id == service_id)
            .order_by(ServiceHealthHistory.calculated_at.desc(), ServiceHealthHistory.id.desc())
        )
        .scalars()
        .all()
    )
    prior = rows[1:]
    if len(prior) < min_windows:
        return None, True
    error_rate = sum(row.error_rate for row in prior) / len(prior)
    latency = sum(row.avg_latency_ms for row in prior) / len(prior)
    return BaselineStats(error_rate=error_rate, avg_latency_ms=latency), False


def _shows_symptoms(service: Service, thresholds) -> bool:
    return (
        service.health_status in {"UNHEALTHY", "DEGRADED"}
        or service.error_rate >= thresholds.health.degraded_error_rate
        or service.avg_latency_ms >= thresholds.latency.high_latency_ms
    )


def _has_unhealthy_dependency_role(
    service: Service,
    graph: nx.DiGraph,
    services: dict[str, Service],
) -> bool:
    """A callee that is already unhealthy is a stronger origin than its callers."""

    if service.health_status != "UNHEALTHY":
        return False
    if service.id not in graph:
        return False
    predecessors = list(graph.predecessors(service.id))
    return bool(predecessors)


def _hypothetical_message(failed: Service) -> str:
    parts = [
        HYPOTHETICAL_MESSAGE,
        f"{failed.name} was selected as a hypothetical failure target.",
    ]
    if failed.health_status == "HEALTHY":
        parts.append(
            "This simulation does not confirm a production root cause. "
            f"{failed.name} was selected as the hypothetical failure target. "
            "The observed telemetry does not indicate that the service was currently failing."
        )
    else:
        parts.append(
            f"{failed.name} is an observed {failed.health_status.lower()} service that was "
            "selected as the simulation target. That does not establish causality."
        )
    return " ".join(parts)
