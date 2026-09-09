"""Declarative service/dependency topology ingestion."""

from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config.thresholds import get_thresholds
from app.core.exceptions import ValidationFailedError
from app.core.logging import get_logger
from app.core.utils import new_id, normalize_name, utc_now
from app.db.models import (
    CircuitBreakerState,
    CriticalitySnapshot,
    Dependency,
    Service,
    ServiceHealthHistory,
    ServiceOperation,
)
from app.schemas.config import TopologyIngestResponse, TopologyUploadRequest
from app.services.circuit_breaker_service import ensure_circuit_breakers_for_dependencies
from app.services.criticality_service import recompute_all_criticality
from app.services.dataset_service import create_and_activate_dataset, get_active_dataset
from app.services.graph_service import invalidate_graph_cache
from app.services.health_service import recompute_all_health
from app.services.origin import SOURCE_CONFIG, normalized_source, touch_source

logger = get_logger("weft.topology")


def ingest_topology(db: Session, payload: TopologyUploadRequest) -> TopologyIngestResponse:
    """Upsert config-declared services and dependencies into the active dataset.

    Trace-derived metrics are never overwritten. Cache invalidation happens at the
    start and end of this write path so later /api/graph reads see the new topology.
    """

    invalidate_graph_cache()
    dataset = get_active_dataset(db)
    if dataset is None:
        dataset = create_and_activate_dataset(db, name="Config topology", source="config")

    declared = {normalize_name(item.name): item for item in payload.services if item.name.strip()}
    existing_services = {
        service.normalized_name: service
        for service in db.execute(select(Service).where(Service.dataset_id == dataset.id)).scalars().all()
    }
    _validate_dependency_refs(payload, declared, existing_services)

    removed_services = 0
    removed_deps = 0
    if payload.mode == "replace":
        removed_services, removed_deps = _replace_config_rows(db, dataset.id, declared, payload)

    created_services = 0
    updated_services = 0
    for spec in payload.services:
        name = spec.name.strip()
        if not name:
            continue
        normalized = normalize_name(name)
        service = db.execute(
            select(Service).where(Service.dataset_id == dataset.id, Service.normalized_name == normalized)
        ).scalar_one_or_none()
        if service is None:
            service = Service(
                id=new_id(),
                dataset_id=dataset.id,
                name=name,
                normalized_name=normalized,
                source=SOURCE_CONFIG,
            )
            db.add(service)
            created_services += 1
        else:
            touch_source(service, SOURCE_CONFIG)
            updated_services += 1
        if spec.tier is not None:
            service.tier = spec.tier
        if spec.type is not None:
            service.service_type = spec.type
        if spec.owner is not None:
            service.owner = spec.owner
        service.updated_at = utc_now()
        db.flush()

    created_deps = 0
    updated_deps = 0
    default_weight = get_thresholds().blast_radius.non_critical_edge_weight
    for spec in payload.dependencies:
        source = _require_service(db, dataset.id, spec.source)
        target = _require_service(db, dataset.id, spec.target)
        if source.id == target.id:
            continue
        dependency = db.execute(
            select(Dependency).where(
                Dependency.dataset_id == dataset.id,
                Dependency.source_service_id == source.id,
                Dependency.target_service_id == target.id,
            )
        ).scalar_one_or_none()
        if dependency is None:
            dependency = Dependency(
                id=new_id(),
                dataset_id=dataset.id,
                source_service_id=source.id,
                target_service_id=target.id,
                source=SOURCE_CONFIG,
                critical_weight=spec.critical_weight if spec.critical_weight is not None else default_weight,
            )
            db.add(dependency)
            created_deps += 1
        else:
            touch_source(dependency, SOURCE_CONFIG)
            if spec.critical_weight is not None:
                dependency.critical_weight = spec.critical_weight
            updated_deps += 1
        if spec.protocol:
            dependency.dependency_type = spec.protocol
        dependency.updated_at = utc_now()
        db.flush()

    recompute_all_health(db, dataset_id=dataset.id)
    recompute_all_criticality(db, dataset_id=dataset.id)
    ensure_circuit_breakers_for_dependencies(db, dataset_id=dataset.id)
    invalidate_graph_cache()
    logger.info(
        "Topology ingest mode=%s created services=%s deps=%s",
        payload.mode,
        created_services,
        created_deps,
    )
    return TopologyIngestResponse(
        dataset_id=dataset.id,
        mode=payload.mode,
        services_created=created_services,
        services_updated=updated_services,
        dependencies_created=created_deps,
        dependencies_updated=updated_deps,
        services_removed=removed_services,
        dependencies_removed=removed_deps,
    )


def _validate_dependency_refs(
    payload: TopologyUploadRequest,
    declared: dict,
    existing_services: dict[str, Service],
) -> None:
    known = set(declared) | set(existing_services)
    for spec in payload.dependencies:
        missing = [name for name in (spec.source, spec.target) if normalize_name(name) not in known]
        if missing:
            raise ValidationFailedError(
                "Dependency references a service that is not declared and not already in the graph",
                details={"source": spec.source, "target": spec.target, "missing": missing},
            )


def _require_service(db: Session, dataset_id: str, name: str) -> Service:
    service = db.execute(
        select(Service).where(Service.dataset_id == dataset_id, Service.normalized_name == normalize_name(name))
    ).scalar_one_or_none()
    if service is None:
        raise ValidationFailedError(
            "Dependency references a service that is not declared and not already in the graph",
            details={"service": name},
        )
    return service


def _replace_config_rows(
    db: Session,
    dataset_id: str,
    declared_services: dict,
    payload: TopologyUploadRequest,
) -> tuple[int, int]:
    keep_service_names = set(declared_services)
    keep_dep_pairs = {
        (normalize_name(item.source), normalize_name(item.target)) for item in payload.dependencies
    }
    deps = list(db.execute(select(Dependency).where(Dependency.dataset_id == dataset_id)).scalars().all())
    services = {
        service.id: service
        for service in db.execute(select(Service).where(Service.dataset_id == dataset_id)).scalars().all()
    }
    removed_deps = 0
    for dependency in deps:
        if normalized_source(dependency.source) != SOURCE_CONFIG:
            continue
        source = services.get(dependency.source_service_id)
        target = services.get(dependency.target_service_id)
        pair = (
            source.normalized_name if source else "",
            target.normalized_name if target else "",
        )
        if pair in keep_dep_pairs:
            continue
        breakers = list(
            db.execute(select(CircuitBreakerState).where(CircuitBreakerState.dependency_id == dependency.id)).scalars().all()
        )
        for breaker in breakers:
            db.delete(breaker)
        db.delete(dependency)
        removed_deps += 1
    db.flush()

    removed_services = 0
    for service in list(services.values()):
        if normalized_source(service.source) != SOURCE_CONFIG:
            continue
        if service.normalized_name in keep_service_names:
            continue
        remaining = db.execute(
            select(Dependency).where(
                Dependency.dataset_id == dataset_id,
                (Dependency.source_service_id == service.id) | (Dependency.target_service_id == service.id),
            )
        ).scalars().all()
        if remaining:
            continue
        db.execute(delete(CriticalitySnapshot).where(CriticalitySnapshot.service_id == service.id))
        db.execute(delete(ServiceHealthHistory).where(ServiceHealthHistory.service_id == service.id))
        db.execute(delete(ServiceOperation).where(ServiceOperation.service_id == service.id))
        db.delete(service)
        removed_services += 1
    db.flush()
    return removed_services, removed_deps
