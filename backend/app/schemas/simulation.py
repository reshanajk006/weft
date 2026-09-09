"""Failure simulation schemas."""

from __future__ import annotations

from pydantic import Field, model_validator

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
    caused_by: list[str] = Field(default_factory=list)


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
    failed_services: list[SimulatedFailedService] = Field(default_factory=list)
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

    @model_validator(mode="after")
    def fill_failed_services(self) -> "SimulationResponse":
        if not self.failed_services:
            self.failed_services = [self.failed_service]
        return self


class MultiFailureRequest(APIModel):
    service_ids: list[str] = Field(min_length=1)


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
