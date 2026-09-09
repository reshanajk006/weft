"""Service health history model."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.utils import new_id, utc_now
from app.db.base import Base


class ServiceHealthHistory(Base):
    __tablename__ = "service_health_history"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    service_id: Mapped[str] = mapped_column(String(36), ForeignKey("services.id"), nullable=False, index=True)
    health_score: Mapped[float] = mapped_column(Float, nullable=False)
    health_status: Mapped[str] = mapped_column(String(32), nullable=False)
    error_rate: Mapped[float] = mapped_column(Float, default=0.0)
    total_spans: Mapped[int] = mapped_column(Integer, default=0)
    error_spans: Mapped[int] = mapped_column(Integer, default=0)
    avg_latency_ms: Mapped[float] = mapped_column(Float, default=0.0)
    calculated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True)

    service: Mapped["Service"] = relationship("Service", back_populates="health_history")
