"""Existing SQLite files may still have pre-dataset UNIQUE constraints."""

from __future__ import annotations

import shutil
import sqlite3
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from tests.conftest import BACKEND_DIR, chain_payload


def test_legacy_trace_span_unique_allows_new_dataset_import(tmp_path, monkeypatch):
    db_path = tmp_path / "legacy.db"
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        CREATE TABLE span_records (
            id VARCHAR(36) NOT NULL,
            ingestion_id VARCHAR(36),
            service_id VARCHAR(36) NOT NULL,
            dependency_id VARCHAR(36),
            trace_id VARCHAR(128) NOT NULL,
            span_id VARCHAR(128) NOT NULL,
            parent_span_id VARCHAR(128),
            operation_name VARCHAR(512) NOT NULL,
            start_time_us INTEGER NOT NULL,
            duration_ms FLOAT NOT NULL,
            is_error BOOLEAN NOT NULL,
            http_status_code VARCHAR(16),
            created_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            CONSTRAINT uq_trace_span UNIQUE (trace_id, span_id)
        )
        """
    )
    conn.execute(
        """
        INSERT INTO span_records (
            id, ingestion_id, service_id, dependency_id, trace_id, span_id,
            parent_span_id, operation_name, start_time_us, duration_ms, is_error,
            http_status_code, created_at
        ) VALUES (?, NULL, 'legacy', NULL, 't-chain', 's0', NULL, 'op', 1, 1.0, 0, '200', ?)
        """,
        ("legacy-span", datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()
    conn.close()

    thresholds_copy = tmp_path / "thresholds.yaml"
    shutil.copyfile(BACKEND_DIR / "config" / "thresholds.yaml", thresholds_copy)
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path.as_posix()}")
    monkeypatch.setenv("TRACE_UPLOAD_DIR", str(tmp_path / "traces"))
    monkeypatch.setenv("REPORT_STORAGE_DIR", str(tmp_path / "reports"))
    monkeypatch.setenv("THRESHOLDS_PATH", str(thresholds_copy))
    monkeypatch.setenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173")
    monkeypatch.setenv("LOG_LEVEL", "WARNING")

    from app.config.thresholds import reset_thresholds
    from app.core.settings import reset_settings
    from app.db.database import reset_engine

    reset_settings()
    reset_engine()
    reset_thresholds(thresholds_copy)
    try:
        from app.main import create_app

        with TestClient(create_app()) as client:
            response = client.post(
                "/api/telemetry/traces",
                json=chain_payload(["checkout-service", "payment-gateway"]),
            )
            assert response.status_code == 201, response.text
            names = {node["name"] for node in client.get("/api/graph").json()["nodes"]}
            assert names == {"checkout-service", "payment-gateway"}
    finally:
        reset_engine()
        reset_settings()

    schema = sqlite3.connect(db_path).execute(
        "SELECT sql FROM sqlite_master WHERE tbl_name = 'span_records' AND type = 'table'"
    ).fetchone()[0]
    assert "uq_trace_span" not in schema
    assert "uq_dataset_trace_span" in schema or "dataset_id" in schema
