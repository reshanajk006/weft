"""Tests for recording observed trace errors and auto-recording incident reports when loading JSON files."""

from __future__ import annotations

import json
from pathlib import Path

from tests.conftest import jaeger_payload, jaeger_span, jaeger_trace


def test_ingesting_json_with_errors_auto_records_incident_simulation(client, ingest):
    # Ingest a JSON trace payload containing span errors
    payload = jaeger_payload(
        jaeger_trace(
            "trace-with-err",
            [
                jaeger_span(trace_id="trace-with-err", span_id="op1", service="checkout-service"),
                jaeger_span(
                    trace_id="trace-with-err",
                    span_id="op2",
                    service="billing-service",
                    parent="op1",
                    error=True,
                    status="500",
                ),
            ],
        )
    )
    result = ingest(payload)
    assert result["errors_detected"] == 1

    # Verify that a simulation run / incident report was automatically recorded
    simulations = client.get("/api/simulations").json()["items"]
    assert len(simulations) >= 1
    failing_names = [item["failed_service_name"] for item in simulations]
    assert "billing-service" in failing_names

    # Generate incident report for the auto-recorded simulation
    sim_id = next(item["id"] for item in simulations if item["failed_service_name"] == "billing-service")
    report_res = client.post(
        "/api/reports/generate",
        json={"simulation_id": sim_id, "format": "markdown"},
    )
    assert report_res.status_code == 201
    content = report_res.json()["content"]

    # Verify report records observed production incident and trace error details
    assert "# WEFT Incident Impact Report" in content
    assert "Observed production incident: Yes" in content
    assert "Recorded trace errors: 1 error span(s)" in content


def test_generate_json_report_includes_observed_telemetry_errors(client, ingest):
    payload = jaeger_payload(
        jaeger_trace(
            "err-trace-2",
            [
                jaeger_span(
                    trace_id="err-trace-2",
                    span_id="sp1",
                    service="auth-service",
                    error=True,
                    status="503",
                ),
            ],
        )
    )
    ingest(payload)

    simulations = client.get("/api/simulations").json()["items"]
    sim_id = simulations[0]["id"]

    json_report = client.post(
        "/api/reports/generate",
        json={"simulation_id": sim_id, "format": "json"},
    ).json()

    parsed = json.loads(json_report["content"])
    assert "observed_telemetry_errors" in parsed
    obs_err = parsed["observed_telemetry_errors"]
    assert obs_err["has_observed_errors"] is True
    assert obs_err["error_spans"] >= 1
    assert parsed["scenario_classification"]["observed_production_incident"] is True
