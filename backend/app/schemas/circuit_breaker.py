"""Circuit breaker schemas."""

from __future__ import annotations

from pydantic import Field

from app.schemas.common import APIModel


class CircuitBreakerDependency(APIModel):
    source: str
    target: str
    source_service_id: str
    target_service_id: str
    dependency_id: str


class CircuitBreakerItem(APIModel):
    id: str
    dependency: CircuitBreakerDependency
    state: str
    failure_threshold: float
    cooldown_seconds: float
    recovery_threshold: float
    opened_at: str | None = None
    last_transition_at: str | None = None
    created_at: str
    updated_at: str


class CircuitBreakerListResponse(APIModel):
    items: list[CircuitBreakerItem]
    total: int


class CircuitBreakerSimulateRequest(APIModel):
    dependency_id: str
    simulated_error_rate: float = Field(ge=0.0, le=1.0)
    simulated_health_score: float = Field(ge=0.0, le=100.0)
    elapsed_seconds: float | None = Field(default=None, ge=0.0)


class CircuitBreakerSimulateResponse(APIModel):
    dependency: dict
    previous_state: str
    new_state: str
    reason: str
    simulated_error_rate: float
    simulated_health_score: float
    transition_id: str | None = None
    timestamp: str
    kind: str = "real_circuit_transition"


class CircuitBreakerTransitionRequest(APIModel):
    new_state: str
    reason: str = "Manual transition"


class CircuitBreakerTransitionItem(APIModel):
    id: str
    circuit_breaker_id: str
    previous_state: str
    new_state: str
    reason: str
    error_rate: float | None = None
    health_score: float | None = None
    timestamp: str
