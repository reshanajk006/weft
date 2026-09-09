"""Dependency graph routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from starlette.responses import StreamingResponse

from app.api.deps import get_db
from app.schemas.graph import GraphResponse, GraphValidationResponse
from app.services.graph_service import export_graph, serialize_graph, validate_graph

router = APIRouter(prefix="/graph", tags=["Graph"])


@router.get(
    "",
    response_model=GraphResponse,
    summary="Dependency graph",
    description="Frontend-ready nodes and edges. Optional highlight_service_id annotates blast-radius status.",
)
def get_graph(
    highlight_service_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> GraphResponse:
    return serialize_graph(db, highlight_service_id)


@router.get(
    "/validation",
    response_model=GraphValidationResponse,
    summary="Graph validation",
    description="Detect cycles and orphan services. Cycles are warnings, not fatal errors.",
)
def graph_validation(db: Session = Depends(get_db)) -> GraphValidationResponse:
    return validate_graph(db)


@router.get(
    "/export",
    summary="Export graph as GraphML or DOT",
)
def graph_export(
    format: str = Query(default="graphml"),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    payload, content_type, filename = export_graph(db, format)
    return StreamingResponse(
        iter([payload]),
        media_type=content_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
