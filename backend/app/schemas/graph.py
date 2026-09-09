"""Graph API schemas."""

from __future__ import annotations

from app.schemas.common import APIModel


class GraphNode(APIModel):
    id: str
    name: str
    status: str
    health_status: str
    health_score: float
    criticality_score: float


class GraphEdge(APIModel):
    id: str
    source: str
    target: str
    call_count: int
    error_rate: float
    avg_latency_ms: float
    critical_weight: float = 0.5
    status: str = "NORMAL"


class GraphResponse(APIModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]


class CycleInfo(APIModel):
    services: list[str]
    service_ids: list[str]


class GraphValidationResponse(APIModel):
    has_cycles: bool
    cycle_count: int
    cycles: list[CycleInfo]
    orphan_services: list[str]
    dependency_count: int
    service_count: int
