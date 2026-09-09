"""Root-cause and recommendation schemas."""

from __future__ import annotations

from typing import Any

from app.schemas.common import APIModel


class RootCauseCandidate(APIModel):
    service_id: str
    service: str
    score: float
    confidence: str
    health_status: str
    health_score: float
    error_rate: float
    avg_latency_ms: float
    criticality_score: float
    called_by: list[str]
    calls: list[str]
    evidence: list[str]


class RootCauseResponse(APIModel):
    simulation_id: str
    likely_root_cause: RootCauseCandidate | None = None
    candidates: list[RootCauseCandidate]


class RecommendationItem(APIModel):
    priority: str
    service: str
    recommendation: str
    reason: str
    evidence: dict[str, Any]


class RecommendationListResponse(APIModel):
    simulation_id: str
    items: list[RecommendationItem]


class IncidentAnalysisResponse(APIModel):
    simulation_id: str
    root_cause: RootCauseResponse
    recommendations: list[RecommendationItem]
