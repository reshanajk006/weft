"""Observed RCA scoring: five evidence factors and confidence rules."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
import json

import networkx as nx

from sqlalchemy import select

from app.config.thresholds import get_thresholds
from app.db.database import get_session_factory
from app.db.models import Service, ServiceHealthHistory
from app.services.analysis_common import INSUFFICIENT_BASELINE, OBSERVED_DISCLAIMER
from app.services.root_cause_service import (
    BaselineStats,
    classify_rca_confidence,
    score_observed_service,
)
from tests.conftest import jaeger_payload, jaeger_span, jaeger_trace


class _Svc(SimpleNamespace):
    def effective_criticality_score(self) -> float:
        return float(getattr(self, "criticality_score", 0.0))


def _service(**kwargs) -> _Svc:
    defaults = {
        "id": "svc-1",
        "name": "payment-gateway",
        "error_rate": 0.0,
        "avg_latency_ms": 10.0,
        "health_status": "HEALTHY",
        "health_score": 100.0,
        "criticality_score": 40.0,
    }
    defaults.update(kwargs)
    return _Svc(**defaults)


def _points(scored, factor: str) -> int:
    return sum(item.points for item in scored.evidence if item.factor == factor)


def test_error_rate_evidence_gives_30():
    graph = nx.DiGraph()
    graph.add_node("svc-1")
    service = _service(error_rate=0.52, health_status="UNHEALTHY")
    scored = score_observed_service(service, graph, {"svc-1": service}, baseline=None, thresholds=get_thresholds())
    assert _points(scored, "error_rate") == 30


def test_high_latency_evidence_gives_20():
    graph = nx.DiGraph()
    graph.add_node("svc-1")
    service = _service(avg_latency_ms=250.0)
    scored = score_observed_service(service, graph, {"svc-1": service}, baseline=None, thresholds=get_thresholds())
    assert _points(scored, "latency") == 20


def test_baseline_deviation_gives_25_only_when_baseline_exists():
    graph = nx.DiGraph()
    graph.add_node("svc-1")
    service = _service(error_rate=0.20)
    with_baseline = score_observed_service(
        service,
        graph,
        {"svc-1": service},
        baseline=BaselineStats(error_rate=0.02, avg_latency_ms=10.0),
        thresholds=get_thresholds(),
    )
    without = score_observed_service(
        service,
        graph,
        {"svc-1": service},
        baseline=None,
        thresholds=get_thresholds(),
    )
    assert _points(with_baseline, "baseline_deviation") == 25
    assert _points(without, "baseline_deviation") == 0


def test_missing_baseline_does_not_fabricate_points():
    graph = nx.DiGraph()
    graph.add_node("svc-1")
    service = _service(error_rate=0.9, avg_latency_ms=900.0, health_status="UNHEALTHY")
    scored = score_observed_service(service, graph, {"svc-1": service}, baseline=None, thresholds=get_thresholds())
    assert _points(scored, "baseline_deviation") == 0


def test_upstream_caller_evidence_gives_15():
    graph = nx.DiGraph()
    graph.add_node("a")
    graph.add_node("b")
    graph.add_node("c")
    graph.add_node("pay", name="payment-gateway")
    graph.add_edge("a", "pay")
    graph.add_edge("b", "pay")
    graph.add_edge("c", "pay")
    service = _service(id="pay", error_rate=0.52, health_status="UNHEALTHY")
    scored = score_observed_service(service, graph, {"pay": service}, baseline=None, thresholds=get_thresholds())
    assert _points(scored, "blast_radius") == 15


def test_unhealthy_dependency_gives_10():
    graph = nx.DiGraph()
    graph.add_node("checkout")
    graph.add_node("pay")
    graph.add_edge("checkout", "pay")
    pay = _service(id="pay", health_status="UNHEALTHY", error_rate=0.0)
    scored = score_observed_service(pay, graph, {"pay": pay}, baseline=None, thresholds=get_thresholds())
    assert _points(scored, "unhealthy_dependency") == 10


def test_simulated_target_receives_no_automatic_bonus():
    graph = nx.DiGraph()
    graph.add_node("analytics")
    service = _service(id="analytics", name="analytics-service")
    scored = score_observed_service(service, graph, {"analytics": service}, baseline=None, thresholds=get_thresholds())
    assert scored.score == 0


def test_confidence_rules():
    thresholds = get_thresholds()
    assert classify_rca_confidence(70, {"error_rate", "latency"}, thresholds) == "HIGH"
    assert classify_rca_confidence(80, {"error_rate"}, thresholds) == "MEDIUM"
    assert classify_rca_confidence(40, {"latency"}, thresholds) == "MEDIUM"
    assert classify_rca_confidence(39, {"latency"}, thresholds) == "LOW"


def test_observed_rca_uses_payment_incident_telemetry(client, ingest):
    payload = json.loads(
        (Path(__file__).resolve().parent.parent / "samples" / "payment_incident_traces.json").read_text(encoding="utf-8")
    )
    ingest(payload)
    rca = client.get("/api/analysis/root-cause").json()
    assert rca["mode"] == "OBSERVED_INCIDENT"
    assert rca["disclaimer"] == OBSERVED_DISCLAIMER
    assert INSUFFICIENT_BASELINE in " ".join(rca["limitations"])
    names = {item["service"] for item in rca["candidates"]}
    assert "payment-gateway" in names
    payment = next(item for item in rca["candidates"] if item["service"] == "payment-gateway")
    factors = {item["factor"] for item in payment["evidence_items"]}
    assert "error_rate" in factors or "latency" in factors
    assert all(item.get("points", 0) != 50 for item in payment["evidence_items"])


def test_baseline_history_is_used_when_present(client, ingest):
    ingest(
        jaeger_payload(
            jaeger_trace(
                "hist",
                [
                    jaeger_span(trace_id="hist", span_id="c", service="checkout-service"),
                    jaeger_span(
                        trace_id="hist",
                        span_id="p",
                        service="payment-gateway",
                        parent="c",
                        error=True,
                        status="500",
                        duration=800_000,
                    ),
                ],
            )
        )
    )
    session = get_session_factory()()
    try:
        payment = session.execute(select(Service).where(Service.name == "payment-gateway")).scalar_one()
        now = datetime.now(timezone.utc)
        for index in range(2):
            session.add(
                ServiceHealthHistory(
                    service_id=payment.id,
                    health_score=95.0,
                    health_status="HEALTHY",
                    error_rate=0.02,
                    total_spans=10,
                    error_spans=0,
                    avg_latency_ms=20.0,
                    calculated_at=now - timedelta(minutes=index + 1),
                )
            )
        session.commit()
    finally:
        session.close()
    rca = client.get("/api/analysis/root-cause").json()
    payment = next(item for item in rca["candidates"] if item["service"] == "payment-gateway")
    factors = {item["factor"]: item["points"] for item in payment["evidence_items"]}
    assert factors.get("baseline_deviation") == 25
