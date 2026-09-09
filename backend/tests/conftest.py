"""Shared pytest fixtures and Jaeger payload helpers."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parent.parent


def jaeger_span(
    *,
    trace_id: str,
    span_id: str,
    service: str,
    operation: str = "op",
    duration: int = 10_000,
    start: int = 1_700_000_000_000_000,
    parent: str | None = None,
    status: object | None = "200",
    error: object | None = False,
    process_id: str | None = None,
    extra_tags: list[dict] | None = None,
) -> dict:
    tags = []
    if status is not None:
        tags.append({"key": "http.status_code", "value": status})
    if error is not None:
        tags.append({"key": "error", "value": error})
    if extra_tags:
        tags.extend(extra_tags)
    references = []
    if parent:
        references.append({"refType": "CHILD_OF", "spanID": parent, "traceID": trace_id})
    span: dict = {
        "traceID": trace_id,
        "spanID": span_id,
        "operationName": operation,
        "startTime": start,
        "duration": duration,
        "tags": tags,
        "references": references,
    }
    if process_id:
        span["processID"] = process_id
    else:
        span["process"] = {"serviceName": service}
    return span


def jaeger_trace(trace_id: str, spans: list[dict], processes: dict | None = None) -> dict:
    return {"traceID": trace_id, "spans": spans, "processes": processes or {}}


def jaeger_payload(*traces: dict) -> dict:
    return {"data": list(traces)}


def chain_payload(services: list[str], trace_id: str = "t-chain") -> dict:
    spans = []
    parent = None
    for index, name in enumerate(services):
        span_id = f"s{index}"
        spans.append(
            jaeger_span(
                trace_id=trace_id,
                span_id=span_id,
                service=name,
                parent=parent,
                duration=12_000 + index * 1000,
            )
        )
        parent = span_id
    return jaeger_payload(jaeger_trace(trace_id, spans))


@pytest.fixture
def tmp_env(tmp_path, monkeypatch):
    db_path = tmp_path / "weft-test.db"
    thresholds_src = BACKEND_DIR / "config" / "thresholds.yaml"
    thresholds_copy = tmp_path / "thresholds.yaml"
    shutil.copyfile(thresholds_src, thresholds_copy)
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path.as_posix()}")
    monkeypatch.setenv("TRACE_UPLOAD_DIR", str(tmp_path / "traces"))
    monkeypatch.setenv("REPORT_STORAGE_DIR", str(tmp_path / "reports"))
    monkeypatch.setenv("THRESHOLDS_PATH", str(thresholds_copy))
    monkeypatch.setenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173")
    monkeypatch.setenv("LOG_LEVEL", "WARNING")
    from app.core.settings import reset_settings
    from app.config.thresholds import reset_thresholds
    from app.db.database import reset_engine

    reset_settings()
    reset_engine()
    reset_thresholds(thresholds_copy)
    yield tmp_path
    reset_engine()
    reset_settings()


@pytest.fixture
def app(tmp_env):
    from app.main import create_app

    return create_app()


@pytest.fixture
def client(app):
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def ingest(client):
    def _ingest(payload: dict):
        response = client.post("/api/telemetry/traces", json=payload)
        assert response.status_code == 201, response.text
        return response.json()

    return _ingest
