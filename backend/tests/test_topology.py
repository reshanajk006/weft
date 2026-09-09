"""Config-driven topology ingestion tests."""

from __future__ import annotations

from tests.conftest import chain_payload


TOPOLOGY = {
    "services": [
        {"name": "checkout", "tier": "high", "type": "api", "owner": "checkout-team"},
        {"name": "payment-service", "tier": "critical", "type": "api", "owner": "payments-team"},
    ],
    "dependencies": [
        {"source": "checkout", "target": "payment-service", "critical_weight": 0.9, "protocol": "http"}
    ],
    "mode": "merge",
}


def test_topology_create_from_scratch(client):
    response = client.post("/api/config/topology", json=TOPOLOGY)
    assert response.status_code == 201, response.text
    graph = client.get("/api/graph").json()
    names = {node["name"] for node in graph["nodes"]}
    assert names == {"checkout", "payment-service"}
    assert len(graph["edges"]) == 1
    assert client.get("/api/criticality/rankings").json()["total"] == 2
    payment = next(item for item in client.get("/api/services").json()["items"] if item["name"] == "payment-service")
    blast = client.get(f"/api/blast-radius/{payment['id']}")
    assert blast.status_code == 200
    assert "checkout" in {item["service_name"] for item in blast.json()["affected_services"]}


def test_topology_merges_with_trace_data(client, ingest):
    ingest(chain_payload(["checkout-service", "payment-gateway"]))
    before = {item["name"] for item in client.get("/api/services").json()["items"]}
    response = client.post(
        "/api/config/topology",
        json={
            "services": [
                {"name": "checkout-service", "tier": "critical", "owner": "checkout-team"},
                {"name": "notification-service", "tier": "low"},
            ],
            "dependencies": [{"source": "checkout-service", "target": "notification-service"}],
            "mode": "merge",
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert body["services_created"] == 1
    checkout = next(item for item in client.get("/api/services").json()["items"] if item["name"] == "checkout-service")
    assert checkout["source"] == "both"
    assert checkout["owner"] == "checkout-team"
    names = {item["name"] for item in client.get("/api/services").json()["items"]}
    assert "payment-gateway" in names
    assert "notification-service" in names
    assert before <= names


def test_topology_replace_keeps_trace_rows(client, ingest):
    ingest(chain_payload(["checkout-service", "payment-gateway"]))
    client.post(
        "/api/config/topology",
        json={
            "services": [{"name": "temp-config-service"}],
            "dependencies": [],
            "mode": "merge",
        },
    )
    assert "temp-config-service" in {item["name"] for item in client.get("/api/services").json()["items"]}
    response = client.post(
        "/api/config/topology",
        json={
            "services": [{"name": "kept-config-service"}],
            "dependencies": [],
            "mode": "replace",
        },
    )
    assert response.status_code == 201
    names = {item["name"] for item in client.get("/api/services").json()["items"]}
    assert "checkout-service" in names
    assert "payment-gateway" in names
    assert "temp-config-service" not in names
    assert "kept-config-service" in names


def test_invalid_dependency_reference_rejected(client):
    response = client.post(
        "/api/config/topology",
        json={
            "services": [{"name": "only-service"}],
            "dependencies": [{"source": "only-service", "target": "missing-service"}],
        },
    )
    assert response.status_code == 422
    assert client.get("/api/graph").json() == {"nodes": [], "edges": []}


def test_topology_reupload_is_idempotent(client):
    first = client.post("/api/config/topology", json=TOPOLOGY).json()
    second = client.post("/api/config/topology", json=TOPOLOGY).json()
    assert first["services_created"] == 2
    assert second["services_created"] == 0
    assert second["services_updated"] == 2
    graph = client.get("/api/graph").json()
    assert len(graph["nodes"]) == 2
    assert len(graph["edges"]) == 1
