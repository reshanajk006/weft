"""Application-specific exceptions."""

from __future__ import annotations

from typing import Any


class AppError(Exception):
    """Base error that maps to a stable JSON API response."""

    def __init__(
        self,
        code: str,
        message: str,
        status_code: int = 400,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}


class BadRequestError(AppError):
    def __init__(self, message: str, code: str = "BAD_REQUEST", details: dict[str, Any] | None = None) -> None:
        super().__init__(code=code, message=message, status_code=400, details=details)


class NotFoundError(AppError):
    def __init__(self, message: str, code: str = "NOT_FOUND", details: dict[str, Any] | None = None) -> None:
        super().__init__(code=code, message=message, status_code=404, details=details)


class ConflictError(AppError):
    def __init__(self, message: str, code: str = "CONFLICT", details: dict[str, Any] | None = None) -> None:
        super().__init__(code=code, message=message, status_code=409, details=details)


class ForbiddenError(AppError):
    def __init__(self, message: str, code: str = "FORBIDDEN", details: dict[str, Any] | None = None) -> None:
        super().__init__(code=code, message=message, status_code=403, details=details)


class ValidationFailedError(AppError):
    def __init__(self, message: str, code: str = "VALIDATION_ERROR", details: dict[str, Any] | None = None) -> None:
        super().__init__(code=code, message=message, status_code=422, details=details)


class InternalServerError(AppError):
    def __init__(self, message: str = "An unexpected error occurred", details: dict[str, Any] | None = None) -> None:
        super().__init__(
            code="INTERNAL_SERVER_ERROR",
            message=message,
            status_code=500,
            details=details,
        )
