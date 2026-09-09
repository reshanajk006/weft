"""Live Jaeger polling. User-initiated only; never starts on FastAPI startup."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from app.core.exceptions import JaegerUnavailableError, ValidationFailedError
from app.core.logging import get_logger
from app.core.settings import get_settings
from app.core.utils import isoformat, utc_now
from app.db.database import get_session_factory
from app.db.models import TelemetryDataset
from app.schemas.jaeger import JaegerConnectRequest, JaegerStatusResponse, JaegerTestResponse
from app.services.dataset_service import activate_dataset, create_and_activate_dataset
from app.services.jaeger_client import JaegerClient, normalize_jaeger_url
from app.services.trace_ingestion import ingest_jaeger_payload

logger = get_logger("weft.live_jaeger")


def parse_service_filter(value: str | None) -> list[str] | None:
    if not value:
        return None
    cleaned = value.strip()
    if not cleaned or cleaned.lower() in {"all", "all services"}:
        return None
    names = [item.strip() for item in cleaned.split(",") if item.strip()]
    return names or None


@dataclass
class LiveJaegerManager:
    """One poll loop at a time. CONNECT creates one dataset; polls rebuild it from the lookback window."""

    is_running: bool = False
    status: str = "disconnected"
    jaeger_url: str | None = None
    started_at: str | None = None
    last_poll_time: str | None = None
    traces_ingested: int = 0
    services_discovered: list[str] = field(default_factory=list)
    error_message: str | None = None
    dataset_id: str | None = None
    poll_interval: int = 30
    max_traces_per_poll: int = 50
    service_filter: str | None = None
    lookback: str = "1h"
    poll_generation: int = 0
    graph_service_count: int = 0
    graph_dependency_count: int = 0
    _client: JaegerClient | None = None
    _task: asyncio.Task | None = None
    _stop: asyncio.Event | None = None
    _lock: asyncio.Lock | None = None
    _seen_trace_ids: set[str] = field(default_factory=set)

    def _ensure_lock(self) -> asyncio.Lock:
        if self._lock is None:
            self._lock = asyncio.Lock()
        return self._lock

    def snapshot(self) -> JaegerStatusResponse:
        return JaegerStatusResponse(
            is_running=self.is_running,
            status=self.status,
            jaeger_url=self.jaeger_url,
            started_at=self.started_at,
            last_poll_time=self.last_poll_time,
            traces_ingested=self.traces_ingested,
            services_discovered=list(self.services_discovered),
            error_message=self.error_message,
            dataset_id=self.dataset_id,
            poll_interval=self.poll_interval,
            max_traces_per_poll=self.max_traces_per_poll,
            service_filter=self.service_filter,
            poll_generation=self.poll_generation,
            graph_service_count=self.graph_service_count,
            graph_dependency_count=self.graph_dependency_count,
        )

    def test_connection(self, jaeger_url: str | None = None) -> JaegerTestResponse:
        url = normalize_jaeger_url(jaeger_url or get_settings().jaeger_query_url)
        client = JaegerClient(url)
        try:
            services = client.get_services()
        finally:
            client.close()
        return JaegerTestResponse(ok=True, jaeger_url=url, services=services, service_count=len(services))

    def _loop_alive(self) -> bool:
        return self._task is not None and not self._task.done()

    async def connect(self, db: Session, payload: JaegerConnectRequest) -> JaegerStatusResponse:
        async with self._ensure_lock():
            url = normalize_jaeger_url(payload.jaeger_url or get_settings().jaeger_query_url)
            if self.is_running and self._loop_alive() and self.jaeger_url == url:
                self.poll_interval = payload.poll_interval
                self.max_traces_per_poll = payload.max_traces_per_poll
                self.service_filter = payload.service_filter
                self.lookback = payload.lookback or self.lookback or "1h"
                try:
                    self.poll_once(db)
                except JaegerUnavailableError as exc:
                    self.status = "error"
                    self.error_message = exc.message
                return self.snapshot()
            if self.is_running:
                await self._cancel_task()
                if self._client is not None:
                    self._client.close()
                    self._client = None
                self.is_running = False

            client = JaegerClient(url)
            try:
                services = client.get_services()
            except Exception:
                client.close()
                raise

            resume = payload.resume and self.dataset_id is not None
            if resume:
                dataset = db.get(TelemetryDataset, self.dataset_id)
                if dataset is None:
                    resume = False
            if not resume:
                stamp = utc_now().strftime("%Y-%m-%d %H:%M")
                dataset = create_and_activate_dataset(db, name=f"Live Jaeger - {stamp}", source=url)
                self.dataset_id = dataset.id
                self.traces_ingested = 0
                self._seen_trace_ids = set()
            else:
                activate_dataset(db, dataset)

            self._client = client
            self.jaeger_url = url
            self.poll_interval = payload.poll_interval
            self.max_traces_per_poll = payload.max_traces_per_poll
            self.service_filter = payload.service_filter
            self.lookback = payload.lookback or "1h"
            self.services_discovered = services
            self.started_at = isoformat(utc_now())
            self.error_message = None
            self.status = "connected"
            self.is_running = True
            self._stop = asyncio.Event()
            try:
                added = self.poll_once(db)
                logger.info("Initial Jaeger poll ingested %s traces into dataset %s", added, self.dataset_id)
            except JaegerUnavailableError as exc:
                self.status = "error"
                self.error_message = exc.message
                logger.warning("Initial Jaeger poll failed: %s", exc.message)
            loop = asyncio.get_running_loop()
            self._task = loop.create_task(self._loop(), name="weft-jaeger-poll")
            return self.snapshot()

    async def disconnect(self) -> JaegerStatusResponse:
        async with self._ensure_lock():
            await self._cancel_task()
            if self._client is not None:
                self._client.close()
                self._client = None
            self.is_running = False
            self.status = "disconnected"
            self.error_message = None
            return self.snapshot()

    async def reconnect(self, db: Session) -> JaegerStatusResponse:
        if self.is_running:
            self.error_message = None
            self.status = "connected"
            try:
                self.poll_once(db)
            except JaegerUnavailableError as exc:
                self.status = "error"
                self.error_message = exc.message
            return self.snapshot()
        if not self.jaeger_url or not self.dataset_id:
            raise ValidationFailedError("No previous Jaeger connection to resume")
        payload = JaegerConnectRequest(
            jaeger_url=self.jaeger_url,
            poll_interval=self.poll_interval,
            max_traces_per_poll=self.max_traces_per_poll,
            service_filter=self.service_filter,
            lookback=self.lookback,
            resume=True,
        )
        return await self.connect(db, payload)

    async def shutdown(self) -> None:
        await self.disconnect()

    def stop_sync(self) -> None:
        self.is_running = False
        self.status = "disconnected"
        if self._stop is not None:
            self._stop.set()
        if self._task is not None and not self._task.done():
            self._task.cancel()
        self._task = None
        if self._client is not None:
            self._client.close()
            self._client = None

    async def _cancel_task(self) -> None:
        if self._stop is not None:
            self._stop.set()
        task = self._task
        self._task = None
        if task is None:
            return
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    async def _loop(self) -> None:
        assert self._stop is not None
        while not self._stop.is_set():
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=self.poll_interval)
                break
            except asyncio.TimeoutError:
                pass
            if self._stop.is_set():
                break
            try:
                await asyncio.to_thread(self._poll_in_own_session)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Live Jaeger poll loop error")

    def _poll_in_own_session(self) -> None:
        session = get_session_factory()()
        try:
            self.poll_once(session)
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def poll_once(self, db: Session) -> int:
        """Rebuild the live dataset from Jaeger's current lookback window. Returns traces in this window."""

        if self._client is None or not self.dataset_id:
            return 0
        from app.services.dataset_service import get_active_dataset

        active = get_active_dataset(db)
        if active is not None and active.id != self.dataset_id:
            self.is_running = False
            self.status = "disconnected"
            if self._stop is not None:
                self._stop.set()
            return 0
        try:
            services = self._client.get_services()
            self.services_discovered = services
            wanted = parse_service_filter(self.service_filter)
            targets = wanted if wanted is not None else services
            traces: list[dict] = []
            seen: set[str] = set()
            remaining = self.max_traces_per_poll
            for service in targets:
                if remaining <= 0:
                    break
                if not str(service).strip():
                    continue
                try:
                    fetched = self._client.get_traces(
                        service=service,
                        limit=remaining,
                        lookback=self.lookback,
                    )
                except JaegerUnavailableError as exc:
                    logger.warning("Skipping Jaeger traces for %s: %s", service, exc.message)
                    continue
                for trace in fetched:
                    trace_id = str(trace.get("traceID") or trace.get("traceId") or "")
                    if not trace_id or trace_id in seen:
                        continue
                    seen.add(trace_id)
                    traces.append(trace)
                    remaining -= 1
                    if remaining <= 0:
                        break
            added = 0
            if traces:
                result = ingest_jaeger_payload(
                    db,
                    {"data": traces},
                    filename="live-jaeger-poll.json",
                    dataset_id=self.dataset_id,
                    replace=True,
                )
                added = int(result.traces_processed or 0)
                self.traces_ingested = added
                self.graph_service_count = int(result.services_discovered or 0)
                self.graph_dependency_count = int(result.dependencies_discovered or 0)
            self.poll_generation += 1
            self.last_poll_time = isoformat(utc_now())
            logger.info(
                "Jaeger poll fetched %s new traces (%s services) into dataset %s",
                added,
                len(targets),
                self.dataset_id,
            )
            if self.is_running:
                self.status = "connected"
                self.error_message = None
            return added
        except JaegerUnavailableError as exc:
            self.status = "error"
            self.error_message = exc.message
            self.last_poll_time = isoformat(utc_now())
            logger.warning("Jaeger poll failed: %s", exc.message)
            return 0


_manager: LiveJaegerManager | None = None


def get_live_manager() -> LiveJaegerManager:
    global _manager
    if _manager is None:
        _manager = LiveJaegerManager()
    return _manager


def reset_live_manager() -> None:
    global _manager
    if _manager is not None:
        _manager.stop_sync()
    _manager = None
