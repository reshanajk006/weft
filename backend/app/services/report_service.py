"""Deterministic incident report generation."""

from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy.orm import Session

from app.config.thresholds import get_thresholds
from app.core.exceptions import BadRequestError, NotFoundError
from app.core.settings import get_settings
from app.core.utils import isoformat, new_id, utc_now
from app.db.models import ImpactReport, Service, SimulationRun
from app.schemas.report import ReportResponse
from app.schemas.simulation import SimulationResponse, TimelineEvent
from app.services.simulation_service import get_timeline


def generate_report(db: Session, simulation_id: str, fmt: str) -> ReportResponse:
    fmt_normalized = fmt.lower().strip()
    if fmt_normalized not in {"json", "markdown"}:
        raise BadRequestError("format must be 'json' or 'markdown'", details={"format": fmt})
    run = db.get(SimulationRun, simulation_id)
    if run is None:
        raise NotFoundError(
            f"Simulation '{simulation_id}' was not found",
            code="SIMULATION_NOT_FOUND",
            details={"simulation_id": simulation_id},
        )
    result = SimulationResponse.model_validate(run.result_json)
    timeline = get_timeline(db, simulation_id).items
    recommendations = _recommendations(db, result)
    failed = db.get(Service, result.failed_service.id)

    payload = {
        "report_title": "Incident Impact Report",
        "simulation_id": result.simulation_id,
        "created_at": result.created_at,
        "executive_summary": result.explanation,
        "failed_service": result.failed_service.model_dump(),
        "current_health": {
            "health_score": failed.health_score if failed else None,
            "health_status": failed.health_status if failed else None,
            "error_rate": failed.error_rate if failed else None,
            "avg_latency_ms": failed.avg_latency_ms if failed else None,
        },
        "blast_radius": {
            "score": result.blast_radius_score,
            "severity": result.severity,
            "services_affected": result.services_affected,
            "critical_services_affected": result.critical_services_affected,
            "estimated_requests_affected": result.estimated_requests_affected,
        },
        "affected_services": [item.model_dump() for item in result.affected_services],
        "impact_ranking": [
            item.model_dump()
            for item in sorted(
                result.affected_services,
                key=lambda item: (-item.impact_probability, item.distance, item.service_name),
            )
        ],
        "criticality_analysis": [
            {
                "service": item.service_name,
                "criticality_score": item.criticality_score,
            }
            for item in sorted(result.affected_services, key=lambda item: (-item.criticality_score, item.service_name))
        ],
        "circuit_breaker_simulation": [item.model_dump() for item in result.predicted_circuit_transitions],
        "incident_timeline": [item.model_dump() for item in timeline],
        "recommendations": recommendations,
    }

    if fmt_normalized == "json":
        content = json.dumps(payload, indent=2)
    else:
        content = _markdown(payload, timeline, recommendations)

    created_at = utc_now()
    report_id = new_id()
    storage_dir = get_settings().reports_dir
    storage_dir.mkdir(parents=True, exist_ok=True)
    extension = "md" if fmt_normalized == "markdown" else "json"
    file_path = storage_dir / f"{report_id}.{extension}"
    file_path.write_text(content, encoding="utf-8")

    report = ImpactReport(
        id=report_id,
        simulation_run_id=simulation_id,
        format=fmt_normalized,
        content=content,
        file_path=str(file_path),
        created_at=created_at,
    )
    db.add(report)
    db.flush()
    return ReportResponse(
        report_id=report.id,
        simulation_id=simulation_id,
        format=fmt_normalized,
        content=content,
        created_at=isoformat(created_at) or "",
    )


def _recommendations(db: Session, result: SimulationResponse) -> list[str]:
    thresholds = get_thresholds()
    recs: list[str] = []
    failed = db.get(Service, result.failed_service.id)
    if failed is None:
        return recs
    if failed.error_rate >= thresholds.health.degraded_error_rate:
        recs.append(
            f"Investigate {failed.name} error rate of {failed.error_rate:.0%}."
        )
    if failed.avg_latency_ms >= thresholds.latency.high_latency_ms:
        recs.append(
            f"Investigate {failed.name} latency of {failed.avg_latency_ms:.0f}ms."
        )
    if result.blast_radius_score >= thresholds.severity.medium_max:
        recs.append(
            f"{failed.name} is a high-impact dependency. Review containment strategy."
        )
    if result.critical_services_affected >= 2 or len(result.directly_affected) >= 3:
        recs.append(f"Multiple critical callers depend on {failed.name}.")
    if result.predicted_circuit_transitions:
        recs.append(
            "Predicted circuit-breaker opens would contain caller traffic in simulation only; "
            "no production circuit breakers were changed."
        )
    if not recs:
        recs.append(
            f"Review remaining callers of {failed.name} and continue monitoring observed error rate and latency."
        )
    return recs


def _markdown(payload: dict, timeline: list[TimelineEvent], recommendations: list[str]) -> str:
    failed = payload["failed_service"]
    health = payload["current_health"]
    blast = payload["blast_radius"]
    lines = [
        "# Incident Impact Report",
        "",
        "## Executive Summary",
        payload["executive_summary"],
        "",
        "## Failed Service",
        f"- Name: {failed['name']}",
        f"- ID: {failed['id']}",
        "",
        "## Health",
        f"- Status: {health.get('health_status')}",
        f"- Score: {health.get('health_score')}",
        f"- Error rate: {health.get('error_rate')}",
        f"- Average latency (ms): {health.get('avg_latency_ms')}",
        "",
        "## Blast Radius",
        f"- Score: {blast['score']}",
        f"- Severity: {blast['severity']}",
        f"- Services affected: {blast['services_affected']}",
        f"- Critical services affected: {blast['critical_services_affected']}",
        f"- Estimated requests affected: {blast['estimated_requests_affected']}",
        "",
        "## Affected Services",
    ]
    for item in payload["affected_services"]:
        lines.append(
            f"- {item['service_name']}: probability {item['impact_probability']}, "
            f"distance {item['distance']}, projected health {item['projected_health_score']}"
        )
    lines.extend(["", "## Impact Ranking"])
    for index, item in enumerate(payload["impact_ranking"], start=1):
        lines.append(f"{index}. {item['service_name']} ({item['impact_level']})")
    lines.extend(["", "## Criticality Analysis"])
    for item in payload["criticality_analysis"]:
        lines.append(f"- {item['service']}: {item['criticality_score']}")
    lines.extend(["", "## Circuit Breaker Simulation"])
    if payload["circuit_breaker_simulation"]:
        for item in payload["circuit_breaker_simulation"]:
            lines.append(
                f"- Predicted {item['source']} -> {item['target']}: "
                f"{item['previous_state']} -> {item['new_state']}"
            )
    else:
        lines.append("- No predicted circuit-breaker transitions.")
    lines.extend(["", "## Incident Timeline"])
    for event in timeline:
        label = event.service or ""
        lines.append(f"- {event.timestamp} [{event.type}] {label} {event.message}".strip())
    lines.extend(["", "## Recommendations"])
    for rec in recommendations:
        lines.append(f"- {rec}")
    lines.append("")
    return "\n".join(lines)
