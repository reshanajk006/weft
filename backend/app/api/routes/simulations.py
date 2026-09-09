"""Failure simulation routes including SSE."""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session
from sse_starlette.sse import EventSourceResponse

from app.api.deps import get_db
from app.schemas.simulation import SimulationListResponse, SimulationResponse, TimelineResponse
from app.services.simulation_service import get_simulation, get_timeline, list_simulations, simulate_failure, stream_failure_events

router = APIRouter(tags=["Simulations"])


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
