"""Generate realistic Jaeger sample traces for WEFT."""

from __future__ import annotations

import json
from pathlib import Path

BASE = 1_700_000_000_000_000


def span(
    trace_id: str,
    span_id: str,
    service: str,
    operation: str,
    duration: int,
    start: int,
    parent: str | None = None,
    status: object = "200",
    error: object = False,
) -> dict:
    tags = [
        {"key": "http.status_code", "value": status},
        {"key": "error", "value": error},
        {"key": "service.name", "value": service},
    ]
    references = []
    if parent:
        references.append({"refType": "CHILD_OF", "spanID": parent, "traceID": trace_id})
    return {
        "traceID": trace_id,
        "spanID": span_id,
        "operationName": operation,
        "startTime": start,
        "duration": duration,
        "tags": tags,
        "process": {"serviceName": service},
        "references": references,
    }


def checkout_trace(trace_id: str, start: int, payment_status: object = "200", payment_error: object = False, payment_duration: int = 180_000) -> dict:
    spans = [
        span(trace_id, "root", "checkout-service", "POST /checkout", 820_000, start),
        span(trace_id, "auth", "auth-service", "POST /auth/verify", 40_000, start + 1_000, "root"),
        span(trace_id, "user", "user-service", "GET /users/{id}", 35_000, start + 2_000, "auth"),
        span(trace_id, "user-db", "db-service", "SELECT users", 12_000, start + 3_000, "user"),
        span(trace_id, "order", "order-service", "POST /orders", 220_000, start + 5_000, "root"),
        span(trace_id, "inv", "inventory-service", "POST /reserve", 90_000, start + 6_000, "order"),
        span(trace_id, "order-db", "db-service", "INSERT orders", 18_000, start + 7_000, "order"),
        span(trace_id, "pay", "payment-gateway", "POST /charge", payment_duration, start + 8_000, "root", payment_status, payment_error),
        span(trace_id, "pay-db", "db-service", "INSERT payments", 20_000, start + 9_000, "pay"),
    ]
    return {
        "traceID": trace_id,
        "spans": spans,
        "processes": {
            "p1": {"serviceName": "checkout-service"},
            "p2": {"serviceName": "payment-gateway"},
        },
    }


def recommendation_trace(trace_id: str, start: int) -> dict:
    return {
        "traceID": trace_id,
        "spans": [
            span(trace_id, "rec", "recommendation-engine", "GET /recommend", 45_000, start),
            span(trace_id, "cache", "cache-service", "GET /cache", 4_000, start + 500, "rec"),
            span(trace_id, "user", "user-service", "GET /users/{id}/prefs", 22_000, start + 800, "rec"),
        ],
        "processes": {},
    }


def notification_trace(trace_id: str, start: int, status: object = "200") -> dict:
    return {
        "traceID": trace_id,
        "spans": [
            span(trace_id, "n1", "notification-service", "POST /notify", 30_000, start, status=status, error=str(status).startswith("5")),
            span(trace_id, "n2", "user-service", "GET /users/{id}", 15_000, start + 200, "n1"),
        ],
        "processes": {},
    }


def login_trace(trace_id: str, start: int) -> dict:
    return {
        "traceID": trace_id,
        "spans": [
            span(trace_id, "l1", "auth-service", "POST /login", 60_000, start),
            span(trace_id, "l2", "user-service", "GET /users/by-email", 20_000, start + 300, "l1"),
            span(trace_id, "l3", "db-service", "SELECT users", 8_000, start + 400, "l2"),
        ],
        "processes": {},
    }


def build_sample_traces() -> dict:
    traces = []
    for i in range(8):
        traces.append(checkout_trace(f"checkout-{i:03d}", BASE + i * 2_000_000, "200", False, 160_000 + i * 5_000))
    traces.append(checkout_trace("checkout-4xx", BASE + 20_000_000, "404", False, 90_000))
    traces.append(checkout_trace("checkout-5xx", BASE + 22_000_000, "500", True, 820_000))
    for i in range(5):
        traces.append(recommendation_trace(f"rec-{i:03d}", BASE + 30_000_000 + i * 1_000_000))
    for i in range(4):
        traces.append(notification_trace(f"notify-{i:03d}", BASE + 40_000_000 + i * 1_000_000, "200" if i < 3 else "503"))
    for i in range(4):
        traces.append(login_trace(f"login-{i:03d}", BASE + 50_000_000 + i * 1_000_000))
    return {"data": traces}


def build_incident_traces() -> dict:
    traces = []
    for i in range(20):
        failed = i < 14
        traces.append(
            checkout_trace(
                f"incident-{i:03d}",
                BASE + 80_000_000 + i * 500_000,
                "500" if failed else "200",
                True if failed else False,
                1_200_000 if failed else 170_000,
            )
        )
    return {"data": traces}


def main() -> None:
    directory = Path(__file__).resolve().parent
    sample = build_sample_traces()
    incident = build_incident_traces()
    (directory / "sample_traces.json").write_text(json.dumps(sample, indent=2), encoding="utf-8")
    (directory / "payment_incident_traces.json").write_text(json.dumps(incident, indent=2), encoding="utf-8")
    print(f"Wrote {len(sample['data'])} sample traces and {len(incident['data'])} incident traces")


if __name__ == "__main__":
    main()
