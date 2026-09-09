"""Optional API-key check for write endpoints."""

from __future__ import annotations

from fastapi import Request

from app.core.exceptions import ForbiddenError
from app.core.settings import get_settings


def enforce_write_api_key(request: Request) -> None:
    """No-op when settings.api_key is unset. GET/HEAD/OPTIONS stay open."""

    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return
    settings = get_settings()
    if not settings.api_key:
        return
    presented = request.headers.get("x-api-key") or request.headers.get("X-API-Key")
    if presented != settings.api_key:
        raise ForbiddenError("Invalid or missing API key")


def require_admin_key(x_admin_key: str | None) -> None:
    settings = get_settings()
    if not settings.admin_key:
        raise ForbiddenError("Admin endpoints are disabled")
    if not x_admin_key or x_admin_key != settings.admin_key:
        raise ForbiddenError("Invalid or missing admin key")
