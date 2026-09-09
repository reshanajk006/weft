"""Service-to-service dependency model."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.utils import new_id, utc_now
from app.db.base import Base


class Dependency(Base):
    __tablename__ = "dependencies"
    __table_args__ = (
        UniqueConstraint("source_service_id", "target_service_id", name="uq_dependency_pair"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    source_service_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("services.id"), nullable=False, index=True
    )
    target_service_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("services.id"), nullable=False, index=True
    )
    call_count: Mapped[int] = mapped_column(Integer, default=0)
    error_count: Mapped[int] = mapped_column(Integer, default=0)
    error_rate: Mapped[float] = mapped_column(Float, default=0.0)
    avg_latency_ms: Mapped[float] = mapped_column(Float, default=0.0)
    p95_latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    p99_latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    dependency_type: Mapped[str] = mapped_column(String(64), default="sync")
    critical_weight: Mapped[float] = mapped_column(Float, default=0.5)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    source_service: Mapped["Service"] = relationship(
        "Service",
        foreign_keys=[source_service_id],
        back_populates="outgoing_dependencies",
    )
    target_service: Mapped["Service"] = relationship(
        "Service",
        foreign_keys=[target_service_id],
        back_populates="incoming_dependencies",
    )
