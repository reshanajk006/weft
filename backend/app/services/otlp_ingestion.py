"""OTLP JSON → internal Jaeger-shaped payload, then existing ingest write path."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.core.exceptions import ValidationFailedError
from app.core.utils import as_str
from app.schemas.telemetry import IngestionResult
from app.services.trace_ingestion import ingest_jaeger_payload


def ingest_otlp_payload(db: Session, payload: Any) -> IngestionResult:
    jaeger = otlp_to_jaeger(payload)
    return ingest_jaeger_payload(db, jaeger, filename="otlp.json")


def otlp_to_jaeger(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValidationFailedError("OTLP payload must be a JSON object")
    resource_spans = payload.get("resourceSpans") or payload.get("resource_spans")
    if not isinstance(resource_spans, list):
        raise ValidationFailedError("OTLP payload must contain resourceSpans[]")

    traces: dict[str, list[dict[str, Any]]] = {}
    for resource in resource_spans:
        if not isinstance(resource, dict):
            continue
        resource_service = _service_from_attributes((resource.get("resource") or {}).get("attributes") or [])
        for scope in resource.get("scopeSpans") or resource.get("scope_spans") or []:
            if not isinstance(scope, dict):
                continue
            for span in scope.get("spans") or []:
                if not isinstance(span, dict):
                    continue
                mapped = _map_span(span, resource_service)
                traces.setdefault(mapped["traceID"], []).append(mapped)

    if not traces:
        raise ValidationFailedError("OTLP payload contained no spans")
    return {
        "data": [
            {"traceID": trace_id, "spans": spans, "processes": {}}
            for trace_id, spans in traces.items()
        ]
    }


def _map_span(span: dict[str, Any], fallback_service: str) -> dict[str, Any]:
    attributes = span.get("attributes") or []
    service = _service_from_attributes(attributes) or fallback_service
    if not service:
        raise ValidationFailedError("OTLP span is missing a service name")
    start_ns = _as_int(span.get("startTimeUnixNano") or span.get("start_time_unix_nano"))
    end_ns = _as_int(span.get("endTimeUnixNano") or span.get("end_time_unix_nano"))
    duration_us = max(end_ns - start_ns, 0) // 1000
    start_us = start_ns // 1000
    status = span.get("status") or {}
    status_code = status.get("code", 0)
    tags = _attributes_to_tags(attributes)
    if int(status_code or 0) == 2:
        tags.append({"key": "error", "value": True})
    http_status = _http_status(attributes)
    if http_status:
        tags.append({"key": "http.response.status_code", "value": http_status})
    parent = as_str(span.get("parentSpanId") or span.get("parent_span_id"))
    references = []
    if parent:
        references.append({"refType": "CHILD_OF", "spanID": parent, "traceID": as_str(span.get("traceId") or span.get("trace_id"))})
    return {
        "traceID": as_str(span.get("traceId") or span.get("trace_id")),
        "spanID": as_str(span.get("spanId") or span.get("span_id")),
        "operationName": as_str(span.get("name")),
        "startTime": start_us,
        "duration": duration_us,
        "tags": tags,
        "process": {"serviceName": service},
        "references": references,
    }


def _service_from_attributes(attributes: Any) -> str:
    if not isinstance(attributes, list):
        return ""
    for item in attributes:
        if not isinstance(item, dict):
            continue
        key = as_str(item.get("key"))
        if key in {"service.name", "serviceName"}:
            return _otlp_value(item.get("value"))
    return ""


def _http_status(attributes: Any) -> str:
    if not isinstance(attributes, list):
        return ""
    for item in attributes:
        if not isinstance(item, dict):
            continue
        key = as_str(item.get("key"))
        if key in {"http.response.status_code", "http.status_code", "http.statusCode"}:
            return _otlp_value(item.get("value"))
    return ""


def _attributes_to_tags(attributes: Any) -> list[dict[str, Any]]:
    tags: list[dict[str, Any]] = []
    if not isinstance(attributes, list):
        return tags
    for item in attributes:
        if not isinstance(item, dict):
            continue
        key = as_str(item.get("key"))
        if not key:
            continue
        tags.append({"key": key, "value": _otlp_value(item.get("value"))})
    return tags


def _otlp_value(value: Any) -> Any:
    if isinstance(value, dict):
        if "stringValue" in value:
            return value["stringValue"]
        if "intValue" in value:
            return as_str(value["intValue"])
        if "boolValue" in value:
            return bool(value["boolValue"])
        if "doubleValue" in value:
            return value["doubleValue"]
    return value


def _as_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0
