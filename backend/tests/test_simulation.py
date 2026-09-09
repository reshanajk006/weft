"""Failure simulation tests."""

from __future__ import annotations

from tests.conftest import chain_payload


def test_simulation_does_not_mutate_health(ingest, client):
    ingest(chain_payload(["checkout-service", "payment-gateway"]))
    services = {item["name"]: item for item in client.get("/api/services").json()["items"]}
    before = client.get(f"/api/services/{services['payment-gateway']['id']}").json()
    response = client.post(f"/api/simulate/failure/{services['payment-gateway']['id']}")
    assert response.status_code == 201
    after = client.get(f"/api/services/{services['payment-gateway']['id']}").json()
    assert after["health"]["score"] == before["health"]["score"]
    assert after["health"]["status"] == before["health"]["status"]


def test_simulation_blast_radius_and_severity(ingest, client):
    ingest(chain_payload(["checkout-service", "payment-gateway"]))
    payment = next(item for item in client.get("/api/services").json()["items"] if item["name"] == "payment-gateway")
    result = client.post(f"/api/simulate/failure/{payment['id']}").json()
    assert result["failed_service"]["name"] == "payment-gateway"
    assert result["severity"] in {"LOW", "MEDIUM", "HIGH", "CRITICAL"}
    names = {item["service_name"] for item in result["affected_services"]}
    assert "checkout-service" in names
    assert result["simulation_id"]
    saved = client.get(f"/api/simulations/{result['simulation_id']}").json()
    assert saved["simulation_id"] == result["simulation_id"]
    timeline = client.get(f"/api/simulations/{result['simulation_id']}/timeline").json()
    types = [item["type"] for item in timeline["items"]]
    assert "FAILURE_DETECTED" in types
    assert "BLAST_RADIUS_CALCULATED" in types


def test_impact_ranking_order(ingest, client):
    ingest(chain_payload(["a-service", "b-service", "c-service"]))
    failed = next(item for item in client.get("/api/services").json()["items"] if item["name"] == "c-service")
    result = client.post(f"/api/simulate/failure/{failed['id']}").json()
    callers = [item for item in result["affected_services"] if item["service_name"] != "c-service"]
    probs = [item["impact_probability"] for item in callers]
    assert probs == sorted(probs, reverse=True)


def test_severity_boundaries():
    from app.services.simulation_service import classify_severity

    assert classify_severity(0, 0) == "LOW"
    assert classify_severity(25, 0) == "MEDIUM"
    assert classify_severity(49.9, 0) == "MEDIUM"
    assert classify_severity(50, 0) == "HIGH"
    assert classify_severity(74.9, 0) == "HIGH"
    assert classify_severity(75, 0) == "CRITICAL"
    assert classify_severity(100, 1) == "CRITICAL"
