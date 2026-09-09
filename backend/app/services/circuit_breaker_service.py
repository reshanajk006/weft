"""Deterministic circuit-breaker state-machine simulation."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config.thresholds import get_thresholds
from app.core.exceptions import BadRequestError, NotFoundError
from app.core.logging import get_logger
from app.core.utils import isoformat, new_id, utc_now
from app.db.models import CircuitBreakerState, CircuitBreakerTransition, Dependency, Service
from app.schemas.circuit_breaker import (
    CircuitBreakerDependency,
    CircuitBreakerItem,
    CircuitBreakerListResponse,
    CircuitBreakerSimulateResponse,
    CircuitBreakerTransitionItem,
)

from app.services.dataset_service import active_dataset_id

logger = get_logger("weft.circuit_breaker")

VALID_STATES = {"CLOSED", "OPEN", "HALF_OPEN"}


def ensure_circuit_breakers_for_dependencies(db: Session, dataset_id: str | None = None) -> None:
    thresholds = get_thresholds().circuit_breaker
    query = select(Dependency)
    if dataset_id:
        query = query.where(Dependency.dataset_id == dataset_id)
    dependencies = list(db.execute(query).scalars().all())
    for dependency in dependencies:
        existing = db.execute(
            select(CircuitBreakerState).where(CircuitBreakerState.dependency_id == dependency.id)
        ).scalar_one_or_none()
        if existing is None:
            db.add(
                CircuitBreakerState(
                    id=new_id(),
                    dataset_id=dataset_id or dependency.dataset_id,
                    source_service_id=dependency.source_service_id,
                    target_service_id=dependency.target_service_id,
                    dependency_id=dependency.id,
                    state="CLOSED",
                    failure_threshold=thresholds.error_threshold,
                    cooldown_seconds=thresholds.cooldown_seconds,
                    recovery_threshold=thresholds.recovery_health_threshold,
                )
            )
    db.flush()


def list_circuit_breakers(db: Session) -> CircuitBreakerListResponse:
    dataset_id = active_dataset_id(db)
    if not dataset_id:
        return CircuitBreakerListResponse(items=[], total=0)
    ensure_circuit_breakers_for_dependencies(db, dataset_id=dataset_id)
    rows = list(
        db.execute(
            select(CircuitBreakerState)
            .where(CircuitBreakerState.dataset_id == dataset_id)
            .order_by(CircuitBreakerState.created_at)
        ).scalars().all()
    )
    items = [_to_item(db, row) for row in rows]
    items.sort(key=lambda item: (item.dependency.source, item.dependency.target))
    return CircuitBreakerListResponse(items=items, total=len(items))


def get_circuit_breaker(db: Session, circuit_breaker_id: str) -> CircuitBreakerItem:
    row = db.get(CircuitBreakerState, circuit_breaker_id)
    if row is None:
        raise NotFoundError(
            f"Circuit breaker '{circuit_breaker_id}' was not found",
            code="CIRCUIT_BREAKER_NOT_FOUND",
            details={"id": circuit_breaker_id},
        )
    return _to_item(db, row)


def reset_circuit_breaker(db: Session, circuit_breaker_id: str) -> CircuitBreakerItem:
    row = _get_cb(db, circuit_breaker_id)
    previous = row.state
    now = utc_now()
    row.state = "CLOSED"
    row.opened_at = None
    row.last_transition_at = now
    row.updated_at = now
    transition = CircuitBreakerTransition(
        id=new_id(),
        circuit_breaker_id=row.id,
        previous_state=previous,
        new_state="CLOSED",
        reason="Circuit breaker reset",
        timestamp=now,
    )
    db.add(transition)
    db.flush()
    logger.info("Circuit breaker %s reset %s -> CLOSED", row.id, previous)
    return _to_item(db, row)


def force_transition(db: Session, circuit_breaker_id: str, new_state: str, reason: str) -> CircuitBreakerItem:
    state = new_state.upper()
    if state not in VALID_STATES:
        raise BadRequestError(f"Invalid circuit breaker state '{new_state}'")
    row = _get_cb(db, circuit_breaker_id)
    previous = row.state
    now = utc_now()
    row.state = state
    if state == "OPEN":
        row.opened_at = now
    if state == "CLOSED":
        row.opened_at = None
    row.last_transition_at = now
    row.updated_at = now
    db.add(
        CircuitBreakerTransition(
            id=new_id(),
            circuit_breaker_id=row.id,
            previous_state=previous,
            new_state=state,
            reason=reason,
            timestamp=now,
        )
    )
    db.flush()
    return _to_item(db, row)


def simulate_circuit_breaker(
    db: Session,
    dependency_id: str,
    simulated_error_rate: float,
    simulated_health_score: float,
    elapsed_seconds: float | None = None,
    now: datetime | None = None,
) -> CircuitBreakerSimulateResponse:
    ensure_circuit_breakers_for_dependencies(db)
    dependency = db.get(Dependency, dependency_id)
    if dependency is None:
        raise NotFoundError(
            f"Dependency '{dependency_id}' was not found",
            code="DEPENDENCY_NOT_FOUND",
            details={"dependency_id": dependency_id},
        )
    row = db.execute(
        select(CircuitBreakerState).where(CircuitBreakerState.dependency_id == dependency_id)
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError("Circuit breaker was not found for dependency", code="CIRCUIT_BREAKER_NOT_FOUND")

    timestamp = now or utc_now()
    previous = row.state
    new_state, reason = evaluate_transition(
        current_state=row.state,
        error_rate=simulated_error_rate,
        health_score=simulated_health_score,
        failure_threshold=row.failure_threshold,
        recovery_threshold=row.recovery_threshold,
        cooldown_seconds=row.cooldown_seconds,
        opened_at=row.opened_at,
        now=timestamp,
        elapsed_seconds=elapsed_seconds,
    )
    transition_id = None
    if new_state != previous:
        row.state = new_state
        if new_state == "OPEN":
            row.opened_at = timestamp
        if new_state == "CLOSED":
            row.opened_at = None
        row.last_transition_at = timestamp
        row.updated_at = timestamp
        transition = CircuitBreakerTransition(
            id=new_id(),
            circuit_breaker_id=row.id,
            previous_state=previous,
            new_state=new_state,
            reason=reason,
            error_rate=simulated_error_rate,
            health_score=simulated_health_score,
            timestamp=timestamp,
        )
        db.add(transition)
        db.flush()
        transition_id = transition.id
        logger.info(
            "Circuit breaker %s transition %s -> %s (%s)",
            row.id,
            previous,
            new_state,
            reason,
        )
    else:
        reason = reason or f"No transition from {previous}"

    source = db.get(Service, row.source_service_id)
    target = db.get(Service, row.target_service_id)
    return CircuitBreakerSimulateResponse(
        dependency={
            "source": source.name if source else row.source_service_id,
            "target": target.name if target else row.target_service_id,
            "source_service_id": row.source_service_id,
            "target_service_id": row.target_service_id,
            "dependency_id": dependency_id,
        },
        previous_state=previous,
        new_state=new_state,
        reason=reason,
        simulated_error_rate=simulated_error_rate,
        simulated_health_score=simulated_health_score,
        transition_id=transition_id,
        timestamp=isoformat(timestamp) or "",
        kind="real_circuit_transition",
    )


def evaluate_transition(
    current_state: str,
    error_rate: float,
    health_score: float,
    failure_threshold: float,
    recovery_threshold: float,
    cooldown_seconds: float,
    opened_at: datetime | None,
    now: datetime,
    elapsed_seconds: float | None = None,
) -> tuple[str, str]:
    """Return the next state and reason. One transition per evaluation."""

    if current_state == "CLOSED":
        if error_rate >= failure_threshold:
            return "OPEN", (
                f"Error rate {error_rate:.0%} exceeded threshold {failure_threshold:.0%}"
            )
        return "CLOSED", f"Error rate {error_rate:.0%} is below threshold {failure_threshold:.0%}"

    if current_state == "OPEN":
        elapsed = elapsed_seconds
        if elapsed is None and opened_at is not None:
            opened = opened_at if opened_at.tzinfo else opened_at.replace(tzinfo=timezone.utc)
            elapsed = (now - opened).total_seconds()
        if elapsed is None:
            elapsed = 0.0
        if elapsed >= cooldown_seconds:
            return "HALF_OPEN", f"Cooldown of {cooldown_seconds:.0f}s elapsed"
        remaining = cooldown_seconds - elapsed
        return "OPEN", f"Cooldown remaining {remaining:.0f}s"

    if current_state == "HALF_OPEN":
        if health_score >= recovery_threshold:
            return "CLOSED", (
                f"Simulated health {health_score:.0f} is above recovery threshold {recovery_threshold:.0f}"
            )
        return "OPEN", (
            f"Simulated health {health_score:.0f} is below recovery threshold {recovery_threshold:.0f}"
        )

    return current_state, f"Unknown state {current_state}"


def predict_transitions_for_failure(db: Session, failed_service_id: str) -> list[dict]:
    """Predict caller circuit breakers that would open if the target service fails.

    These are predicted transitions only and do not mutate circuit breaker state.
    """

    ensure_circuit_breakers_for_dependencies(db)
    thresholds = get_thresholds().circuit_breaker
    dependencies = list(
        db.execute(select(Dependency).where(Dependency.target_service_id == failed_service_id)).scalars().all()
    )
    predictions: list[dict] = []
    for dependency in sorted(dependencies, key=lambda dep: dep.id):
        cb = db.execute(
            select(CircuitBreakerState).where(CircuitBreakerState.dependency_id == dependency.id)
        ).scalar_one_or_none()
        if cb is None:
            continue
        source = db.get(Service, dependency.source_service_id)
        target = db.get(Service, dependency.target_service_id)
        simulated_error = 1.0
        simulated_health = 0.0
        new_state, reason = evaluate_transition(
            current_state=cb.state,
            error_rate=simulated_error,
            health_score=simulated_health,
            failure_threshold=cb.failure_threshold,
            recovery_threshold=cb.recovery_threshold,
            cooldown_seconds=cb.cooldown_seconds,
            opened_at=cb.opened_at,
            now=utc_now(),
        )
        if new_state != cb.state:
            predictions.append(
                {
                    "circuit_breaker_id": cb.id,
                    "dependency_id": dependency.id,
                    "source": source.name if source else dependency.source_service_id,
                    "target": target.name if target else dependency.target_service_id,
                    "previous_state": cb.state,
                    "new_state": new_state,
                    "reason": reason,
                    "kind": "predicted_circuit_transition",
                }
            )
    return predictions


def list_transitions(db: Session, circuit_breaker_id: str) -> list[CircuitBreakerTransitionItem]:
    _get_cb(db, circuit_breaker_id)
    rows = list(
        db.execute(
            select(CircuitBreakerTransition)
            .where(CircuitBreakerTransition.circuit_breaker_id == circuit_breaker_id)
            .order_by(CircuitBreakerTransition.timestamp.desc())
        ).scalars().all()
    )
    return [
        CircuitBreakerTransitionItem(
            id=row.id,
            circuit_breaker_id=row.circuit_breaker_id,
            previous_state=row.previous_state,
            new_state=row.new_state,
            reason=row.reason,
            error_rate=row.error_rate,
            health_score=row.health_score,
            timestamp=isoformat(row.timestamp) or "",
        )
        for row in rows
    ]


def _get_cb(db: Session, circuit_breaker_id: str) -> CircuitBreakerState:
    row = db.get(CircuitBreakerState, circuit_breaker_id)
    if row is None:
        raise NotFoundError(
            f"Circuit breaker '{circuit_breaker_id}' was not found",
            code="CIRCUIT_BREAKER_NOT_FOUND",
            details={"id": circuit_breaker_id},
        )
    return row


def _to_item(db: Session, row: CircuitBreakerState) -> CircuitBreakerItem:
    source = db.get(Service, row.source_service_id)
    target = db.get(Service, row.target_service_id)
    return CircuitBreakerItem(
        id=row.id,
        dependency=CircuitBreakerDependency(
            source=source.name if source else row.source_service_id,
            target=target.name if target else row.target_service_id,
            source_service_id=row.source_service_id,
            target_service_id=row.target_service_id,
            dependency_id=row.dependency_id,
        ),
        state=row.state,
        failure_threshold=row.failure_threshold,
        cooldown_seconds=row.cooldown_seconds,
        recovery_threshold=row.recovery_threshold,
        opened_at=isoformat(row.opened_at),
        last_transition_at=isoformat(row.last_transition_at),
        created_at=isoformat(row.created_at) or "",
        updated_at=isoformat(row.updated_at) or "",
    )
