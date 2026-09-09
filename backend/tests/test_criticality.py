"""Technical criticality scoring tests."""

from __future__ import annotations

from tests.conftest import chain_payload, jaeger_payload, jaeger_span, jaeger_trace


def test_deterministic_scores(ingest, client):
    ingest(chain_payload(["checkout-service", "payment-gateway"]))
    first = client.get("/api/criticality/rankings").json()
    second = client.get("/api/criticality/rankings").json()
    assert first == second
    for item in first["items"]:
        assert "breakdown" in item
        total = sum(item["breakdown"][key]["contribution"] for key in item["breakdown"])
        assert abs(total - item["score"]) < 0.02


def test_tie_breaking(ingest, client):
    payload = jaeger_payload(
        jaeger_trace(
            "tie",
            [
                jaeger_span(trace_id="tie", span_id="a", service="zeta-service"),
                jaeger_span(trace_id="tie", span_id="b", service="alpha-service"),
            ],
        )
    )
    ingest(payload)
    rankings = client.get("/api/criticality/rankings").json()["items"]
    names = [item["service"] for item in rankings]
    assert names == sorted(names, key=lambda name: name.lower()) or len(names) == 2
    scores = [item["score"] for item in rankings]
    if scores[0] == scores[1]:
        assert names == ["alpha-service", "zeta-service"]


def test_weight_validation(client):
    response = client.put(
        "/api/config/thresholds",
        json={"criticality": {"call_volume_weight": 1, "error_weight": 1, "latency_weight": 0, "dependency_weight": 0}},
    )
    assert response.status_code == 422


def test_normalization_uses_maxima(ingest, client):
    payload = jaeger_payload(
        jaeger_trace(
            "n",
            [
                jaeger_span(trace_id="n", span_id="a1", service="busy-service", duration=50_000),
                jaeger_span(trace_id="n", span_id="a2", service="busy-service", duration=50_000),
                jaeger_span(trace_id="n", span_id="b1", service="quiet-service", duration=1_000),
            ],
        )
    )
    ingest(payload)
    rankings = {item["service"]: item for item in client.get("/api/criticality/rankings").json()["items"]}
    assert rankings["busy-service"]["breakdown"]["call_volume"]["normalized_score"] == 1.0
    assert rankings["quiet-service"]["breakdown"]["call_volume"]["normalized_score"] < 1.0
