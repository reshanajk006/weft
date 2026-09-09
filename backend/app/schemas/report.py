"""Report schemas."""

from __future__ import annotations

from pydantic import Field

from app.schemas.common import APIModel


class ReportGenerateRequest(APIModel):
    simulation_id: str
    format: str = Field(default="markdown")


class ReportResponse(APIModel):
    report_id: str
    simulation_id: str
    format: str
    content: str
    created_at: str
