"""Jaeger JSON parsing, validation, and ingestion."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config.thresholds import get_thresholds
from app.core.exceptions import ValidationFailedError
from app.core.logging import get_logger
from app.core.utils import as_bool, as_str, new_id, normalize_name, percentile, safe_div, utc_now
from app.db.models import (
    CircuitBreakerState,
    Dependency,
    Service,
    ServiceOperation,
    SpanRecord,
    TraceIngestion,
)
from app.schemas.telemetry import IngestionResult
from app.services.circuit_breaker_service import ensure_circuit_breakers_for_dependencies
from app.services.criticality_service import recompute_all_criticality
from app.services.health_service import recompute_all_health

logger = get_logger("weft.ingestion")

ALLOWED_UPLOAD_TYPES = {
    "application/json",
    "application/octet-stream",
    "text/json",
    "text/plain",
    "application/x-json",
}


def ingest_jaeger_payload(
    db: Session,
    payload: Any,
    filename: str | None = None,
) -> IngestionResult:
    """Validate and ingest a Jaeger JSON payload into the database."""

    ingestion = TraceIngestion(
        id=new_id(),
        filename=filename,
        status="processing",
    )
    db.add(ingestion)
    db.flush()

    try:
        traces = _validate_payload(payload)
        result = _process_traces(db, traces, ingestion)
        ingestion.trace_count = result["trace_count"]
        ingestion.span_count = result["span_count"]
        ingestion.service_count = result["service_count"]
        ingestion.dependency_count = result["dependency_count"]
        ingestion.error_count = result["error_count"]
        ingestion.status = "completed"
        db.flush()

        recompute_all_health(db)
        recompute_all_criticality(db)
        ensure_circuit_breakers_for_dependencies(db)
        _refresh_dependency_critical_weights(db)

        logger.info(
            "Ingestion %s completed: traces=%s spans=%s services=%s dependencies=%s errors=%s",
            ingestion.id,
            ingestion.trace_count,
            ingestion.span_count,
            ingestion.service_count,
            ingestion.dependency_count,
            ingestion.error_count,
        )
        return IngestionResult(
            ingestion_id=ingestion.id,
            filename=filename,
            traces_processed=ingestion.trace_count,
            spans_processed=ingestion.span_count,
            services_discovered=ingestion.service_count,
            dependencies_discovered=ingestion.dependency_count,
            errors_detected=ingestion.error_count,
            status=ingestion.status,
        )
    except ValidationFailedError:
        ingestion.status = "failed"
        ingestion.error_message = "Validation failed"
        db.flush()
        raise
    except Exception as exc:
        ingestion.status = "failed"
        ingestion.error_message = str(exc)
        db.flush()
        logger.exception("Ingestion %s failed", ingestion.id)
        raise


def ingest_jaeger_file(db: Session, path: Path, original_filename: str | None) -> IngestionResult:
    with path.open("r", encoding="utf-8") as handle:
        try:
            payload = json.load(handle)
        except json.JSONDecodeError as exc:
            raise ValidationFailedError(
                "Uploaded file is not valid JSON",
                details={"line": exc.lineno, "column": exc.colno, "message": exc.msg},
            ) from exc
    return ingest_jaeger_payload(db, payload, filename=original_filename or path.name)


def _validate_payload(payload: Any) -> list[dict[str, Any]]:
    if payload is None:
        raise ValidationFailedError("Request body is required")
    if not isinstance(payload, dict):
        raise ValidationFailedError("Jaeger payload must be a JSON object")
    if "data" not in payload:
        raise ValidationFailedError("Jaeger payload is missing required 'data' array")
    data = payload["data"]
    if not isinstance(data, list):
        raise ValidationFailedError("'data' must be an array of traces")
    traces: list[dict[str, Any]] = []
    for index, item in enumerate(data):
        if not isinstance(item, dict):
            raise ValidationFailedError(f"Trace at index {index} must be an object")
        if "spans" not in item:
            raise ValidationFailedError(f"Trace at index {index} is missing 'spans'")
        if not isinstance(item["spans"], list):
            raise ValidationFailedError(f"Trace at index {index} 'spans' must be an array")
        traces.append(item)
    return traces


def _process_traces(db: Session, traces: list[dict[str, Any]], ingestion: TraceIngestion) -> dict[str, int]:
    span_count = 0
    error_count = 0
    services_before = {row[0] for row in db.execute(select(Service.normalized_name)).all()}
    deps_before = {row[0] for row in db.execute(select(Dependency.id)).all()}

    for trace in traces:
        processed = _process_single_trace(db, trace, ingestion.id)
        span_count += processed["spans"]
        error_count += processed["errors"]

    services_after = {row[0] for row in db.execute(select(Service.normalized_name)).all()}
    deps_after = {row[0] for row in db.execute(select(Dependency.id)).all()}
    return {
        "trace_count": len(traces),
        "span_count": span_count,
        "service_count": len(services_after - services_before) if services_before else len(services_after),
        "dependency_count": len(deps_after - deps_before) if deps_before else len(deps_after),
        "error_count": error_count,
    }


def _process_single_trace(db: Session, trace: dict[str, Any], ingestion_id: str) -> dict[str, int]:
    processes = trace.get("processes") or {}
    if not isinstance(processes, dict):
        processes = {}
    trace_id = as_str(trace.get("traceID") or "")
    spans = trace.get("spans") or []

    parsed: list[dict[str, Any]] = []
    span_to_service: dict[str, str] = {}

    for span in spans:
        if not isinstance(span, dict):
            continue
        extracted = _extract_span(span, processes, trace_id)
        if extracted is None:
            continue
        parsed.append(extracted)
        span_to_service[extracted["span_id"]] = extracted["service_name"]

    if spans and not parsed:
        raise ValidationFailedError("No spans contained a resolvable service name")

    errors = 0
    seen_operations: set[tuple[str, str]] = set()
    for item in parsed:
        existing = db.execute(
            select(SpanRecord).where(
                SpanRecord.trace_id == item["trace_id"],
                SpanRecord.span_id == item["span_id"],
            )
        ).scalar_one_or_none()
        if existing is not None:
            continue

        service = _get_or_create_service(db, item["service_name"])
        _ensure_operation(db, service, item["operation_name"], seen_operations)
        parent_service_name = None
        parent_span_id = item["parent_span_id"]
        if parent_span_id:
            parent_service_name = span_to_service.get(parent_span_id)

        dependency = None
        if parent_service_name and normalize_name(parent_service_name) != service.normalized_name:
            source = _get_or_create_service(db, parent_service_name)
            dependency = _get_or_create_dependency(db, source, service)

        record = SpanRecord(
            id=new_id(),
            ingestion_id=ingestion_id,
            service_id=service.id,
            dependency_id=dependency.id if dependency else None,
            trace_id=item["trace_id"],
            span_id=item["span_id"],
            parent_span_id=parent_span_id,
            operation_name=item["operation_name"],
            start_time_us=item["start_time_us"],
            duration_ms=item["duration_ms"],
            is_error=item["is_error"],
            http_status_code=item["http_status_code"],
        )
        db.add(record)
        if item["is_error"]:
            errors += 1

    db.flush()
    _recompute_metrics(db)
    return {"spans": len(parsed), "errors": errors}


def _extract_span(span: dict[str, Any], processes: dict[str, Any], fallback_trace_id: str) -> dict[str, Any] | None:
    span_id = as_str(span.get("spanID") or span.get("spanId") or "")
    if not span_id:
        return None
    service_name = _extract_service_name(span, processes)
    if not service_name:
        return None

    start_time = span.get("startTime") or 0
    try:
        start_time_us = int(start_time)
    except (TypeError, ValueError):
        start_time_us = 0

    duration = span.get("duration") or 0
    try:
        duration_us = float(duration)
    except (TypeError, ValueError):
        duration_us = 0.0

    tags = span.get("tags") or []
    error, status = _detect_error(tags)
    return {
        "trace_id": as_str(span.get("traceID") or fallback_trace_id or ""),
        "span_id": span_id,
        "parent_span_id": _extract_parent_span_id(span),
        "operation_name": as_str(span.get("operationName") or ""),
        "start_time_us": start_time_us,
        "duration_ms": duration_us / 1000.0,
        "service_name": service_name,
        "is_error": error,
        "http_status_code": status,
    }


def _extract_service_name(span: dict[str, Any], processes: dict[str, Any]) -> str | None:
    process = span.get("process")
    if isinstance(process, dict):
        name = process.get("serviceName") or process.get("service_name")
        if name:
            return str(name).strip()
    process_id = span.get("processID") or span.get("processId")
    if process_id and isinstance(processes, dict):
        proc = processes.get(str(process_id))
        if isinstance(proc, dict) and proc.get("serviceName"):
            return str(proc["serviceName"]).strip()
    for tag in span.get("tags") or []:
        if not isinstance(tag, dict):
            continue
        if tag.get("key") in {"service.name", "serviceName", "otel.library.name"}:
            value = tag.get("value")
            if value:
                return str(value).strip()
    return None


def _extract_parent_span_id(span: dict[str, Any]) -> str | None:
    references = span.get("references") or []
    child_of = None
    follows = None
    for ref in references:
        if not isinstance(ref, dict):
            continue
        ref_type = as_str(ref.get("refType") or "").upper()
        span_id = as_str(ref.get("spanID") or ref.get("spanId") or "")
        if not span_id:
            continue
        if ref_type == "CHILD_OF":
            child_of = span_id
        elif ref_type == "FOLLOWS_FROM":
            follows = span_id
    if child_of:
        return child_of
    if follows:
        return follows
    parent = span.get("parentSpanID") or span.get("parentSpanId")
    return as_str(parent) if parent else None


def _detect_error(tags: Any) -> tuple[bool, str | None]:
    error = False
    status: str | None = None
    if not isinstance(tags, list):
        return False, None
    for tag in tags:
        if not isinstance(tag, dict):
            continue
        key = as_str(tag.get("key") or "")
        value = tag.get("value")
        if key == "error":
            error = error or as_bool(value)
        if key in {"http.status_code", "http.statusCode", "status.code", "http.response.status_code"}:
            status = as_str(value)
            if status.startswith("5"):
                error = True
    return error, status


def _get_or_create_service(db: Session, name: str) -> Service:
    normalized = normalize_name(name)
    service = db.execute(select(Service).where(Service.normalized_name == normalized)).scalar_one_or_none()
    if service is None:
        service = Service(
            id=new_id(),
            name=name.strip(),
            normalized_name=normalized,
        )
        db.add(service)
        db.flush()
    return service


def _ensure_operation(
    db: Session,
    service: Service,
    operation_name: str,
    seen: set[tuple[str, str]],
) -> None:
    if not operation_name:
        return
    key = (service.id, operation_name)
    if key in seen:
        return
    seen.add(key)
    existing = db.execute(
        select(ServiceOperation).where(
            ServiceOperation.service_id == service.id,
            ServiceOperation.operation_name == operation_name,
        )
    ).scalar_one_or_none()
    if existing is None:
        db.add(ServiceOperation(id=new_id(), service_id=service.id, operation_name=operation_name))


def _get_or_create_dependency(db: Session, source: Service, target: Service) -> Dependency:
    dependency = db.execute(
        select(Dependency).where(
            Dependency.source_service_id == source.id,
            Dependency.target_service_id == target.id,
        )
    ).scalar_one_or_none()
    if dependency is None:
        thresholds = get_thresholds()
        dependency = Dependency(
            id=new_id(),
            source_service_id=source.id,
            target_service_id=target.id,
            critical_weight=get_thresholds().blast_radius.non_critical_edge_weight,
        )
        db.add(dependency)
        db.flush()
        db.add(
            CircuitBreakerState(
                id=new_id(),
                source_service_id=source.id,
                target_service_id=target.id,
                dependency_id=dependency.id,
                state="CLOSED",
                failure_threshold=thresholds.circuit_breaker.error_threshold,
                cooldown_seconds=thresholds.circuit_breaker.cooldown_seconds,
                recovery_threshold=thresholds.circuit_breaker.recovery_health_threshold,
            )
        )
        db.flush()
    return dependency


def _recompute_metrics(db: Session) -> None:
    services = list(db.execute(select(Service)).scalars().all())
    for service in services:
        spans = list(db.execute(select(SpanRecord).where(SpanRecord.service_id == service.id)).scalars().all())
        durations = [span.duration_ms for span in spans]
        errors = sum(1 for span in spans if span.is_error)
        service.total_spans = len(spans)
        service.total_calls = len(spans)
        service.error_count = errors
        service.error_rate = safe_div(errors, len(spans))
        service.avg_latency_ms = safe_div(sum(durations), len(durations))
        service.min_latency_ms = min(durations) if durations else None
        service.max_latency_ms = max(durations) if durations else None
        service.p95_latency_ms = percentile(durations, 95)
        service.p99_latency_ms = percentile(durations, 99)
        if spans:
            latest = max(span.start_time_us for span in spans)
            service.last_seen_at = _start_time_to_datetime(latest)
        service.updated_at = utc_now()

    dependencies = list(db.execute(select(Dependency)).scalars().all())
    for dependency in dependencies:
        spans = list(
            db.execute(select(SpanRecord).where(SpanRecord.dependency_id == dependency.id)).scalars().all()
        )
        durations = [span.duration_ms for span in spans]
        errors = sum(1 for span in spans if span.is_error)
        dependency.call_count = len(spans)
        dependency.error_count = errors
        dependency.error_rate = safe_div(errors, len(spans))
        dependency.avg_latency_ms = safe_div(sum(durations), len(durations))
        dependency.p95_latency_ms = percentile(durations, 95)
        dependency.p99_latency_ms = percentile(durations, 99)
        dependency.updated_at = utc_now()
    db.flush()


def _refresh_dependency_critical_weights(db: Session) -> None:
    thresholds = get_thresholds()
    dependencies = list(db.execute(select(Dependency)).scalars().all())
    if not dependencies:
        return
    counts = sorted(dep.call_count for dep in dependencies)
    rank = thresholds.critical_edge.call_count_percentile * (len(counts) - 1)
    index = int(round(rank))
    cutoff = counts[index]
    for dependency in dependencies:
        is_critical = dependency.call_count >= cutoff and cutoff > 0
        dependency.critical_weight = (
            thresholds.blast_radius.critical_edge_weight
            if is_critical
            else thresholds.blast_radius.non_critical_edge_weight
        )
    db.flush()


def _start_time_to_datetime(start_time: int):
    from datetime import datetime, timezone

    if start_time > 1e15:
        seconds = start_time / 1e9
    elif start_time > 1e12:
        seconds = start_time / 1e6
    elif start_time > 1e9:
        seconds = start_time / 1e3
    else:
        seconds = start_time
    try:
        return datetime.fromtimestamp(seconds, tz=timezone.utc)
    except (OSError, OverflowError, ValueError):
        return utc_now()
