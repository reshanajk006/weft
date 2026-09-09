"""Explicit development reset. Never called on startup."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.db.base import Base
import app.db.models  # noqa: F401


def reset_all_data(db: Session) -> dict[str, int]:
    """Delete every persisted row. Telemetry must be imported again afterwards."""

    from app.services.graph_service import invalidate_graph_cache

    counts: dict[str, int] = {}
    for table in reversed(Base.metadata.sorted_tables):
        result = db.execute(table.delete())
        counts[table.name] = int(result.rowcount or 0)
    invalidate_graph_cache()
    return counts
