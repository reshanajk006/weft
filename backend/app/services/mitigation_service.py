"""Virtual-only mitigation comparison. Never persists weight or health changes."""

from __future__ import annotations

from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.config.thresholds import get_thresholds
from app.core.exceptions import ValidationFailedError
from app.core.utils import clamp, safe_div
from app.db.models import Dependency, Service
from app.schemas.blast_radius import BlastRadiusResponse, BlastRadiusScoreBreakdown
from app.schemas.mitigation import (
    MitigationEdge,
    MitigationImprovement,
    MitigationResponse,
    MitigationSnapshot,
)
from app.schemas.simulation import SimulationResponse
from app.services.analysis_common import is_tier1
from app.services.blast_radius_service import analyze_failure_set, calculate_blast_radius
from app.services.dataset_service import list_active_dependencies
from app.services.simulation_service import _get_active_simulation


def simulate_mitigation(
    db: Session,
    simulation_id: str,
    strategy: str = "FALLBACK",
    dependency_id: str | None = None,
) -> MitigationResponse:
    strategy_norm = (strategy or "FALLBACK").strip().upper()
    if strategy_norm != "FALLBACK":
        raise ValidationFailedError(
            "Only the FALLBACK virtual mitigation strategy is supported",
            details={"strategy": strategy},
        )
    run = _get_active_simulation(db, simulation_id)
    result = SimulationResponse.model_validate(run.result_json)
    failed_ids = list(run.failed_service_ids or [run.failed_service_id])
    virtual_weight = get_thresholds().mitigation.fallback_edge_weight

    edge = _select_fallback_edge(db, failed_ids, dependency_id)
    baseline = _snapshot_from_simulation(db, result)

    if edge is None:
        response = MitigationResponse(
            simulation_id=simulation_id,
            strategy=strategy_norm,
            baseline=baseline,
            mitigated=None,
            improvement=None,
            mitigation={"type": "FALLBACK", "description": "No direct caller edge available"},
            affected_edges=[],
            explanation=(
                "No direct caller edge is available to apply a virtual fallback. "
                "Mitigation comparison was not executed for this simulation."
            ),
            production_changes_executed=False,
        )
        _store(run, response)
        return response

    overrides = {(edge.source_service_id, edge.target_service_id): virtual_weight}
    if len(failed_ids) == 1:
        blast = calculate_blast_radius(db, failed_ids[0], edge_weight_overrides=overrides)
        mitigated = _snapshot_from_blast(db, blast, failed_ids)
        score = blast.blast_radius_score
        affected_count = blast.total_affected
    else:
        _graph, services, rows, score, _caused, breakdown = analyze_failure_set(
            db,
            failed_ids,
            edge_weight_overrides=overrides,
        )
        mitigated = _snapshot_from_rows(db, services, rows, failed_ids, score, breakdown)
        affected_count = len(rows)

    improvement = MitigationImprovement(
        blast_radius_score_delta=round(mitigated.blast_radius_score - baseline.blast_radius_score, 4),
        blast_radius_reduction_percent=_reduction_percent(
            baseline.blast_radius_score, mitigated.blast_radius_score
        ),
        affected_services_delta=mitigated.affected_services - baseline.affected_services,
        tier1_services_delta=mitigated.tier1_services_at_risk - baseline.tier1_services_at_risk,
    )
    source = db.get(Service, edge.source_service_id)
    target = db.get(Service, edge.target_service_id)
    affected_edge = MitigationEdge(
        dependency_id=edge.id,
        source_service_id=edge.source_service_id,
        source_service_name=source.name if source else edge.source_service_id,
        target_service_id=edge.target_service_id,
        target_service_name=target.name if target else edge.target_service_id,
        original_weight=float(edge.critical_weight),
        virtual_weight=virtual_weight,
    )
    source_name = affected_edge.source_service_name
    target_name = affected_edge.target_service_name
    response = MitigationResponse(
        simulation_id=simulation_id,
        strategy=strategy_norm,
        baseline=baseline,
        mitigated=mitigated,
        improvement=improvement,
        mitigation={
            "type": "FALLBACK",
            "description": (
                f"Virtual fail-open fallback on {source_name} → {target_name}: "
                f"propagation weight {edge.critical_weight:.2f} → {virtual_weight:.2f} "
                "during calculation only."
            ),
            "affected_services_after": affected_count,
            "score": score,
        },
        affected_edges=[affected_edge],
        explanation=(
            f"Virtual fallback applied to {source_name} → {target_name} "
            f"(weight {virtual_weight:.2f}) without persisting graph or health changes."
        ),
        production_changes_executed=False,
    )
    _store(run, response)
    return response


def _select_fallback_edge(
    db: Session,
    failed_ids: list[str],
    dependency_id: str | None,
) -> Dependency | None:
    dependencies = list_active_dependencies(db)
    incoming = [row for row in dependencies if row.target_service_id in set(failed_ids)]
    if dependency_id:
        match = next((row for row in incoming if row.id == dependency_id), None)
        if match is None:
            raise ValidationFailedError(
                "dependency_id must be a direct caller edge of the failed service",
                details={"dependency_id": dependency_id},
            )
        return match
    incoming.sort(key=lambda row: (-row.call_count, -float(row.critical_weight), row.id))
    return incoming[0] if incoming else None


def _snapshot_from_simulation(db: Session, result: SimulationResponse) -> MitigationSnapshot:
    failed_ids = {item.id for item in result.failed_services} or {result.failed_service.id}
    tier1 = 0
    caller_health: list[float] = []
    for item in result.affected_services:
        service = db.get(Service, item.service_id)
        if is_tier1(service):
            tier1 += 1
        if item.service_id not in failed_ids:
            caller_health.append(item.projected_health_score)
    return MitigationSnapshot(
        affected_services=result.services_affected,
        tier1_services_at_risk=tier1,
        blast_radius_score=result.blast_radius_score,
        projected_caller_health=_mean(caller_health, default=100.0),
        score_breakdown=result.score_breakdown,
    )


def _snapshot_from_blast(
    db: Session,
    blast: BlastRadiusResponse,
    failed_ids: list[str],
) -> MitigationSnapshot:
    failed = set(failed_ids)
    caller_health: list[float] = []
    tier1 = 0
    for row in blast.affected_services:
        service = db.get(Service, row.service_id)
        if is_tier1(service):
            tier1 += 1
        current = service.health_score if service else 100.0
        if row.service_id in failed:
            continue
        caller_health.append(clamp(current * (1 - row.impact_probability), 0.0, 100.0))
    return MitigationSnapshot(
        affected_services=blast.total_affected,
        tier1_services_at_risk=tier1,
        blast_radius_score=blast.blast_radius_score,
        projected_caller_health=_mean(caller_health, default=100.0),
        score_breakdown=blast.score_breakdown,
    )


def _snapshot_from_rows(
    db: Session,
    services: dict[str, Service | None],
    rows,
    failed_ids: list[str],
    score: float,
    breakdown: BlastRadiusScoreBreakdown,
) -> MitigationSnapshot:
    failed = set(failed_ids)
    caller_health: list[float] = []
    tier1 = 0
    for row in rows:
        service = services.get(row.service_id) or db.get(Service, row.service_id)
        if is_tier1(service):
            tier1 += 1
        current = service.health_score if service else 100.0
        if row.service_id in failed:
            continue
        caller_health.append(clamp(current * (1 - row.impact_probability), 0.0, 100.0))
    return MitigationSnapshot(
        affected_services=len(rows),
        tier1_services_at_risk=tier1,
        blast_radius_score=score,
        projected_caller_health=_mean(caller_health, default=100.0),
        score_breakdown=breakdown,
    )


def _reduction_percent(before: float, after: float) -> float:
    if before <= 0:
        return 0.0
    return round(((before - after) / before) * 100.0, 4)


def _mean(values: list[float], default: float) -> float:
    if not values:
        return default
    return round(safe_div(sum(values), len(values)), 4)


def _store(run, response: MitigationResponse) -> None:
    payload = dict(run.result_json or {})
    payload["mitigation"] = response.model_dump()
    run.result_json = payload
    flag_modified(run, "result_json")
