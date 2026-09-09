"""Observed-incident analysis routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.schemas.analysis import RootCauseResponse
from app.services.root_cause_service import analyze_observed_root_cause

router = APIRouter(prefix="/analysis", tags=["Analysis"])


@router.get(
    "/root-cause",
    response_model=RootCauseResponse,
    summary="Observed root-cause ranking",
    description="Ranks services from active-dataset telemetry. Does not treat a simulation target as a cause.",
)
def observed_root_cause(db: Session = Depends(get_db)) -> RootCauseResponse:
    return analyze_observed_root_cause(db)
