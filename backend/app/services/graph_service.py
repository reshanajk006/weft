"""NetworkX graph construction and neighborhood queries."""

from __future__ import annotations

from io import BytesIO

import networkx as nx
from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError, ValidationFailedError
from app.db.models import Service
from app.schemas.graph import CycleInfo, GraphEdge, GraphNode, GraphResponse, GraphValidationResponse
from app.schemas.services import NeighborListResponse, NeighborService
from app.services.dataset_service import (
    active_dataset_id,
    is_in_active_dataset,
    list_active_dependencies,
    list_active_services,
)

# Invalidation call sites: trace ingest, topology ingest, PATCH /services/{id},
# admin reset/seed, and reset_engine() between tests. Missing one of these is the
# only way a stale graph can leak into a later read.
_graph_cache: nx.DiGraph | None = None
_cache_dataset_id: str | None = None
_cache_dirty: bool = True


def invalidate_graph_cache() -> None:
    global _graph_cache, _cache_dataset_id, _cache_dirty
    _graph_cache = None
    _cache_dataset_id = None
    _cache_dirty = True


def build_graph(db: Session) -> nx.DiGraph:
    """Build a directed graph from persisted services and dependencies.

    Edge direction is source -> target, meaning source CALLS target.
    If target fails, source is affected. Blast radius therefore uses ancestors.
    Returns a copy of the cached graph so callers cannot mutate shared state.
    """

    global _graph_cache, _cache_dataset_id, _cache_dirty
    dataset_id = active_dataset_id(db)
    if not _cache_dirty and _graph_cache is not None and _cache_dataset_id == dataset_id:
        return _graph_cache.copy()

    graph = nx.DiGraph()
    services = list_active_services(db)
    for service in services:
        graph.add_node(
            service.id,
            service_id=service.id,
            name=service.name,
            health_score=service.health_score,
            health_status=service.health_status,
            criticality_score=service.effective_criticality_score(),
            tier=service.tier or "",
        )
    dependencies = list_active_dependencies(db)
    for dependency in dependencies:
        if dependency.source_service_id not in graph or dependency.target_service_id not in graph:
            continue
        graph.add_edge(
            dependency.source_service_id,
            dependency.target_service_id,
            dependency_id=dependency.id,
            call_count=dependency.call_count,
            error_rate=dependency.error_rate,
            avg_latency_ms=dependency.avg_latency_ms,
            critical_weight=dependency.critical_weight,
        )
    _graph_cache = graph
    _cache_dataset_id = dataset_id
    _cache_dirty = False
    return graph.copy()


def get_service_or_404(db: Session, service_id: str) -> Service:
    service = db.get(Service, service_id)
    if service is None or not is_in_active_dataset(db, service):
        raise NotFoundError(
            f"Service '{service_id}' was not found in the active dataset",
            code="SERVICE_NOT_FOUND",
            details={"service_id": service_id},
        )
    return service


def serialize_graph(
    db: Session,
    highlight_service_id: str | None = None,
) -> GraphResponse:
    graph = build_graph(db)
    highlight: dict[str, str] = {}
    impacted_edges: set[str] = set()
    if highlight_service_id:
        get_service_or_404(db, highlight_service_id)
        if highlight_service_id in graph:
            ancestors = nx.ancestors(graph, highlight_service_id)
            predecessors = set(graph.predecessors(highlight_service_id))
            highlight[highlight_service_id] = "FAILED"
            for node_id in ancestors:
                highlight[node_id] = "DIRECTLY_AFFECTED" if node_id in predecessors else "INDIRECTLY_AFFECTED"
            affected = set(ancestors) | {highlight_service_id}
            for source, target, data in graph.edges(data=True):
                if source in affected and target in affected:
                    impacted_edges.add(data.get("dependency_id", ""))

    nodes: list[GraphNode] = []
    for node_id, data in sorted(graph.nodes(data=True), key=lambda item: item[1].get("name", "")):
        health_status = data.get("health_status", "HEALTHY")
        status = highlight.get(node_id, health_status if not highlight_service_id else "NORMAL")
        nodes.append(
            GraphNode(
                id=node_id,
                name=data.get("name", ""),
                status=status,
                health_status=health_status,
                health_score=float(data.get("health_score") or 0),
                criticality_score=float(data.get("criticality_score") or 0),
            )
        )

    edges: list[GraphEdge] = []
    edge_rows = []
    for source, target, data in graph.edges(data=True):
        edge_rows.append((source, target, data))
    edge_rows.sort(key=lambda item: (item[0], item[1]))
    for source, target, data in edge_rows:
        dep_id = data.get("dependency_id", "")
        edges.append(
            GraphEdge(
                id=dep_id,
                source=source,
                target=target,
                call_count=int(data.get("call_count") or 0),
                error_rate=float(data.get("error_rate") or 0),
                avg_latency_ms=float(data.get("avg_latency_ms") or 0),
                critical_weight=float(data.get("critical_weight") or 0.5),
                status="IMPACTED" if dep_id in impacted_edges else "NORMAL",
            )
        )
    return GraphResponse(nodes=nodes, edges=edges)


def validate_graph(db: Session) -> GraphValidationResponse:
    graph = build_graph(db)
    cycles_raw = []
    if graph.number_of_nodes() > 0:
        cycles_raw = list(nx.simple_cycles(graph))
    cycles: list[CycleInfo] = []
    for cycle in sorted(cycles_raw, key=lambda c: [graph.nodes[n]["name"] for n in c]):
        names = [graph.nodes[node_id]["name"] for node_id in cycle]
        cycles.append(CycleInfo(services=names, service_ids=list(cycle)))
    orphans = sorted(
        [
            data["name"]
            for node_id, data in graph.nodes(data=True)
            if graph.degree(node_id) == 0
        ]
    )
    return GraphValidationResponse(
        has_cycles=bool(cycles),
        cycle_count=len(cycles),
        cycles=cycles,
        orphan_services=orphans,
        dependency_count=graph.number_of_edges(),
        service_count=graph.number_of_nodes(),
    )


def get_upstream(db: Session, service_id: str) -> NeighborListResponse:
    service = get_service_or_404(db, service_id)
    graph = build_graph(db)
    items = _neighbors(db, graph, list(graph.predecessors(service_id)) if service_id in graph else [], incoming=True, center=service_id)
    return NeighborListResponse(service_id=service.id, service_name=service.name, items=items, count=len(items))


def get_downstream(db: Session, service_id: str) -> NeighborListResponse:
    service = get_service_or_404(db, service_id)
    graph = build_graph(db)
    items = _neighbors(db, graph, list(graph.successors(service_id)) if service_id in graph else [], incoming=False, center=service_id)
    return NeighborListResponse(service_id=service.id, service_name=service.name, items=items, count=len(items))


def _neighbors(
    db: Session,
    graph: nx.DiGraph,
    node_ids: list[str],
    incoming: bool,
    center: str,
) -> list[NeighborService]:
    items: list[NeighborService] = []
    for node_id in sorted(node_ids, key=lambda nid: graph.nodes[nid]["name"]):
        service = db.get(Service, node_id)
        if service is None:
            continue
        source, target = (node_id, center) if incoming else (center, node_id)
        edge = graph.get_edge_data(source, target) or {}
        items.append(
            NeighborService(
                id=service.id,
                name=service.name,
                health_status=service.health_status,
                health_score=service.health_score,
                criticality_score=service.effective_criticality_score(),
                call_count=int(edge.get("call_count") or 0),
                error_rate=float(edge.get("error_rate") or 0),
                avg_latency_ms=float(edge.get("avg_latency_ms") or 0),
            )
        )
    return items


def export_graph(db: Session, fmt: str) -> tuple[bytes, str, str]:
    """Serialize the active graph as GraphML or DOT for download."""

    graph = build_graph(db)
    fmt = fmt.strip().lower()
    if fmt == "graphml":
        buffer = BytesIO()
        nx.write_graphml(graph, buffer)
        return buffer.getvalue(), "application/graphml+xml", "weft-graph.graphml"
    if fmt == "dot":
        text = _to_dot(graph)
        return text.encode("utf-8"), "text/vnd.graphviz", "weft-graph.dot"
    raise ValidationFailedError("format must be graphml or dot", details={"format": fmt})


def _to_dot(graph: nx.DiGraph) -> str:
    lines = ["digraph weft {"]
    for node_id, data in sorted(graph.nodes(data=True), key=lambda item: item[1].get("name", "")):
        label = data.get("name", node_id)
        health = data.get("health_status", "")
        crit = data.get("criticality_score", 0)
        tier = data.get("tier", "")
        lines.append(
            f'  "{node_id}" [label="{label}", health_status="{health}", '
            f'criticality_score="{crit}", tier="{tier}"];'
        )
    for source, target, data in sorted(graph.edges(data=True), key=lambda item: (item[0], item[1])):
        lines.append(
            f'  "{source}" -> "{target}" [call_count="{data.get("call_count", 0)}", '
            f'error_rate="{data.get("error_rate", 0)}", critical_weight="{data.get("critical_weight", 0.5)}"];'
        )
    lines.append("}")
    return "\n".join(lines) + "\n"
