"""Root-cause and recommendation schemas."""

from __future__ import annotations

from typing import Any

from pydantic import Field

from app.schemas.common import APIModel
from app.schemas.mitigation import MitigationResponse


class RcaEvidenceItem(APIModel):
    factor: str
    points: int
    value: Any = None
    explanation: str


class SelectedTarget(APIModel):
    service_id: str
    service_name: str
    observed_status: str
    observed_health_score: float
    observed_error_rate: float
    observed_latency_ms: float
    call_count: int = 0
    p95_latency_ms: float | None = None
    p99_latency_ms: float | None = None
    business_tier: str | None = None
    computed_criticality: float = 0.0


class ScenarioClassification(APIModel):
    type: str
    input_source: str
    selected_failure_target: str
    current_observed_status: str
    current_health_score: float
    observed_production_incident: bool = False
    live_service_health_modified: bool = False


class RootCauseCandidate(APIModel):
    service_id: str
    service: str
    service_name: str | None = None
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
    evidence_items: list[RcaEvidenceItem] = Field(default_factory=list)


class RootCauseResponse(APIModel):
    simulation_id: str
    mode: str = "HYPOTHETICAL"
    root_cause_status: str = "NOT_DETERMINED"
    status: str = "NOT_DETERMINED"
    message: str = ""
    disclaimer: str = ""
    likely_root_cause: RootCauseCandidate | None = None
    candidates: list[RootCauseCandidate]
    selected_target: SelectedTarget | None = None
    observed_status: str | None = None
    observed_health_score: float | None = None
    observed_error_rate: float | None = None
    observed_latency_ms: float | None = None
    limitations: list[str] = Field(default_factory=list)
    scenario: ScenarioClassification | None = None


class RecommendationItem(APIModel):
    priority: str
    priority_rank: int = 1
    category: str = "PREVENTION"
    title: str = ""
    action: str = ""
    service: str
    recommendation: str
    reason: str
    expected_outcome: str = ""
    risk: str = ""
    effort: str = "MEDIUM"
    safe_to_automate: bool = False
    validation: str = ""
    evidence: dict[str, Any]


class RecommendationListResponse(APIModel):
    simulation_id: str
    items: list[RecommendationItem]


class IncidentAnalysisResponse(APIModel):
    simulation_id: str
    scenario: ScenarioClassification | None = None
    root_cause: RootCauseResponse
    recommendations: list[RecommendationItem]
    mitigation: MitigationResponse | None = None
