"""Service listing, dashboard, and overview queries."""

from __future__ import annotations

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.core.utils import isoformat, utc_now
from app.db.models import CircuitBreakerState, Dependency, Service, ServiceOperation, SimulationRun
from app.schemas.services import (
    OverviewHighestRisk,
    OverviewLatestSimulation,
    OverviewResponse,
    ServiceDashboard,
    ServiceDetail,
    ServiceHealthListItem,
    ServiceHealthListResponse,
    ServiceListResponse,
    ServiceMetrics,
    ServiceSummary,
)
from app.services.circuit_breaker_service import list_circuit_breakers
from app.services.criticality_service import get_criticality
from app.services.dataset_service import (
    active_dataset_id,
    dataset_summary,
    get_active_dataset,
    list_active_dependencies,
    list_active_services,
)
from app.services.graph_service import get_downstream, get_service_or_404, get_upstream
from app.services.health_service import list_health_history
from app.services.simulation_service import list_simulations


def list_services(
    db: Session,
    q: str | None = None,
    tier: str | None = None,
    service_type: str | None = None,
    health_status: str | None = None,
    min_health: float | None = None,
    max_health: float | None = None,
    min_risk: float | None = None,
    max_risk: float | None = None,
    min_error_rate: float | None = None,
    max_error_rate: float | None = None,
    min_latency: float | None = None,
    max_latency: float | None = None,
    min_calls: int | None = None,
    max_calls: int | None = None,
    limit: int = 50,
    offset: int = 0,
) -> ServiceListResponse:
    query = select(Service)
    dataset_id = active_dataset_id(db)
    if not dataset_id:
        return ServiceListResponse(items=[], total=0, limit=limit, offset=offset)
    query = query.where(Service.dataset_id == dataset_id)
    filters = []
    if q:
        pattern = f"%{q.lower()}%"
        operation_ids = select(ServiceOperation.service_id).where(
            func.lower(ServiceOperation.operation_name).like(pattern)
        )
        filters.append(
            or_(
                func.lower(Service.name).like(pattern),
                Service.normalized_name.like(pattern),
                Service.id.in_(operation_ids),
            )
        )
    if tier:
        filters.append(func.lower(Service.tier) == tier.lower())
    if service_type:
        filters.append(func.lower(Service.service_type) == service_type.lower())
    if health_status:
        filters.append(func.upper(Service.health_status) == health_status.upper())
    if min_health is not None:
        filters.append(Service.health_score >= min_health)
    if max_health is not None:
        filters.append(Service.health_score <= max_health)
    if min_risk is not None:
        filters.append(Service.criticality_score >= min_risk)
    if max_risk is not None:
        filters.append(Service.criticality_score <= max_risk)
    if min_error_rate is not None:
        filters.append(Service.error_rate >= min_error_rate)
    if max_error_rate is not None:
        filters.append(Service.error_rate <= max_error_rate)
    if min_latency is not None:
        filters.append(Service.avg_latency_ms >= min_latency)
    if max_latency is not None:
        filters.append(Service.avg_latency_ms <= max_latency)
    if min_calls is not None:
        filters.append(Service.total_calls >= min_calls)
    if max_calls is not None:
        filters.append(Service.total_calls <= max_calls)
    if filters:
        query = query.where(and_(*filters))
    rows = list(db.execute(query.order_by(Service.normalized_name)).scalars().all())
    sliced = rows[offset : offset + limit]
    return ServiceListResponse(
        items=[_summary(service) for service in sliced],
        total=len(rows),
        limit=limit,
        offset=offset,
    )


def get_service_detail(db: Session, service_id: str) -> ServiceDetail:
    service = get_service_or_404(db, service_id)
    upstream = get_upstream(db, service_id)
    downstream = get_downstream(db, service_id)
    criticality = get_criticality(db, service_id)
    return ServiceDetail(
        id=service.id,
        name=service.name,
        normalized_name=service.normalized_name,
        health={
            "status": service.health_status,
            "score": service.health_score,
            "error_rate": service.error_rate,
        },
        metrics=_metrics(service),
        criticality=criticality.model_dump(),
        dependency_counts={
            "upstream": upstream.count,
            "downstream": downstream.count,
        },
        upstream_count=upstream.count,
        downstream_count=downstream.count,
        last_seen_at=isoformat(service.last_seen_at),
        created_at=isoformat(service.created_at) or "",
        updated_at=isoformat(service.updated_at) or "",
        tier=service.tier,
        service_type=service.service_type,
        owner=service.owner,
        source=service.source,
        criticality_override=service.criticality_override,
    )


def get_dashboard(db: Session, service_id: str) -> ServiceDashboard:
    service = get_service_or_404(db, service_id)
    criticality = get_criticality(db, service_id)
    history = list_health_history(db, service_id, limit=10)
    breakers = [
        item.model_dump()
        for item in list_circuit_breakers(db).items
        if item.dependency.source_service_id == service_id or item.dependency.target_service_id == service_id
    ]
    simulations = [
        item.model_dump()
        for item in list_simulations(db, limit=10).items
        if item.failed_service_id == service_id
    ]
    return ServiceDashboard(
        service=_summary(service),
        metrics=_metrics(service),
        health={
            "status": service.health_status,
            "score": service.health_score,
            "error_rate": service.error_rate,
        },
        criticality=criticality.model_dump(),
        upstream=get_upstream(db, service_id).items,
        downstream=get_downstream(db, service_id).items,
        recent_health_history=history.items,
        circuit_breakers=breakers,
        recent_simulations=simulations,
    )


def list_service_health(db: Session) -> ServiceHealthListResponse:
    rows = list_active_services(db)
    items = [
        ServiceHealthListItem(
            service_id=service.id,
            service_name=service.name,
            health_score=service.health_score,
            health_status=service.health_status,
            error_rate=service.error_rate,
            avg_latency_ms=service.avg_latency_ms,
            call_volume=service.total_calls,
        )
        for service in rows
    ]
    return ServiceHealthListResponse(items=items, total=len(items))


def get_overview(db: Session) -> OverviewResponse:
    services = list_active_services(db)
    dataset = get_active_dataset(db)
    dataset_id = dataset.id if dataset else None
    dependency_count = len(list_active_dependencies(db))
    healthy = sum(1 for service in services if service.health_status == "HEALTHY")
    degraded = sum(1 for service in services if service.health_status == "DEGRADED")
    unhealthy = sum(1 for service in services if service.health_status == "UNHEALTHY")
    average = round(sum(service.health_score for service in services) / len(services), 4) if services else 0.0
    highest = None
    if services:
        top = sorted(
            services,
            key=lambda service: (-service.effective_criticality_score(), -service.total_calls, service.normalized_name),
        )[0]
        highest = OverviewHighestRisk(
            id=top.id,
            name=top.name,
            criticality_score=top.effective_criticality_score(),
            health_status=top.health_status,
            health_score=top.health_score,
        )
    latest_row = None
    if dataset_id:
        latest_row = db.execute(
            select(SimulationRun)
            .where(SimulationRun.dataset_id == dataset_id)
            .order_by(SimulationRun.created_at.desc())
        ).scalars().first()
    latest = None
    if latest_row:
        failed = db.get(Service, latest_row.failed_service_id)
        latest = OverviewLatestSimulation(
            id=latest_row.id,
            failed_service_id=latest_row.failed_service_id,
            failed_service_name=failed.name if failed else latest_row.failed_service_id,
            severity=latest_row.severity,
            blast_radius_score=latest_row.blast_radius_score,
            created_at=isoformat(latest_row.created_at) or "",
        )
    open_count = 0
    if dataset_id:
        open_count = db.execute(
            select(func.count(CircuitBreakerState.id)).where(
                CircuitBreakerState.state == "OPEN",
                CircuitBreakerState.dataset_id == dataset_id,
            )
        ).scalar_one()
    return OverviewResponse(
        service_count=len(services),
        dependency_count=int(dependency_count or 0),
        healthy_count=healthy,
        degraded_count=degraded,
        unhealthy_count=unhealthy,
        average_health_score=average,
        highest_risk_service=highest,
        latest_simulation=latest,
        open_circuit_breakers=int(open_count or 0),
        active_dataset=dataset_summary(db, dataset),
    )


def _summary(service: Service) -> ServiceSummary:
    return ServiceSummary(
        id=service.id,
        name=service.name,
        normalized_name=service.normalized_name,
        health_status=service.health_status,
        health_score=service.health_score,
        error_rate=service.error_rate,
        avg_latency_ms=service.avg_latency_ms,
        total_calls=service.total_calls,
        total_spans=service.total_spans,
        criticality_score=service.criticality_score,
        effective_criticality_score=service.effective_criticality_score(),
        tier=service.tier,
        service_type=service.service_type,
        owner=service.owner,
        source=service.source,
        criticality_override=service.criticality_override,
    )


def _metrics(service: Service) -> ServiceMetrics:
    return ServiceMetrics(
        total_calls=service.total_calls,
        total_spans=service.total_spans,
        error_count=service.error_count,
        error_rate=service.error_rate,
        avg_latency_ms=service.avg_latency_ms,
        min_latency_ms=service.min_latency_ms,
        max_latency_ms=service.max_latency_ms,
        p95_latency_ms=service.p95_latency_ms,
        p99_latency_ms=service.p99_latency_ms,
        sample_count=service.total_spans,
    )


def update_service(db: Session, service_id: str, payload) -> ServiceDetail:
    """Patch business metadata. Invalidates the graph cache after criticality recompute."""

    from app.services.criticality_service import recompute_all_criticality
    from app.services.graph_service import invalidate_graph_cache

    invalidate_graph_cache()
    service = get_service_or_404(db, service_id)
    data = payload.model_dump(exclude_unset=True)
    if "tier" in data:
        service.tier = data["tier"]
    if "service_type" in data:
        service.service_type = data["service_type"]
    if "owner" in data:
        service.owner = data["owner"]
    if "criticality_override" in data:
        service.criticality_override = data["criticality_override"]
    service.updated_at = utc_now()
    db.flush()
    recompute_all_criticality(db, dataset_id=service.dataset_id)
    invalidate_graph_cache()
    return get_service_detail(db, service_id)
