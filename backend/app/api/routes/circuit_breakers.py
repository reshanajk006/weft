"""Circuit-breaker simulation routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.schemas.circuit_breaker import (
    CircuitBreakerItem,
    CircuitBreakerListResponse,
    CircuitBreakerSimulateRequest,
    CircuitBreakerSimulateResponse,
    CircuitBreakerTransitionRequest,
)
from app.services.circuit_breaker_service import (
    force_transition,
    get_circuit_breaker,
    list_circuit_breakers,
    reset_circuit_breaker,
    simulate_circuit_breaker,
)

router = APIRouter(prefix="/circuit-breakers", tags=["Circuit Breakers"])


@router.get(
    "",
    response_model=CircuitBreakerListResponse,
    summary="List simulated circuit breakers",
)
def list_breakers(db: Session = Depends(get_db)) -> CircuitBreakerListResponse:
    return list_circuit_breakers(db)


@router.get(
    "/{circuit_breaker_id}",
    response_model=CircuitBreakerItem,
    summary="Get a circuit breaker",
)
def get_breaker(circuit_breaker_id: str, db: Session = Depends(get_db)) -> CircuitBreakerItem:
    return get_circuit_breaker(db, circuit_breaker_id)


@router.post(
    "/simulate",
    response_model=CircuitBreakerSimulateResponse,
    summary="Simulate a circuit-breaker evaluation",
    description="State-machine simulation only. This does not control production traffic.",
)
def simulate(payload: CircuitBreakerSimulateRequest, db: Session = Depends(get_db)) -> CircuitBreakerSimulateResponse:
    return simulate_circuit_breaker(
        db,
        dependency_id=payload.dependency_id,
        simulated_error_rate=payload.simulated_error_rate,
        simulated_health_score=payload.simulated_health_score,
        elapsed_seconds=payload.elapsed_seconds,
    )


@router.post(
    "/{circuit_breaker_id}/reset",
    response_model=CircuitBreakerItem,
    summary="Reset a circuit breaker to CLOSED",
)
def reset(circuit_breaker_id: str, db: Session = Depends(get_db)) -> CircuitBreakerItem:
    return reset_circuit_breaker(db, circuit_breaker_id)


@router.post(
    "/{circuit_breaker_id}/transition",
    response_model=CircuitBreakerItem,
    status_code=status.HTTP_200_OK,
    summary="Force a circuit-breaker state transition",
)
def transition(
    circuit_breaker_id: str,
    payload: CircuitBreakerTransitionRequest,
    db: Session = Depends(get_db),
) -> CircuitBreakerItem:
    return force_transition(db, circuit_breaker_id, payload.new_state, payload.reason)
