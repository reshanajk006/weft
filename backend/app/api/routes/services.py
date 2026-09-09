"""Service catalog routes."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.schemas.health import HealthHistoryResponse
from app.schemas.services import (
    NeighborListResponse,
    ServiceDashboard,
    ServiceDetail,
    ServiceListResponse,
    ServiceUpdateRequest,
)
from app.services.graph_service import get_downstream, get_upstream
from app.services.health_service import list_health_history
from app.services.service_query import get_dashboard, get_service_detail, list_services, update_service

router = APIRouter(prefix="/services", tags=["Services"])


@router.get(
    "",
    response_model=ServiceListResponse,
    summary="List services",
    description="Search and filter discovered services. Pagination is included.",
)
def list_services_route(
    q: str | None = Query(default=None),
    tier: str | None = Query(default=None),
    type: str | None = Query(default=None),
    health_status: str | None = Query(default=None),
    min_health: float | None = Query(default=None),
    max_health: float | None = Query(default=None),
    min_risk: float | None = Query(default=None),
    max_risk: float | None = Query(default=None),
    min_error_rate: float | None = Query(default=None),
    max_error_rate: float | None = Query(default=None),
    min_latency: float | None = Query(default=None),
    max_latency: float | None = Query(default=None),
    min_calls: int | None = Query(default=None),
    max_calls: int | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> ServiceListResponse:
    return list_services(
        db,
        q=q,
        tier=tier,
        service_type=type,
        health_status=health_status,
        min_health=min_health,
        max_health=max_health,
        min_risk=min_risk,
        max_risk=max_risk,
        min_error_rate=min_error_rate,
        max_error_rate=max_error_rate,
        min_latency=min_latency,
        max_latency=max_latency,
        min_calls=min_calls,
        max_calls=max_calls,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/{service_id}",
    response_model=ServiceDetail,
    summary="Service details",
    responses={404: {"description": "Service not found"}},
)
def get_service(service_id: str, db: Session = Depends(get_db)) -> ServiceDetail:
    return get_service_detail(db, service_id)


@router.patch(
    "/{service_id}",
    response_model=ServiceDetail,
    summary="Update service metadata",
)
def patch_service(
    service_id: str,
    payload: ServiceUpdateRequest,
    db: Session = Depends(get_db),
) -> ServiceDetail:
    return update_service(db, service_id, payload)


@router.get(
    "/{service_id}/dashboard",
    response_model=ServiceDashboard,
    summary="Service dashboard aggregate",
)
def service_dashboard(service_id: str, db: Session = Depends(get_db)) -> ServiceDashboard:
    return get_dashboard(db, service_id)


@router.get(
    "/{service_id}/upstream",
    response_model=NeighborListResponse,
    summary="Direct upstream callers",
)
def upstream(service_id: str, db: Session = Depends(get_db)) -> NeighborListResponse:
    return get_upstream(db, service_id)


@router.get(
    "/{service_id}/downstream",
    response_model=NeighborListResponse,
    summary="Direct downstream dependencies",
)
def downstream(service_id: str, db: Session = Depends(get_db)) -> NeighborListResponse:
    return get_downstream(db, service_id)


@router.get(
    "/{service_id}/health-history",
    response_model=HealthHistoryResponse,
    summary="Service health history",
)
def health_history(
    service_id: str,
    limit: int = Query(default=50, ge=1, le=500),
    start_time: datetime | None = Query(default=None),
    end_time: datetime | None = Query(default=None),
    db: Session = Depends(get_db),
) -> HealthHistoryResponse:
    return list_health_history(db, service_id, limit=limit, start_time=start_time, end_time=end_time)
