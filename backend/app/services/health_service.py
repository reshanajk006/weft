"""Deterministic service health engine."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config.thresholds import get_thresholds
from app.core.exceptions import NotFoundError
from app.core.utils import clamp, isoformat, safe_div
from app.db.models import Service, ServiceHealthHistory, SpanRecord
from app.schemas.health import HealthHistoryItem, HealthHistoryResponse
from app.services.dataset_service import list_active_services
from app.services.graph_service import get_service_or_404


def classify_health(error_rate: float) -> tuple[float, str]:
    thresholds = get_thresholds().health
    score = clamp(round((1 - error_rate) * 100), 0, 100)
    if error_rate >= thresholds.critical_error_rate:
        status = "UNHEALTHY"
    elif error_rate >= thresholds.degraded_error_rate:
        status = "DEGRADED"
    else:
        status = "HEALTHY"
    return score, status


def apply_health(service: Service, error_rate: float, total_spans: int, error_spans: int, avg_latency_ms: float) -> ServiceHealthHistory:
    score, status = classify_health(error_rate)
    service.health_score = score
    service.health_status = status
    history = ServiceHealthHistory(
        service_id=service.id,
        health_score=score,
        health_status=status,
        error_rate=error_rate,
        total_spans=total_spans,
        error_spans=error_spans,
        avg_latency_ms=avg_latency_ms,
    )
    return history


def recompute_service_health(db: Session, service: Service) -> ServiceHealthHistory:
    thresholds = get_thresholds().health
    spans = list(db.execute(select(SpanRecord).where(SpanRecord.service_id == service.id)).scalars().all())
    window_spans = _window_spans(spans, thresholds.sliding_window_seconds)
    used = window_spans if window_spans else spans
    errors = sum(1 for span in used if span.is_error)
    error_rate = safe_div(errors, len(used))
    avg_latency = safe_div(sum(span.duration_ms for span in used), len(used))
    history = apply_health(service, error_rate, len(used), errors, avg_latency)
    db.add(history)
    db.flush()
    return history


def recompute_all_health(db: Session, dataset_id: str | None = None) -> None:
    if dataset_id:
        services = list(
            db.execute(select(Service).where(Service.dataset_id == dataset_id).order_by(Service.normalized_name)).scalars().all()
        )
    else:
        services = list_active_services(db)
    for service in services:
        recompute_service_health(db, service)


def list_health_history(
    db: Session,
    service_id: str,
    limit: int = 50,
    start_time: datetime | None = None,
    end_time: datetime | None = None,
) -> HealthHistoryResponse:
    service = get_service_or_404(db, service_id)
    query = select(ServiceHealthHistory).where(ServiceHealthHistory.service_id == service_id)
    if start_time is not None:
        query = query.where(ServiceHealthHistory.calculated_at >= start_time)
    if end_time is not None:
        query = query.where(ServiceHealthHistory.calculated_at <= end_time)
    query = query.order_by(ServiceHealthHistory.calculated_at.desc())
    rows = list(db.execute(query).scalars().all())
    limited = rows[: max(limit, 0)]
    items = [
        HealthHistoryItem(
            id=row.id,
            service_id=row.service_id,
            health_score=row.health_score,
            health_status=row.health_status,
            error_rate=row.error_rate,
            total_spans=row.total_spans,
            error_spans=row.error_spans,
            avg_latency_ms=row.avg_latency_ms,
            calculated_at=isoformat(row.calculated_at) or "",
        )
        for row in limited
    ]
    return HealthHistoryResponse(items=items, total=len(rows), limit=limit, offset=0)


def _window_spans(spans: list[SpanRecord], window_seconds: float) -> list[SpanRecord]:
    if not spans:
        return []
    latest = max(span.start_time_us for span in spans)
    window_us = int(window_seconds * 1_000_000)
    return [span for span in spans if span.start_time_us >= latest - window_us]
