"""Failure simulation and incident timeline models."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.utils import new_id, utc_now
from app.db.base import Base


class SimulationRun(Base):
    __tablename__ = "simulation_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    failed_service_id: Mapped[str] = mapped_column(String(36), ForeignKey("services.id"), nullable=False, index=True)
    blast_radius_score: Mapped[float] = mapped_column(Float, default=0.0)
    severity: Mapped[str] = mapped_column(String(32), default="LOW")
    affected_service_count: Mapped[int] = mapped_column(Integer, default=0)
    critical_service_count: Mapped[int] = mapped_column(Integer, default=0)
    estimated_request_impact: Mapped[int] = mapped_column(Integer, default=0)
    result_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True)

    failed_service: Mapped["Service"] = relationship("Service")
    events: Mapped[list["IncidentSimulation"]] = relationship(
        "IncidentSimulation",
        back_populates="simulation_run",
        cascade="all, delete-orphan",
    )


class IncidentSimulation(Base):
    __tablename__ = "incident_simulations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    simulation_run_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("simulation_runs.id"), nullable=False, index=True
    )
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    service_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("services.id"), nullable=True)
    circuit_breaker_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("circuit_breaker_states.id"), nullable=True
    )
    previous_state: Mapped[str | None] = mapped_column(String(32), nullable=True)
    new_state: Mapped[str | None] = mapped_column(String(32), nullable=True)
    message: Mapped[str] = mapped_column(Text, default="")
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True)

    simulation_run: Mapped[SimulationRun] = relationship("SimulationRun", back_populates="events")
