"""Error detection from mixed Jaeger tag types."""

from __future__ import annotations

from tests.conftest import jaeger_payload, jaeger_span, jaeger_trace


def _ingest_status(ingest, client, status, error):
    payload = jaeger_payload(
        jaeger_trace(
            "t-err",
            [
                jaeger_span(
                    trace_id="t-err",
                    span_id="s1",
                    service="payment-gateway",
                    status=status,
                    error=error,
                )
            ],
        )
    )
    ingest(payload)
    item = client.get("/api/services").json()["items"][0]
    return item["error_rate"], item["health_status"]


def test_error_true_string(ingest, client):
    rate, status = _ingest_status(ingest, client, "200", "true")
    assert rate == 1.0
    assert status == "UNHEALTHY"


def test_error_true_boolean(ingest, client):
    rate, status = _ingest_status(ingest, client, "200", True)
    assert rate == 1.0
    assert status == "UNHEALTHY"


def test_http_500_string(ingest, client):
    rate, status = _ingest_status(ingest, client, "500", "false")
    assert rate == 1.0
    assert status == "UNHEALTHY"


def test_http_500_int(ingest, client):
    rate, status = _ingest_status(ingest, client, 500, False)
    assert rate == 1.0


def test_http_503(ingest, client):
    rate, _ = _ingest_status(ingest, client, 503, False)
    assert rate == 1.0


def test_http_200_success(ingest, client):
    rate, status = _ingest_status(ingest, client, "200", "false")
    assert rate == 0.0
    assert status == "HEALTHY"


def test_http_404_is_not_error(ingest, client):
    rate, status = _ingest_status(ingest, client, "404", False)
    assert rate == 0.0
    assert status == "HEALTHY"


def test_mixed_tag_types(ingest, client):
    payload = jaeger_payload(
        jaeger_trace(
            "mix",
            [
                jaeger_span(trace_id="t", span_id="a", service="svc", status=200, error=False),
                jaeger_span(trace_id="t", span_id="b", service="svc", status="500", error=False),
                jaeger_span(trace_id="t", span_id="c", service="svc", status=201, error="true"),
            ],
        )
    )
    ingest(payload)
    item = client.get("/api/services").json()["items"][0]
    assert item["total_spans"] == 3
    assert abs(item["error_rate"] - (2 / 3)) < 1e-9
