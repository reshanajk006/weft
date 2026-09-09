"""Hypothetical vs observed root-cause and recommendation tests."""

from __future__ import annotations

from tests.conftest import chain_payload, jaeger_payload, jaeger_span, jaeger_trace


def test_hypothetical_analysis_does_not_call_target_root_cause(client, ingest):
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
    root = analysis["root_cause"]
    assert root["mode"] == "HYPOTHETICAL"
    assert root["root_cause_status"] == "NOT_DETERMINED"
    assert root["likely_root_cause"] is None
    assert "simulation target" in root["message"]
    assert "simulation target" in root["disclaimer"]
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
    required = {
        "priority",
        "category",
        "action",
        "reason",
        "expected_outcome",
        "risk",
        "effort",
        "safe_to_automate",
        "validation",
    }
    for item in recs:
        assert required <= set(item)
        assert item["safe_to_automate"] is False
        assert item["category"] in {"CONTAINMENT", "FALLBACK", "RECOVERY", "PREVENTION"}


def test_containment_when_upstream_callers_exist(client, ingest):
    ingest(chain_payload(["checkout-service", "payment-gateway"]))
    payment = next(item for item in client.get("/api/services").json()["items"] if item["name"] == "payment-gateway")
    sim = client.post(f"/api/simulate/failure/{payment['id']}")
    recs = client.get(f"/api/simulations/{sim.json()['simulation_id']}/analysis").json()["recommendations"]
    containment = [item for item in recs if item["category"] == "CONTAINMENT"]
    assert containment
    assert "Isolate payment-gateway calls" in containment[0]["title"]
    assert "upstream callers" in containment[0]["reason"]


def test_fallback_playbook_by_service_name(client, ingest):
    cases = [
        ("analytics-service", "fail open", "analytics"),
        ("notification-service", "queue", "retry"),
        ("search-service", "cached", "partial"),
        ("payment-gateway", "fail closed", "backup"),
        ("auth-service", "fail closed", "never bypass"),
    ]
    for name, token_a, token_b in cases:
        ingest(chain_payload(["web-service", name], trace_id=f"t-{name}"))
        target = next(item for item in client.get("/api/services").json()["items"] if item["name"] == name)
        sim = client.post(f"/api/simulate/failure/{target['id']}")
        recs = client.get(f"/api/simulations/{sim.json()['simulation_id']}/analysis").json()["recommendations"]
        fallback = next(item for item in recs if item["category"] == "FALLBACK")
        blob = f"{fallback['action']} {fallback['title']}".lower()
        assert token_a in blob
        assert token_b in blob
        if name == "auth-service":
            assert "fail open" not in fallback["action"].lower()
