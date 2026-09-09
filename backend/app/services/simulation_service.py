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
from app.services.blast_radius_service import calculate_blast_radius, classify_impact_level
from app.services.circuit_breaker_service import predict_transitions_for_failure
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
    snapshot_health = {row.id: row.health_score for row in db.execute(select(Service)).scalars().all()}
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
                criticality_score=service.criticality_score,
                current_health_score=current_health,
                projected_health_score=round(projected, 4),
                impact_level=classify_impact_level(row.impact_probability),
                direct=row.direct,
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
        failed_service_id=failed.id,
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

    for service in db.execute(select(Service)).scalars().all():
        service.health_score = snapshot_health[service.id]

    logger.info("Failure simulation complete id=%s severity=%s", run.id, severity)
    return response


def list_simulations(db: Session, limit: int = 50, offset: int = 0) -> SimulationListResponse:
    rows = list(
        db.execute(select(SimulationRun).order_by(SimulationRun.created_at.desc())).scalars().all()
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


def get_simulation(db: Session, simulation_id: str) -> SimulationResponse:
    run = db.get(SimulationRun, simulation_id)
    if run is None:
        from app.core.exceptions import NotFoundError

        raise NotFoundError(
            f"Simulation '{simulation_id}' was not found",
            code="SIMULATION_NOT_FOUND",
            details={"simulation_id": simulation_id},
        )
    return SimulationResponse.model_validate(run.result_json)


def get_timeline(db: Session, simulation_id: str) -> TimelineResponse:
    run = db.get(SimulationRun, simulation_id)
    if run is None:
        from app.core.exceptions import NotFoundError

        raise NotFoundError(
            f"Simulation '{simulation_id}' was not found",
            code="SIMULATION_NOT_FOUND",
            details={"simulation_id": simulation_id},
        )
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
