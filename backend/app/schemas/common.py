"""Shared schema primitives."""

from __future__ import annotations

from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")


class APIModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class ErrorBody(APIModel):
    code: str
    message: str
    details: dict = Field(default_factory=dict)


class ErrorResponse(APIModel):
    error: ErrorBody


class Paginated(APIModel, Generic[T]):
    items: list[T]
    total: int
    limit: int
    offset: int


class HealthResponse(APIModel):
    status: str
    service: str
    version: str
