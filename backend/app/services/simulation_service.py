"""Failure simulation without mutating live service health."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config.thresholds import get_thresholds
from app.core.logging import get_logger
from app.core.utils import clamp, isoformat, new_id, utc_now
from app.db.models import IncidentSimulation, Service, SimulationRun
from app.schemas.simulation import (
    PredictedCircuitTransition,
    SimulatedAffectedService,
    SimulatedFailedService,
    SimulationListItem,
    SimulationListResponse,
    SimulationResponse,
    TimelineEvent,
    TimelineResponse,
)
from app.services.blast_radius_service import analyze_failure_set, calculate_blast_radius, classify_impact_level
from app.services.circuit_breaker_service import predict_transitions_for_failure
from app.services.dataset_service import active_dataset_id, list_active_services
from app.services.graph_service import get_service_or_404

logger = get_logger("weft.simulation")


def classify_severity(blast_radius_score: float, critical_services_affected: int) -> str:
    thresholds = get_thresholds().severity
    score = blast_radius_score
    if critical_services_affected > 0 and score >= thresholds.high_max:
        return "CRITICAL"
    if score >= thresholds.high_max:
        return "CRITICAL"
    if score >= thresholds.medium_max:
        return "HIGH"
    if score >= thresholds.low_max:
        return "MEDIUM"
    return "LOW"


def simulate_failure(db: Session, service_id: str) -> SimulationResponse:
    failed = get_service_or_404(db, service_id)
    snapshot_health = {row.id: row.health_score for row in list_active_services(db)}
    logger.info("Failure simulation start for %s (%s)", failed.name, failed.id)

    blast = calculate_blast_radius(db, failed.id)
    predictions = predict_transitions_for_failure(db, failed.id)
    critical_min = get_thresholds().critical_service.min_criticality_score

    affected: list[SimulatedAffectedService] = []
    for row in blast.affected_services:
        service = db.get(Service, row.service_id)
        if service is None:
            continue
        current_health = snapshot_health.get(service.id, service.health_score)
        if row.service_id == failed.id:
            projected = 0.0
        else:
            projected = clamp(current_health * (1 - row.impact_probability), 0.0, 100.0)
        affected.append(
            SimulatedAffectedService(
                service_id=service.id,
                service_name=service.name,
                impact_probability=row.impact_probability,
                distance=row.distance,
                criticality_score=service.effective_criticality_score(),
                current_health_score=current_health,
                projected_health_score=round(projected, 4),
                impact_level=classify_impact_level(row.impact_probability),
                direct=row.direct,
                caused_by=[failed.id],
            )
        )
    affected.sort(key=lambda item: (-item.impact_probability, item.distance, item.service_name))
    directly = [item for item in affected if item.service_id != failed.id and (item.direct or item.distance == 1)]
    indirectly = [item for item in affected if item.service_id != failed.id and item not in directly]
    callers = [item for item in affected if item.service_id != failed.id]

    critical_count = sum(1 for item in affected if item.criticality_score >= critical_min)
    estimated_requests = sum(
        (db.get(Service, item.service_id).total_calls if db.get(Service, item.service_id) else 0)
        for item in affected
    )
    severity = classify_severity(blast.blast_radius_score, critical_count)
    created_at = utc_now()
    explanation = (
        f"Simulated failure of {failed.name} affects {len(affected)} service(s) "
        f"with blast-radius score {blast.blast_radius_score:.1f} and severity {severity}. "
        "No live service health was modified."
    )

    predicted_models = [
        PredictedCircuitTransition(
            circuit_breaker_id=item.get("circuit_breaker_id"),
            dependency_id=item["dependency_id"],
            source=item["source"],
            target=item["target"],
            previous_state=item["previous_state"],
            new_state=item["new_state"],
            reason=item["reason"],
            kind="predicted_circuit_transition",
        )
        for item in predictions
    ]

    response = SimulationResponse(
        simulation_id=new_id(),
        failed_service=SimulatedFailedService(id=failed.id, name=failed.name),
        failed_services=[SimulatedFailedService(id=failed.id, name=failed.name)],
        severity=severity,
        blast_radius_score=blast.blast_radius_score,
        services_affected=len(affected),
        critical_services_affected=critical_count,
        estimated_requests_affected=estimated_requests,
        directly_affected=directly,
        indirectly_affected=indirectly,
        affected_services=affected,
        predicted_circuit_transitions=predicted_models,
        explanation=explanation,
        created_at=isoformat(created_at) or "",
    )

    run = SimulationRun(
        id=response.simulation_id,
        dataset_id=failed.dataset_id,
        failed_service_id=failed.id,
        failed_service_ids=[failed.id],
        blast_radius_score=blast.blast_radius_score,
        severity=severity,
        affected_service_count=len(affected),
        critical_service_count=critical_count,
        estimated_request_impact=estimated_requests,
        result_json=response.model_dump(),
        created_at=created_at,
    )
    db.add(run)
    _write_timeline(db, run, failed, blast, predictions, created_at)
    db.flush()

    for service in list_active_services(db):
        if service.id in snapshot_health:
            service.health_score = snapshot_health[service.id]

    logger.info("Failure simulation complete id=%s severity=%s", run.id, severity)
    return response


_STATE_RANK = {"CLOSED": 0, "HALF_OPEN": 1, "OPEN": 2}


def simulate_multi_failure(db: Session, service_ids: list[str]) -> SimulationResponse:
    unique_ids: list[str] = []
    for service_id in service_ids:
        if service_id not in unique_ids:
            unique_ids.append(service_id)
    if not unique_ids:
        from app.core.exceptions import ValidationFailedError

        raise ValidationFailedError("service_ids must contain at least one service")

    failed_models = [get_service_or_404(db, service_id) for service_id in unique_ids]
    snapshot_health = {row.id: row.health_score for row in list_active_services(db)}
    logger.info("Multi-failure simulation start for %s", [item.name for item in failed_models])

    _graph, _services, blast_rows, score, caused_by = analyze_failure_set(db, unique_ids)
    failed_set = set(unique_ids)
    predictions = _union_predictions(db, unique_ids)
    critical_min = get_thresholds().critical_service.min_criticality_score

    affected: list[SimulatedAffectedService] = []
    for row in blast_rows:
        service = db.get(Service, row.service_id)
        if service is None:
            continue
        current_health = snapshot_health.get(service.id, service.health_score)
        if row.service_id in failed_set:
            projected = 0.0
        else:
            projected = clamp(current_health * (1 - row.impact_probability), 0.0, 100.0)
        affected.append(
            SimulatedAffectedService(
                service_id=service.id,
                service_name=service.name,
                impact_probability=row.impact_probability,
                distance=row.distance,
                criticality_score=service.effective_criticality_score(),
                current_health_score=current_health,
                projected_health_score=round(projected, 4),
                impact_level=classify_impact_level(row.impact_probability),
                direct=row.direct,
                caused_by=caused_by.get(service.id, []),
            )
        )
    affected.sort(key=lambda item: (-item.impact_probability, item.distance, item.service_name))
    directly = [item for item in affected if item.service_id not in failed_set and (item.direct or item.distance == 1)]
    indirectly = [item for item in affected if item.service_id not in failed_set and item not in directly]

    critical_count = sum(1 for item in affected if item.criticality_score >= critical_min)
    estimated_requests = sum(
        (db.get(Service, item.service_id).total_calls if db.get(Service, item.service_id) else 0)
        for item in affected
    )
    severity = classify_severity(score, critical_count)
    created_at = utc_now()
    names = ", ".join(item.name for item in failed_models)
    explanation = (
        f"Simulated failure of {names} affects {len(affected)} service(s) "
        f"with blast-radius score {score:.1f} and severity {severity}. "
        "No live service health was modified."
    )
    predicted_models = [
        PredictedCircuitTransition(
            circuit_breaker_id=item.get("circuit_breaker_id"),
            dependency_id=item["dependency_id"],
            source=item["source"],
            target=item["target"],
            previous_state=item["previous_state"],
            new_state=item["new_state"],
            reason=item["reason"],
            kind="predicted_circuit_transition",
        )
        for item in predictions
    ]
    failed_services = [SimulatedFailedService(id=item.id, name=item.name) for item in failed_models]
    response = SimulationResponse(
        simulation_id=new_id(),
        failed_service=failed_services[0],
        failed_services=failed_services,
        severity=severity,
        blast_radius_score=score,
        services_affected=len(affected),
        critical_services_affected=critical_count,
        estimated_requests_affected=estimated_requests,
        directly_affected=directly,
        indirectly_affected=indirectly,
        affected_services=affected,
        predicted_circuit_transitions=predicted_models,
        explanation=explanation,
        created_at=isoformat(created_at) or "",
    )
    run = SimulationRun(
        id=response.simulation_id,
        dataset_id=failed_models[0].dataset_id,
        failed_service_id=failed_models[0].id,
        failed_service_ids=unique_ids,
        blast_radius_score=score,
        severity=severity,
        affected_service_count=len(affected),
        critical_service_count=critical_count,
        estimated_request_impact=estimated_requests,
        result_json=response.model_dump(),
        created_at=created_at,
    )
    db.add(run)
    _write_multi_timeline(db, run, failed_models, blast_rows, predictions, created_at)
    db.flush()
    for service in list_active_services(db):
        if service.id in snapshot_health:
            service.health_score = snapshot_health[service.id]
    logger.info("Multi-failure simulation complete id=%s severity=%s", run.id, severity)
    return response


def _union_predictions(db: Session, failed_ids: list[str]) -> list[dict]:
    merged: dict[str, dict] = {}
    for failed_id in failed_ids:
        for item in predict_transitions_for_failure(db, failed_id):
            current = merged.get(item["dependency_id"])
            if current is None or _STATE_RANK.get(item["new_state"], 0) > _STATE_RANK.get(current["new_state"], 0):
                merged[item["dependency_id"]] = item
    return list(merged.values())


def _write_multi_timeline(db, run, failed_models, blast_rows, predictions, created_at) -> None:
    events = []
    for failed in failed_models:
        events.append(
            IncidentSimulation(
                simulation_run_id=run.id,
                event_type="FAILURE_DETECTED",
                service_id=failed.id,
                message=f"{failed.name} marked failed for simulation",
                timestamp=created_at,
            )
        )
    events.append(
        IncidentSimulation(
            simulation_run_id=run.id,
            event_type="BLAST_RADIUS_CALCULATED",
            service_id=failed_models[0].id,
            message=f"{len(blast_rows)} services potentially affected",
            timestamp=created_at,
        )
    )
    failed_ids = {item.id for item in failed_models}
    for item in blast_rows:
        if item.service_id in failed_ids:
            continue
        events.append(
            IncidentSimulation(
                simulation_run_id=run.id,
                event_type="SERVICE_AFFECTED",
                service_id=item.service_id,
                message=(
                    f"{item.service_name} impact probability {item.impact_probability:.2f} "
                    f"at distance {item.distance}"
                ),
                timestamp=created_at,
            )
        )
    for prediction in predictions:
        events.append(
            IncidentSimulation(
                simulation_run_id=run.id,
                event_type="CIRCUIT_BREAKER_OPENED",
                service_id=None,
                circuit_breaker_id=prediction.get("circuit_breaker_id"),
                previous_state=prediction["previous_state"],
                new_state=prediction["new_state"],
                message=(
                    f"Predicted circuit transition {prediction['previous_state']} -> "
                    f"{prediction['new_state']} for {prediction['source']} -> {prediction['target']}"
                ),
                timestamp=created_at,
            )
        )
    events.append(
        IncidentSimulation(
            simulation_run_id=run.id,
            event_type="SIMULATION_COMPLETED",
            service_id=failed_models[0].id,
            message=f"Simulation completed with severity {run.severity}",
            timestamp=created_at,
        )
    )
    for event in events:
        db.add(event)


def list_simulations(db: Session, limit: int = 50, offset: int = 0) -> SimulationListResponse:
    dataset_id = active_dataset_id(db)
    if not dataset_id:
        return SimulationListResponse(items=[], total=0, limit=limit, offset=offset)
    rows = list(
        db.execute(
            select(SimulationRun)
            .where(SimulationRun.dataset_id == dataset_id)
            .order_by(SimulationRun.created_at.desc())
        ).scalars().all()
    )
    sliced = rows[offset : offset + limit]
    items: list[SimulationListItem] = []
    for row in sliced:
        service = db.get(Service, row.failed_service_id)
        items.append(
            SimulationListItem(
                id=row.id,
                failed_service_id=row.failed_service_id,
                failed_service_name=service.name if (service := db.get(Service, row.failed_service_id)) else row.failed_service_id,
                severity=row.severity,
                blast_radius_score=row.blast_radius_score,
                affected_service_count=row.affected_service_count,
                created_at=isoformat(row.created_at) or "",
            )
        )
    return SimulationListResponse(items=items, total=len(rows), limit=limit, offset=offset)


def _get_active_simulation(db: Session, simulation_id: str) -> SimulationRun:
    from app.core.exceptions import NotFoundError

    run = db.get(SimulationRun, simulation_id)
    dataset_id = active_dataset_id(db)
    if run is None or not dataset_id or run.dataset_id != dataset_id:
        raise NotFoundError(
            f"Simulation '{simulation_id}' was not found in the active dataset",
            code="SIMULATION_NOT_FOUND",
            details={"simulation_id": simulation_id},
        )
    return run


def get_simulation(db: Session, simulation_id: str) -> SimulationResponse:
    run = _get_active_simulation(db, simulation_id)
    return SimulationResponse.model_validate(run.result_json)


def get_timeline(db: Session, simulation_id: str) -> TimelineResponse:
    run = _get_active_simulation(db, simulation_id)
    events = list(
        db.execute(
            select(IncidentSimulation)
            .where(IncidentSimulation.simulation_run_id == simulation_id)
            .order_by(IncidentSimulation.timestamp.asc(), IncidentSimulation.id.asc())
        ).scalars().all()
    )
    items: list[TimelineEvent] = []
    for event in events:
        service = db.get(Service, event.service_id) if event.service_id else None
        items.append(
            TimelineEvent(
                timestamp=isoformat(event.timestamp) or "",
                type=event.event_type,
                service=service.name if service else None,
                message=event.message,
                previous_state=event.previous_state,
                new_state=event.new_state,
                circuit_breaker_id=event.circuit_breaker_id,
            )
        )
    return TimelineResponse(simulation_id=simulation_id, items=items)


def stream_failure_events(db: Session, service_id: str) -> list[tuple[str, dict]]:
    """Compute SSE events without mutating live health."""

    result = simulate_failure(db, service_id)
    events: list[tuple[str, dict]] = [
        (
            "blast_radius_start",
            {
                "simulation_id": result.simulation_id,
                "failed_service": result.failed_service.model_dump(),
            },
        )
    ]
    for item in result.affected_services:
        events.append(("service_affected", item.model_dump()))
    events.append(
        (
            "blast_radius_complete",
            {
                "simulation_id": result.simulation_id,
                "severity": result.severity,
                "blast_radius_score": result.blast_radius_score,
                "services_affected": result.services_affected,
                "predicted_circuit_transitions": [
                    item.model_dump() for item in result.predicted_circuit_transitions
                ],
            },
        )
    )
    return events


def _write_timeline(
    db: Session,
    run: SimulationRun,
    failed: Service,
    blast,
    predictions: list[dict],
    created_at,
) -> None:
    events = [
        IncidentSimulation(
            simulation_run_id=run.id,
            event_type="FAILURE_DETECTED",
            service_id=failed.id,
            message=f"{failed.name} marked failed for simulation",
            timestamp=created_at,
        ),
        IncidentSimulation(
            simulation_run_id=run.id,
            event_type="BLAST_RADIUS_CALCULATED",
            service_id=failed.id,
            message=f"{blast.total_affected} services potentially affected",
            timestamp=created_at,
        ),
    ]
    for item in blast.affected_services:
        if item.service_id == failed.id:
            continue
        events.append(
            IncidentSimulation(
                simulation_run_id=run.id,
                event_type="SERVICE_AFFECTED",
                service_id=item.service_id,
                message=(
                    f"{item.service_name} impact probability {item.impact_probability:.2f} "
                    f"at distance {item.distance}"
                ),
                timestamp=created_at,
            )
        )
    for prediction in predictions:
        events.append(
            IncidentSimulation(
                simulation_run_id=run.id,
                event_type="CIRCUIT_BREAKER_OPENED",
                service_id=None,
                circuit_breaker_id=prediction.get("circuit_breaker_id"),
                previous_state=prediction["previous_state"],
                new_state=prediction["new_state"],
                message=(
                    f"Predicted circuit transition {prediction['previous_state']} -> "
                    f"{prediction['new_state']} for {prediction['source']} -> {prediction['target']}"
                ),
                timestamp=created_at,
            )
        )
    events.append(
        IncidentSimulation(
            simulation_run_id=run.id,
            event_type="SIMULATION_COMPLETED",
            service_id=failed.id,
            message=f"Simulation completed with severity {run.severity}",
            timestamp=created_at,
        )
    )
    for event in events:
        db.add(event)
