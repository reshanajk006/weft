"""Multi-service failure simulation tests."""

from __future__ import annotations

from tests.conftest import chain_payload, jaeger_payload, jaeger_span, jaeger_trace


def _ids(client, *names: str) -> dict[str, str]:
    items = {item["name"]: item["id"] for item in client.get("/api/services").json()["items"]}
    return {name: items[name] for name in names}


def test_disjoint_failures_union(client, ingest):
    payload = {
        "data": chain_payload(["a-service", "b-service"], "t-left")["data"]
        + jaeger_payload(
            jaeger_trace(
                "t-right",
                [
                    jaeger_span(trace_id="t-right", span_id="x", service="x-service"),
                    jaeger_span(trace_id="t-right", span_id="y", service="y-service", parent="x"),
                ],
            )
        )["data"]
    }
    ingest(payload)
    ids = _ids(client, "b-service", "y-service")
    single_b = client.post(f"/api/simulate/failure/{ids['b-service']}").json()
    single_y = client.post(f"/api/simulate/failure/{ids['y-service']}").json()
    combined = client.post("/api/simulate/failure", json={"service_ids": [ids["b-service"], ids["y-service"]]}).json()
    union = {item["service_name"] for item in single_b["affected_services"]} | {
        item["service_name"] for item in single_y["affected_services"]
    }
    assert {item["service_name"] for item in combined["affected_services"]} == union
    assert len(combined["failed_services"]) == 2


def test_overlapping_failures_keep_max_probability(client, ingest):
    payload = {
        "data": chain_payload(["shared-caller", "left-dep"], "t1")["data"]
        + jaeger_payload(
            jaeger_trace(
                "t2",
                [
                    jaeger_span(trace_id="t2", span_id="c", service="shared-caller"),
                    jaeger_span(trace_id="t2", span_id="r", service="right-dep", parent="c"),
                ],
            )
        )["data"]
    }
    ingest(payload)
    ids = _ids(client, "left-dep", "right-dep", "shared-caller")
    left = client.post(f"/api/simulate/failure/{ids['left-dep']}").json()
    right = client.post(f"/api/simulate/failure/{ids['right-dep']}").json()
    combined = client.post("/api/simulate/failure", json={"service_ids": [ids["left-dep"], ids["right-dep"]]}).json()
    caller = next(item for item in combined["affected_services"] if item["service_name"] == "shared-caller")
    left_p = next(item["impact_probability"] for item in left["affected_services"] if item["service_name"] == "shared-caller")
    right_p = next(item["impact_probability"] for item in right["affected_services"] if item["service_name"] == "shared-caller")
    assert caller["impact_probability"] == max(left_p, right_p)
    assert caller["impact_probability"] <= 1.0
    assert set(caller["caused_by"]) == {ids["left-dep"], ids["right-dep"]}


def test_caused_by_and_timeline(client, ingest):
    ingest(chain_payload(["checkout-service", "payment-gateway"]))
    ids = _ids(client, "payment-gateway")
    result = client.post("/api/simulate/failure", json={"service_ids": [ids["payment-gateway"]]}).json()
    assert result["failed_services"][0]["name"] == "payment-gateway"
    checkout = next(item for item in result["affected_services"] if item["service_name"] == "checkout-service")
    assert ids["payment-gateway"] in checkout["caused_by"]
    timeline = client.get(f"/api/simulations/{result['simulation_id']}/timeline").json()
    types = [item["type"] for item in timeline["items"]]
    assert types.count("FAILURE_DETECTED") == 1
    assert "FAILURE_DETECTED" in types
