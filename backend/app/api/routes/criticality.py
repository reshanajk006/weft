"""Technical criticality routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.schemas.criticality import CriticalityExplanation, CriticalityRankingResponse
from app.services.criticality_service import get_criticality, list_rankings

router = APIRouter(prefix="/criticality", tags=["Criticality"])


@router.get(
    "/rankings",
    response_model=CriticalityRankingResponse,
    summary="Technical criticality rankings",
    description="Deterministic ranking with explainable factor breakdown.",
)
def rankings(db: Session = Depends(get_db)) -> CriticalityRankingResponse:
    return list_rankings(db)


@router.get(
    "/{service_id}",
    response_model=CriticalityExplanation,
    summary="Explainable criticality for one service",
)
def criticality_for_service(service_id: str, db: Session = Depends(get_db)) -> CriticalityExplanation:
    return get_criticality(db, service_id)
