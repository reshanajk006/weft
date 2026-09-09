"""Jaeger JSON parsing, validation, and ingestion."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config.thresholds import get_thresholds
from app.core.exceptions import NotFoundError, ValidationFailedError
from app.core.logging import get_logger
from app.core.utils import as_bool, as_str, new_id, normalize_name, percentile, safe_div, utc_now
from app.db.models import (
    CircuitBreakerState,
    CircuitBreakerTransition,
    CriticalitySnapshot,
    Dependency,
    Service,
    ServiceHealthHistory,
    ServiceOperation,
    SpanRecord,
    TelemetryDataset,
    TraceIngestion,
)
from app.schemas.telemetry import IngestionResult
from app.services.circuit_breaker_service import ensure_circuit_breakers_for_dependencies
from app.services.criticality_service import recompute_all_criticality
from app.services.dataset_service import create_and_activate_dataset
from app.services.graph_service import invalidate_graph_cache
from app.services.health_service import recompute_all_health
from app.db.models.simulation import IncidentSimulation, SimulationRun
from app.services.origin import SOURCE_CONFIG, SOURCE_TRACE, normalized_source, touch_source

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
    dataset_id: str | None = None,
    replace: bool = False,
    keep_service_names: list[str] | None = None,
) -> IngestionResult:
    """Validate and ingest Jaeger JSON.

    Manual import (dataset_id is None) creates and activates a NEW dataset.
    Live polling passes an existing dataset_id. When replace=True, the live
    dataset is rebuilt from the current lookback window so removals and
    metric changes appear on the graph.
    """

    invalidate_graph_cache()
    if dataset_id:
        dataset = db.get(TelemetryDataset, dataset_id)
        if dataset is None:
            raise NotFoundError(
                "Telemetry dataset was not found",
                code="DATASET_NOT_FOUND",
                details={"dataset_id": dataset_id},
            )
    else:
        from app.services.live_jaeger_ingestion import get_live_manager

        get_live_manager().stop_sync()
        dataset = create_and_activate_dataset(db, name=filename or "Jaeger import", source=filename)
        replace = False
    ingestion = TraceIngestion(
        id=new_id(),
        dataset_id=dataset.id,
        filename=filename,
        status="processing",
    )
    db.add(ingestion)
    db.flush()

    try:
        traces = _validate_payload(payload)
        if replace:
            _replace_dataset_spans(db, dataset.id)
        result = _process_traces(db, traces, ingestion, dataset.id)
        if keep_service_names:
            _ensure_named_services(db, dataset.id, keep_service_names)
        if replace:
            _prune_stale_topology(db, dataset.id, keep_names=keep_service_names)
            result["service_count"] = len(
                list(db.execute(select(Service).where(Service.dataset_id == dataset.id)).scalars().all())
            )
            result["dependency_count"] = len(
                list(db.execute(select(Dependency).where(Dependency.dataset_id == dataset.id)).scalars().all())
            )
        ingestion.trace_count = result["trace_count"]
        ingestion.span_count = result["span_count"]
        ingestion.service_count = result["service_count"]
        ingestion.dependency_count = result["dependency_count"]
        ingestion.error_count = result["error_count"]
        ingestion.status = "completed"
        db.flush()

        recompute_all_health(db, dataset_id=dataset.id)
        recompute_all_criticality(db, dataset_id=dataset.id)
        ensure_circuit_breakers_for_dependencies(db, dataset_id=dataset.id)
        _refresh_dependency_critical_weights(db, dataset_id=dataset.id)
        invalidate_graph_cache()

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
            dataset_id=dataset.id,
            dataset_name=dataset.name,
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


def _process_traces(
    db: Session,
    traces: list[dict[str, Any]],
    ingestion: TraceIngestion,
    dataset_id: str,
) -> dict[str, int]:
    span_count = 0
    error_count = 0
    for trace in traces:
        processed = _process_single_trace(db, trace, ingestion.id, dataset_id)
        span_count += processed["spans"]
        error_count += processed["errors"]

    _recompute_metrics(db, dataset_id)
    service_count = len(
        list(db.execute(select(Service).where(Service.dataset_id == dataset_id)).scalars().all())
    )
    dependency_count = len(
        list(db.execute(select(Dependency).where(Dependency.dataset_id == dataset_id)).scalars().all())
    )
    return {
        "trace_count": len(traces),
        "span_count": span_count,
        "service_count": service_count,
        "dependency_count": dependency_count,
        "error_count": error_count,
    }


def _process_single_trace(
    db: Session,
    trace: dict[str, Any],
    ingestion_id: str,
    dataset_id: str,
) -> dict[str, int]:
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
                SpanRecord.dataset_id == dataset_id,
                SpanRecord.trace_id == item["trace_id"],
                SpanRecord.span_id == item["span_id"],
            )
        ).scalar_one_or_none()
        if existing is not None:
            continue

        service = _get_or_create_service(db, item["service_name"], dataset_id)
        _ensure_operation(db, service, item["operation_name"], seen_operations)
        parent_service_name = None
        parent_span_id = item["parent_span_id"]
        if parent_span_id:
            parent_service_name = span_to_service.get(parent_span_id)

        dependency = None
        if parent_service_name and normalize_name(parent_service_name) != service.normalized_name:
            source = _get_or_create_service(db, parent_service_name, dataset_id)
            dependency = _get_or_create_dependency(db, source, service, dataset_id)

        record = SpanRecord(
            id=new_id(),
            dataset_id=dataset_id,
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
    return {"spans": len(parsed), "errors": errors}


def _replace_dataset_spans(db: Session, dataset_id: str) -> None:
    db.execute(delete(SpanRecord).where(SpanRecord.dataset_id == dataset_id))
    db.flush()


def _prune_stale_topology(
    db: Session,
    dataset_id: str,
    keep_names: list[str] | None = None,
) -> None:
    """Drop trace-only services and edges that are no longer in the live window."""

    protected = {
        row[0]
        for row in db.execute(select(SimulationRun.failed_service_id).where(SimulationRun.dataset_id == dataset_id))
        if row[0]
    }
    keep = {normalize_name(name) for name in keep_names or [] if str(name).strip()}
    for dependency in list(db.execute(select(Dependency).where(Dependency.dataset_id == dataset_id)).scalars().all()):
        if dependency.call_count > 0:
            continue
        if normalized_source(dependency.source) == SOURCE_CONFIG:
            continue
        _delete_dependency(db, dependency)
    db.flush()
    for service in list(db.execute(select(Service).where(Service.dataset_id == dataset_id)).scalars().all()):
        if service.id in protected:
            continue
        if normalized_source(service.source) == SOURCE_CONFIG:
            continue
        if keep and normalize_name(service.name) in keep:
            continue
        if service.total_spans > 0 and not keep:
            continue
        leftover = list(
            db.execute(
                select(Dependency).where(
                    Dependency.dataset_id == dataset_id,
                    (Dependency.source_service_id == service.id) | (Dependency.target_service_id == service.id),
                )
            ).scalars().all()
        )
        if leftover and not keep:
            continue
        for dependency in leftover:
            if normalized_source(dependency.source) == SOURCE_CONFIG:
                continue
            _delete_dependency(db, dependency)
        leftover = list(
            db.execute(
                select(Dependency).where(
                    Dependency.dataset_id == dataset_id,
                    (Dependency.source_service_id == service.id) | (Dependency.target_service_id == service.id),
                )
            ).scalars().all()
        )
        if leftover:
            continue
        db.execute(delete(CriticalitySnapshot).where(CriticalitySnapshot.service_id == service.id))
        db.execute(delete(ServiceHealthHistory).where(ServiceHealthHistory.service_id == service.id))
        db.execute(delete(ServiceOperation).where(ServiceOperation.service_id == service.id))
        db.execute(delete(IncidentSimulation).where(IncidentSimulation.service_id == service.id))
        db.delete(service)
    db.flush()


def _delete_dependency(db: Session, dependency: Dependency) -> None:
    breakers = list(
        db.execute(select(CircuitBreakerState).where(CircuitBreakerState.dependency_id == dependency.id)).scalars().all()
    )
    for breaker in breakers:
        db.execute(delete(IncidentSimulation).where(IncidentSimulation.circuit_breaker_id == breaker.id))
        db.execute(delete(CircuitBreakerTransition).where(CircuitBreakerTransition.circuit_breaker_id == breaker.id))
        db.delete(breaker)
    db.delete(dependency)


def _ensure_named_services(db: Session, dataset_id: str, names: list[str]) -> None:
    for name in names:
        cleaned = str(name).strip()
        if cleaned:
            _get_or_create_service(db, cleaned, dataset_id)
    db.flush()


def sync_live_catalog(db: Session, dataset_id: str, names: list[str]) -> None:
    """Keep the live graph aligned with Jaeger's service catalog, even without traces."""

    invalidate_graph_cache()
    _ensure_named_services(db, dataset_id, names)
    _prune_stale_topology(db, dataset_id, keep_names=names)
    recompute_all_health(db, dataset_id=dataset_id)
    recompute_all_criticality(db, dataset_id=dataset_id)
    invalidate_graph_cache()


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


def _get_or_create_service(db: Session, name: str, dataset_id: str) -> Service:
    normalized = normalize_name(name)
    service = db.execute(
        select(Service).where(Service.dataset_id == dataset_id, Service.normalized_name == normalized)
    ).scalar_one_or_none()
    if service is None:
        service = Service(
            id=new_id(),
            dataset_id=dataset_id,
            name=name.strip(),
            normalized_name=normalized,
            source=SOURCE_TRACE,
        )
        db.add(service)
        db.flush()
    else:
        touch_source(service, SOURCE_TRACE)
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


def _get_or_create_dependency(db: Session, source: Service, target: Service, dataset_id: str) -> Dependency:
    dependency = db.execute(
        select(Dependency).where(
            Dependency.dataset_id == dataset_id,
            Dependency.source_service_id == source.id,
            Dependency.target_service_id == target.id,
        )
    ).scalar_one_or_none()
    if dependency is None:
        thresholds = get_thresholds()
        dependency = Dependency(
            id=new_id(),
            dataset_id=dataset_id,
            source_service_id=source.id,
            target_service_id=target.id,
            critical_weight=get_thresholds().blast_radius.non_critical_edge_weight,
            source=SOURCE_TRACE,
        )
        db.add(dependency)
        db.flush()
        db.add(
            CircuitBreakerState(
                id=new_id(),
                dataset_id=dataset_id,
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
    else:
        touch_source(dependency, SOURCE_TRACE)
    return dependency


def _recompute_metrics(db: Session, dataset_id: str) -> None:
    services = list(db.execute(select(Service).where(Service.dataset_id == dataset_id)).scalars().all())
    dependencies = list(db.execute(select(Dependency).where(Dependency.dataset_id == dataset_id)).scalars().all())
    all_spans = list(db.execute(select(SpanRecord).where(SpanRecord.dataset_id == dataset_id)).scalars().all())
    by_service: dict[str, list[SpanRecord]] = {service.id: [] for service in services}
    by_dependency: dict[str, list[SpanRecord]] = {dependency.id: [] for dependency in dependencies}
    for span in all_spans:
        by_service.setdefault(span.service_id, []).append(span)
        if span.dependency_id:
            by_dependency.setdefault(span.dependency_id, []).append(span)

    for service in services:
        spans = by_service.get(service.id, [])
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

    for dependency in dependencies:
        spans = by_dependency.get(dependency.id, [])
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


def _refresh_dependency_critical_weights(db: Session, dataset_id: str | None = None) -> None:
    thresholds = get_thresholds()
    query = select(Dependency)
    if dataset_id:
        query = query.where(Dependency.dataset_id == dataset_id)
    dependencies = list(db.execute(query).scalars().all())
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
