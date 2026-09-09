"""Development-only utilities. Disabled when ALLOW_DEV_RESET is false."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.exceptions import ForbiddenError
from app.core.settings import get_settings
from app.schemas.common import APIModel
from app.services.system_reset import reset_all_data

router = APIRouter(prefix="/dev", tags=["Development"])


class ResetResponse(APIModel):
    cleared: bool
    tables: dict[str, int]


@router.post(
    "/reset",
    response_model=ResetResponse,
    summary="Reset development database",
    description="Deletes all imported telemetry, simulations, and reports. Does not run on startup.",
)
def reset_database(db: Session = Depends(get_db)) -> ResetResponse:
    settings = get_settings()
    if not settings.allow_dev_reset:
        raise ForbiddenError("Database reset is disabled")
    tables = reset_all_data(db)
    return ResetResponse(cleared=True, tables=tables)
