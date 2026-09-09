"""Shared helpers for scenario classification, tier labels, and telemetry windows."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import Service, SpanRecord, TelemetryDataset
from app.schemas.analysis import ScenarioClassification, SelectedTarget
from app.services.dataset_service import get_active_dataset


HYPOTHETICAL_TYPE = "Hypothetical failure simulation"
OBSERVED_TYPE = "Observed incident"
INSUFFICIENT_BASELINE = "Insufficient historical telemetry to calculate a reliable baseline."
HYPOTHETICAL_MESSAGE = "The selected service is a simulation target, not a confirmed root cause."
OBSERVED_DISCLAIMER = (
    "This is a ranked suspicion based on available traces, not a guaranteed causal diagnosis."
)

_TIER1 = {"critical", "tier-1", "tier1", "t1", "1"}
_TIER_DISPLAY = {
    "critical": "Tier-1",
    "tier-1": "Tier-1",
    "tier1": "Tier-1",
    "t1": "Tier-1",
    "1": "Tier-1",
    "high": "Tier-2",
    "tier-2": "Tier-2",
    "tier2": "Tier-2",
    "2": "Tier-2",
    "medium": "Tier-3",
    "low": "Tier-3",
    "tier-3": "Tier-3",
    "tier3": "Tier-3",
    "3": "Tier-3",
}


def input_source_label(dataset: TelemetryDataset | None) -> str:
    if dataset is None or not dataset.source:
        return "Jaeger JSON"
    source = dataset.source.strip()
    lowered = source.lower()
    if lowered.startswith("http://") or lowered.startswith("https://"):
        return f"Live Jaeger Query API ({source})"
    if lowered == "config":
        return "Declarative topology"
    return source


def display_business_tier(tier: str | None) -> str:
    if not tier or not tier.strip():
        return "Unspecified"
    return _TIER_DISPLAY.get(tier.strip().lower(), tier.strip())


def is_tier1(service: Service | None) -> bool:
    if service is None or not service.tier:
        return False
    return service.tier.strip().lower() in _TIER1


def selected_target_from_service(service: Service) -> SelectedTarget:
    return SelectedTarget(
        service_id=service.id,
        service_name=service.name,
        observed_status=service.health_status,
        observed_health_score=service.health_score,
        observed_error_rate=service.error_rate,
        observed_latency_ms=service.avg_latency_ms,
        call_count=service.total_calls,
        p95_latency_ms=service.p95_latency_ms,
        p99_latency_ms=service.p99_latency_ms,
        business_tier=display_business_tier(service.tier),
        computed_criticality=service.effective_criticality_score(),
    )


def hypothetical_scenario(service: Service, dataset: TelemetryDataset | None) -> ScenarioClassification:
    is_observed_error = service.error_rate > 0 or service.health_status in ("UNHEALTHY", "DEGRADED")
    return ScenarioClassification(
        type=HYPOTHETICAL_TYPE,
        input_source=input_source_label(dataset),
        selected_failure_target=service.name,
        current_observed_status=service.health_status,
        current_health_score=service.health_score,
        observed_production_incident=is_observed_error,
        live_service_health_modified=False,
    )


def observed_scenario(dataset: TelemetryDataset | None) -> ScenarioClassification:
    return ScenarioClassification(
        type=OBSERVED_TYPE,
        input_source=input_source_label(dataset),
        selected_failure_target="",
        current_observed_status="",
        current_health_score=0.0,
        observed_production_incident=True,
        live_service_health_modified=False,
    )


def us_to_iso(value: int | None) -> str | None:
    if not value:
        return None
    seconds = value / 1_000_000
    return datetime.fromtimestamp(seconds, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def observed_time_window(db: Session, dataset_id: str | None) -> tuple[str | None, str | None]:
    if not dataset_id:
        return None, None
    row = db.execute(
        select(func.min(SpanRecord.start_time_us), func.max(SpanRecord.start_time_us)).where(
            SpanRecord.dataset_id == dataset_id
        )
    ).one()
    return us_to_iso(row[0]), us_to_iso(row[1])


def active_dataset_or_none(db: Session) -> TelemetryDataset | None:
    return get_active_dataset(db)
