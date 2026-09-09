"""Health schemas."""

from __future__ import annotations

from app.schemas.common import APIModel


class HealthHistoryItem(APIModel):
    id: str
    service_id: str
    health_score: float
    health_status: str
    error_rate: float
    total_spans: int
    error_spans: int
    avg_latency_ms: float
    calculated_at: str


class HealthHistoryResponse(APIModel):
    items: list[HealthHistoryItem]
    total: int
    limit: int
    offset: int
