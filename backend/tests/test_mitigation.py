"""Virtual mitigation must not mutate live graph, health, or breakers."""

from __future__ import annotations

from tests.conftest import chain_payload


def test_mitigation_before_after_and_immutability(client, ingest):
    ingest(chain_payload(["checkout-service", "payment-gateway", "card-network"]))
    payment = next(item for item in client.get("/api/services").json()["items"] if item["name"] == "payment-gateway")
    health_before = client.get(f"/api/services/{payment['id']}").json()
    graph_before = client.get("/api/graph").json()
    weights_before = {(edge["source"], edge["target"]): edge["critical_weight"] for edge in graph_before["edges"]}
    breakers_before = client.get("/api/circuit-breakers").json()["items"]
    breaker_states = {item["id"]: item["state"] for item in breakers_before}

    sim = client.post(f"/api/simulate/failure/{payment['id']}").json()
    baseline_score = sim["blast_radius_score"]
    mitigation = client.post(
        f"/api/simulations/{sim['simulation_id']}/mitigation",
        json={"strategy": "FALLBACK"},
    )
    assert mitigation.status_code == 200, mitigation.text
    body = mitigation.json()
    assert body["production_changes_executed"] is False
    assert body["baseline"]["blast_radius_score"] == baseline_score
    assert body["mitigated"] is not None
    assert body["improvement"] is not None
    assert body["affected_edges"]
    edge = body["affected_edges"][0]
    assert edge["virtual_weight"] == 0.1
    expected_delta = body["mitigated"]["blast_radius_score"] - body["baseline"]["blast_radius_score"]
    assert abs(body["improvement"]["blast_radius_score_delta"] - expected_delta) < 1e-6
    before = body["baseline"]["blast_radius_score"]
    after = body["mitigated"]["blast_radius_score"]
    if before > 0:
        expected_pct = ((before - after) / before) * 100.0
        assert abs(body["improvement"]["blast_radius_reduction_percent"] - expected_pct) < 0.02
    mitigated_breakdown = body["mitigated"]["score_breakdown"]
    expected_score = 100 * (
        0.40 * mitigated_breakdown["affected_ratio"]
        + 0.35 * mitigated_breakdown["weighted_impact"]
        + 0.25 * mitigated_breakdown["critical_service_factor"]
    )
    assert abs(body["mitigated"]["blast_radius_score"] - expected_score) < 0.05

    health_after = client.get(f"/api/services/{payment['id']}").json()
    assert health_after["health"]["score"] == health_before["health"]["score"]
    assert health_after["health"]["status"] == health_before["health"]["status"]
    graph_after = client.get("/api/graph").json()
    weights_after = {(edge["source"], edge["target"]): edge["critical_weight"] for edge in graph_after["edges"]}
    assert weights_after == weights_before
    breakers_after = {item["id"]: item["state"] for item in client.get("/api/circuit-breakers").json()["items"]}
    assert breaker_states == breakers_after
    blast_after = client.get(f"/api/blast-radius/{payment['id']}").json()
    assert blast_after["blast_radius_score"] == baseline_score

    report = client.post(
        "/api/reports/generate",
        json={"simulation_id": sim["simulation_id"], "format": "markdown"},
    ).json()["content"]
    assert "Without mitigation" in report
    assert "Production changes executed: No" in report


def test_no_fabricated_mitigation_without_caller_edge(client, ingest):
    ingest(chain_payload(["lonely-service"]))
    lonely = next(item for item in client.get("/api/services").json()["items"] if item["name"] == "lonely-service")
    sim = client.post(f"/api/simulate/failure/{lonely['id']}").json()
    body = client.post(
        f"/api/simulations/{sim['simulation_id']}/mitigation",
        json={"strategy": "FALLBACK"},
    ).json()
    assert body["mitigated"] is None
    assert body["improvement"] is None
    assert body["production_changes_executed"] is False
    report = client.post(
        "/api/reports/generate",
        json={"simulation_id": sim["simulation_id"], "format": "markdown"},
    ).json()["content"]
    assert "Mitigation comparison was not executed" in report
