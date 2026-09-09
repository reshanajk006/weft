"""Active telemetry dataset is the only graph the product may show."""

from __future__ import annotations

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.utils import isoformat, new_id
from app.db.models import Dependency, Service, TelemetryDataset
from app.schemas.dataset import DatasetSummary


def get_active_dataset(db: Session) -> TelemetryDataset | None:
    return db.execute(
        select(TelemetryDataset).where(TelemetryDataset.is_active.is_(True))
    ).scalar_one_or_none()


def active_dataset_id(db: Session) -> str | None:
    dataset = get_active_dataset(db)
    return dataset.id if dataset else None


def list_active_services(db: Session) -> list[Service]:
    dataset_id = active_dataset_id(db)
    if not dataset_id:
        return []
    return list(
        db.execute(
            select(Service).where(Service.dataset_id == dataset_id).order_by(Service.normalized_name)
        ).scalars().all()
    )


def list_active_dependencies(db: Session) -> list[Dependency]:
    dataset_id = active_dataset_id(db)
    if not dataset_id:
        return []
    return list(db.execute(select(Dependency).where(Dependency.dataset_id == dataset_id)).scalars().all())


def is_in_active_dataset(db: Session, service: Service | None) -> bool:
    if service is None or not service.dataset_id:
        return False
    return service.dataset_id == active_dataset_id(db)


def create_and_activate_dataset(db: Session, name: str, source: str | None) -> TelemetryDataset:
    db.execute(update(TelemetryDataset).values(is_active=False))
    dataset = TelemetryDataset(
        id=new_id(),
        name=name.strip() or "Jaeger import",
        source=source,
        status="ready",
        is_active=True,
    )
    db.add(dataset)
    db.flush()
    return dataset


def activate_dataset(db: Session, dataset: TelemetryDataset) -> TelemetryDataset:
    db.execute(update(TelemetryDataset).values(is_active=False))
    dataset.is_active = True
    db.flush()
    return dataset


def dataset_summary(db: Session, dataset: TelemetryDataset | None) -> DatasetSummary | None:
    if dataset is None:
        return None
    services = db.execute(select(Service).where(Service.dataset_id == dataset.id)).scalars().all()
    deps = db.execute(select(Dependency).where(Dependency.dataset_id == dataset.id)).scalars().all()
    return DatasetSummary(
        id=dataset.id,
        name=dataset.name,
        source=dataset.source,
        status=dataset.status,
        created_at=isoformat(dataset.created_at) or "",
        service_count=len(list(services)),
        dependency_count=len(list(deps)),
    )
