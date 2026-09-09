"""Live Jaeger connection schemas."""

from __future__ import annotations

from pydantic import Field

from app.schemas.common import APIModel


class JaegerTestRequest(APIModel):
    jaeger_url: str | None = None


class JaegerTestResponse(APIModel):
    ok: bool
    jaeger_url: str
    services: list[str] = Field(default_factory=list)
    service_count: int = 0


class JaegerConnectRequest(APIModel):
    jaeger_url: str | None = None
    poll_interval: int = Field(default=5, ge=5, le=3600)
    max_traces_per_poll: int = Field(default=50, ge=1, le=500)
    service_filter: str | None = None
    lookback: str = "5m"
    resume: bool = False


class JaegerStatusResponse(APIModel):
    is_running: bool
    status: str
    jaeger_url: str | None = None
    started_at: str | None = None
    last_poll_time: str | None = None
    traces_ingested: int = 0
    services_discovered: list[str] = Field(default_factory=list)
    error_message: str | None = None
    dataset_id: str | None = None
    poll_interval: int = 5
    max_traces_per_poll: int = 50
    service_filter: str | None = None
    lookback: str = "5m"
    poll_generation: int = 0
    graph_service_count: int = 0
    graph_dependency_count: int = 0
