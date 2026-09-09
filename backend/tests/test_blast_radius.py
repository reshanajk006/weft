"""Blast-radius direction and scoring tests."""

from __future__ import annotations

from tests.conftest import chain_payload, jaeger_payload, jaeger_span, jaeger_trace


def _ids(client):
    return {item["name"]: item["id"] for item in client.get("/api/services").json()["items"]}


def test_b_fails_affects_a_not_c(ingest, client):
    ingest(chain_payload(["a-service", "b-service", "c-service"]))
    ids = _ids(client)
    result = client.get(f"/api/blast-radius/{ids['b-service']}").json()
    names = {item["service_name"] for item in result["services"]}
    assert "a-service" in names
    assert "c-service" not in names
    assert result["failed_service_id"] == ids["b-service"]
    assert ids["a-service"] in result["directly_affected_ids"]
    assert ids["c-service"] not in result["affected_service_ids"]


def test_two_callers_of_b(ingest, client):
    payload = jaeger_payload(
        jaeger_trace(
            "fan",
            [
                jaeger_span(trace_id="fan", span_id="a", service="a-service"),
                jaeger_span(trace_id="fan", span_id="b1", service="b-service", parent="a"),
                jaeger_span(trace_id="fan", span_id="c", service="c-service"),
                jaeger_span(trace_id="fan", span_id="b2", service="b-service", parent="c"),
            ],
        )
    )
    ingest(payload)
    ids = _ids(client)
    result = client.get(f"/api/blast-radius/{ids['b-service']}").json()
    names = {item["service_name"] for item in result["services"]}
    assert names == {"a-service", "c-service"}


def test_d_fails_affects_abc(ingest, client):
    ingest(chain_payload(["a-service", "b-service", "c-service", "d-service"]))
    ids = _ids(client)
    result = client.get(f"/api/blast-radius/{ids['d-service']}").json()
    names = {item["service_name"] for item in result["services"]}
    assert names == {"a-service", "b-service", "c-service"}
    assert "d-service" not in names
    assert result["total_affected"] == 4


def test_blast_radius_score_is_deterministic(ingest, client):
    ingest(chain_payload(["a-service", "b-service"]))
    ids = _ids(client)
    first = client.get(f"/api/blast-radius/{ids['b-service']}").json()
    second = client.get(f"/api/blast-radius/{ids['b-service']}").json()
    assert first["blast_radius_score"] == second["blast_radius_score"]
    assert "formula" in first["score_breakdown"]
