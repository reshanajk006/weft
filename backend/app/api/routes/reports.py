"""Incident report routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.schemas.report import ReportGenerateRequest, ReportResponse
from app.services.report_service import generate_report

router = APIRouter(prefix="/reports", tags=["Reports"])


@router.post(
    "/generate",
    response_model=ReportResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Generate an incident impact report",
    description="Creates a Markdown or JSON report from a stored simulation result.",
)
def create_report(payload: ReportGenerateRequest, db: Session = Depends(get_db)) -> ReportResponse:
    return generate_report(db, payload.simulation_id, payload.format)
