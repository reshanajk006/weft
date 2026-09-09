"""Telemetry dataset schemas."""

from __future__ import annotations

from app.schemas.common import APIModel


class DatasetSummary(APIModel):
    id: str
    name: str
    source: str | None = None
    status: str
    created_at: str
    service_count: int = 0
    dependency_count: int = 0


class ActiveDatasetResponse(APIModel):
    dataset: DatasetSummary | None = None
