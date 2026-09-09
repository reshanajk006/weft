"""Circuit-breaker state machine tests."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from tests.conftest import chain_payload


def _dependency_and_cb(client):
    ingest_id_graph = client.get("/api/graph").json()
    edge = ingest_id_graph["edges"][0]
    breakers = client.get("/api/circuit-breakers").json()["items"]
    breaker = next(item for item in breakers if item["dependency"]["dependency_id"] == edge["id"])
    return edge["id"], breaker


def test_closed_to_open(ingest, client):
    ingest(chain_payload(["checkout-service", "payment-gateway"]))
    dep_id, breaker = _dependency_and_cb(client)
    assert breaker["state"] == "CLOSED"
    result = client.post(
        "/api/circuit-breakers/simulate",
        json={"dependency_id": dep_id, "simulated_error_rate": 0.75, "simulated_health_score": 25},
    ).json()
    assert result["previous_state"] == "CLOSED"
    assert result["new_state"] == "OPEN"
    assert result["kind"] == "real_circuit_transition"
    assert result["transition_id"]
    fetched = client.get(f"/api/circuit-breakers/{breaker['id']}").json()
    assert fetched["state"] == "OPEN"


def test_open_to_half_open_after_cooldown(ingest, client):
    ingest(chain_payload(["checkout-service", "payment-gateway"]))
    dep_id, _ = _dependency_and_cb(client)
    client.post(
        "/api/circuit-breakers/simulate",
        json={"dependency_id": dep_id, "simulated_error_rate": 0.9, "simulated_health_score": 10},
    )
    still_open = client.post(
        "/api/circuit-breakers/simulate",
        json={
            "dependency_id": dep_id,
            "simulated_error_rate": 0.9,
            "simulated_health_score": 10,
            "elapsed_seconds": 1,
        },
    ).json()
    assert still_open["new_state"] == "OPEN"
    half = client.post(
        "/api/circuit-breakers/simulate",
        json={
            "dependency_id": dep_id,
            "simulated_error_rate": 0.9,
            "simulated_health_score": 10,
            "elapsed_seconds": 30,
        },
    ).json()
    assert still_open["previous_state"] == "OPEN"
    assert half["new_state"] == "HALF_OPEN"


def test_half_open_to_closed(ingest, client):
    ingest(chain_payload(["checkout-service", "payment-gateway"]))
    dep_id, breaker = _dependency_and_cb(client)
    client.post(
        f"/api/circuit-breakers/{breaker['id']}/transition",
        json={"new_state": "HALF_OPEN", "reason": "test"},
    )
    result = client.post(
        "/api/circuit-breakers/simulate",
        json={"dependency_id": dep_id, "simulated_error_rate": 0.1, "simulated_health_score": 90},
    ).json()
    assert result["previous_state"] == "HALF_OPEN"
    assert result["new_state"] == "CLOSED"


def test_half_open_to_open(ingest, client):
    ingest(chain_payload(["checkout-service", "payment-gateway"]))
    dep_id, breaker = _dependency_and_cb(client)
    client.post(
        f"/api/circuit-breakers/{breaker['id']}/transition",
        json={"new_state": "HALF_OPEN", "reason": "test"},
    )
    result = client.post(
        "/api/circuit-breakers/simulate",
        json={"dependency_id": dep_id, "simulated_error_rate": 0.8, "simulated_health_score": 20},
    ).json()
    assert result["previous_state"] == "HALF_OPEN"
    assert result["new_state"] == "OPEN"


def test_threshold_boundary(ingest, client):
    ingest(chain_payload(["checkout-service", "payment-gateway"]))
    dep_id, _ = _dependency_and_cb(client)
    below = client.post(
        "/api/circuit-breakers/simulate",
        json={"dependency_id": dep_id, "simulated_error_rate": 0.4999, "simulated_health_score": 90},
    ).json()
    assert below["new_state"] == "CLOSED"
    at = client.post(
        "/api/circuit-breakers/simulate",
        json={"dependency_id": dep_id, "simulated_error_rate": 0.50, "simulated_health_score": 20},
    ).json()
    assert at["new_state"] == "OPEN"


def test_reset_and_transition_logging(ingest, client):
    ingest(chain_payload(["checkout-service", "payment-gateway"]))
    dep_id, breaker = _dependency_and_cb(client)
    client.post(
        "/api/circuit-breakers/simulate",
        json={"dependency_id": dep_id, "simulated_error_rate": 1.0, "simulated_health_score": 0},
    )
    reset = client.post(f"/api/circuit-breakers/{breaker['id']}/reset").json()
    assert reset["state"] == "CLOSED"


def test_failure_simulation_predicts_circuit_breakers(ingest, client):
    ingest(chain_payload(["checkout-service", "payment-gateway"]))
    payment = next(item for item in client.get("/api/services").json()["items"] if item["name"] == "payment-gateway")
    result = client.post(f"/api/simulate/failure/{payment['id']}").json()
    assert result["predicted_circuit_transitions"]
    predicted = result["predicted_circuit_transitions"][0]
    assert predicted["kind"] == "predicted_circuit_transition"
    assert predicted["new_state"] == "OPEN"
    live = client.get("/api/circuit-breakers").json()["items"]
    assert all(item["state"] == "CLOSED" for item in live)
