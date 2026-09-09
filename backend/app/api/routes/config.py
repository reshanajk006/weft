"""Threshold and topology configuration routes."""

from __future__ import annotations

import json

import yaml
from fastapi import APIRouter, Depends, File, UploadFile, status
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.config.thresholds import get_thresholds, update_thresholds
from app.core.exceptions import ValidationFailedError
from app.schemas.config import (
    ThresholdsResponse,
    ThresholdsUpdateRequest,
    TopologyIngestResponse,
    TopologyUploadRequest,
)
from app.services.topology_service import ingest_topology

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


@router.post(
    "/topology",
    response_model=TopologyIngestResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Ingest declarative topology",
)
def post_topology(payload: TopologyUploadRequest, db: Session = Depends(get_db)) -> TopologyIngestResponse:
    return ingest_topology(db, payload)


@router.post(
    "/topology/upload",
    response_model=TopologyIngestResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload topology JSON or YAML",
)
async def upload_topology(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> TopologyIngestResponse:
    filename = (file.filename or "topology.json").lower()
    raw = await file.read()
    try:
        if filename.endswith((".yaml", ".yml")):
            loaded = yaml.safe_load(raw.decode("utf-8"))
        else:
            loaded = json.loads(raw.decode("utf-8"))
    except Exception as exc:
        raise ValidationFailedError("Uploaded topology file is not valid JSON or YAML") from exc
    payload = TopologyUploadRequest.model_validate(loaded)
    return ingest_topology(db, payload)
