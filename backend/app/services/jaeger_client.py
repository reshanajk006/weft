"""HTTP client for the Jaeger Query API. Never auto-connects."""

from __future__ import annotations

import re
import time
from typing import Any
from urllib.parse import urljoin

import httpx

from app.core.exceptions import JaegerUnavailableError, ValidationFailedError
from app.core.logging import get_logger

logger = get_logger("weft.jaeger")

_LOOKBACK = re.compile(r"^(\d+)(ms|s|m|h|d)$", re.IGNORECASE)


def lookback_to_microseconds(lookback: str | None) -> int:
    text = (lookback or "1h").strip().lower()
    if text.isdigit():
        return int(text) * 1_000_000
    match = _LOOKBACK.fullmatch(text)
    if not match:
        return 3600 * 1_000_000
    amount = int(match.group(1))
    unit = match.group(2).lower()
    if unit == "ms":
        return amount * 1000
    seconds = {"s": 1, "m": 60, "h": 3600, "d": 86400}[unit]
    return amount * seconds * 1_000_000


def normalize_jaeger_url(url: str) -> str:
    cleaned = (url or "").strip()
    if not cleaned:
        raise ValidationFailedError("Jaeger Query URL is required")
    return cleaned.rstrip("/")


class JaegerClient:
    """Thin wrapper around Jaeger Query HTTP JSON endpoints."""

    def __init__(
        self,
        base_url: str,
        timeout: float = 10.0,
        client: httpx.Client | None = None,
    ) -> None:
        self.base_url = normalize_jaeger_url(base_url)
        self._owns_client = client is None
        self._client = client or httpx.Client(
            timeout=httpx.Timeout(timeout, connect=5.0),
            follow_redirects=True,
        )

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def health_check(self) -> bool:
        self.get_services()
        return True

    def get_services(self) -> list[str]:
        payload = self._get("api/services")
        return _string_list(payload.get("data"))

    def get_operations(self, service: str) -> list[str]:
        payload = self._get("api/operations", params={"service": service})
        data = payload.get("data")
        if isinstance(data, list) and data and isinstance(data[0], dict):
            return [str(item.get("name") or item.get("operationName") or "") for item in data if item]
        return _string_list(data)

    def get_traces(
        self,
        service: str | None = None,
        operation: str | None = None,
        tags: str | None = None,
        min_duration: str | None = None,
        max_duration: str | None = None,
        limit: int = 20,
        lookback: str = "1h",
    ) -> list[dict[str, Any]]:
        # Jaeger Query API filters by start/end in microseconds. `lookback` is a UI
        # convenience, not a reliable query param — sending it can 400 and yield no traces.
        end_us = int(time.time() * 1_000_000)
        start_us = max(0, end_us - lookback_to_microseconds(lookback))
        params: dict[str, Any] = {
            "limit": max(1, int(limit)),
            "start": start_us,
            "end": end_us,
        }
        if service:
            params["service"] = service
        if operation:
            params["operation"] = operation
        if tags:
            params["tags"] = tags
        if min_duration:
            params["minDuration"] = min_duration
        if max_duration:
            params["maxDuration"] = max_duration
        payload = self._get("api/traces", params=params)
        traces = payload.get("data")
        if traces is None:
            return []
        if not isinstance(traces, list):
            raise JaegerUnavailableError("Jaeger traces response is missing data[]")
        return [item for item in traces if isinstance(item, dict)]

    def get_trace(self, trace_id: str) -> dict[str, Any]:
        payload = self._get(f"api/traces/{trace_id}")
        traces = payload.get("data")
        if not isinstance(traces, list) or not traces:
            raise JaegerUnavailableError(f"Trace '{trace_id}' was not found")
        first = traces[0]
        if not isinstance(first, dict):
            raise JaegerUnavailableError(f"Trace '{trace_id}' was not found")
        return first

    def get_dependencies(self, service: str | None = None, end_ts: int | None = None) -> list[dict[str, Any]]:
        params: dict[str, Any] = {}
        if end_ts is not None:
            params["endTs"] = end_ts
        payload = self._get("api/dependencies", params=params)
        data = payload.get("data")
        if not isinstance(data, list):
            return []
        rows = [item for item in data if isinstance(item, dict)]
        if service:
            needle = service.strip().lower()
            rows = [
                item
                for item in rows
                if needle in {str(item.get("parent") or "").lower(), str(item.get("child") or "").lower()}
            ]
        return rows

    def _get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        url = urljoin(self.base_url + "/", path)
        try:
            response = self._client.get(url, params=params)
        except httpx.ConnectError as exc:
            raise JaegerUnavailableError(
                f"Could not connect to Jaeger at {self.base_url}",
                details={"url": url, "reason": "connection_refused"},
            ) from exc
        except httpx.TimeoutException as exc:
            raise JaegerUnavailableError(
                f"Jaeger at {self.base_url} timed out",
                details={"url": url, "reason": "timeout"},
            ) from exc
        except httpx.HTTPError as exc:
            raise JaegerUnavailableError(
                f"Jaeger request failed: {exc}",
                details={"url": url},
            ) from exc
        if response.status_code >= 400:
            raise JaegerUnavailableError(
                f"Jaeger returned HTTP {response.status_code}",
                details={"url": url, "status_code": response.status_code},
            )
        try:
            payload = response.json()
        except ValueError as exc:
            raise JaegerUnavailableError(
                "Jaeger returned a non-JSON response",
                details={"url": url},
            ) from exc
        if not isinstance(payload, dict):
            raise JaegerUnavailableError("Jaeger JSON must be an object")
        return payload


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if item is not None and str(item).strip()]
