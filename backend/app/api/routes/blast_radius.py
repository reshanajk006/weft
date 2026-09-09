"""Blast-radius routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.schemas.blast_radius import BlastRadiusResponse
from app.services.blast_radius_service import calculate_blast_radius

router = APIRouter(prefix="/blast-radius", tags=["Blast Radius"])


@router.get(
    "/{service_id}",
    response_model=BlastRadiusResponse,
    summary="Structural and probabilistic blast radius",
    description="If B fails, callers of B (ancestors) are affected. Descendants are not.",
)
def blast_radius(service_id: str, db: Session = Depends(get_db)) -> BlastRadiusResponse:
    return calculate_blast_radius(db, service_id)
