"""Deterministic incident report generation."""

from __future__ import annotations

import json

from sqlalchemy.orm import Session

from app.core.exceptions import BadRequestError
from app.core.settings import get_settings
from app.core.utils import isoformat, new_id, utc_now
from app.db.models import ImpactReport, Service
from app.schemas.mitigation import MitigationResponse
from app.schemas.report import ReportResponse
from app.schemas.simulation import SimulationResponse, TimelineEvent
from app.services.analysis_common import (
    HYPOTHETICAL_MESSAGE,
    INSUFFICIENT_BASELINE,
    OBSERVED_DISCLAIMER,
    active_dataset_or_none,
    display_business_tier,
    observed_time_window,
)
from app.services.blast_radius_service import calculate_blast_radius
from app.services.graph_service import build_graph
from app.services.recommendation_service import build_recommendations
from app.services.root_cause_service import analyze_root_cause
from app.services.simulation_service import _get_active_simulation, get_timeline
from app.config.thresholds import get_thresholds


def generate_report(db: Session, simulation_id: str, fmt: str) -> ReportResponse:
    fmt_normalized = fmt.lower().strip()
    if fmt_normalized not in {"json", "markdown"}:
        raise BadRequestError("format must be 'json' or 'markdown'", details={"format": fmt})
    run = _get_active_simulation(db, simulation_id)
    result = SimulationResponse.model_validate(run.result_json)
    timeline = get_timeline(db, simulation_id).items
    rec_response = build_recommendations(db, simulation_id)
    root = analyze_root_cause(db, simulation_id)
    failed = db.get(Service, result.failed_service.id)
    dataset = active_dataset_or_none(db)
    window_start, window_end = observed_time_window(db, failed.dataset_id if failed else None)
    graph = build_graph(db)
    thresholds = get_thresholds()
    breakdown = result.score_breakdown
    if breakdown is None and failed is not None:
        breakdown = calculate_blast_radius(db, failed.id).score_breakdown

    dep_health: list[dict] = []
    if failed is not None and failed.id in graph:
        for nid in sorted(graph.successors(failed.id), key=lambda item: graph.nodes[item].get("name", item)):
            dep = db.get(Service, nid)
            if dep is None:
                continue
            dep_health.append(
                {
                    "service": dep.name,
                    "health_status": dep.health_status,
                    "health_score": dep.health_score,
                    "error_rate": dep.error_rate,
                }
            )

    mitigation = result.mitigation
    payload = {
        "report_title": "WEFT Incident Impact Report",
        "simulation_id": result.simulation_id,
        "created_at": result.created_at,
        "scenario_classification": root.scenario.model_dump() if root.scenario else None,
        "executive_summary": _executive_summary(result, failed, root),
        "failed_service": result.failed_service.model_dump(),
        "current_health": {
            "health_score": failed.health_score if failed else None,
            "health_status": failed.health_status if failed else None,
            "error_rate": failed.error_rate if failed else None,
            "avg_latency_ms": failed.avg_latency_ms if failed else None,
            "call_count": failed.total_calls if failed else None,
            "p95_latency_ms": failed.p95_latency_ms if failed else None,
            "p99_latency_ms": failed.p99_latency_ms if failed else None,
            "business_tier": display_business_tier(failed.tier) if failed else None,
            "computed_criticality": failed.effective_criticality_score() if failed else None,
        },
        "input_window": {
            "input_source": root.scenario.input_source if root.scenario else (dataset.source if dataset else "Jaeger JSON"),
            "dataset_name": dataset.name if dataset else None,
            "window_start": window_start,
            "window_end": window_end,
        },
        "dependency_health": dep_health,
        "blast_radius": {
            "score": result.blast_radius_score,
            "severity": result.severity,
            "services_affected": result.services_affected,
            "critical_services_affected": result.critical_services_affected,
            "estimated_requests_affected": result.estimated_requests_affected,
            "score_breakdown": breakdown.model_dump() if breakdown else None,
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
                "impact_severity": item.impact_level,
                "business_tier": display_business_tier(
                    (db.get(Service, item.service_id).tier if db.get(Service, item.service_id) else None)
                ),
            }
            for item in sorted(result.affected_services, key=lambda item: (-item.criticality_score, item.service_name))
        ],
        "circuit_breaker_simulation": [item.model_dump() for item in result.predicted_circuit_transitions],
        "circuit_breaker_thresholds": {
            "error_threshold": thresholds.circuit_breaker.error_threshold,
            "cooldown_seconds": thresholds.circuit_breaker.cooldown_seconds,
            "recovery_health_threshold": thresholds.circuit_breaker.recovery_health_threshold,
        },
        "incident_timeline": [item.model_dump() for item in timeline],
        "root_cause": root.model_dump(),
        "recommendation_items": [item.model_dump() for item in rec_response.items],
        "recommendations": [f"{item.priority}: {item.title} ({item.reason})" for item in rec_response.items],
        "mitigation": mitigation.model_dump() if mitigation else None,
    }

    if fmt_normalized == "json":
        content = json.dumps(payload, indent=2)
    else:
        content = _markdown(payload, timeline, rec_response.items, root, mitigation)

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


def _executive_summary(result: SimulationResponse, failed: Service | None, root) -> str:
    name = failed.name if failed else result.failed_service.name
    status = failed.health_status if failed else "UNKNOWN"
    return (
        f"Hypothetical failure simulation of {name}. "
        f"Observed status before the simulation was {status} with health score "
        f"{(failed.health_score if failed else 0):.1f}. "
        f"Predicted blast-radius score {result.blast_radius_score:.1f} with impact severity {result.severity}. "
        f"{result.services_affected} service(s) are in the predicted blast radius. "
        "Live service health was not modified. "
        f"Root-cause status: {root.root_cause_status}."
    )


def _markdown(payload: dict, timeline: list[TimelineEvent], recs, root, mitigation: MitigationResponse | None) -> str:
    failed = payload["failed_service"]
    health = payload["current_health"]
    blast = payload["blast_radius"]
    scenario = payload.get("scenario_classification") or {}
    window = payload.get("input_window") or {}
    cb = payload.get("circuit_breaker_thresholds") or {}
    name = failed["name"]
    lines: list[str] = [
        "# WEFT Incident Impact Report",
        "",
        "## 1. Scenario Classification",
        f"Type: {scenario.get('type', 'Hypothetical failure simulation')}",
        f"Input source: {scenario.get('input_source', window.get('input_source', 'Jaeger JSON'))}",
        f"Selected failure target: {scenario.get('selected_failure_target') or name}",
        f"Current observed status: {scenario.get('current_observed_status') or health.get('health_status')}",
        f"Current health score: {scenario.get('current_health_score', health.get('health_score'))}",
        "Observed production incident: No",
        "Live service health modified: No",
        "",
        "## 2. Executive Summary",
        payload["executive_summary"],
        "",
        "## 3. Input and Analysis Window",
        f"- Input source: {window.get('input_source')}",
        f"- Dataset: {window.get('dataset_name')}",
        f"- Observed window start: {window.get('window_start')}",
        f"- Observed window end: {window.get('window_end')}",
        "",
        "## 4. Simulated Failure Target",
        f"{name} was intentionally selected as unavailable.",
        f"- ID: {failed['id']}",
        f"- Observed status: {health.get('health_status')}",
        "",
        "## 5. Observed Telemetry Evidence",
        "These metrics describe the observed system before the hypothetical failure. "
        "The failure itself was not observed in production.",
        f"- Health status: {health.get('health_status')}",
        f"- Health score: {health.get('health_score')}",
        f"- Error rate: {_pct(health.get('error_rate'))}",
        f"- Call count: {health.get('call_count')}",
        f"- Average latency: {health.get('avg_latency_ms')} ms",
        f"- P95 latency: {health.get('p95_latency_ms')}",
        f"- P99 latency: {health.get('p99_latency_ms')}",
        f"- Observed time window: {window.get('window_start')} → {window.get('window_end')}",
        "- Relevant dependency health:",
    ]
    if payload.get("dependency_health"):
        for item in payload["dependency_health"]:
            lines.append(
                f"- {item['service']}: {item['health_status']} (score {item['health_score']}, "
                f"error rate {_pct(item['error_rate'])})"
            )
    else:
        lines.append("- No direct dependencies recorded for the selected target.")
    lines.extend(_rca_markdown(root, name))
    lines.extend(_blast_markdown(payload, blast))
    lines.extend(_severity_markdown(payload, blast, health))
    lines.extend(_cb_markdown(payload, cb))
    lines.extend(["", "## 10. Recommended Immediate Actions"])
    immediate = [item for item in recs if item.category in {"CONTAINMENT", "FALLBACK"}]
    if not immediate:
        lines.append("- No immediate containment action was generated.")
    for item in immediate:
        lines.extend(_rec_lines(item))
    lines.extend(["", "## 11. Fallback and Containment Plan"])
    for item in recs:
        if item.category in {"FALLBACK", "CONTAINMENT", "RECOVERY"}:
            lines.append(f"- {item.title}: {item.action}")
            lines.append(f"  Reason: {item.reason}")
    lines.append("Configuration draft — not executed.")
    lines.append(
        f"Suggested circuit-breaker policy: failure threshold {cb.get('error_threshold')}, "
        f"cooldown {cb.get('cooldown_seconds')}s, recovery mode HALF_OPEN."
    )
    lines.append("safe_to_automate: false")
    lines.extend(_mitigation_markdown(mitigation))
    lines.extend(
        [
            "",
            "## 13. Recovery Validation Plan",
            f"- Recheck dependency health after cooldown ({cb.get('cooldown_seconds')} seconds).",
            "- Verify error rate falls below recovery threshold.",
            "- Verify latency returns to acceptable range.",
            "- Allow HALF_OPEN validation.",
            "- Confirm projected caller health improves.",
            "- Replay queued requests only after successful recovery.",
            "- Confirm recovery remains stable across subsequent telemetry windows.",
            "No production recovery action was executed by WEFT.",
            "",
            "## 14. Timeline",
        ]
    )
    for event in timeline:
        label = event.service or ""
        lines.append(f"- {event.timestamp} [{event.type}] {label} {event.message}".strip())
    lines.extend(
        [
            "",
            "## 15. Assumptions and Limitations",
            "- Jaeger traces provide observed telemetry and dependency relationships.",
            "- Trace correlation does not guarantee causal proof.",
            "- No infrastructure metrics were available.",
            "- No deployment-change history was available.",
            "- No production remediation was executed.",
            "- Failure simulations are hypothetical.",
            "- Virtual mitigation results are predictions, not guarantees.",
            f"- Baseline analysis is limited when insufficient historical telemetry exists. {INSUFFICIENT_BASELINE}",
            f"- {OBSERVED_DISCLAIMER}",
            "",
        ]
    )
    return "\n".join(lines)


def _rca_markdown(root, name: str) -> list[str]:
    lines = ["", "## 6. Root-Cause Analysis", "Status: Not determined"]
    target = root.selected_target
    if target and target.observed_status == "HEALTHY":
        lines.extend(
            [
                f"{target.service_name} was selected as a hypothetical failure target.",
                "- Health status: HEALTHY",
                f"- Error rate: {_pct(target.observed_error_rate)}",
                f"- Current health score: {target.observed_health_score}",
                f"- Average latency: {target.observed_latency_ms} ms",
                "",
                "This simulation does not confirm a production root cause. "
                f"{target.service_name} was selected as the hypothetical failure target. "
                "The observed telemetry does not indicate that the service was currently failing.",
            ]
        )
    elif target:
        lines.extend(
            [
                f"{target.service_name} is an observed unhealthy service that was selected as the simulation target.",
                f"- Health status: {target.observed_status}",
                f"- Error rate: {_pct(target.observed_error_rate)}",
                f"- Current health score: {target.observed_health_score}",
                f"- Average latency: {target.observed_latency_ms} ms",
                "That observation does not establish causality.",
            ]
        )
    lines.extend(
        [
            "",
            "Suspected root cause:",
            "No confirmed root cause available for this hypothetical scenario.",
            "",
            "Root-cause analysis requires an observed anomaly such as:",
            "- elevated error rate",
            "- elevated latency",
            "- timeouts",
            "- dependency failures",
            "- abnormal behavior relative to baseline",
            "",
            HYPOTHETICAL_MESSAGE,
        ]
    )
    return lines


def _blast_markdown(payload: dict, blast: dict) -> list[str]:
    br = blast.get("score_breakdown") or {}
    affected_ratio = br.get("affected_ratio")
    mean_p = br.get("mean_impact_probability", br.get("weighted_impact"))
    crit_ratio = br.get("affected_criticality_ratio", br.get("critical_service_factor"))
    lines = [
        "",
        "## 7. Blast-Radius Analysis",
        "### Blast-Radius Score Breakdown",
        f"- Affected-service ratio: {_ratio_pct(affected_ratio)}",
        f"- Mean impact probability: {_ratio_pct(mean_p)}",
        f"- Affected criticality contribution: {_ratio_pct(crit_ratio)}",
        f"- Final score: {blast['score']}",
        "",
        "Formula:",
        "0.40 × affected ratio + 0.35 × mean impact probability + 0.25 × affected criticality ratio",
        f"- Services affected: {blast['services_affected']}",
        f"- Estimated requests affected: {blast['estimated_requests_affected']}",
        "",
        "Affected services:",
    ]
    for item in payload["affected_services"]:
        lines.append(
            f"- {item['service_name']}: probability {item['impact_probability']}, "
            f"distance {item['distance']}, projected health {item['projected_health_score']}"
        )
    return lines


def _severity_markdown(payload: dict, blast: dict, health: dict) -> list[str]:
    lines = [
        "",
        "## 8. Criticality and Severity Breakdown",
        f"- Impact severity: {blast['severity']} (blast-radius score {blast['score']})",
        f"- Business tier of selected target: {health.get('business_tier')}",
        f"- Computed technical criticality of selected target: {health.get('computed_criticality')} / 100",
        "Criticality is a technical score. Impact severity is derived from the blast-radius score.",
    ]
    for item in payload["criticality_analysis"]:
        lines.append(
            f"- {item['service']}: business tier {item['business_tier']}, "
            f"computed criticality {item['criticality_score']}, impact level {item['impact_severity']}"
        )
    return lines


def _cb_markdown(payload: dict, cb: dict) -> list[str]:
    lines = [
        "",
        "## 9. Predicted Circuit-Breaker Behavior",
        "Predicted circuit-breaker behavior (not actual circuit-breaker state).",
        f"- Failure threshold: {cb.get('error_threshold')}",
        f"- Cooldown: {cb.get('cooldown_seconds')} seconds",
        "- Recovery mode: HALF_OPEN",
        f"- Recovery health threshold: {cb.get('recovery_health_threshold')}",
        "- CLOSED → OPEN when error rate >= configured threshold",
        "- OPEN → HALF_OPEN when cooldown elapsed",
        "- HALF_OPEN → CLOSED when health >= recovery threshold",
        "- HALF_OPEN → OPEN when recovery is still below threshold",
    ]
    if payload["circuit_breaker_simulation"]:
        for item in payload["circuit_breaker_simulation"]:
            lines.append(
                f"- Predicted {item['source']} -> {item['target']}: "
                f"{item['previous_state']} -> {item['new_state']} ({item['reason']})"
            )
    else:
        lines.append("- No predicted circuit-breaker transitions.")
    return lines


def _mitigation_markdown(mitigation: MitigationResponse | None) -> list[str]:
    lines = ["", "## 12. Mitigation Comparison"]
    if mitigation and mitigation.mitigated and mitigation.improvement:
        lines.extend(
            [
                f"Virtual mitigation applied: {mitigation.mitigation.get('description', mitigation.explanation)}",
                "",
                "### Without mitigation",
                f"- Services affected: {mitigation.baseline.affected_services}",
                f"- Tier-1 services at risk: {mitigation.baseline.tier1_services_at_risk}",
                f"- Blast-radius score: {mitigation.baseline.blast_radius_score}",
                f"- Projected caller health: {mitigation.baseline.projected_caller_health}",
                "",
                "### With proposed mitigation",
                f"- Services affected: {mitigation.mitigated.affected_services}",
                f"- Tier-1 services at risk: {mitigation.mitigated.tier1_services_at_risk}",
                f"- Blast-radius score: {mitigation.mitigated.blast_radius_score}",
                f"- Projected caller health: {mitigation.mitigated.projected_caller_health}",
                "",
                "### Predicted improvement",
                f"- Blast-radius score reduced by {mitigation.improvement.blast_radius_reduction_percent}%",
                f"- {abs(mitigation.improvement.affected_services_delta)} affected services removed",
                f"- {abs(mitigation.improvement.tier1_services_delta)} Tier-1 services removed from affected set",
                "Production changes executed: No",
            ]
        )
        return lines
    lines.append("Mitigation comparison was not executed for this simulation.")
    return lines


def _rec_lines(item) -> list[str]:
    return [
        f"- [{item.category}] {item.title}",
        f"  Action: {item.action}",
        f"  Reason: {item.reason}",
        f"  Expected outcome: {item.expected_outcome}",
        f"  Risk: {item.risk}",
        f"  Effort: {item.effort}",
        f"  safe_to_automate: {str(item.safe_to_automate).lower()}",
        f"  Validation: {item.validation}",
    ]


def _pct(value) -> str:
    if value is None:
        return "n/a"
    try:
        return f"{float(value) * 100:.1f}%"
    except (TypeError, ValueError):
        return str(value)


def _ratio_pct(value) -> str:
    if value is None:
        return "n/a"
    try:
        return f"{float(value) * 100:.2f}%"
    except (TypeError, ValueError):
        return str(value)
