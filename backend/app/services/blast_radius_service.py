"""Structural and probabilistic blast-radius analysis."""

from __future__ import annotations

from collections import deque

import networkx as nx
from sqlalchemy.orm import Session

from app.config.thresholds import get_thresholds
from app.core.utils import clamp, safe_div
from app.db.models import Service
from app.schemas.blast_radius import (
    BlastRadiusResponse,
    BlastRadiusScoreBreakdown,
    BlastRadiusService,
)
from app.services.graph_service import build_graph, get_service_or_404


def classify_impact_level(probability: float) -> str:
    thresholds = get_thresholds().impact_level
    if probability >= thresholds.critical_min:
        return "CRITICAL"
    if probability >= thresholds.high_min:
        return "HIGH"
    if probability >= thresholds.medium_min:
        return "MEDIUM"
    return "LOW"


def calculate_blast_radius(
    db: Session,
    service_id: str,
    *,
    edge_weight_overrides: dict[tuple[str, str], float] | None = None,
) -> BlastRadiusResponse:
    failed = get_service_or_404(db, service_id)
    graph = _apply_edge_weight_overrides(build_graph(db), edge_weight_overrides)
    services = {node_id: db.get(Service, node_id) for node_id in graph.nodes}

    structural_ids = {failed.id}
    predecessors: set[str] = set()
    if failed.id in graph:
        structural_ids |= nx.ancestors(graph, failed.id)
        predecessors = set(graph.predecessors(failed.id))

    probabilities = _probabilistic_blast_radius(graph, [failed.id])
    affected_rows: list[BlastRadiusService] = []
    for node_id in sorted(structural_ids, key=lambda nid: services[nid].normalized_name if services.get(nid) else nid):
        service = services.get(node_id)
        if service is None:
            continue
        probability, distance = probabilities.get(node_id, (1.0 if node_id == failed.id else 0.0, 0 if node_id == failed.id else 0))
        if node_id != failed.id and node_id not in probabilities:
            distance = _shortest_reverse_distance(graph, failed.id, node_id)
            probability = 0.0
        direct = node_id in predecessors
        affected_rows.append(
            BlastRadiusService(
                service_id=service.id,
                service_name=service.name,
                impact_probability=round(probability, 6),
                distance=distance,
                direct=direct if node_id != failed.id else False,
                impact_level=classify_impact_level(probability),
                criticality_score=service.effective_criticality_score(),
                current_health_score=service.health_score,
            )
        )

    failed_row = next((row for row in affected_rows if row.service_id == failed.id), None)
    callers = [row for row in affected_rows if row.service_id != failed.id]
    callers.sort(key=lambda row: (-row.impact_probability, row.distance, row.service_name))
    directly = [row for row in callers if row.distance == 1 or row.direct]
    indirectly = [row for row in callers if row not in directly]
    all_affected = ([failed_row] if failed_row else []) + callers

    unaffected = sorted(
        service.name
        for service in services.values()
        if service is not None and service.id not in structural_ids
    )
    score, breakdown = _blast_radius_score(graph, services, all_affected)
    return BlastRadiusResponse(
        failed_service_id=failed.id,
        failed_service_name=failed.name,
        blast_radius_score=score,
        score_breakdown=breakdown,
        formula=breakdown.formula,
        directly_affected=directly,
        indirectly_affected=indirectly,
        total_affected=len(all_affected),
        affected_services=all_affected,
        unaffected_services=unaffected,
        affected_service_ids=[row.service_id for row in callers],
        directly_affected_ids=[row.service_id for row in directly],
        indirectly_affected_ids=[row.service_id for row in indirectly],
        services=callers,
    )


def analyze_failure_set(
    db: Session,
    failed_ids: list[str],
    *,
    edge_weight_overrides: dict[tuple[str, str], float] | None = None,
) -> tuple[
    nx.DiGraph,
    dict[str, Service | None],
    list[BlastRadiusService],
    float,
    dict[str, list[str]],
    BlastRadiusScoreBreakdown,
]:
    """Union structural + probabilistic blast radius for multiple failed services."""

    graph = _apply_edge_weight_overrides(build_graph(db), edge_weight_overrides)
    services = {node_id: db.get(Service, node_id) for node_id in graph.nodes}
    for failed_id in failed_ids:
        get_service_or_404(db, failed_id)
        services[failed_id] = db.get(Service, failed_id)

    structural_ids: set[str] = set(failed_ids)
    predecessors: set[str] = set()
    caused_by: dict[str, list[str]] = {failed_id: [failed_id] for failed_id in failed_ids}
    for failed_id in failed_ids:
        if failed_id not in graph:
            continue
        ancestors = nx.ancestors(graph, failed_id)
        structural_ids |= ancestors
        predecessors |= set(graph.predecessors(failed_id))
        for ancestor in ancestors:
            caused_by.setdefault(ancestor, [])
            if failed_id not in caused_by[ancestor]:
                caused_by[ancestor].append(failed_id)

    probabilities = _probabilistic_blast_radius(graph, failed_ids)
    affected_rows: list[BlastRadiusService] = []
    failed_set = set(failed_ids)

    def sort_key(nid: str) -> str:
        service = services.get(nid)
        return service.normalized_name if service else nid

    for node_id in sorted(structural_ids, key=sort_key):
        service = services.get(node_id)
        if service is None:
            continue
        probability, distance = probabilities.get(
            node_id,
            (1.0 if node_id in failed_set else 0.0, 0 if node_id in failed_set else 0),
        )
        if node_id not in failed_set and node_id not in probabilities:
            distance = min(
                (_shortest_reverse_distance(graph, failed_id, node_id) for failed_id in failed_ids),
                default=0,
            )
            probability = 0.0
        direct = node_id in predecessors
        affected_rows.append(
            BlastRadiusService(
                service_id=service.id,
                service_name=service.name,
                impact_probability=round(probability, 6),
                distance=distance,
                direct=direct if node_id not in failed_set else False,
                impact_level=classify_impact_level(probability),
                criticality_score=service.effective_criticality_score(),
                current_health_score=service.health_score,
            )
        )
    score, breakdown = _blast_radius_score(graph, services, affected_rows)
    return graph, services, affected_rows, score, caused_by, breakdown


def _probabilistic_blast_radius(graph: nx.DiGraph, failed_ids: list[str]) -> dict[str, tuple[float, int]]:
    """BFS through predecessors. child_impact = parent_impact * edge_weight.

    Seed every failed service at probability 1.0. If a node is reachable from more
    than one failure, keep the maximum probability.
    """

    thresholds = get_thresholds().blast_radius
    min_prob = thresholds.min_impact_probability
    impact: dict[str, tuple[float, int]] = {failed_id: (1.0, 0) for failed_id in failed_ids}
    queue: deque[str] = deque(failed_ids)
    while queue:
        current = queue.popleft()
        current_impact, distance = impact[current]
        predecessors = sorted(graph.predecessors(current), key=lambda nid: graph.nodes[nid].get("name", nid))
        for pred in predecessors:
            edge = graph.get_edge_data(pred, current) or {}
            weight = float(edge.get("critical_weight") or thresholds.non_critical_edge_weight)
            candidate = current_impact * weight
            if candidate < min_prob:
                continue
            previous = impact.get(pred)
            if previous is None or candidate > previous[0]:
                impact[pred] = (candidate, distance + 1)
                queue.append(pred)
            elif previous is not None and distance + 1 < previous[1]:
                impact[pred] = (previous[0], distance + 1)
    return impact


def _shortest_reverse_distance(graph: nx.DiGraph, failed_id: str, target_id: str) -> int:
    try:
        return nx.shortest_path_length(graph.reverse(copy=False), failed_id, target_id)
    except (nx.NetworkXError, nx.NetworkXNoPath):
        return 0


def _blast_radius_score(
    graph: nx.DiGraph,
    services: dict[str, Service | None],
    affected: list[BlastRadiusService],
) -> tuple[float, BlastRadiusScoreBreakdown]:
    weights = get_thresholds().blast_radius_score
    total_services = max(len(graph.nodes), 1)
    affected_ratio = safe_div(len(affected), total_services)
    weighted_impact = safe_div(sum(row.impact_probability for row in affected), len(affected))
    affected_crit = sum(
        (services[row.service_id].effective_criticality_score() if services.get(row.service_id) else 0)
        for row in affected
    )
    all_crit = sum((svc.effective_criticality_score() if svc else 0) for svc in services.values())
    critical_factor = safe_div(affected_crit, all_crit)
    score = clamp(
        round(
            (
                weights.affected_ratio_weight * affected_ratio
                + weights.weighted_impact_weight * weighted_impact
                + weights.critical_service_factor_weight * critical_factor
            )
            * 100.0,
            4,
        ),
        0.0,
        100.0,
    )
    formula = (
        f"{weights.affected_ratio_weight}*affected_ratio + "
        f"{weights.weighted_impact_weight}*weighted_impact + "
        f"{weights.critical_service_factor_weight}*critical_service_factor"
    )
    breakdown = BlastRadiusScoreBreakdown(
        affected_ratio=round(affected_ratio, 6),
        weighted_impact=round(weighted_impact, 6),
        critical_service_factor=round(critical_factor, 6),
        mean_impact_probability=round(weighted_impact, 6),
        affected_criticality_ratio=round(critical_factor, 6),
        formula=f"score = 100 * ({formula})",
    )
    return score, breakdown


def _apply_edge_weight_overrides(
    graph: nx.DiGraph,
    overrides: dict[tuple[str, str], float] | None,
) -> nx.DiGraph:
    """Return a copy with virtual edge weights. Never mutates the cached graph."""

    if not overrides:
        return graph
    graph = graph.copy()
    for (source_id, target_id), weight in overrides.items():
        if graph.has_edge(source_id, target_id):
            graph[source_id][target_id]["critical_weight"] = float(weight)
    return graph
