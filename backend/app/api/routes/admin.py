"""Admin reset and sample seed. Disabled unless ADMIN_KEY is configured."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header, status
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.security import require_admin_key
from app.schemas.common import APIModel
from app.schemas.graph import GraphResponse
from app.services.graph_service import invalidate_graph_cache, serialize_graph
from app.services.system_reset import reset_all_data
from app.services.trace_ingestion import ingest_jaeger_payload

router = APIRouter(prefix="/admin", tags=["Admin"])


class AdminResetResponse(APIModel):
    cleared: bool
    tables: dict[str, int]


class SeedResponse(APIModel):
    seeded: bool
    graph: GraphResponse


def _admin(x_admin_key: str | None = Header(default=None, alias="X-Admin-Key")) -> None:
    require_admin_key(x_admin_key)


@router.post(
    "/reset",
    response_model=AdminResetResponse,
    summary="Truncate all tables",
)
def admin_reset(
    db: Session = Depends(get_db),
    _: None = Depends(_admin),
) -> AdminResetResponse:
    tables = reset_all_data(db)
    invalidate_graph_cache()
    return AdminResetResponse(cleared=True, tables=tables)


@router.post(
    "/seed-sample",
    response_model=SeedResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Ingest bundled sample traces",
)
def admin_seed(
    db: Session = Depends(get_db),
    _: None = Depends(_admin),
) -> SeedResponse:
    from samples.generate_samples import build_sample_traces

    invalidate_graph_cache()
    ingest_jaeger_payload(db, build_sample_traces(), filename="sample_traces.json")
    invalidate_graph_cache()
    return SeedResponse(seeded=True, graph=serialize_graph(db))
