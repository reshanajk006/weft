"""Live Jaeger connection and append-only ingestion tests."""

from __future__ import annotations

import httpx
import respx

from app.services.live_jaeger_ingestion import get_live_manager
from tests.conftest import chain_payload, jaeger_payload, jaeger_span, jaeger_trace

JAEGER = "http://localhost:16686"


def _services_ok(names: list[str]):
    respx.get(f"{JAEGER}/api/services").mock(return_value=httpx.Response(200, json={"data": names}))


def _traces_for(service: str, traces: list[dict]):
    respx.get(f"{JAEGER}/api/traces").mock(return_value=httpx.Response(200, json={"data": traces}))


@respx.mock
def test_startup_does_not_connect_or_seed(client):
    status = client.get("/api/jaeger/status").json()
    assert status["is_running"] is False
    assert status["status"] == "disconnected"
    assert client.get("/api/datasets/active").json() == {"dataset": None}
    assert client.get("/api/graph").json() == {"nodes": [], "edges": []}


@respx.mock
def test_jaeger_test_does_not_create_dataset(client):
    _services_ok(["checkout-service", "payment-gateway"])
    response = client.post("/api/jaeger/test", json={"jaeger_url": JAEGER})
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["service_count"] == 2
    assert client.get("/api/datasets/active").json() == {"dataset": None}
    get_ok = client.get("/api/jaeger/test", params={"jaeger_url": JAEGER})
    assert get_ok.status_code == 200


@respx.mock
def test_connect_creates_one_live_dataset(client):
    _services_ok(["checkout-service", "payment-gateway"])
    trace = jaeger_trace(
        "live-1",
        [
            jaeger_span(trace_id="live-1", span_id="root", service="checkout-service"),
            jaeger_span(trace_id="live-1", span_id="pay", service="payment-gateway", parent="root"),
        ],
    )
    _traces_for("checkout-service", [trace])
    response = client.post(
        "/api/jaeger/connect",
        json={"jaeger_url": JAEGER, "poll_interval": 5, "max_traces_per_poll": 50},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["is_running"] is True
    assert body["status"] in {"connected", "error"}
    dataset = client.get("/api/datasets/active").json()["dataset"]
    assert dataset is not None
    assert dataset["id"] == body["dataset_id"]
    assert dataset["name"].startswith("Live Jaeger -")
    names = {node["name"] for node in client.get("/api/graph").json()["nodes"]}
    assert names == {"checkout-service", "payment-gateway"}


@respx.mock
def test_duplicate_connect_reuses_running_session(client):
    _services_ok(["alpha"])
    _traces_for("alpha", [])
    first = client.post("/api/jaeger/connect", json={"jaeger_url": JAEGER, "poll_interval": 5})
    assert first.status_code == 201
    second = client.post("/api/jaeger/connect", json={"jaeger_url": JAEGER, "poll_interval": 5})
    assert second.status_code == 201
    assert second.json()["is_running"] is True
    assert second.json()["dataset_id"] == first.json()["dataset_id"]
    assert client.get("/api/datasets/active").json()["dataset"]["id"] == first.json()["dataset_id"]


@respx.mock
def test_polls_reuse_same_dataset_and_reingest_window(client):
    _services_ok(["checkout-service", "payment-gateway"])
    trace = jaeger_trace(
        "dup-1",
        [
            jaeger_span(trace_id="dup-1", span_id="root", service="checkout-service"),
            jaeger_span(trace_id="dup-1", span_id="pay", service="payment-gateway", parent="root", error=True, status="500"),
        ],
    )
    _traces_for("checkout-service", [trace])
    connected = client.post("/api/jaeger/connect", json={"jaeger_url": JAEGER, "poll_interval": 5})
    assert connected.status_code == 201
    dataset_id = connected.json()["dataset_id"]
    graph_before = client.get("/api/graph").json()
    from app.db.database import get_session_factory

    session = get_session_factory()()
    try:
        added = get_live_manager().poll_once(session)
        session.commit()
    finally:
        session.close()
    assert added == 1
    assert client.get("/api/datasets/active").json()["dataset"]["id"] == dataset_id
    names = {node["name"] for node in client.get("/api/graph").json()["nodes"]}
    assert names == {node["name"] for node in graph_before["nodes"]}


@respx.mock
def test_live_poll_drops_service_missing_from_window(client):
    _services_ok(["checkout-service", "payment-gateway"])
    both = jaeger_trace(
        "live-both",
        [
            jaeger_span(trace_id="live-both", span_id="root", service="checkout-service"),
            jaeger_span(trace_id="live-both", span_id="pay", service="payment-gateway", parent="root"),
        ],
    )
    respx.get(f"{JAEGER}/api/traces").mock(return_value=httpx.Response(200, json={"data": [both]}))
    connected = client.post("/api/jaeger/connect", json={"jaeger_url": JAEGER, "poll_interval": 5})
    assert connected.status_code == 201
    dataset_id = connected.json()["dataset_id"]
    assert {node["name"] for node in client.get("/api/graph").json()["nodes"]} == {
        "checkout-service",
        "payment-gateway",
    }

    _services_ok(["checkout-service"])
    only_checkout = jaeger_trace(
        "live-checkout",
        [jaeger_span(trace_id="live-checkout", span_id="root", service="checkout-service")],
    )
    respx.get(f"{JAEGER}/api/traces").mock(return_value=httpx.Response(200, json={"data": [only_checkout]}))
    from app.db.database import get_session_factory

    session = get_session_factory()()
    try:
        added = get_live_manager().poll_once(session)
        session.commit()
    finally:
        session.close()
    assert added == 1
    assert client.get("/api/datasets/active").json()["dataset"]["id"] == dataset_id
    names = {node["name"] for node in client.get("/api/graph").json()["nodes"]}
    assert names == {"checkout-service"}
    assert client.get("/api/graph").json()["edges"] == []


@respx.mock
def test_empty_poll_does_not_wipe_graph(client):
    _services_ok(["checkout-service"])
    trace = jaeger_trace("keep-1", [jaeger_span(trace_id="keep-1", span_id="s1", service="checkout-service")])
    respx.get(f"{JAEGER}/api/traces").mock(return_value=httpx.Response(200, json={"data": [trace]}))
    client.post("/api/jaeger/connect", json={"jaeger_url": JAEGER, "poll_interval": 5})
    assert {node["name"] for node in client.get("/api/graph").json()["nodes"]} == {"checkout-service"}

    respx.get(f"{JAEGER}/api/traces").mock(return_value=httpx.Response(200, json={"data": []}))
    from app.db.database import get_session_factory

    session = get_session_factory()()
    try:
        added = get_live_manager().poll_once(session)
        session.commit()
    finally:
        session.close()
    assert added == 0
    assert {node["name"] for node in client.get("/api/graph").json()["nodes"]} == {"checkout-service"}


@respx.mock
def test_second_poll_appends_new_service(client):
    _services_ok(["checkout-service"])
    first_trace = jaeger_trace(
        "p1",
        [jaeger_span(trace_id="live-a", span_id="root", service="checkout-service")],
    )
    respx.get(f"{JAEGER}/api/traces").mock(return_value=httpx.Response(200, json={"data": [first_trace]}))
    connected = client.post("/api/jaeger/connect", json={"jaeger_url": JAEGER, "poll_interval": 5})
    assert connected.status_code == 201
    dataset_id = connected.json()["dataset_id"]
    assert {node["name"] for node in client.get("/api/graph").json()["nodes"]} == {"checkout-service"}

    _services_ok(["checkout-service", "payment-gateway"])
    second_trace = jaeger_trace(
        "p2",
        [
            jaeger_span(trace_id="live-b", span_id="root", service="checkout-service"),
            jaeger_span(trace_id="live-b", span_id="pay", service="payment-gateway", parent="root"),
        ],
    )
    respx.get(f"{JAEGER}/api/traces").mock(return_value=httpx.Response(200, json={"data": [first_trace, second_trace]}))
    from app.db.database import get_session_factory

    session = get_session_factory()()
    try:
        get_live_manager().poll_once(session)
        session.commit()
    finally:
        session.close()
    assert client.get("/api/datasets/active").json()["dataset"]["id"] == dataset_id
    names = {node["name"] for node in client.get("/api/graph").json()["nodes"]}
    assert names == {"checkout-service", "payment-gateway"}
    assert client.get("/api/graph").json()["edges"]


@respx.mock
def test_disconnect_stops_polling_and_keeps_dataset(client):
    _services_ok(["alpha"])
    _traces_for("alpha", [jaeger_trace("t1", [jaeger_span(trace_id="t1", span_id="s1", service="alpha")])])
    connected = client.post("/api/jaeger/connect", json={"jaeger_url": JAEGER, "poll_interval": 5})
    dataset_id = connected.json()["dataset_id"]
    stopped = client.post("/api/jaeger/disconnect")
    assert stopped.status_code == 200
    assert stopped.json()["is_running"] is False
    assert client.get("/api/datasets/active").json()["dataset"]["id"] == dataset_id
    assert client.get("/api/graph").json()["nodes"]
    again = client.post("/api/jaeger/connect", json={"jaeger_url": JAEGER, "poll_interval": 5})
    assert again.status_code == 201
    assert again.json()["dataset_id"] != dataset_id


@respx.mock
def test_reconnect_reuses_dataset(client):
    _services_ok(["alpha"])
    _traces_for("alpha", [jaeger_trace("t1", [jaeger_span(trace_id="t1", span_id="s1", service="alpha")])])
    connected = client.post("/api/jaeger/connect", json={"jaeger_url": JAEGER, "poll_interval": 5})
    dataset_id = connected.json()["dataset_id"]
    client.post("/api/jaeger/disconnect")
    resumed = client.post("/api/jaeger/reconnect")
    assert resumed.status_code == 200
    assert resumed.json()["is_running"] is True
    assert resumed.json()["dataset_id"] == dataset_id


@respx.mock
def test_jaeger_failure_does_not_crash(client):
    respx.get(f"{JAEGER}/api/services").mock(side_effect=httpx.ConnectError("refused"))
    response = client.post("/api/jaeger/test", json={"jaeger_url": JAEGER})
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "JAEGER_UNAVAILABLE"
    assert client.get("/api/health").json()["status"] == "ok"


@respx.mock
def test_live_ingest_then_simulation_still_safe(client):
    _services_ok(["checkout-service", "payment-gateway"])
    trace = jaeger_trace(
        "live-sim",
        [
            jaeger_span(trace_id="live-sim", span_id="root", service="checkout-service"),
            jaeger_span(
                trace_id="live-sim",
                span_id="pay",
                service="payment-gateway",
                parent="root",
                error=True,
                status="500",
            ),
        ],
    )
    _traces_for("checkout-service", [trace])
    client.post("/api/jaeger/connect", json={"jaeger_url": JAEGER, "poll_interval": 5})
    payment = client.get("/api/services", params={"q": "payment"}).json()["items"][0]
    health_before = payment["health_score"]
    sim = client.post(f"/api/simulate/failure/{payment['id']}")
    assert sim.status_code == 201
    after = client.get(f"/api/services/{payment['id']}").json()
    assert after["health"]["score"] == health_before
    blast = client.get(f"/api/blast-radius/{payment['id']}").json()
    assert "checkout-service" in {item["service_name"] for item in blast["affected_services"]}
    analysis = client.get(f"/api/simulations/{sim.json()['simulation_id']}/analysis")
    assert analysis.status_code == 200
    body = analysis.json()
    assert body["root_cause"]["likely_root_cause"]["service"] == "payment-gateway"
    assert body["recommendations"]
    report = client.post(
        "/api/reports/generate",
        json={"simulation_id": sim.json()["simulation_id"], "format": "markdown"},
    )
    assert report.status_code == 201
    assert "## Root Cause" in report.json()["content"]


def test_manual_import_replaces_live_dataset(client, ingest):
    ingest(chain_payload(["legacy-a", "legacy-b"]))
    ingest(chain_payload(["auth-service", "user-db"]))
    names = {node["name"] for node in client.get("/api/graph").json()["nodes"]}
    assert names == {"auth-service", "user-db"}


@respx.mock
def test_get_traces_sends_start_and_end_not_lookback():
    from app.services.jaeger_client import JaegerClient

    route = respx.get(f"{JAEGER}/api/traces").mock(return_value=httpx.Response(200, json={"data": []}))
    client = JaegerClient(JAEGER)
    try:
        client.get_traces(service="checkout-service", lookback="1h")
    finally:
        client.close()
    assert route.called
    params = route.calls.last.request.url.params
    assert "start" in params
    assert "end" in params
    assert int(params["end"]) > int(params["start"])
    assert "lookback" not in params
