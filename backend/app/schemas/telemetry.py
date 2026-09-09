"""Telemetry ingestion schemas."""

from __future__ import annotations

from typing import Any

from pydantic import Field

from app.schemas.common import APIModel


class IngestionResult(APIModel):
    ingestion_id: str
    filename: str | None = None
    traces_processed: int
    spans_processed: int
    services_discovered: int
    dependencies_discovered: int
    errors_detected: int
    status: str
    error_message: str | None = None


class IngestionHistoryItem(APIModel):
    id: str
    filename: str | None = None
    trace_count: int
    span_count: int
    service_count: int
    dependency_count: int
    error_count: int
    status: str
    error_message: str | None = None
    created_at: str


class IngestionHistoryResponse(APIModel):
    items: list[IngestionHistoryItem]
    total: int
    limit: int
    offset: int


class JaegerTag(APIModel):
    key: str
    value: Any = None


class JaegerProcess(APIModel):
    serviceName: str | None = None
    tags: list[JaegerTag] = Field(default_factory=list)


class JaegerReference(APIModel):
    refType: str | None = None
    spanID: str | None = None
    traceID: str | None = None


class JaegerSpan(APIModel):
    traceID: str | None = None
    spanID: str | None = None
    operationName: str | None = None
    startTime: int | float | None = None
    duration: int | float | None = None
    tags: list[JaegerTag] = Field(default_factory=list)
    process: JaegerProcess | None = None
    processID: str | None = None
    references: list[JaegerReference] = Field(default_factory=list)


class JaegerTrace(APIModel):
    traceID: str | None = None
    spans: list[JaegerSpan] = Field(default_factory=list)
    processes: dict[str, JaegerProcess] = Field(default_factory=dict)


class JaegerPayload(APIModel):
    data: list[JaegerTrace]
