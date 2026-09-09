"""Database engine and session management."""

from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.logging import get_logger
from app.core.settings import get_settings
from app.db.base import Base

logger = get_logger("weft.db")

_engine: Engine | None = None
_SessionLocal: sessionmaker[Session] | None = None

_STALE_UNIQUES: dict[str, set[tuple[str, ...]]] = {
    "services": {("normalized_name",)},
    "dependencies": {("source_service_id", "target_service_id")},
    "span_records": {("trace_id", "span_id")},
}


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        settings = get_settings()
        url = settings.sqlalchemy_database_url
        kwargs: dict = {"future": True}
        if url.startswith("sqlite"):
            kwargs["connect_args"] = {"check_same_thread": False, "timeout": 30}
            if ":memory:" in url:
                kwargs["poolclass"] = StaticPool
        _engine = create_engine(url, **kwargs)
        logger.info("Database engine initialized")
    return _engine


def get_session_factory() -> sessionmaker[Session]:
    global _SessionLocal
    if _SessionLocal is None:
        _SessionLocal = sessionmaker(bind=get_engine(), autoflush=False, autocommit=False, future=True)
    return _SessionLocal


def init_db() -> None:
    """Create all tables and required directories."""

    import app.db.models  # noqa: F401

    settings = get_settings()
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    settings.reports_dir.mkdir(parents=True, exist_ok=True)
    engine = get_engine()
    Base.metadata.create_all(bind=engine)
    ensure_dataset_schema(engine)
    logger.info("Database tables created")


def ensure_dataset_schema(engine: Engine) -> None:
    """Add dataset columns and drop pre-dataset UNIQUE constraints without wiping rows.

    SQLite table-level UNIQUE constraints (e.g. uq_trace_span) cannot be removed with
    DROP INDEX. They stay in CREATE TABLE and block a new dataset from reusing the same
    Jaeger trace/span IDs. Rebuild those tables in place.
    """

    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    additions = {
        "services": "dataset_id",
        "dependencies": "dataset_id",
        "span_records": "dataset_id",
        "trace_ingestions": "dataset_id",
        "simulation_runs": "dataset_id",
        "circuit_breaker_states": "dataset_id",
    }
    with engine.begin() as conn:
        conn.execute(text("PRAGMA foreign_keys = OFF"))
        for table, column in additions.items():
            if table not in tables:
                continue
            columns = {item["name"] for item in inspect(conn).get_columns(table)}
            if column not in columns:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} VARCHAR(36)"))
        additive = {
            "services": [
                ("source", "VARCHAR(16) DEFAULT 'trace'"),
                ("owner", "VARCHAR(255)"),
                ("criticality_override", "FLOAT"),
            ],
            "dependencies": [
                ("source", "VARCHAR(16) DEFAULT 'trace'"),
            ],
            "simulation_runs": [
                ("failed_service_ids", "JSON"),
            ],
        }
        for table, columns_spec in additive.items():
            if table not in tables and table not in inspect(conn).get_table_names():
                continue
            existing = {item["name"] for item in inspect(conn).get_columns(table)}
            for column, ddl in columns_spec:
                if column not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))
                    existing.add(column)
        inspector = inspect(conn)
        for table, column_sets in _STALE_UNIQUES.items():
            if _has_stale_unique(inspector, table, column_sets):
                logger.info("Rebuilding %s to drop pre-dataset unique constraint", table)
                _rebuild_sqlite_table(conn, table)
                inspector = inspect(conn)
            else:
                _drop_matching_unique_indexes(conn, inspector, table, column_sets)
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_service_dataset_name "
                "ON services (dataset_id, normalized_name)"
            )
        )
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_dependency_dataset_pair "
                "ON dependencies (dataset_id, source_service_id, target_service_id)"
            )
        )
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_dataset_trace_span "
                "ON span_records (dataset_id, trace_id, span_id)"
            )
        )


def _has_stale_unique(inspector, table: str, column_sets: set[tuple[str, ...]]) -> bool:
    if table not in inspector.get_table_names():
        return False
    for constraint in inspector.get_unique_constraints(table):
        cols = tuple(constraint.get("column_names") or [])
        if cols in column_sets:
            return True
    for index in inspector.get_indexes(table):
        name = str(index.get("name") or "")
        cols = tuple(index.get("column_names") or [])
        if index.get("unique") and cols in column_sets and name.startswith("sqlite_autoindex_"):
            return True
    return False


def _rebuild_sqlite_table(conn: Connection, table_name: str) -> None:
    import app.db.models  # noqa: F401

    table = Base.metadata.tables[table_name]
    inspector = inspect(conn)
    existing_cols = {item["name"] for item in inspector.get_columns(table_name)}
    shared = [column.name for column in table.columns if column.name in existing_cols]
    tmp = f"_weft_old_{table_name}"
    conn.execute(text(f'DROP TABLE IF EXISTS "{tmp}"'))
    conn.execute(text(f'ALTER TABLE "{table_name}" RENAME TO "{tmp}"'))
    leftover_indexes = conn.execute(
        text(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = :tbl "
            "AND name NOT LIKE 'sqlite_autoindex_%' AND name IS NOT NULL"
        ),
        {"tbl": tmp},
    ).fetchall()
    for (name,) in leftover_indexes:
        conn.execute(text(f'DROP INDEX IF EXISTS "{name}"'))
    table.create(bind=conn)
    quoted = ", ".join(f'"{name}"' for name in shared)
    conn.execute(text(f'INSERT INTO "{table_name}" ({quoted}) SELECT {quoted} FROM "{tmp}"'))
    conn.execute(text(f'DROP TABLE "{tmp}"'))


def _drop_matching_unique_indexes(conn, inspector, table: str, column_sets: set[tuple[str, ...]]) -> None:
    if table not in inspector.get_table_names():
        return
    for index in inspector.get_indexes(table):
        cols = tuple(index.get("column_names") or [])
        name = str(index.get("name") or "")
        if index.get("unique") and cols in column_sets and not name.startswith("sqlite_autoindex_"):
            conn.execute(text(f'DROP INDEX IF EXISTS "{name}"'))
    for constraint in inspector.get_unique_constraints(table):
        cols = tuple(constraint.get("column_names") or [])
        name = constraint.get("name")
        if cols in column_sets and name and not str(name).startswith("sqlite_autoindex_"):
            conn.execute(text(f'DROP INDEX IF EXISTS "{name}"'))


def get_db() -> Generator[Session, None, None]:
    session = get_session_factory()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def reset_engine() -> None:
    global _engine, _SessionLocal
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _SessionLocal = None
    from app.services.graph_service import invalidate_graph_cache

    invalidate_graph_cache()
