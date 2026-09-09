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
from app.services.graph_service import build_graph


def recompute_all_criticality(db: Session) -> list[CriticalityExplanation]:
    services = list(db.execute(select(Service)).scalars().all())
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
        breakdown = CriticalityBreakdown(
            call_volume=_factor(weights.call_volume_weight, float(service.total_calls), call_norm),
            error_impact=_factor(weights.error_weight, service.error_rate, error_norm),
            latency_impact=_factor(weights.latency_weight, service.avg_latency_ms, latency_norm),
            dependency_impact=_factor(weights.dependency_weight, dependency_raw[service.id], dep_norm),
        )
        score = round(
            breakdown.call_volume.contribution
            + breakdown.error_impact.contribution
            + breakdown.latency_impact.contribution
            + breakdown.dependency_impact.contribution,
            4,
        )
        score = clamp(score, 0.0, 100.0)
        service.criticality_score = score
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
            )
        )
    db.flush()
    return explanations


def get_criticality(db: Session, service_id: str) -> CriticalityExplanation:
    service = db.get(Service, service_id)
    if service is None:
        raise NotFoundError(
            f"Service '{service_id}' was not found",
            code="SERVICE_NOT_FOUND",
            details={"service_id": service_id},
        )
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
        score=service.criticality_score,
        breakdown=breakdown,
    )


def list_rankings(db: Session) -> CriticalityRankingResponse:
    services = list(db.execute(select(Service)).scalars().all())
    if services and not db.execute(select(CriticalitySnapshot)).scalars().first():
        recompute_all_criticality(db)
    items: list[CriticalityRankingItem] = []
    ranked = sorted(
        services,
        key=lambda service: (-service.criticality_score, -service.total_calls, service.normalized_name),
    )
    for index, service in enumerate(ranked, start=1):
        explanation = get_criticality(db, service.id)
        items.append(
            CriticalityRankingItem(
                rank=index,
                service=service.name,
                service_id=service.id,
                score=service.criticality_score,
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
