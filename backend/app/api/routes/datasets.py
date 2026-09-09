"""Active telemetry dataset routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.schemas.dataset import ActiveDatasetResponse
from app.services.dataset_service import dataset_summary, get_active_dataset

router = APIRouter(prefix="/datasets", tags=["Datasets"])


@router.get(
    "/active",
    response_model=ActiveDatasetResponse,
    summary="Current active telemetry dataset",
    description="Returns null when no import has been activated in this database.",
)
def active_dataset(db: Session = Depends(get_db)) -> ActiveDatasetResponse:
    return ActiveDatasetResponse(dataset=dataset_summary(db, get_active_dataset(db)))
