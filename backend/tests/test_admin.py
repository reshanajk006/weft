"""Admin reset/seed and API-key tests."""

from __future__ import annotations

from tests.conftest import chain_payload


def test_admin_requires_key(client, ingest):
    ingest(chain_payload(["a-service", "b-service"]))
    assert client.post("/api/admin/reset").status_code == 403
    assert client.post("/api/admin/seed-sample").status_code == 403


def test_admin_reset_and_seed(client, monkeypatch):
    from app.core.settings import get_settings

    monkeypatch.setattr(get_settings(), "admin_key", "test-admin")
    headers = {"X-Admin-Key": "test-admin"}
    client.post("/api/config/topology", json={"services": [{"name": "scratch-service"}], "dependencies": []})
    assert client.get("/api/graph").json()["nodes"]

    reset = client.post("/api/admin/reset", headers=headers)
    assert reset.status_code == 200
    assert client.get("/api/graph").json() == {"nodes": [], "edges": []}

    seeded = client.post("/api/admin/seed-sample", headers=headers)
    assert seeded.status_code == 201
    graph = client.get("/api/graph").json()
    names = {node["name"] for node in graph["nodes"]}
    pairs = {(edge["source"], edge["target"]) for edge in graph["edges"]}
    id_to_name = {node["id"]: node["name"] for node in graph["nodes"]}
    named_pairs = {(id_to_name[src], id_to_name[tgt]) for src, tgt in pairs}
    assert "checkout-service" in names
    assert "payment-gateway" in names
    assert ("checkout-service", "payment-gateway") in named_pairs


def test_admin_invalid_key(client, monkeypatch):
    from app.core.settings import get_settings

    monkeypatch.setattr(get_settings(), "admin_key", "test-admin")
    response = client.post("/api/admin/reset", headers={"X-Admin-Key": "nope"})
    assert response.status_code == 403


def test_write_api_key_rejects_when_configured(client, monkeypatch):
    from app.core.settings import get_settings

    monkeypatch.setattr(get_settings(), "api_key", "secret")
    denied = client.post("/api/config/topology", json={"services": [{"name": "x"}], "dependencies": []})
    assert denied.status_code == 403
    allowed = client.post(
        "/api/config/topology",
        json={"services": [{"name": "x"}], "dependencies": []},
        headers={"X-API-Key": "secret"},
    )
    assert allowed.status_code == 201
    assert client.get("/api/graph").status_code == 200
