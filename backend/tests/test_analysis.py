"""Deterministic root-cause and recommendation tests."""

from tests.conftest import chain_payload, jaeger_payload, jaeger_span, jaeger_trace


def test_root_cause_ranks_failed_service(client, ingest):
    ingest(
        jaeger_payload(
            jaeger_trace(
                "rca-1",
                [
                    jaeger_span(trace_id="rca-1", span_id="c", service="checkout-service"),
                    jaeger_span(
                        trace_id="rca-1",
                        span_id="p",
                        service="payment-gateway",
                        parent="c",
                        error=True,
                        status="500",
                    ),
                ],
            )
        )
    )
    payment = client.get("/api/services", params={"q": "payment"}).json()["items"][0]
    sim = client.post(f"/api/simulate/failure/{payment['id']}")
    assert sim.status_code == 201
    analysis = client.get(f"/api/simulations/{sim.json()['simulation_id']}/analysis").json()
    cause = analysis["root_cause"]["likely_root_cause"]
    assert cause["service"] == "payment-gateway"
    assert cause["confidence"] == "High"
    assert cause["evidence"]
    blob = str(analysis).lower()
    assert "ai recommend" not in blob
    assert "machine learning" not in blob
    recs = analysis["recommendations"]
    assert recs
    assert recs[0]["priority"] in {"HIGH", "MEDIUM", "LOW"}
    assert recs[0]["evidence"]
    assert recs[0]["reason"]


def test_recommendations_are_evidence_backed(client, ingest):
    ingest(chain_payload(["checkout-service", "payment-gateway"]))
    payment = next(item for item in client.get("/api/services").json()["items"] if item["name"] == "payment-gateway")
    sim = client.post(f"/api/simulate/failure/{payment['id']}")
    recs = client.get(f"/api/simulations/{sim.json()['simulation_id']}/analysis").json()["recommendations"]
    assert all("recommendation" in item and "reason" in item and "evidence" in item for item in recs)
