"""Threshold configuration schemas."""

from __future__ import annotations

from typing import Any

from app.config.thresholds import ThresholdsConfig
from app.schemas.common import APIModel


class ThresholdsResponse(ThresholdsConfig):
    """Full threshold configuration returned to clients."""


class ThresholdsUpdateRequest(APIModel):
    health: dict[str, Any] | None = None
    blast_radius: dict[str, Any] | None = None
    blast_radius_score: dict[str, Any] | None = None
    criticality: dict[str, Any] | None = None
    circuit_breaker: dict[str, Any] | None = None
    severity: dict[str, Any] | None = None
    impact_level: dict[str, Any] | None = None
    critical_service: dict[str, Any] | None = None
    critical_edge: dict[str, Any] | None = None
    latency: dict[str, Any] | None = None
