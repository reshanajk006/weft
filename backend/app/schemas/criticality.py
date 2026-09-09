"""Criticality schemas."""

from __future__ import annotations

from pydantic import Field

from app.schemas.common import APIModel


class FactorBreakdown(APIModel):
    weight: float
    raw_value: float
    normalized_score: float
    contribution: float


def _zero_factor() -> FactorBreakdown:
    return FactorBreakdown(weight=0.0, raw_value=0.0, normalized_score=0.0, contribution=0.0)


class CriticalityBreakdown(APIModel):
    call_volume: FactorBreakdown
    error_impact: FactorBreakdown
    latency_impact: FactorBreakdown
    dependency_impact: FactorBreakdown
    business_tier: FactorBreakdown = Field(default_factory=_zero_factor)


class CriticalityExplanation(APIModel):
    service: str
    service_id: str
    score: float
    breakdown: CriticalityBreakdown
    computed_score: float | None = None
    criticality_override: float | None = None


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
