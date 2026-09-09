"""Deterministic technical criticality scoring."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config.thresholds import get_thresholds
from app.core.exceptions import NotFoundError
from app.core.utils import clamp, safe_div
from app.db.models import CriticalitySnapshot, Dependency, Service
from app.schemas.criticality import (
    CriticalityBreakdown,
    CriticalityExplanation,
    CriticalityRankingItem,
    CriticalityRankingResponse,
    FactorBreakdown,
)
from app.services.graph_service import build_graph, get_service_or_404
from app.services.dataset_service import list_active_services


def recompute_all_criticality(db: Session, dataset_id: str | None = None) -> list[CriticalityExplanation]:
    if dataset_id:
        services = list(db.execute(select(Service).where(Service.dataset_id == dataset_id)).scalars().all())
    else:
        services = list_active_services(db)
    graph = build_graph(db)
    max_calls = max((service.total_calls for service in services), default=0)
    max_latency = max((service.avg_latency_ms for service in services), default=0.0)
    dependency_raw: dict[str, float] = {}
    for service in services:
        in_degree = graph.in_degree(service.id) if service.id in graph else 0
        out_degree = graph.out_degree(service.id) if service.id in graph else 0
        dependency_raw[service.id] = float(in_degree + out_degree)
    max_dependency = max(dependency_raw.values(), default=0.0)

    explanations: list[CriticalityExplanation] = []
    weights = get_thresholds().criticality
    for service in services:
        call_norm = safe_div(service.total_calls, max_calls)
        error_norm = clamp(service.error_rate, 0.0, 1.0)
        latency_norm = safe_div(service.avg_latency_ms, max_latency)
        dep_norm = safe_div(dependency_raw[service.id], max_dependency)
        tier_norm = _tier_norm(service.tier, weights.tier_scores)
        breakdown = CriticalityBreakdown(
            call_volume=_factor(weights.call_volume_weight, float(service.total_calls), call_norm),
            error_impact=_factor(weights.error_weight, service.error_rate, error_norm),
            latency_impact=_factor(weights.latency_weight, service.avg_latency_ms, latency_norm),
            dependency_impact=_factor(weights.dependency_weight, dependency_raw[service.id], dep_norm),
            business_tier=_factor(weights.tier_weight, tier_norm, tier_norm),
        )
        computed = round(
            breakdown.call_volume.contribution
            + breakdown.error_impact.contribution
            + breakdown.latency_impact.contribution
            + breakdown.dependency_impact.contribution
            + breakdown.business_tier.contribution,
            4,
        )
        computed = clamp(computed, 0.0, 100.0)
        service.criticality_score = computed
        score = service.effective_criticality_score()
        snapshot = CriticalitySnapshot(
            service_id=service.id,
            score=score,
            breakdown=breakdown.model_dump(),
        )
        db.add(snapshot)
        explanations.append(
            CriticalityExplanation(
                service=service.name,
                service_id=service.id,
                score=score,
                breakdown=breakdown,
                computed_score=computed,
                criticality_override=service.criticality_override,
            )
        )
    db.flush()
    return explanations


def get_criticality(db: Session, service_id: str) -> CriticalityExplanation:
    service = get_service_or_404(db, service_id)
    snapshot = db.execute(
        select(CriticalitySnapshot)
        .where(CriticalitySnapshot.service_id == service_id)
        .order_by(CriticalitySnapshot.calculated_at.desc())
    ).scalars().first()
    if snapshot is None:
        recompute_all_criticality(db)
        snapshot = db.execute(
            select(CriticalitySnapshot)
            .where(CriticalitySnapshot.service_id == service_id)
            .order_by(CriticalitySnapshot.calculated_at.desc())
        ).scalars().first()
    breakdown = CriticalityBreakdown.model_validate(snapshot.breakdown if snapshot else {})
    return CriticalityExplanation(
        service=service.name,
        service_id=service.id,
        score=service.effective_criticality_score(),
        breakdown=breakdown,
        computed_score=service.criticality_score,
        criticality_override=service.criticality_override,
    )


def list_rankings(db: Session) -> CriticalityRankingResponse:
    services = list_active_services(db)
    if services and not db.execute(select(CriticalitySnapshot)).scalars().first():
        recompute_all_criticality(db)
    items: list[CriticalityRankingItem] = []
    ranked = sorted(
        services,
        key=lambda service: (-service.effective_criticality_score(), -service.total_calls, service.normalized_name),
    )
    for index, service in enumerate(ranked, start=1):
        explanation = get_criticality(db, service.id)
        items.append(
            CriticalityRankingItem(
                rank=index,
                service=service.name,
                service_id=service.id,
                score=service.effective_criticality_score(),
                health=service.health_status,
                health_score=service.health_score,
                error_rate=service.error_rate,
                avg_latency_ms=service.avg_latency_ms,
                call_volume=service.total_calls,
                breakdown=explanation.breakdown,
            )
        )
    return CriticalityRankingResponse(items=items, total=len(items))


def _factor(weight: float, raw_value: float, normalized_score: float) -> FactorBreakdown:
    return FactorBreakdown(
        weight=weight,
        raw_value=round(raw_value, 6),
        normalized_score=round(normalized_score, 6),
        contribution=round(weight * normalized_score * 100.0, 4),
    )


def _tier_norm(tier: str | None, scores: dict[str, float]) -> float:
    if not tier:
        return 0.0
    return float(scores.get(tier.strip().lower(), 0.0))
