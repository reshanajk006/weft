"""Blast-radius schemas."""

from __future__ import annotations

from app.schemas.common import APIModel


class BlastRadiusService(APIModel):
    service_id: str
    service_name: str
    impact_probability: float
    distance: int
    direct: bool
    impact_level: str
    criticality_score: float
    current_health_score: float


class BlastRadiusScoreBreakdown(APIModel):
    affected_ratio: float
    weighted_impact: float
    critical_service_factor: float
    formula: str


class BlastRadiusScore(APIModel):
    score: float
    breakdown: BlastRadiusScoreBreakdown


class BlastRadiusResponse(APIModel):
    failed_service_id: str
    failed_service_name: str
    blast_radius_score: float
    score_breakdown: BlastRadiusScoreBreakdown
    formula: str
    directly_affected: list[BlastRadiusService]
    indirectly_affected: list[BlastRadiusService]
    total_affected: int
    affected_services: list[BlastRadiusService]
    unaffected_services: list[str]
    affected_service_ids: list[str]
    directly_affected_ids: list[str]
    indirectly_affected_ids: list[str]
    services: list[BlastRadiusService]
