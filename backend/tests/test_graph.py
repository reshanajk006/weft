"""Graph construction and neighborhood tests."""

from __future__ import annotations

from tests.conftest import chain_payload, jaeger_payload, jaeger_span, jaeger_trace


def test_service_nodes_and_edges(ingest, client):
    ingest(chain_payload(["a-service", "b-service", "c-service"]))
    graph = client.get("/api/graph").json()
    assert len(graph["nodes"]) == 3
    assert len(graph["edges"]) == 2
    names = {node["id"]: node["name"] for node in graph["nodes"]}
    pairs = {(names[edge["source"]], names[edge["target"]]) for edge in graph["edges"]}
    assert ("a-service", "b-service") in pairs
    assert ("b-service", "c-service") in pairs


def test_upstream_and_downstream(ingest, client):
    ingest(chain_payload(["a-service", "b-service", "c-service"]))
    services = {item["name"]: item["id"] for item in client.get("/api/services").json()["items"]}
    upstream = client.get(f"/api/services/{services['b-service']}/upstream").json()
    downstream = client.get(f"/api/services/{services['b-service']}/downstream").json()
    assert [item["name"] for item in upstream["items"]] == ["a-service"]
    assert [item["name"] for item in downstream["items"]] == ["c-service"]


def test_cycles_do_not_crash(ingest, client):
    payload = jaeger_payload(
        jaeger_trace(
            "cycle",
            [
                jaeger_span(trace_id="cycle", span_id="a", service="svc-a"),
                jaeger_span(trace_id="cycle", span_id="b", service="svc-b", parent="a"),
                jaeger_span(trace_id="cycle", span_id="c", service="svc-c", parent="b"),
                jaeger_span(trace_id="cycle", span_id="d", service="svc-a", parent="c"),
            ],
        )
    )
    ingest(payload)
    validation = client.get("/api/graph/validation").json()
    assert validation["has_cycles"] is True
    assert validation["cycle_count"] >= 1
    assert validation["service_count"] == 3


def test_isolated_services(ingest, client):
    payload = jaeger_payload(
        jaeger_trace(
            "iso",
            [
                jaeger_span(trace_id="iso", span_id="a", service="lonely-service"),
                jaeger_span(trace_id="iso", span_id="b", service="checkout-service"),
                jaeger_span(trace_id="iso", span_id="c", service="payment-gateway", parent="b"),
            ],
        )
    )
    ingest(payload)
    validation = client.get("/api/graph/validation").json()
    assert "lonely-service" in validation["orphan_services"]


def test_graph_highlight_status(ingest, client):
    ingest(chain_payload(["a-service", "b-service", "c-service"]))
    services = {item["name"]: item["id"] for item in client.get("/api/services").json()["items"]}
    graph = client.get("/api/graph", params={"highlight_service_id": services["b-service"]}).json()
    status = {node["name"]: node["status"] for node in graph["nodes"]}
    assert status["b-service"] == "FAILED"
    assert status["a-service"] == "DIRECTLY_AFFECTED"
    assert status["c-service"] == "NORMAL"
