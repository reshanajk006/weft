"""Rule-based recommendations tied to observed telemetry. Simulation-only; never executes actions."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.config.thresholds import get_thresholds
from app.db.models import Service
from app.schemas.analysis import RecommendationItem, RecommendationListResponse
from app.schemas.simulation import SimulationResponse
from app.services.simulation_service import _get_active_simulation


def build_recommendations(db: Session, simulation_id: str) -> RecommendationListResponse:
    run = _get_active_simulation(db, simulation_id)
    result = SimulationResponse.model_validate(run.result_json)
    failed = db.get(Service, result.failed_service.id)
    thresholds = get_thresholds()
    items: list[RecommendationItem] = []
    if failed is None:
        return RecommendationListResponse(simulation_id=simulation_id, items=[])

    if failed.error_rate >= thresholds.health.critical_error_rate:
        items.append(
            RecommendationItem(
                priority="HIGH",
                service=failed.name,
                recommendation=f"Investigate repeated 5xx responses from {failed.name}.",
                reason=f"Error rate is {failed.error_rate:.0%}, health score is {failed.health_score:.0f}.",
                evidence={
                    "error_rate": failed.error_rate,
                    "health_score": failed.health_score,
                    "health_status": failed.health_status,
                },
            )
        )
    elif failed.error_rate >= thresholds.health.degraded_error_rate:
        items.append(
            RecommendationItem(
                priority="MEDIUM",
                service=failed.name,
                recommendation=f"Investigate elevated error rate on {failed.name}.",
                reason=f"Error rate is {failed.error_rate:.0%}.",
                evidence={"error_rate": failed.error_rate, "health_score": failed.health_score},
            )
        )

    if failed.avg_latency_ms >= thresholds.latency.high_latency_ms:
        items.append(
            RecommendationItem(
                priority="MEDIUM" if failed.avg_latency_ms < thresholds.latency.very_high_latency_ms else "HIGH",
                service=failed.name,
                recommendation=f"Review latency on {failed.name}.",
                reason=f"Average latency is {failed.avg_latency_ms:.0f} ms.",
                evidence={"avg_latency_ms": failed.avg_latency_ms},
            )
        )

    if result.blast_radius_score >= thresholds.severity.medium_max:
        items.append(
            RecommendationItem(
                priority="HIGH",
                service=failed.name,
                recommendation=f"Prioritize {failed.name} because failure affects multiple upstream callers.",
                reason=(
                    f"Blast-radius score is {result.blast_radius_score:.1f} with "
                    f"{result.services_affected} services affected."
                ),
                evidence={
                    "blast_radius_score": result.blast_radius_score,
                    "services_affected": result.services_affected,
                },
            )
        )

    for transition in result.predicted_circuit_transitions:
        items.append(
            RecommendationItem(
                priority="MEDIUM",
                service=transition.source,
                recommendation=(
                    f"Verify fallback behavior for {transition.source} → {transition.target}. "
                    "Recommended action (simulation only): review circuit-breaker configuration."
                ),
                reason=(
                    f"Predicted circuit-breaker {transition.previous_state} → {transition.new_state}. "
                    "No production breaker was changed."
                ),
                evidence={
                    "dependency": f"{transition.source} → {transition.target}",
                    "previous_state": transition.previous_state,
                    "new_state": transition.new_state,
                    "kind": transition.kind,
                },
            )
        )

    if result.critical_services_affected >= 2 or len(result.directly_affected) >= 3:
        items.append(
            RecommendationItem(
                priority="HIGH",
                service=failed.name,
                recommendation=f"Review resilience strategy for callers of {failed.name}.",
                reason=(
                    f"{result.critical_services_affected} critical service(s) and "
                    f"{len(result.directly_affected)} direct caller(s) are in the blast radius."
                ),
                evidence={
                    "critical_services_affected": result.critical_services_affected,
                    "direct_callers": len(result.directly_affected),
                },
            )
        )

    if not items:
        items.append(
            RecommendationItem(
                priority="LOW",
                service=failed.name,
                recommendation=f"Continue monitoring observed error rate and latency on {failed.name}.",
                reason="No critical error, latency, or blast-radius threshold was crossed.",
                evidence={
                    "error_rate": failed.error_rate,
                    "health_score": failed.health_score,
                    "blast_radius_score": result.blast_radius_score,
                },
            )
        )
    return RecommendationListResponse(simulation_id=simulation_id, items=items)


def recommendation_lines(items: list[RecommendationItem]) -> list[str]:
    return [f"{item.priority}: {item.recommendation} ({item.reason})" for item in items]
