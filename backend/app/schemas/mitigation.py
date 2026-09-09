"""Virtual mitigation comparison schemas. Predictions only; never production changes."""

from __future__ import annotations

from app.schemas.blast_radius import BlastRadiusScoreBreakdown
from app.schemas.common import APIModel


class MitigationSnapshot(APIModel):
    affected_services: int
    tier1_services_at_risk: int
    blast_radius_score: float
    projected_caller_health: float
    score_breakdown: BlastRadiusScoreBreakdown | None = None


class MitigationImprovement(APIModel):
    blast_radius_score_delta: float
    blast_radius_reduction_percent: float
    affected_services_delta: int
    tier1_services_delta: int


class MitigationEdge(APIModel):
    dependency_id: str
    source_service_id: str
    source_service_name: str
    target_service_id: str
    target_service_name: str
    original_weight: float
    virtual_weight: float


class MitigationRequest(APIModel):
    strategy: str = "FALLBACK"
    dependency_id: str | None = None


class MitigationResponse(APIModel):
    simulation_id: str
    strategy: str
    baseline: MitigationSnapshot
    mitigated: MitigationSnapshot | None = None
    improvement: MitigationImprovement | None = None
    mitigation: dict
    affected_edges: list[MitigationEdge]
    explanation: str
    production_changes_executed: bool = False
