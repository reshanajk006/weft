"""Deterministic incident report generation."""

from __future__ import annotations

import json


from sqlalchemy.orm import Session

from app.core.exceptions import BadRequestError
from app.core.settings import get_settings
from app.core.utils import isoformat, new_id, utc_now
from app.db.models import ImpactReport, Service
from app.schemas.report import ReportResponse
from app.schemas.simulation import SimulationResponse, TimelineEvent
from app.services.recommendation_service import build_recommendations, recommendation_lines
from app.services.root_cause_service import analyze_root_cause
from app.services.simulation_service import _get_active_simulation, get_timeline


def generate_report(db: Session, simulation_id: str, fmt: str) -> ReportResponse:
    fmt_normalized = fmt.lower().strip()
    if fmt_normalized not in {"json", "markdown"}:
        raise BadRequestError("format must be 'json' or 'markdown'", details={"format": fmt})
    run = _get_active_simulation(db, simulation_id)
    result = SimulationResponse.model_validate(run.result_json)
    timeline = get_timeline(db, simulation_id).items
    rec_response = build_recommendations(db, simulation_id)
    recommendations = recommendation_lines(rec_response.items)
    root = analyze_root_cause(db, simulation_id)
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
        "root_cause": root.model_dump(),
        "recommendation_items": [item.model_dump() for item in rec_response.items],
        "recommendations": recommendations,
    }

    if fmt_normalized == "json":
        content = json.dumps(payload, indent=2)
    else:
        content = _markdown(payload, timeline, recommendations, root)

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


def _markdown(payload: dict, timeline: list[TimelineEvent], recommendations: list[str], root) -> str:
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
    lines.extend(["", "## Root Cause"])
    likely = root.likely_root_cause
    if likely is None:
        lines.append("- No root-cause candidate from observed telemetry.")
    else:
        lines.append(f"- Likely root cause: {likely.service}")
        lines.append(f"- Confidence: {likely.confidence}")
        lines.append(f"- Error rate: {likely.error_rate}")
        lines.append(f"- Health score: {likely.health_score}")
        lines.append(f"- Criticality: {likely.criticality_score}")
        for item in likely.evidence:
            lines.append(f"- {item}")
    lines.extend(["", "## Recommendations"])
    for rec in recommendations:
        lines.append(f"- {rec}")
    lines.append("")
    return "\n".join(lines)
