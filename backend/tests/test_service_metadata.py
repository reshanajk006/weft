"""Service metadata PATCH and business-tier criticality tests."""

from __future__ import annotations

from tests.conftest import chain_payload


def test_tier_changes_score(client, ingest):
    ingest(chain_payload(["checkout-service", "payment-gateway"]))
    payment = next(item for item in client.get("/api/services").json()["items"] if item["name"] == "payment-gateway")
    before = client.get(f"/api/criticality/{payment['id']}").json()
    assert before["breakdown"]["business_tier"]["normalized_score"] == 0.0
    patched = client.patch(f"/api/services/{payment['id']}", json={"tier": "critical", "owner": "payments-team"})
    assert patched.status_code == 200
    after = client.get(f"/api/criticality/{payment['id']}").json()
    assert after["breakdown"]["business_tier"]["normalized_score"] == 1.0
    assert after["breakdown"]["business_tier"]["contribution"] > 0
    assert after["score"] > before["score"]
    assert patched.json()["owner"] == "payments-team"
    assert patched.json()["tier"] == "critical"


def test_criticality_override_bypasses_computed(client, ingest):
    ingest(chain_payload(["checkout-service", "payment-gateway"]))
    payment = next(item for item in client.get("/api/services").json()["items"] if item["name"] == "payment-gateway")
    response = client.patch(f"/api/services/{payment['id']}", json={"criticality_override": 91})
    assert response.status_code == 200
    explanation = client.get(f"/api/criticality/{payment['id']}").json()
    assert explanation["score"] == 91
    assert explanation["criticality_override"] == 91
    assert explanation["computed_score"] is not None
    ranking = next(item for item in client.get("/api/criticality/rankings").json()["items"] if item["service_id"] == payment["id"])
    assert ranking["score"] == 91


def test_tier_weight_included_in_sum_validation(client):
    ok = client.put(
        "/api/config/thresholds",
        json={
            "criticality": {
                "call_volume_weight": 0.25,
                "error_weight": 0.20,
                "latency_weight": 0.20,
                "dependency_weight": 0.20,
                "tier_weight": 0.15,
            }
        },
    )
    assert ok.status_code == 200
    bad = client.put(
        "/api/config/thresholds",
        json={
            "criticality": {
                "call_volume_weight": 0.25,
                "error_weight": 0.20,
                "latency_weight": 0.20,
                "dependency_weight": 0.20,
                "tier_weight": 0.5,
            }
        },
    )
    assert bad.status_code == 422
