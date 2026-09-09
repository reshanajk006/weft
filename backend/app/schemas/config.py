"""Threshold and topology configuration schemas."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import Field

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


class TopologyServiceSpec(APIModel):
    name: str
    tier: str | None = None
    type: str | None = None
    owner: str | None = None


class TopologyDependencySpec(APIModel):
    source: str
    target: str
    critical_weight: float | None = Field(default=None, ge=0.0, le=1.0)
    protocol: str | None = None


class TopologyUploadRequest(APIModel):
    services: list[TopologyServiceSpec] = Field(default_factory=list)
    dependencies: list[TopologyDependencySpec] = Field(default_factory=list)
    mode: Literal["merge", "replace"] = "merge"


class TopologyIngestResponse(APIModel):
    dataset_id: str
    mode: str
    services_created: int
    services_updated: int
    dependencies_created: int
    dependencies_updated: int
    services_removed: int = 0
    dependencies_removed: int = 0
