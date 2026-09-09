"""Development reset must be explicit and must empty the graph."""

from tests.conftest import chain_payload


def test_reset_clears_imported_telemetry(client, ingest):
    ingest(chain_payload(["alpha-service", "payment-gateway"]))
    overview = client.get("/api/overview").json()
    assert overview["service_count"] == 2
    assert client.get("/api/graph").json()["nodes"]

    response = client.post("/api/dev/reset")
    assert response.status_code == 200
    body = response.json()
    assert body["cleared"] is True

    empty = client.get("/api/overview").json()
    assert empty["service_count"] == 0
    assert empty["dependency_count"] == 0
    assert client.get("/api/graph").json() == {"nodes": [], "edges": []}
    assert client.get("/api/simulations").json()["items"] == []


def test_reset_disabled(client, monkeypatch):
    from app.core.settings import get_settings

    monkeypatch.setattr(get_settings(), "allow_dev_reset", False)
    response = client.post("/api/dev/reset")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "FORBIDDEN"
