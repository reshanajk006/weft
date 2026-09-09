"""Rule-based recommendations tied to observed telemetry. Simulation-only; never executes actions."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.config.thresholds import get_thresholds
from app.db.models import Service
from app.schemas.analysis import RecommendationItem, RecommendationListResponse
from app.schemas.simulation import SimulationResponse
from app.services.graph_service import build_graph
from app.services.simulation_service import _get_active_simulation

_ANALYTICS = "analytics"
_NOTIFICATION = "notification"
_SEARCH = "search"
_CACHE = "cache"
_PAYMENT = "payment"
_AUTH = "authentication"
_DB_READ = "database_read"
_DB_WRITE = "database_write"

_NAME_HINTS: list[tuple[str, str]] = [
    ("analytics", _ANALYTICS),
    ("telemetry", _ANALYTICS),
    ("notification", _NOTIFICATION),
    ("notify", _NOTIFICATION),
    ("mail", _NOTIFICATION),
    ("search", _SEARCH),
    ("cache", _CACHE),
    ("redis", _CACHE),
    ("payment", _PAYMENT),
    ("billing", _PAYMENT),
    ("auth", _AUTH),
    ("identity", _AUTH),
    ("login", _AUTH),
    ("read-replica", _DB_READ),
    ("read_replica", _DB_READ),
]


def build_recommendations(db: Session, simulation_id: str) -> RecommendationListResponse:
    run = _get_active_simulation(db, simulation_id)
    result = SimulationResponse.model_validate(run.result_json)
    failed = db.get(Service, result.failed_service.id)
    if failed is None:
        return RecommendationListResponse(simulation_id=simulation_id, items=[])

    graph = build_graph(db)
    thresholds = get_thresholds()
    caller_count = len(list(graph.predecessors(failed.id))) if failed.id in graph else 0
    items: list[RecommendationItem] = []
    rank = 1

    if caller_count > 0:
        items.append(
            _item(
                rank=rank,
                priority="HIGH",
                category="CONTAINMENT",
                service=failed.name,
                title=f"Isolate {failed.name} calls",
                action="Open or verify the circuit breaker on each direct caller.",
                reason=f"{caller_count} upstream callers are potentially affected.",
                expected_outcome=(
                    "Stop repeated calls to the unavailable dependency and reduce "
                    "resource exhaustion in upstream services."
                ),
                risk="Callers may serve degraded or fallback responses until recovery.",
                effort="MEDIUM",
                validation=(
                    "Confirm the circuit breaker prediction changes to OPEN and "
                    "re-run the virtual mitigation simulation."
                ),
                evidence={"upstream_callers": caller_count, "failed_service": failed.name},
            )
        )
        rank += 1

    kind, declared = resolve_service_kind(failed)
    fallback_action, fallback_title, conservative = fallback_playbook(kind)
    items.append(
        _item(
            rank=rank,
            priority="HIGH" if kind in {_PAYMENT, _AUTH} else "MEDIUM",
            category="FALLBACK",
            service=failed.name,
            title=fallback_title,
            action=fallback_action,
            reason=_fallback_reason(failed, kind, declared, conservative),
            expected_outcome="Callers continue with a defined degraded path instead of unbounded retries.",
            risk="Incorrect fallback choice can hide errors or violate business rules.",
            effort="MEDIUM",
            validation="Re-run the virtual mitigation simulation and confirm blast-radius reduction.",
            evidence={
                "service_type": kind or "undeclared",
                "service_type_declared": declared,
                "circuit_breaker": {
                    "failure_threshold": thresholds.circuit_breaker.error_threshold,
                    "cooldown_seconds": thresholds.circuit_breaker.cooldown_seconds,
                    "recovery_mode": "HALF_OPEN",
                    "recovery_health_threshold": thresholds.circuit_breaker.recovery_health_threshold,
                },
            },
        )
    )
    rank += 1

    cb = thresholds.circuit_breaker
    items.append(
        _item(
            rank=rank,
            priority="MEDIUM",
            category="RECOVERY",
            service=failed.name,
            title=f"Recover {failed.name} through HALF_OPEN validation",
            action=(
                f"Recheck dependency health after the {cb.cooldown_seconds:.0f}s cooldown. "
                "Allow gradual recovery using HALF_OPEN state. "
                "Replay queued requests only after health recovers."
            ),
            reason=(
                f"Configured recovery health threshold is {cb.recovery_health_threshold:.0f}. "
                f"Observed error rate is {failed.error_rate:.1%} and average latency is "
                f"{failed.avg_latency_ms:.0f} ms."
            ),
            expected_outcome=(
                "Verify error rate remains below the configured recovery threshold and "
                "confirm caller health improves before restoring normal traffic."
            ),
            risk="Restoring traffic too early can re-open breakers and amplify load.",
            effort="MEDIUM",
            validation=(
                "Verify latency returns below configured limits and confirm recovery remains "
                "stable across subsequent telemetry windows."
            ),
            evidence={
                "predicted_transitions": len(result.predicted_circuit_transitions),
                "cooldown_seconds": cb.cooldown_seconds,
                "recovery_health_threshold": cb.recovery_health_threshold,
            },
        )
    )
    rank += 1

    items.extend(_prevention_items(failed, graph, result, thresholds, start_rank=rank))
    return RecommendationListResponse(simulation_id=simulation_id, items=items)


def recommendation_lines(items: list[RecommendationItem]) -> list[str]:
    return [f"{item.priority}: {item.recommendation} ({item.reason})" for item in items]


def resolve_service_kind(service: Service) -> tuple[str | None, bool]:
    declared = (service.service_type or "").strip().lower()
    if declared:
        return _normalize_kind(declared), True
    name = (service.name or "").strip().lower()
    for needle, kind in _NAME_HINTS:
        if needle in name:
            return kind, False
    if "db" in name or "database" in name or "postgres" in name or "mysql" in name:
        if "write" in name or "insert" in name:
            return _DB_WRITE, False
        return _DB_READ, False
    return None, False


def fallback_playbook(kind: str | None) -> tuple[str, str, bool]:
    if kind == _ANALYTICS:
        return "Fail open; drop or buffer analytics events.", "Use analytics fail-open fallback", False
    if kind == _NOTIFICATION:
        return "Queue for retry.", "Queue notification delivery for retry", False
    if kind == _SEARCH:
        return "Serve cached or partial results.", "Serve cached or partial search results", False
    if kind == _CACHE:
        return "Bypass cache and query the primary store.", "Bypass cache and query the primary store", False
    if kind == _PAYMENT:
        return "Fail closed or use an approved backup provider.", "Fail closed on payment or use an approved backup", False
    if kind == _AUTH:
        return "Fail closed; never bypass authentication.", "Fail closed; never bypass authentication", False
    if kind == _DB_READ:
        return "Serve cache or read replica if available.", "Serve cache or a read replica", False
    if kind == _DB_WRITE:
        return "Queue only if the operation is idempotent.", "Queue writes only if idempotent", False
    return (
        "Keep a conservative fallback: fail closed unless an approved degraded path already exists.",
        "Use a conservative fallback",
        True,
    )


def _fallback_reason(service: Service, kind: str | None, declared: bool, conservative: bool) -> str:
    if conservative:
        return (
            f"Dependency type is not explicitly declared; fallback selection is conservative. "
            f"Observed health status is {service.health_status}."
        )
    source = "declared service_type" if declared else "deterministic name-based type inference"
    return f"Fallback selected from {source} ({kind}) for {service.name}."


def _prevention_items(
    failed: Service,
    graph,
    result: SimulationResponse,
    thresholds,
    *,
    start_rank: int,
) -> list[RecommendationItem]:
    items: list[RecommendationItem] = []
    rank = start_rank
    crit = failed.effective_criticality_score()
    incoming_weights: list[float] = []
    if failed.id in graph:
        for pred in graph.predecessors(failed.id):
            edge = graph.get_edge_data(pred, failed.id) or {}
            incoming_weights.append(float(edge.get("critical_weight") or 0.0))

    if incoming_weights and max(incoming_weights) >= thresholds.blast_radius.critical_edge_weight:
        items.append(
            _item(
                rank=rank,
                priority="MEDIUM",
                category="PREVENTION",
                service=failed.name,
                title="Add a circuit breaker to the highest-risk dependency edge",
                action="Add a circuit breaker to the highest-risk dependency edge.",
                reason=(
                    f"At least one caller edge uses critical weight "
                    f"{max(incoming_weights):.2f}."
                ),
                expected_outcome="Future incidents fail fast at the caller instead of retrying unbounded.",
                risk="A breaker that is too sensitive can drop legitimate traffic.",
                effort="MEDIUM",
                validation="Review predicted OPEN transitions after the next simulation.",
                evidence={"max_edge_weight": max(incoming_weights)},
            )
        )
        rank += 1

    if failed.avg_latency_ms >= thresholds.latency.high_latency_ms:
        items.append(
            _item(
                rank=rank,
                priority="MEDIUM",
                category="PREVENTION",
                service=failed.name,
                title="Add or tighten a timeout based on observed latency",
                action="Add or tighten a timeout based on observed latency.",
                reason=f"Average latency is {failed.avg_latency_ms:.0f} ms.",
                expected_outcome="Callers stop waiting past the observed latency envelope.",
                risk="Timeouts that are too tight increase error rate.",
                effort="LOW",
                validation="Confirm P95 latency stays below the configured high threshold after recovery.",
                evidence={"avg_latency_ms": failed.avg_latency_ms},
            )
        )
        rank += 1

    if incoming_weights and max(incoming_weights) <= thresholds.blast_radius.non_critical_edge_weight:
        items.append(
            _item(
                rank=rank,
                priority="LOW",
                category="PREVENTION",
                service=failed.name,
                title="Add a fallback for this non-critical dependency",
                action="Add a fallback for this dependency.",
                reason="Caller edges use non-critical propagation weight, so a fallback is safer than blocking.",
                expected_outcome="Non-critical features degrade instead of stalling callers.",
                risk="Fallback data may be stale.",
                effort="LOW",
                validation="Re-run virtual mitigation after documenting the fallback path.",
                evidence={"max_edge_weight": max(incoming_weights)},
            )
        )
        rank += 1

    if (failed.tier or "").strip().lower() in {"critical", "tier-1", "tier1"}:
        items.append(
            _item(
                rank=rank,
                priority="MEDIUM",
                category="PREVENTION",
                service=failed.name,
                title="Consider a secondary provider or approved fallback path",
                action="Consider a secondary provider or approved fallback path.",
                reason=f"{failed.name} is labeled as a Tier-1 / critical business dependency.",
                expected_outcome="A second approved path reduces blast radius for future outages.",
                risk="Dual-running providers increases operational complexity.",
                effort="HIGH",
                validation="Document the approved backup path; WEFT does not execute provider changes.",
                evidence={"tier": failed.tier, "criticality_score": crit},
            )
        )
        rank += 1

    approaching = (
        thresholds.health.degraded_error_rate
        <= failed.error_rate
        < thresholds.health.critical_error_rate
    )
    if approaching:
        items.append(
            _item(
                rank=rank,
                priority="MEDIUM",
                category="PREVENTION",
                service=failed.name,
                title="Add alerting before the unhealthy threshold is reached",
                action="Add alerting before the unhealthy threshold is reached.",
                reason=(
                    f"Error rate {failed.error_rate:.1%} is approaching the unhealthy threshold "
                    f"{thresholds.health.critical_error_rate:.0%}."
                ),
                expected_outcome="Operators can act before the service becomes UNHEALTHY.",
                risk="Alert noise if the threshold is too close to normal error rate.",
                effort="LOW",
                validation="Confirm alerts fire on the degraded threshold, not only after unhealthy.",
                evidence={
                    "error_rate": failed.error_rate,
                    "unhealthy_threshold": thresholds.health.critical_error_rate,
                },
            )
        )
    return items


def _normalize_kind(value: str) -> str:
    mapping = {
        "analytics": _ANALYTICS,
        "notification": _NOTIFICATION,
        "notifications": _NOTIFICATION,
        "search": _SEARCH,
        "cache": _CACHE,
        "payment": _PAYMENT,
        "payments": _PAYMENT,
        "auth": _AUTH,
        "authentication": _AUTH,
        "database": _DB_READ,
        "database_read": _DB_READ,
        "database_write": _DB_WRITE,
    }
    return mapping.get(value, value)


def _item(
    *,
    rank: int,
    priority: str,
    category: str,
    service: str,
    title: str,
    action: str,
    reason: str,
    expected_outcome: str,
    risk: str,
    effort: str,
    validation: str,
    evidence: dict,
) -> RecommendationItem:
    return RecommendationItem(
        priority=priority,
        priority_rank=rank,
        category=category,
        title=title,
        action=action,
        service=service,
        recommendation=title,
        reason=reason,
        expected_outcome=expected_outcome,
        risk=risk,
        effort=effort,
        safe_to_automate=False,
        validation=validation,
        evidence=evidence,
    )
