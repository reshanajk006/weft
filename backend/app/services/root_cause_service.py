"""Deterministic, explainable root-cause ranking from telemetry already in WEFT."""

from __future__ import annotations

import networkx as nx
from sqlalchemy.orm import Session

from app.config.thresholds import get_thresholds
from app.db.models import Service
from app.schemas.analysis import RootCauseCandidate, RootCauseResponse
from app.schemas.simulation import SimulationResponse
from app.services.dataset_service import list_active_services
from app.services.graph_service import build_graph
from app.services.simulation_service import _get_active_simulation


def analyze_root_cause(db: Session, simulation_id: str) -> RootCauseResponse:
    run = _get_active_simulation(db, simulation_id)
    result = SimulationResponse.model_validate(run.result_json)
    graph = build_graph(db)
    thresholds = get_thresholds()
    failed_id = result.failed_service.id
    affected_ids = {item.service_id for item in result.affected_services}
    services = {service.id: service for service in list_active_services(db)}

    candidates: list[RootCauseCandidate] = []
    for service in services.values():
        score, evidence = _score_service(
            service,
            graph,
            failed_id=failed_id,
            affected_ids=affected_ids,
            thresholds=thresholds,
        )
        if score <= 0:
            continue
        callers = []
        if service.id in graph:
            callers = sorted(graph.nodes[nid]["name"] for nid in graph.predecessors(service.id))
        callees = []
        if service.id in graph:
            callees = sorted(graph.nodes[nid]["name"] for nid in graph.successors(service.id))
        candidates.append(
            RootCauseCandidate(
                service_id=service.id,
                service=service.name,
                score=score,
                confidence=_confidence(score, service, failed_id),
                health_status=service.health_status,
                health_score=service.health_score,
                error_rate=service.error_rate,
                avg_latency_ms=service.avg_latency_ms,
                criticality_score=service.effective_criticality_score(),
                called_by=callers,
                calls=callees,
                evidence=evidence,
            )
        )
    candidates.sort(key=lambda item: (-item.score, -item.error_rate, item.service))
    top = candidates[0] if candidates else None
    return RootCauseResponse(
        simulation_id=simulation_id,
        likely_root_cause=top,
        candidates=candidates[:8],
    )


def _score_service(
    service: Service,
    graph: nx.DiGraph,
    *,
    failed_id: str,
    affected_ids: set[str],
    thresholds,
) -> tuple[float, list[str]]:
    score = 0.0
    evidence: list[str] = []
    if service.id == failed_id:
        score += 50
        evidence.append(f"This simulation failed {service.name}.")
    if service.health_status == "UNHEALTHY":
        score += 25
        evidence.append(f"Health status is UNHEALTHY (score {service.health_score:.0f}).")
    elif service.health_status == "DEGRADED":
        score += 10
        evidence.append(f"Health status is DEGRADED (score {service.health_score:.0f}).")
    if service.error_rate >= thresholds.health.critical_error_rate:
        score += 20
        evidence.append(f"Error rate is {service.error_rate:.0%}.")
    elif service.error_rate >= thresholds.health.degraded_error_rate:
        score += 8
        evidence.append(f"Error rate is elevated at {service.error_rate:.0%}.")
    if service.avg_latency_ms >= thresholds.latency.very_high_latency_ms:
        score += 8
        evidence.append(f"Average latency is {service.avg_latency_ms:.0f} ms.")
    elif service.avg_latency_ms >= thresholds.latency.high_latency_ms:
        score += 4
        evidence.append(f"Average latency is {service.avg_latency_ms:.0f} ms.")
    if service.effective_criticality_score() >= thresholds.critical_service.min_criticality_score:
        score += 8
        evidence.append(f"Technical criticality is {service.effective_criticality_score():.1f}.")
    if service.id in graph and failed_id in graph:
        callers = set(graph.predecessors(service.id))
        if callers & affected_ids:
            names = sorted(graph.nodes[nid]["name"] for nid in callers if nid in affected_ids)
            evidence.append(
                f"Upstream callers in the blast radius: {', '.join(names)}."
            )
            score += 6
        if service.id != failed_id and service.id in nx.descendants(graph, failed_id):
            if service.health_status != "HEALTHY":
                score += 4
                evidence.append(f"{service.name} is a callee of the failed service and is not healthy.")
    return score, evidence


def _confidence(score: float, service: Service, failed_id: str) -> str:
    if service.id == failed_id or service.error_rate >= 0.5 or service.health_score <= 0:
        return "High"
    if score >= 25 or service.health_status == "DEGRADED":
        return "Medium"
    return "Low"
