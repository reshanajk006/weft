"""Health engine tests."""

from __future__ import annotations

from tests.conftest import jaeger_payload, jaeger_span, jaeger_trace


def _error_mix(total: int, errors: int, service: str = "svc") -> dict:
    spans = []
    for index in range(total):
        failed = index < errors
        spans.append(
            jaeger_span(
                trace_id="h",
                span_id=f"s{index}",
                service=service,
                status="500" if failed else "200",
                error=failed,
            )
        )
    return jaeger_payload(jaeger_trace("h", spans))


def test_zero_errors(ingest, client):
    ingest(_error_mix(10, 0))
    item = client.get("/api/health/services").json()["items"][0]
    assert item["health_status"] == "HEALTHY"
    assert item["health_score"] == 100
    assert item["error_rate"] == 0


def test_ten_percent_errors(ingest, client):
    ingest(_error_mix(10, 1))
    item = client.get("/api/health/services").json()["items"][0]
    assert abs(item["error_rate"] - 0.10) < 1e-9
    assert item["health_status"] == "DEGRADED"
    assert item["health_score"] == 90


def test_fifty_percent_errors(ingest, client):
    ingest(_error_mix(10, 5))
    item = client.get("/api/health/services").json()["items"][0]
    assert abs(item["error_rate"] - 0.50) < 1e-9
    assert item["health_status"] == "UNHEALTHY"
    assert item["health_score"] == 50


def test_hundred_percent_errors(ingest, client):
    ingest(_error_mix(4, 4))
    item = client.get("/api/health/services").json()["items"][0]
    assert item["error_rate"] == 1.0
    assert item["health_status"] == "UNHEALTHY"
    assert item["health_score"] == 0


def test_score_clamping(client):
    from app.services.health_service import classify_health

    score, status = classify_health(1.5)
    assert score == 0
    assert status == "UNHEALTHY"
    score, status = classify_health(-0.2)
    assert score == 100
    assert status == "HEALTHY"


def test_threshold_boundaries(ingest, client):
    ingest(_error_mix(10, 1))
    degraded = client.get("/api/health/services").json()["items"][0]
    assert degraded["health_status"] == "DEGRADED"
    history = client.get(
        f"/api/services/{degraded['service_id']}/health-history"
    ).json()
    assert history["total"] >= 1
    assert history["items"][0]["health_status"] == "DEGRADED"
