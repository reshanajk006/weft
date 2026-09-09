"""Declared vs observed origin for services and dependencies."""

from __future__ import annotations

SOURCE_TRACE = "trace"
SOURCE_CONFIG = "config"
SOURCE_BOTH = "both"


def normalized_source(value: str | None) -> str:
    current = (value or SOURCE_TRACE).strip().lower()
    if current not in {SOURCE_TRACE, SOURCE_CONFIG, SOURCE_BOTH}:
        return SOURCE_TRACE
    return current


def touch_source(entity, incoming: str) -> None:
    """Mark an entity as trace, config, or both when the other path touches it."""

    incoming = normalized_source(incoming)
    current = normalized_source(getattr(entity, "source", None))
    if current == incoming:
        entity.source = incoming
        return
    entity.source = SOURCE_BOTH
