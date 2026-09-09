"""Failure simulation schemas."""

from __future__ import annotations

from app.schemas.common import APIModel


class SimulatedFailedService(APIModel):
    id: str
    name: str


class SimulatedAffectedService(APIModel):
    service_id: str
    service_name: str
    impact_probability: float
    distance: int
    criticality_score: float
    current_health_score: float
    projected_health_score: float
    impact_level: str
    direct: bool


class PredictedCircuitTransition(APIModel):
    circuit_breaker_id: str | None = None
    dependency_id: str
    source: str
    target: str
    previous_state: str
    new_state: str
    reason: str
    kind: str = "predicted_circuit_transition"


class SimulationResponse(APIModel):
    simulation_id: str
    failed_service: SimulatedFailedService
    severity: str
    blast_radius_score: float
    services_affected: int
    critical_services_affected: int
    estimated_requests_affected: int
    directly_affected: list[SimulatedAffectedService]
    indirectly_affected: list[SimulatedAffectedService]
    affected_services: list[SimulatedAffectedService]
    predicted_circuit_transitions: list[PredictedCircuitTransition]
    explanation: str
    created_at: str


class TimelineEvent(APIModel):
    timestamp: str
    type: str
    service: str | None = None
    message: str
    previous_state: str | None = None
    new_state: str | None = None
    circuit_breaker_id: str | None = None


class SimulationListItem(APIModel):
    id: str
    failed_service_id: str
    failed_service_name: str
    severity: str
    blast_radius_score: float
    affected_service_count: int
    created_at: str


class SimulationListResponse(APIModel):
    items: list[SimulationListItem]
    total: int
    limit: int
    offset: int


class TimelineResponse(APIModel):
    simulation_id: str
    items: list[TimelineEvent]
