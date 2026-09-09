"""Incident report classification, severity, and blast-radius math."""

from __future__ import annotations

from tests.conftest import chain_payload, jaeger_payload, jaeger_span, jaeger_trace


REPORT_HEADINGS = [
    "## 1. Scenario Classification",
    "## 2. Executive Summary",
    "## 3. Input and Analysis Window",
    "## 4. Simulated Failure Target",
    "## 5. Observed Telemetry Evidence",
    "## 6. Root-Cause Analysis",
    "## 7. Blast-Radius Analysis",
    "## 8. Criticality and Severity Breakdown",
    "## 9. Predicted Circuit-Breaker Behavior",
    "## 10. Recommended Immediate Actions",
    "## 11. Fallback and Containment Plan",
    "## 12. Mitigation Comparison",
    "## 13. Recovery Validation Plan",
    "## 14. Timeline",
    "## 15. Assumptions and Limitations",
]


def _service(client, name: str) -> dict:
    return next(item for item in client.get("/api/services").json()["items"] if item["name"] == name)


def test_hypothetical_healthy_target_report(client, ingest):
    ingest(chain_payload(["web-service", "analytics-service"]))
    analytics = _service(client, "analytics-service")
    assert analytics["health_status"] == "HEALTHY"
    sim = client.post(f"/api/simulate/failure/{analytics['id']}")
    analysis = client.get(f"/api/simulations/{sim.json()['simulation_id']}/analysis").json()
    root = analysis["root_cause"]
    assert root["mode"] == "HYPOTHETICAL"
    assert root["observed_status"] == "HEALTHY"
    assert root["likely_root_cause"] is None
    report = client.post(
        "/api/reports/generate",
        json={"simulation_id": sim.json()["simulation_id"], "format": "markdown"},
    )
    content = report.json()["content"]
    assert "# WEFT Incident Impact Report" in content
    for heading in REPORT_HEADINGS:
        assert heading in content
    assert "Hypothetical failure simulation" in content
    assert "HEALTHY" in content
    assert "Likely root cause: analytics-service" not in content
    assert "Status: Not determined" in content
    assert "Mitigation comparison was not executed" in content


def test_hypothetical_unhealthy_target_is_not_automatic_root_cause(client, ingest):
    ingest(
        jaeger_payload(
            jaeger_trace(
                "unhealthy",
                [
                    jaeger_span(trace_id="unhealthy", span_id="c", service="checkout-service"),
                    jaeger_span(
                        trace_id="unhealthy",
                        span_id="p",
                        service="payment-gateway",
                        parent="c",
                        error=True,
                        status="500",
                    ),
                ],
            )
        )
    )
    payment = _service(client, "payment-gateway")
    sim = client.post(f"/api/simulate/failure/{payment['id']}")
    report = client.post(
        "/api/reports/generate",
        json={"simulation_id": sim.json()["simulation_id"], "format": "markdown"},
    ).json()["content"]
    assert "Likely root cause: payment-gateway" not in report
    assert "Status: Not determined" in report
    assert "simulation target" in report.lower()


def test_criticality_and_severity_remain_separate(client, ingest):
    ingest(chain_payload(["checkout-service", "payment-gateway"]))
    payment = _service(client, "payment-gateway")
    sim = client.post(f"/api/simulate/failure/{payment['id']}")
    content = client.post(
        "/api/reports/generate",
        json={"simulation_id": sim.json()["simulation_id"], "format": "markdown"},
    ).json()["content"]
    assert "Computed technical criticality" in content
    assert "Impact severity" in content
    assert "payment-gateway (CRITICAL)" not in content


def test_blast_radius_score_breakdown_matches_formula(client, ingest):
    ingest(chain_payload(["a-service", "b-service", "c-service"]))
    failed = _service(client, "c-service")
    sim = client.post(f"/api/simulate/failure/{failed['id']}").json()
    breakdown = sim["score_breakdown"]
    affected_ratio = breakdown["affected_ratio"]
    mean_probability = breakdown["mean_impact_probability"] or breakdown["weighted_impact"]
    crit_ratio = breakdown["affected_criticality_ratio"] or breakdown["critical_service_factor"]
    expected = 100 * (0.40 * affected_ratio + 0.35 * mean_probability + 0.25 * crit_ratio)
    assert abs(sim["blast_radius_score"] - expected) < 0.05
    report = client.post(
        "/api/reports/generate",
        json={"simulation_id": sim["simulation_id"], "format": "markdown"},
    ).json()["content"]
    assert "Blast-Radius Score Breakdown" in report
    assert str(sim["blast_radius_score"]) in report
