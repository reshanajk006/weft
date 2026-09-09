"""Active dataset isolation tests."""

from tests.conftest import chain_payload


def test_no_active_dataset_hides_legacy_rows(client, ingest):
    ingest(chain_payload(["legacy-a", "legacy-b"]))
    assert client.get("/api/graph").json()["nodes"]

    from sqlalchemy import update
    from app.db.database import get_session_factory
    from app.db.models import TelemetryDataset

    session = get_session_factory()()
    try:
        session.execute(update(TelemetryDataset).values(is_active=False))
        session.commit()
    finally:
        session.close()

    assert client.get("/api/datasets/active").json() == {"dataset": None}
    overview = client.get("/api/overview").json()
    assert overview["service_count"] == 0
    assert overview["active_dataset"] is None
    assert overview["open_circuit_breakers"] == 0
    assert client.get("/api/graph").json() == {"nodes": [], "edges": []}
    assert client.get("/api/services").json()["items"] == []
    assert client.get("/api/simulations").json()["items"] == []


def test_second_ingest_replaces_active_graph(client, ingest):
    ingest(chain_payload(["checkout-service", "payment-gateway"]))
    first = {node["name"] for node in client.get("/api/graph").json()["nodes"]}
    assert first == {"checkout-service", "payment-gateway"}
    first_dataset = client.get("/api/datasets/active").json()["dataset"]["id"]

    ingest(chain_payload(["auth-service", "user-db"]))
    graph = client.get("/api/graph").json()
    names = {node["name"] for node in graph["nodes"]}
    assert names == {"auth-service", "user-db"}
    assert "checkout-service" not in names
    assert "payment-gateway" not in names
    second_dataset = client.get("/api/datasets/active").json()["dataset"]["id"]
    assert second_dataset != first_dataset


def test_service_from_inactive_dataset_is_not_found(client, ingest):
    ingest(chain_payload(["alpha-service", "beta-service"]))
    old_id = client.get("/api/services").json()["items"][0]["id"]
    ingest(chain_payload(["gamma-service"]))
    response = client.get(f"/api/services/{old_id}")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "SERVICE_NOT_FOUND"
