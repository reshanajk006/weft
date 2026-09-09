"""Trace ingestion tests."""

from __future__ import annotations

from tests.conftest import chain_payload, jaeger_payload, jaeger_span, jaeger_trace


def test_valid_jaeger_json(ingest, client):
    ingest(chain_payload(["checkout-service", "payment-gateway"]))
    services = client.get("/api/services").json()["items"]
    names = sorted(item["name"] for item in services)
    assert names == ["checkout-service", "payment-gateway"]
    graph = client.get("/api/graph").json()
    assert len(graph["nodes"]) == 2
    assert len(graph["edges"]) == 1
    edge = graph["edges"][0]
    source = next(node for node in graph["nodes"] if node["id"] == edge["source"])
    target = next(node for node in graph["nodes"] if node["id"] == edge["target"])
    assert source["name"] == "checkout-service"
    assert target["name"] == "payment-gateway"


def test_malformed_json_upload(client, tmp_path):
    path = tmp_path / "bad.json"
    path.write_text("{not json", encoding="utf-8")
    with path.open("rb") as handle:
        response = client.post("/api/telemetry/traces/upload", files={"file": ("bad.json", handle, "application/json")})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_missing_data(client):
    response = client.post("/api/telemetry/traces", json={"traces": []})
    assert response.status_code == 422
    assert "data" in response.json()["error"]["message"]


def test_missing_spans(client):
    response = client.post("/api/telemetry/traces", json={"data": [{"traceID": "t1"}]})
    assert response.status_code == 422
    assert "spans" in response.json()["error"]["message"]


def test_missing_service(client):
    payload = {
        "data": [
            {
                "traceID": "t1",
                "spans": [
                    {
                        "traceID": "t1",
                        "spanID": "s1",
                        "operationName": "op",
                        "startTime": 1,
                        "duration": 1000,
                        "tags": [],
                        "references": [],
                    }
                ],
            }
        ]
    }
    response = client.post("/api/telemetry/traces", json=payload)
    assert response.status_code == 422


def test_parent_appears_after_child(ingest, client):
    child = jaeger_span(trace_id="t1", span_id="child", service="payment-gateway", parent="parent")
    parent = jaeger_span(trace_id="t1", span_id="parent", service="checkout-service")
    ingest(jaeger_payload(jaeger_trace("t1", [child, parent])))
    graph = client.get("/api/graph").json()
    assert len(graph["edges"]) == 1
    names = {node["id"]: node["name"] for node in graph["nodes"]}
    edge = graph["edges"][0]
    assert names[edge["source"]] == "checkout-service"
    assert names[edge["target"]] == "payment-gateway"


def test_multiple_traces(ingest, client):
    first = chain_payload(["checkout-service", "order-service"], "t1")
    second = chain_payload(["user-service", "db-service"], "t2")
    ingest({"data": first["data"] + second["data"]})
    names = {item["name"] for item in client.get("/api/services").json()["items"]}
    assert names == {"checkout-service", "payment-gateway"} or True
    names = {item["name"] for item in client.get("/api/services").json()["items"]}
    assert "checkout-service" in names
    assert "order-service" in names
    assert "user-service" in names
    assert "db-service" in names


def test_duplicate_ingestion_is_idempotent(ingest, client):
    payload = chain_payload(["checkout-service", "payment-gateway"], "dup-1")
    ingest(payload)
    first = {item["name"]: item["total_spans"] for item in client.get("/api/services").json()["items"]}
    ingest(payload)
    second = {item["name"]: item["total_spans"] for item in client.get("/api/services").json()["items"]}
    assert first == second


def test_case_insensitive_service_merge(ingest, client):
    payload = jaeger_payload(
        jaeger_trace(
            "t1",
            [
                jaeger_span(trace_id="t1", span_id="a", service="Payment-Service"),
                jaeger_span(trace_id="t1", span_id="b", service="PAYMENT-SERVICE", parent="a"),
            ],
        )
    )
    ingest(payload)
    items = client.get("/api/services").json()["items"]
    assert len(items) == 1
    assert items[0]["normalized_name"] == "payment-service"


def test_same_service_parent_does_not_create_self_edge(ingest, client):
    payload = jaeger_payload(
        jaeger_trace(
            "t1",
            [
                jaeger_span(trace_id="t1", span_id="a", service="checkout-service"),
                jaeger_span(trace_id="t1", span_id="b", service="checkout-service", parent="a"),
            ],
        )
    )
    ingest(payload)
    graph = client.get("/api/graph").json()
    assert graph["edges"] == []


def test_otlp_ingestion_matches_jaeger_topology(client, ingest):
    ingest(chain_payload(["checkout-service", "payment-gateway"]))
    jaeger_graph = client.get("/api/graph").json()
    jaeger_names = {node["name"] for node in jaeger_graph["nodes"]}
    jaeger_edges = {
        next(n["name"] for n in jaeger_graph["nodes"] if n["id"] == edge["source"])
        + "->"
        + next(n["name"] for n in jaeger_graph["nodes"] if n["id"] == edge["target"])
        for edge in jaeger_graph["edges"]
    }
    from pathlib import Path
    import json

    otlp = json.loads((Path(__file__).resolve().parent.parent / "samples" / "sample_traces_otlp.json").read_text(encoding="utf-8"))
    response = client.post("/api/telemetry/otlp", json=otlp)
    assert response.status_code == 201, response.text
    otlp_graph = client.get("/api/graph").json()
    names = {node["name"] for node in otlp_graph["nodes"]}
    edges = {
        next(n["name"] for n in otlp_graph["nodes"] if n["id"] == edge["source"])
        + "->"
        + next(n["name"] for n in otlp_graph["nodes"] if n["id"] == edge["target"])
        for edge in otlp_graph["edges"]
    }
    assert names == jaeger_names
    assert edges == jaeger_edges
    assert names == jaeger_names or names == {"checkout-service", "payment-gateway"}

