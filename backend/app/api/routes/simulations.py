"""Failure simulation routes including SSE."""

from __future__ import annotations

import json

from fastapi import APIRouter, Body, Depends, Query, status
from sqlalchemy.orm import Session
from sse_starlette.sse import EventSourceResponse

from app.api.deps import get_db
from app.schemas.analysis import IncidentAnalysisResponse
from app.schemas.mitigation import MitigationRequest, MitigationResponse
from app.schemas.simulation import MultiFailureRequest, SimulationListResponse, SimulationResponse, TimelineResponse
from app.services.mitigation_service import simulate_mitigation
from app.services.recommendation_service import build_recommendations
from app.services.root_cause_service import analyze_root_cause
from app.services.simulation_service import (
    _get_active_simulation,
    get_simulation,
    get_timeline,
    list_simulations,
    simulate_failure,
    simulate_multi_failure,
    stream_failure_events,
)

router = APIRouter(tags=["Simulations"])


@router.post(
    "/simulate/failure",
    response_model=SimulationResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Simulate multiple service failures",
)
def simulate_batch(payload: MultiFailureRequest, db: Session = Depends(get_db)) -> SimulationResponse:
    return simulate_multi_failure(db, payload.service_ids)


@router.post(
    "/simulate/failure/{service_id}",
    response_model=SimulationResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Simulate service failure",
    description="Analysis-only simulation. Live service health is not modified.",
)
def simulate(service_id: str, db: Session = Depends(get_db)) -> SimulationResponse:
    return simulate_failure(db, service_id)


@router.get(
    "/simulate/failure/{service_id}/stream",
    summary="SSE failure simulation stream",
    description="Server-Sent Events stream of blast-radius computation. Does not use WebSockets.",
)
def simulate_stream(service_id: str, db: Session = Depends(get_db)) -> EventSourceResponse:
    events = stream_failure_events(db, service_id)

    async def generator():
        for event_name, payload in events:
            yield {"event": event_name, "data": json.dumps(payload)}

    return EventSourceResponse(generator())


@router.get(
    "/simulations",
    response_model=SimulationListResponse,
    summary="Simulation history",
)
def simulations(
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> SimulationListResponse:
    return list_simulations(db, limit=limit, offset=offset)


@router.get(
    "/simulations/{simulation_id}",
    response_model=SimulationResponse,
    summary="Simulation result",
)
def simulation_detail(simulation_id: str, db: Session = Depends(get_db)) -> SimulationResponse:
    return get_simulation(db, simulation_id)


@router.get(
    "/simulations/{simulation_id}/timeline",
    response_model=TimelineResponse,
    summary="Incident timeline",
)
def simulation_timeline(simulation_id: str, db: Session = Depends(get_db)) -> TimelineResponse:
    return get_timeline(db, simulation_id)


@router.get(
    "/simulations/{simulation_id}/analysis",
    response_model=IncidentAnalysisResponse,
    summary="Explainable root cause and recommendations",
)
def simulation_analysis(simulation_id: str, db: Session = Depends(get_db)) -> IncidentAnalysisResponse:
    root = analyze_root_cause(db, simulation_id)
    recs = build_recommendations(db, simulation_id)
    run = _get_active_simulation(db, simulation_id)
    result = SimulationResponse.model_validate(run.result_json)
    return IncidentAnalysisResponse(
        simulation_id=simulation_id,
        scenario=root.scenario,
        root_cause=root,
        recommendations=recs.items,
        mitigation=result.mitigation,
    )


@router.post(
    "/simulations/{simulation_id}/mitigation",
    response_model=MitigationResponse,
    summary="Virtual mitigation comparison",
    description="What-if fallback comparison. Does not persist graph, health, or circuit-breaker changes.",
)
def simulation_mitigation(
    simulation_id: str,
    payload: MitigationRequest = Body(default_factory=MitigationRequest),
    db: Session = Depends(get_db),
) -> MitigationResponse:
    return simulate_mitigation(db, simulation_id, payload.strategy, payload.dependency_id)
