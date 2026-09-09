"""Live Jaeger Query API connection. Never auto-starts."""

from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.settings import get_settings
from app.schemas.jaeger import JaegerConnectRequest, JaegerStatusResponse, JaegerTestRequest, JaegerTestResponse
from app.services.live_jaeger_ingestion import get_live_manager

router = APIRouter(prefix="/jaeger", tags=["Jaeger"])


@router.post(
    "/test",
    response_model=JaegerTestResponse,
    summary="Test Jaeger Query API connectivity",
)
def test_jaeger(payload: JaegerTestRequest = JaegerTestRequest()) -> JaegerTestResponse:
    settings = get_settings()
    url = payload.jaeger_url or settings.jaeger_query_url
    return get_live_manager().test_connection(url)


@router.get(
    "/test",
    response_model=JaegerTestResponse,
    summary="Test Jaeger Query API connectivity (GET)",
)
def test_jaeger_get(jaeger_url: str | None = None) -> JaegerTestResponse:
    return get_live_manager().test_connection(jaeger_url or get_settings().jaeger_query_url)


@router.post(
    "/connect",
    response_model=JaegerStatusResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Connect to Jaeger and start live ingestion",
)
async def connect_jaeger(
    payload: JaegerConnectRequest,
    db: Session = Depends(get_db),
) -> JaegerStatusResponse:
    return await get_live_manager().connect(db, payload)


@router.get(
    "/status",
    response_model=JaegerStatusResponse,
    summary="Live Jaeger connection status",
)
def jaeger_status() -> JaegerStatusResponse:
    return get_live_manager().snapshot()


@router.post(
    "/disconnect",
    response_model=JaegerStatusResponse,
    summary="Stop live ingestion without deleting the dataset",
)
async def disconnect_jaeger() -> JaegerStatusResponse:
    return await get_live_manager().disconnect()


@router.post(
    "/reconnect",
    response_model=JaegerStatusResponse,
    summary="Resume live ingestion on the existing live dataset",
)
async def reconnect_jaeger(db: Session = Depends(get_db)) -> JaegerStatusResponse:
    return await get_live_manager().reconnect(db)
