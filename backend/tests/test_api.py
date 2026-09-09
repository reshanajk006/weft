"""HTTP API contract tests."""

from __future__ import annotations

from pathlib import Path

from tests.conftest import chain_payload, jaeger_payload, jaeger_span, jaeger_trace

SAMPLES = Path(__file__).resolve().parent.parent / "samples"


def test_health_does_not_need_database(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body == {"status": "ok", "service": "weft-backend", "version": "1.0.0"}


def test_upload_and_json_endpoints(client, tmp_path):
    payload = chain_payload(["checkout-service", "payment-gateway"])
    json_response = client.post("/api/telemetry/traces", json=payload)
    assert json_response.status_code == 201
    path = tmp_path / "trace.json"
    path.write_text(__import__("json").dumps(payload), encoding="utf-8")
    with path.open("rb") as handle:
        upload = client.post(
            "/api/telemetry/traces/upload",
            files={"file": ("trace.json", handle, "application/json")},
        )
    assert upload.status_code == 201
    body = upload.json()
    assert set(body) >= {
        "ingestion_id",
        "filename",
        "traces_processed",
        "spans_processed",
        "services_discovered",
        "dependencies_discovered",
        "errors_detected",
        "status",
    }


def test_graph_services_blast_simulation_report(ingest, client):
    ingest(chain_payload(["checkout-service", "payment-gateway"]))
    graph = client.get("/api/graph").json()
    assert "nodes" in graph and "edges" in graph
    services = client.get("/api/services", params={"q": "payment"}).json()
    assert services["total"] == 1
    payment = services["items"][0]
    blast = client.get(f"/api/blast-radius/{payment['id']}").json()
    assert blast["failed_service_id"] == payment["id"]
    sim = client.post(f"/api/simulate/failure/{payment['id']}")
    assert sim.status_code == 201
    report = client.post(
        "/api/reports/generate",
        json={"simulation_id": sim.json()["simulation_id"], "format": "markdown"},
    )
    assert report.status_code == 201
    assert "# Incident Impact Report" in report.json()["content"]
    json_report = client.post(
        "/api/reports/generate",
        json={"simulation_id": sim.json()["simulation_id"], "format": "json"},
    )
    assert json_report.status_code == 201


def test_validation_and_404(client):
    missing = client.get("/api/services/does-not-exist")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "SERVICE_NOT_FOUND"
    invalid = client.post("/api/telemetry/traces", json={"hello": "world"})
    assert invalid.status_code == 422
    assert "error" in invalid.json()


def test_cors_allows_configured_origin(client):
    response = client.options(
        "/api/health",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.status_code in {200, 204}
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"


def test_sse_stream(ingest, client):
    ingest(chain_payload(["checkout-service", "payment-gateway"]))
    payment = next(item for item in client.get("/api/services").json()["items"] if item["name"] == "payment-gateway")
    response = client.get(f"/api/simulate/failure/{payment['id']}/stream")
    assert response.status_code == 200
    assert "blast_radius_start" in response.text
    assert "service_affected" in response.text
    assert "blast_radius_complete" in response.text


def test_overview_and_docs(ingest, client):
    ingest(chain_payload(["checkout-service", "payment-gateway"]))
    overview = client.get("/api/overview").json()
    assert overview["service_count"] == 2
    assert overview["dependency_count"] == 1
    docs = client.get("/docs")
    assert docs.status_code == 200
    redoc = client.get("/redoc")
    assert redoc.status_code == 200


def test_upload_rejects_non_json_extension(client):
    response = client.post(
        "/api/telemetry/traces/upload",
        files={"file": ("trace.txt", b"{}", "text/plain")},
    )
    assert response.status_code == 422


def test_pagination_shape(ingest, client):
    ingest(chain_payload(["checkout-service", "payment-gateway"]))
    body = client.get("/api/services", params={"limit": 1, "offset": 0}).json()
    assert set(body) == {"items", "total", "limit", "offset"}
    assert body["limit"] == 1
    assert len(body["items"]) == 1
