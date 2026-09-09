"""Circuit breaker simulation models."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.utils import new_id, utc_now
from app.db.base import Base


class CircuitBreakerState(Base):
    __tablename__ = "circuit_breaker_states"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    dataset_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("telemetry_datasets.id"), nullable=True, index=True
    )
    source_service_id: Mapped[str] = mapped_column(String(36), ForeignKey("services.id"), nullable=False, index=True)
    target_service_id: Mapped[str] = mapped_column(String(36), ForeignKey("services.id"), nullable=False, index=True)
    dependency_id: Mapped[str] = mapped_column(String(36), ForeignKey("dependencies.id"), nullable=False, unique=True)
    state: Mapped[str] = mapped_column(String(16), default="CLOSED")
    failure_threshold: Mapped[float] = mapped_column(Float, default=0.50)
    cooldown_seconds: Mapped[float] = mapped_column(Float, default=30.0)
    recovery_threshold: Mapped[float] = mapped_column(Float, default=80.0)
    opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_transition_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    source_service: Mapped["Service"] = relationship("Service", foreign_keys=[source_service_id])
    target_service: Mapped["Service"] = relationship("Service", foreign_keys=[target_service_id])
    transitions: Mapped[list["CircuitBreakerTransition"]] = relationship(
        "CircuitBreakerTransition",
        back_populates="circuit_breaker",
        cascade="all, delete-orphan",
    )


class CircuitBreakerTransition(Base):
    __tablename__ = "circuit_breaker_transitions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    circuit_breaker_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("circuit_breaker_states.id"), nullable=False, index=True
    )
    previous_state: Mapped[str] = mapped_column(String(16), nullable=False)
    new_state: Mapped[str] = mapped_column(String(16), nullable=False)
    reason: Mapped[str] = mapped_column(Text, default="")
    error_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    health_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True)

    circuit_breaker: Mapped[CircuitBreakerState] = relationship(
        "CircuitBreakerState", back_populates="transitions"
    )
