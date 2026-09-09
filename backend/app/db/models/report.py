"""Impact report persistence."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.utils import new_id, utc_now
from app.db.base import Base


class ImpactReport(Base):
    __tablename__ = "impact_reports"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    simulation_run_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("simulation_runs.id"), nullable=False, index=True
    )
    format: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    file_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    simulation_run: Mapped["SimulationRun"] = relationship("SimulationRun")
