"""Threshold configuration routes."""

from __future__ import annotations

from fastapi import APIRouter

from app.config.thresholds import get_thresholds, update_thresholds
from app.schemas.config import ThresholdsResponse, ThresholdsUpdateRequest

router = APIRouter(prefix="/config", tags=["Configuration"])


@router.get(
    "/thresholds",
    response_model=ThresholdsResponse,
    summary="Get analysis thresholds",
)
def read_thresholds() -> ThresholdsResponse:
    return ThresholdsResponse.model_validate(get_thresholds().model_dump())


@router.put(
    "/thresholds",
    response_model=ThresholdsResponse,
    summary="Update analysis thresholds",
    description="Validates weights, probabilities, and logical bounds before persisting.",
)
def put_thresholds(payload: ThresholdsUpdateRequest) -> ThresholdsResponse:
    data = {key: value for key, value in payload.model_dump().items() if value is not None}
    updated = update_thresholds(data)
    return ThresholdsResponse.model_validate(updated.model_dump())
