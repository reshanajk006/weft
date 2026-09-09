"""Service API schemas."""

from __future__ import annotations

from pydantic import Field

from app.schemas.common import APIModel
from app.schemas.dataset import DatasetSummary
from app.schemas.health import HealthHistoryItem


class ServiceSummary(APIModel):
    id: str
    name: str
    normalized_name: str
    health_status: str
    health_score: float
    error_rate: float
    avg_latency_ms: float
    total_calls: int
    total_spans: int
    criticality_score: float
    effective_criticality_score: float | None = None
    tier: str | None = None
    service_type: str | None = None
    owner: str | None = None
    source: str | None = None
    criticality_override: float | None = None


class ServiceMetrics(APIModel):
    total_calls: int
    total_spans: int
    error_count: int
    error_rate: float
    avg_latency_ms: float
    min_latency_ms: float | None = None
    max_latency_ms: float | None = None
    p95_latency_ms: float | None = None
    p99_latency_ms: float | None = None
    sample_count: int = 0


class NeighborService(APIModel):
    id: str
    name: str
    health_status: str
    health_score: float
    criticality_score: float
    call_count: int
    error_rate: float
    avg_latency_ms: float


class ServiceDetail(APIModel):
    id: str
    name: str
    normalized_name: str
    health: dict
    metrics: ServiceMetrics
    criticality: dict
    dependency_counts: dict
    upstream_count: int
    downstream_count: int
    last_seen_at: str | None = None
    created_at: str
    updated_at: str
    tier: str | None = None
    service_type: str | None = None
    owner: str | None = None
    source: str | None = None
    criticality_override: float | None = None


class NeighborListResponse(APIModel):
    service_id: str
    service_name: str
    items: list[NeighborService]
    count: int


class ServiceHealthListItem(APIModel):
    service_id: str
    service_name: str
    health_score: float
    health_status: str
    error_rate: float
    avg_latency_ms: float
    call_volume: int


class ServiceHealthListResponse(APIModel):
    items: list[ServiceHealthListItem]
    total: int


class ServiceListResponse(APIModel):
    items: list[ServiceSummary]
    total: int
    limit: int
    offset: int


class ServiceUpdateRequest(APIModel):
    tier: str | None = None
    service_type: str | None = None
    owner: str | None = None
    criticality_override: float | None = Field(default=None, ge=0.0, le=100.0)


class ServiceDashboard(APIModel):
    service: ServiceSummary
    metrics: ServiceMetrics
    health: dict
    criticality: dict
    upstream: list[NeighborService]
    downstream: list[NeighborService]
    recent_health_history: list[HealthHistoryItem]
    circuit_breakers: list[dict]
    recent_simulations: list[dict]


class OverviewHighestRisk(APIModel):
    id: str
    name: str
    criticality_score: float
    health_status: str
    health_score: float


class OverviewLatestSimulation(APIModel):
    id: str
    failed_service_id: str
    failed_service_name: str
    severity: str
    blast_radius_score: float
    created_at: str


class OverviewResponse(APIModel):
    service_count: int
    dependency_count: int
    healthy_count: int
    degraded_count: int
    unhealthy_count: int
    average_health_score: float
    highest_risk_service: OverviewHighestRisk | None = None
    latest_simulation: OverviewLatestSimulation | None = None
    open_circuit_breakers: int
    active_dataset: DatasetSummary | None = None
