"""Criticality schemas."""

from __future__ import annotations

from app.schemas.common import APIModel


class FactorBreakdown(APIModel):
    weight: float
    raw_value: float
    normalized_score: float
    contribution: float


class CriticalityBreakdown(APIModel):
    call_volume: FactorBreakdown
    error_impact: FactorBreakdown
    latency_impact: FactorBreakdown
    dependency_impact: FactorBreakdown


class CriticalityExplanation(APIModel):
    service: str
    service_id: str
    score: float
    breakdown: CriticalityBreakdown


class CriticalityRankingItem(APIModel):
    rank: int
    service: str
    service_id: str
    score: float
    health: str
    health_score: float
    error_rate: float
    avg_latency_ms: float
    call_volume: int
    breakdown: CriticalityBreakdown


class CriticalityRankingResponse(APIModel):
    items: list[CriticalityRankingItem]
    total: int
