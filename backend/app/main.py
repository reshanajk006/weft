"""WEFT FastAPI application factory."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.errors import register_exception_handlers
from app.api.routes import (
    admin,
    blast_radius,
    circuit_breakers,
    config,
    criticality,
    datasets,
    dev,
    graph,
    health,
    jaeger,
    reports,
    services,
    simulations,
    telemetry,
)
from app.config.thresholds import load_thresholds
from app.core.logging import get_logger, setup_logging
from app.core.security import enforce_write_api_key
from app.core.settings import get_settings
from app.db.database import init_db

logger = get_logger("weft")


def create_app() -> FastAPI:
    settings = get_settings()
    setup_logging(settings.log_level)
    logger.info("Starting WEFT backend version %s", settings.app_version)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        logger.info("Initializing database")
        init_db()
        load_thresholds(settings.thresholds_file)
        logger.info("Thresholds loaded from %s", settings.thresholds_file)
        logger.info("WEFT backend ready")
        yield
        from app.services.live_jaeger_ingestion import get_live_manager

        await get_live_manager().shutdown()
        logger.info("WEFT backend stopped")

    application = FastAPI(
        title="WEFT API",
        version=settings.app_version,
        description=(
            "WEFT is a dependency-graph-driven resilience analysis platform. "
            "Upload Jaeger JSON traces or a declarative topology to derive services, "
            "dependencies, health, technical criticality, blast radius, and circuit-breaker simulations. "
            "Canonical prefix is /api/v1; /api remains supported."
        ),
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        lifespan=lifespan,
        dependencies=[Depends(enforce_write_api_key)],
    )

    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    register_exception_handlers(application)

    def mount(prefix: str) -> None:
        application.include_router(health.router, prefix=prefix)
        application.include_router(telemetry.router, prefix=prefix)
        application.include_router(datasets.router, prefix=prefix)
        application.include_router(graph.router, prefix=prefix)
        application.include_router(services.router, prefix=prefix)
        application.include_router(blast_radius.router, prefix=prefix)
        application.include_router(criticality.router, prefix=prefix)
        application.include_router(simulations.router, prefix=prefix)
        application.include_router(circuit_breakers.router, prefix=prefix)
        application.include_router(reports.router, prefix=prefix)
        application.include_router(config.router, prefix=prefix)
        application.include_router(dev.router, prefix=prefix)
        application.include_router(admin.router, prefix=prefix)
        application.include_router(jaeger.router, prefix=prefix)

    mount("/api")
    mount("/api/v1")
    return application


app = create_app()
