"""Health and overview routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import __version__
from app.api.deps import get_db
from app.schemas.common import HealthResponse
from app.schemas.services import OverviewResponse, ServiceHealthListResponse
from app.services.service_query import get_overview, list_service_health

router = APIRouter(tags=["Health"])


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Process health",
    description="Liveness endpoint that does not depend on the database.",
)
def health() -> HealthResponse:
    return HealthResponse(status="ok", service="weft-backend", version=__version__)


@router.get(
    "/health/services",
    response_model=ServiceHealthListResponse,
    summary="Observed service health",
    description="Return observed health for every discovered service.",
)
def service_health(db: Session = Depends(get_db)) -> ServiceHealthListResponse:
    return list_service_health(db)


@router.get(
    "/overview",
    response_model=OverviewResponse,
    summary="Dashboard overview",
    description="Frontend-ready platform summary derived from ingested traces.",
)
def overview(db: Session = Depends(get_db)) -> OverviewResponse:
    return get_overview(db)
