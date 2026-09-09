"""Jaeger telemetry ingestion routes."""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, File, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.exceptions import ValidationFailedError
from app.core.settings import get_settings
from app.core.utils import isoformat, new_id
from app.db.models import TraceIngestion
from app.schemas.telemetry import IngestionHistoryItem, IngestionHistoryResponse, IngestionResult
from app.services.trace_ingestion import ALLOWED_UPLOAD_TYPES, ingest_jaeger_file, ingest_jaeger_payload

router = APIRouter(prefix="/telemetry", tags=["Telemetry"])


@router.post(
    "/traces",
    response_model=IngestionResult,
    status_code=status.HTTP_201_CREATED,
    summary="Ingest Jaeger JSON",
    description="Accept a Jaeger-format JSON body and derive the dependency graph.",
)
def ingest_traces(payload: dict[str, Any], db: Session = Depends(get_db)) -> IngestionResult:
    return ingest_jaeger_payload(db, payload)


@router.post(
    "/traces/upload",
    response_model=IngestionResult,
    status_code=status.HTTP_201_CREATED,
    summary="Upload Jaeger JSON file",
    description="Upload a .json Jaeger export. Uses the same ingestion service as POST /telemetry/traces.",
)
async def upload_traces(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> IngestionResult:
    settings = get_settings()
    filename = file.filename or "upload.json"
    if not filename.lower().endswith(".json"):
        raise ValidationFailedError("Uploaded file must have a .json extension")
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if content_type and content_type not in ALLOWED_UPLOAD_TYPES:
        raise ValidationFailedError(
            "Unsupported content type",
            details={"content_type": file.content_type},
        )
    raw = await file.read()
    if len(raw) > settings.max_trace_file_size_bytes:
        raise ValidationFailedError(
            f"File exceeds maximum size of {settings.max_trace_file_size_mb} MB"
        )
    try:
        json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValidationFailedError("Uploaded file is not valid JSON") from exc

    ingestion_id = new_id()
    safe_name = f"{ingestion_id}.json"
    target = settings.upload_dir / safe_name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(raw)
    return ingest_jaeger_file(db, target, original_filename=filename)


@router.get(
    "/ingestions",
    response_model=IngestionHistoryResponse,
    summary="Ingestion history",
)
def list_ingestions(
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db),
) -> IngestionHistoryResponse:
    rows = list(db.execute(select(TraceIngestion).order_by(TraceIngestion.created_at.desc())).scalars().all())
    sliced = rows[offset : offset + limit]
    return IngestionHistoryResponse(
        items=[
            IngestionHistoryItem(
                id=row.id,
                filename=row.filename,
                trace_count=row.trace_count,
                span_count=row.span_count,
                service_count=row.service_count,
                dependency_count=row.dependency_count,
                error_count=row.error_count,
                status=row.status,
                error_message=row.error_message,
                created_at=isoformat(row.created_at) or "",
            )
            for row in sliced
        ],
        total=len(rows),
        limit=limit,
        offset=offset,
    )
