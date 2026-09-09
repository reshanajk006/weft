"""Service, operation, and span persistence models."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.utils import new_id, utc_now
from app.db.base import Base


class Service(Base):
    __tablename__ = "services"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    tier: Mapped[str | None] = mapped_column(String(64), nullable=True)
    service_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    total_calls: Mapped[int] = mapped_column(Integer, default=0)
    error_count: Mapped[int] = mapped_column(Integer, default=0)
    error_rate: Mapped[float] = mapped_column(Float, default=0.0)
    avg_latency_ms: Mapped[float] = mapped_column(Float, default=0.0)
    min_latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    p95_latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    p99_latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    health_score: Mapped[float] = mapped_column(Float, default=100.0)
    health_status: Mapped[str] = mapped_column(String(32), default="HEALTHY")
    criticality_score: Mapped[float] = mapped_column(Float, default=0.0)
    total_spans: Mapped[int] = mapped_column(Integer, default=0)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    outgoing_dependencies: Mapped[list["Dependency"]] = relationship(
        "Dependency",
        foreign_keys="Dependency.source_service_id",
        back_populates="source_service",
    )
    incoming_dependencies: Mapped[list["Dependency"]] = relationship(
        "Dependency",
        foreign_keys="Dependency.target_service_id",
        back_populates="target_service",
    )
    health_history: Mapped[list["ServiceHealthHistory"]] = relationship(
        "ServiceHealthHistory",
        back_populates="service",
        cascade="all, delete-orphan",
    )
    operations: Mapped[list["ServiceOperation"]] = relationship(
        "ServiceOperation",
        back_populates="service",
        cascade="all, delete-orphan",
    )
    spans: Mapped[list["SpanRecord"]] = relationship(
        "SpanRecord",
        back_populates="service",
        cascade="all, delete-orphan",
    )


class ServiceOperation(Base):
    __tablename__ = "service_operations"
    __table_args__ = (UniqueConstraint("service_id", "operation_name", name="uq_service_operation"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    service_id: Mapped[str] = mapped_column(String(36), ForeignKey("services.id"), nullable=False, index=True)
    operation_name: Mapped[str] = mapped_column(String(512), nullable=False)

    service: Mapped[Service] = relationship("Service", back_populates="operations")


class SpanRecord(Base):
    __tablename__ = "span_records"
    __table_args__ = (UniqueConstraint("trace_id", "span_id", name="uq_trace_span"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    ingestion_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("trace_ingestions.id"), nullable=True)
    service_id: Mapped[str] = mapped_column(String(36), ForeignKey("services.id"), nullable=False, index=True)
    dependency_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("dependencies.id"), nullable=True, index=True)
    trace_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    span_id: Mapped[str] = mapped_column(String(128), nullable=False)
    parent_span_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    operation_name: Mapped[str] = mapped_column(String(512), default="")
    start_time_us: Mapped[int] = mapped_column(Integer, default=0)
    duration_ms: Mapped[float] = mapped_column(Float, default=0.0)
    is_error: Mapped[bool] = mapped_column(default=False)
    http_status_code: Mapped[str | None] = mapped_column(String(16), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    service: Mapped[Service] = relationship("Service", back_populates="spans")
