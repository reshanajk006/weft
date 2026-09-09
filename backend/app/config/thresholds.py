"""WEFT analysis threshold configuration."""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field, field_validator, model_validator

from app.core.exceptions import ValidationFailedError
from app.core.settings import get_settings


class HealthThresholds(BaseModel):
    degraded_error_rate: float = Field(default=0.10, ge=0.0, le=1.0)
    critical_error_rate: float = Field(default=0.50, ge=0.0, le=1.0)
    healthy_above: float = Field(default=80.0, ge=0.0, le=100.0)
    sliding_window_seconds: float = Field(default=10.0, gt=0.0)

    @model_validator(mode="after")
    def validate_error_bounds(self) -> "HealthThresholds":
        if self.degraded_error_rate > self.critical_error_rate:
            raise ValueError("degraded_error_rate must be less than or equal to critical_error_rate")
        return self


class BlastRadiusThresholds(BaseModel):
    critical_edge_weight: float = Field(default=0.90, ge=0.0, le=1.0)
    non_critical_edge_weight: float = Field(default=0.50, ge=0.0, le=1.0)
    min_impact_probability: float = Field(default=0.10, ge=0.0, le=1.0)


class BlastRadiusScoreThresholds(BaseModel):
    affected_ratio_weight: float = Field(default=0.40, ge=0.0)
    weighted_impact_weight: float = Field(default=0.35, ge=0.0)
    critical_service_factor_weight: float = Field(default=0.25, ge=0.0)

    @model_validator(mode="after")
    def validate_weights(self) -> "BlastRadiusScoreThresholds":
        total = (
            self.affected_ratio_weight
            + self.weighted_impact_weight
            + self.critical_service_factor_weight
        )
        if abs(total - 1.0) > 0.001:
            raise ValueError("blast_radius_score weights must sum to 1.0")
        return self


class CriticalityThresholds(BaseModel):
    call_volume_weight: float = Field(default=0.25, ge=0.0)
    error_weight: float = Field(default=0.20, ge=0.0)
    latency_weight: float = Field(default=0.20, ge=0.0)
    dependency_weight: float = Field(default=0.20, ge=0.0)
    tier_weight: float = Field(default=0.0, ge=0.0)
    tier_scores: dict[str, float] = Field(
        default_factory=lambda: {
            "critical": 1.0,
            "high": 0.75,
            "medium": 0.5,
            "low": 0.25,
        }
    )

    @model_validator(mode="after")
    def validate_weights(self) -> "CriticalityThresholds":
        total = (
            self.call_volume_weight
            + self.error_weight
            + self.latency_weight
            + self.dependency_weight
            + self.tier_weight
        )
        if abs(total - 1.0) > 0.001:
            raise ValueError("criticality weights must sum to 1.0")
        return self


class CircuitBreakerThresholds(BaseModel):
    error_threshold: float = Field(default=0.50, ge=0.0, le=1.0)
    cooldown_seconds: float = Field(default=30.0, gt=0.0)
    recovery_health_threshold: float = Field(default=80.0, ge=0.0, le=100.0)


class SeverityThresholds(BaseModel):
    low_max: float = Field(default=25.0, ge=0.0, le=100.0)
    medium_max: float = Field(default=50.0, ge=0.0, le=100.0)
    high_max: float = Field(default=75.0, ge=0.0, le=100.0)

    @model_validator(mode="after")
    def validate_order(self) -> "SeverityThresholds":
        if not (self.low_max <= self.medium_max <= self.high_max):
            raise ValueError("severity thresholds must be ordered: low_max <= medium_max <= high_max")
        return self


class ImpactLevelThresholds(BaseModel):
    critical_min: float = Field(default=0.75, ge=0.0, le=1.0)
    high_min: float = Field(default=0.50, ge=0.0, le=1.0)
    medium_min: float = Field(default=0.25, ge=0.0, le=1.0)

    @model_validator(mode="after")
    def validate_order(self) -> "ImpactLevelThresholds":
        if not (self.medium_min <= self.high_min <= self.critical_min):
            raise ValueError("impact_level thresholds must be ordered")
        return self


class CriticalServiceThresholds(BaseModel):
    min_criticality_score: float = Field(default=70.0, ge=0.0, le=100.0)


class CriticalEdgeThresholds(BaseModel):
    call_count_percentile: float = Field(default=0.75, ge=0.0, le=1.0)


class LatencyThresholds(BaseModel):
    high_latency_ms: float = Field(default=200.0, gt=0.0)
    very_high_latency_ms: float = Field(default=500.0, gt=0.0)

    @model_validator(mode="after")
    def validate_order(self) -> "LatencyThresholds":
        if self.high_latency_ms > self.very_high_latency_ms:
            raise ValueError("high_latency_ms must be <= very_high_latency_ms")
        return self


class RootCauseThresholds(BaseModel):
    error_rate_points: int = Field(default=30, ge=0)
    latency_points: int = Field(default=20, ge=0)
    baseline_deviation_points: int = Field(default=25, ge=0)
    upstream_origin_points: int = Field(default=15, ge=0)
    unhealthy_dependency_points: int = Field(default=10, ge=0)
    high_confidence_min_score: float = Field(default=70.0, ge=0.0, le=100.0)
    medium_confidence_min_score: float = Field(default=40.0, ge=0.0, le=100.0)
    high_confidence_min_factors: int = Field(default=2, ge=1)
    min_upstream_callers: int = Field(default=2, ge=1)
    min_baseline_windows: int = Field(default=2, ge=1)


class MitigationThresholds(BaseModel):
    fallback_edge_weight: float = Field(default=0.10, ge=0.0, le=1.0)


class ThresholdsConfig(BaseModel):
    health: HealthThresholds = Field(default_factory=HealthThresholds)
    blast_radius: BlastRadiusThresholds = Field(default_factory=BlastRadiusThresholds)
    blast_radius_score: BlastRadiusScoreThresholds = Field(default_factory=BlastRadiusScoreThresholds)
    criticality: CriticalityThresholds = Field(default_factory=CriticalityThresholds)
    circuit_breaker: CircuitBreakerThresholds = Field(default_factory=CircuitBreakerThresholds)
    severity: SeverityThresholds = Field(default_factory=SeverityThresholds)
    impact_level: ImpactLevelThresholds = Field(default_factory=ImpactLevelThresholds)
    critical_service: CriticalServiceThresholds = Field(default_factory=CriticalServiceThresholds)
    critical_edge: CriticalEdgeThresholds = Field(default_factory=CriticalEdgeThresholds)
    latency: LatencyThresholds = Field(default_factory=LatencyThresholds)
    root_cause: RootCauseThresholds = Field(default_factory=RootCauseThresholds)
    mitigation: MitigationThresholds = Field(default_factory=MitigationThresholds)

    @field_validator("health", mode="before")
    @classmethod
    def coerce_health(cls, value: Any) -> Any:
        return value or {}


_thresholds: ThresholdsConfig | None = None
_thresholds_path: Path | None = None


def _load_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as handle:
        loaded = yaml.safe_load(handle) or {}
        if not isinstance(loaded, dict):
            raise ValidationFailedError("Thresholds file must contain a YAML mapping")
        return loaded


def load_thresholds(path: Path | None = None) -> ThresholdsConfig:
    global _thresholds, _thresholds_path
    resolved = path or get_settings().thresholds_file
    data = _load_yaml(resolved)
    _thresholds = ThresholdsConfig.model_validate(data)
    _thresholds_path = resolved
    return _thresholds


def get_thresholds() -> ThresholdsConfig:
    global _thresholds
    if _thresholds is None:
        return load_thresholds()
    return _thresholds


def save_thresholds(config: ThresholdsConfig, path: Path | None = None) -> ThresholdsConfig:
    global _thresholds, _thresholds_path
    resolved = path or _thresholds_path or get_settings().thresholds_file
    resolved.parent.mkdir(parents=True, exist_ok=True)
    payload = config.model_dump()
    with resolved.open("w", encoding="utf-8") as handle:
        yaml.safe_dump(payload, handle, sort_keys=False)
    _thresholds = config
    _thresholds_path = resolved
    return _thresholds


def update_thresholds(payload: dict[str, Any]) -> ThresholdsConfig:
    current = get_thresholds().model_dump()
    merged = _deep_merge(current, payload)
    try:
        updated = ThresholdsConfig.model_validate(merged)
    except Exception as exc:
        raise ValidationFailedError(str(exc), details={"payload": payload}) from exc
    return save_thresholds(updated)


def reset_thresholds(path: Path | None = None) -> ThresholdsConfig:
    global _thresholds, _thresholds_path
    _thresholds = None
    _thresholds_path = None
    return load_thresholds(path)


def _deep_merge(base: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
    result = deepcopy(base)
    for key, value in incoming.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result
