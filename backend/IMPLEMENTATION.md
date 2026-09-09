# WEFT Backend Implementation

This document describes **what is implemented**, **how it works**, and **what it uses**.

WEFT is a **deterministic dependency-graph blast-radius analyzer**. You import telemetry (Jaeger JSON or OTLP JSON) or declare a topology. The backend derives services, edges, health, criticality, blast radius, failure simulation, circuit-breaker simulation, and reports.

It does **not** talk to a live Jaeger server, Kubernetes, Prometheus, or production traffic. Simulated failures never stop real services and do not mutate live health.

**Graph rule (do not reverse):** edge `A → B` means A calls B. If B fails, A is affected (`nx.ancestors`). Callees of B are not in the blast radius just because they are called.

---

## Current status

| Area | Status |
| --- | --- |
| FastAPI REST API (`/api` and `/api/v1`) | Implemented |
| SQLite persistence + additive schema migration | Implemented |
| Dataset-scoped workspace (empty until import) | Implemented |
| Jaeger ingest + graph derivation | Implemented |
| OTLP JSON ingest | Implemented |
| Config-driven topology (JSON/YAML) | Implemented |
| Health, 5-factor criticality, blast radius | Implemented |
| Single + multi-service failure simulation | Implemented |
| Circuit-breaker simulation | Implemented |
| Reports, SSE, thresholds API | Implemented |
| Graph cache, GraphML/DOT export | Implemented |
| Admin reset/seed, optional API key | Implemented |
| Live Jaeger Query API (manual connect, poll, same dataset) | Implemented |
| Deterministic root cause + recommendations | Implemented |
| Docker + GitHub Actions CI | Implemented |
| Automated tests | 94 pytest tests |
| React frontend (Vite + xyflow) | Implemented; live Jaeger UI wired |

---

## Stack (what it uses)

| Layer | Technology |
| --- | --- |
| HTTP | FastAPI 0.115, Uvicorn |
| Validation / settings | Pydantic v2, pydantic-settings, PyYAML |
| Persistence | SQLAlchemy 2.x, SQLite (`weft.db`) |
| Graph compute | NetworkX `DiGraph` |
| Streaming | sse-starlette (SSE, not WebSockets) |
| Uploads | python-multipart |
| Tests / lint | pytest, httpx, ruff |
| Frontend (separate package) | React 18, Vite, xyflow |
| Packaging | `backend/Dockerfile`, root `docker-compose.yml` |
| CI | GitHub Actions: pytest + ruff on Python 3.12 |

Run locally: `cd backend && python run.py` (Uvicorn, host `0.0.0.0`, port `8000`, reload). Interactive docs: `/docs`, `/redoc`.

---

## How a request flows

```
UI / curl
    → FastAPI route (thin, Pydantic response_model)
        → service layer (ingest, health, criticality, blast radius, simulation)
            → SQLite (source of truth)
            → NetworkX DiGraph (compute only; copy of an in-process cache)
        → Pydantic schema
    → JSON
```

Routes never return ORM objects. Errors are always:

```json
{ "error": { "code": "SERVICE_NOT_FOUND", "message": "…", "details": {} } }
```

Startup (`app/main.py`):

1. Load settings from environment / `.env`
2. Configure logging
3. `create_all` + `ensure_dataset_schema` (additive ALTERs; rebuild tables with stale uniques)
4. Load `config/thresholds.yaml`
5. CORS (credentials off) + exception handlers
6. Global write-API-key dependency (no-op if `API_KEY` unset)
7. Mount the same routers at `/api` and `/api/v1`

---

## Layout

```
weft/
├── backend/
│   ├── app/
│   │   ├── main.py                 # FastAPI factory; dual /api + /api/v1
│   │   ├── api/routes/           # HTTP endpoints
│   │   ├── api/errors.py        # JSON error envelope
│   │   ├── core/                # settings, logging, exceptions, security
│   │   ├── config/thresholds.py  # YAML loader + Pydantic validation
│   │   ├── db/models/           # SQLAlchemy 2.x models
│   │   ├── db/database.py        # engine, sessions, schema migration
│   │   ├── schemas/            # Pydantic v2 response models
│   │   └── services/            # algorithms
│   ├── config/thresholds.yaml
│   ├── samples/                 # Jaeger + OTLP sample JSON
│   ├── tests/
│   ├── Dockerfile
│   ├── ruff.toml
│   ├── run.py
│   └── requirements.txt
├── frontend/                   # React workspace (consumes /api)
├── docker-compose.yml
└── .github/workflows/ci.yml
```

---

## Feature 1 — Empty workspace until import (datasets)

**Why:** SQLite used to look like “the system” on refresh. A new import must **replace** the on-screen graph, not merge with leftover rows.

**How (`dataset_service.py`):**

- Each Jaeger/OTLP ingest calls `create_and_activate_dataset`, which marks every other `TelemetryDataset` inactive.
- Graph, services, overview, simulation, and blast-radius queries are scoped to `is_active` dataset id.
- `GET /api/datasets/active` returns `null` when nothing is activated.
- Legacy rows with `dataset_id = NULL` are hidden.
- Startup does **not** wipe the DB.

**Uniqueness:** `(dataset_id, normalized_name)` for services; `(dataset_id, source, target)` for edges; `(dataset_id, trace_id, span_id)` for spans. Names are unique **case-insensitively within a dataset**.

**Schema (`database.py`):** old DBs had table-level UNIQUE on `(trace_id, span_id)`. Re-importing sample Jaeger IDs then collided. `ensure_dataset_schema` rebuilds those tables in place and adds columns (`source`, `owner`, `criticality_override`, `failed_service_ids`).

---

## Feature 2 — Jaeger ingest (observed topology)

**Using:** `trace_ingestion.py`, endpoints `POST /api/telemetry/traces` and `POST /api/telemetry/traces/upload`.

Uploads are stored under `data/traces/{ingestion_id}.json`. User filenames are never used as filesystem paths. Max size: `MAX_TRACE_FILE_SIZE_MB` (default 20).

Supported Jaeger fields: `data[].traceID`, `spans[]` (`spanID`, `operationName`, `startTime`, `duration`, `tags`, `references`). Service name from `process.serviceName`, `processID` → `processes`, or tag `service.name`.

### How edges are derived

Parent spans may appear after children. Ingestion:

1. Builds `span_id → service_name` for **all** spans first
2. Then resolves parent → child

`source` = parent service, `target` = child service. Same-service parent/child: no self-edge. That edge means **source calls target**.

Within a dataset, re-uploading the same `(trace_id, span_id)` is skipped (idempotent). A **new** ingest creates a **new** dataset, so the same Jaeger IDs can appear again.

After spans: recompute metrics, health, criticality, circuit breakers, critical edge weights; invalidate graph cache.

---

## Feature 3 — OTLP JSON ingest

**Using:** `otlp_ingestion.py` → maps to Jaeger shape → `ingest_jaeger_payload`.

`POST /api/telemetry/otlp` reads `resourceSpans[].scopeSpans[].spans[]`. Service from resource/span attributes. Duration: nanoseconds → microseconds. `status.code == 2` is treated as error. Sample: `samples/sample_traces_otlp.json`.

---

## Feature 4 — Config-driven topology

**Using:** `topology_service.py`, `POST /api/config/topology` and `/upload` (JSON or YAML).

Payload: `{ "services": [{ name, tier, type, owner }], "dependencies": [{ source, target, critical_weight, protocol }], "mode": "merge" | "replace" }`.

- Upsert by normalized name. Trace-derived **metrics are never overwritten**.
- `Service.source` / `Dependency.source`: `trace` | `config` | `both` (`origin.py`).
- Unknown dependency names → **422**, no placeholder services.
- `mode=replace` only deletes rows whose origin is `config`.
- If no active dataset exists, creates one named “Config topology”.

API-only today (UI is not wired).

---

## Feature 5 — Error and latency rules

A span is failed if:

- tag `error` is true (`true`, `True`, `"true"`, `1`, …), **or**
- `http.status_code` starts with `5`

`404` is **not** an error. Tag types are coerced.

Jaeger `duration` is microseconds. Stored latency is milliseconds: `duration / 1000`.

Per service and per dependency: call/span counts, error rate (`0` if count is `0`), avg/min/max latency, P95/P99 via linear interpolation on sorted samples.

---

## Data model (SQLite)

Default URL: `sqlite:///./weft.db`, resolved to an absolute path under `backend/`.

| Model | Role |
| --- | --- |
| `TelemetryDataset` | Active workspace; ingest activates a new one |
| `Service` | Metrics, health, criticality, `source`, `owner`, `criticality_override` |
| `Dependency` | Directed edge `source → target` with `source` origin |
| `SpanRecord` | Individual spans used to recompute metrics |
| `ServiceOperation` | Operation names for search |
| `ServiceHealthHistory` | Snapshot after every health computation |
| `CriticalitySnapshot` | Explainable score breakdown |
| `TraceIngestion` | Ingest job metadata |
| `CircuitBreakerState` | Simulated breaker per dependency |
| `CircuitBreakerTransition` | Logged state changes |
| `SimulationRun` | Saved result JSON; `failed_service_ids` for multi-fail |
| `IncidentSimulation` | Timeline events |
| `ImpactReport` | Generated markdown/JSON report |

`Service.effective_criticality_score()` returns override if set, else computed score.

---

## Feature 6 — Graph (NetworkX + cache)

**Using:** `graph_service.py`, NetworkX `DiGraph`.

- Node = service in the **active** dataset
- Edge `A → B` = A calls B
- Upstream of X = predecessors (who calls X)
- Downstream of X = successors (who X calls)
- Cycles allowed (`GET /api/graph/validation` reports them as warnings)

**Cache:** module-level, keyed by dataset id, returns `graph.copy()`. Invalidated on ingest, topology, `PATCH /services/{id}`, admin reset/seed, and test `reset_engine()`.

`GET /api/graph?highlight_service_id=...` annotates:

| `status` | Meaning |
| --- | --- |
| `FAILED` | Selected service |
| `DIRECTLY_AFFECTED` | Direct callers |
| `INDIRECTLY_AFFECTED` | Transitive callers |
| `NORMAL` | Not in blast radius |

Impacted edges are marked `IMPACTED`.

**Export:** `GET /api/graph/export?format=graphml|dot`. GraphML via `nx.write_graphml`. DOT written by hand (no pydot). API-only.

---

## Feature 7 — Health

**Using:** `health_service.py`, `config/thresholds.yaml` → `health:`.

```
health_score = clamp(round((1 - error_rate) * 100), 0, 100)
```

| Status | Default rule |
| --- | --- |
| `HEALTHY` | `error_rate < 0.10` |
| `DEGRADED` | `0.10 ≤ error_rate < 0.50` |
| `UNHEALTHY` | `error_rate ≥ 0.50` |

Uses spans inside a sliding window (default 10 seconds, relative to the latest span timestamp for that service). Empty window → all spans. Every recompute writes `ServiceHealthHistory`.

---

## Feature 8 — Criticality (5 factors + override)

**Using:** `criticality_service.py`. Each factor is `0..1` vs dataset max, then weighted. Weights in YAML **must sum to 1.0**. Pydantic `tier_weight` default is `0.0` so old 4-weight files still load.

| Factor | Default weight | Raw value |
| --- | --- | --- |
| Call volume | 0.25 | `total_calls` |
| Error impact | 0.20 | `error_rate` |
| Latency impact | 0.20 | `avg_latency_ms` |
| Dependency impact | 0.20 | in-degree + out-degree |
| Business tier | 0.15 | YAML `tier_scores` (`critical=1.0` … unset = 0) |

```
computed = 100 * Σ (weight_i * normalized_i)
```

`PATCH /api/services/{id}` sets `tier`, `owner`, `service_type`, or `criticality_override` (0–100). Blast radius and “critical services affected” use **effective** score. Rankings sort by effective score desc, then call volume desc, then name asc. Each ranking includes the full breakdown.

---

## Feature 9 — Blast radius

**Using:** `blast_radius_service.py`. `GET /api/blast-radius/{id}`.

Structural: `failed ∪ nx.ancestors(graph, failed)`.

Probabilistic: BFS through **predecessors**, seed failed at `1.0`:

```
caller_impact = failed_impact * edge_weight
```

- Critical edge weight default `0.90`
- Non-critical default `0.50`
- Stop when probability `< 0.10`
- Multiple paths keep the **maximum** probability

Edges are critical when call count is at/above the configured percentile of all edges.

Score:

```
score = 100 * (
  0.40 * affected_ratio
+ 0.35 * mean(impact probabilities)
+ 0.25 * (affected criticality / all criticality)
)
```

The formula string is returned in the response.

---

## Feature 10 — Failure simulation

**Using:** `simulation_service.py`.

| Endpoint | What |
| --- | --- |
| `POST /api/simulate/failure/{id}` | Single failure (UI uses this) |
| `POST /api/simulate/failure` `{ "service_ids": [...] }` | Multi-fail union (API-only) |

Both:

1. Confirm service(s) exist in the active dataset
2. Compute structural + probabilistic blast radius (`analyze_failure_set` for multi)
3. Project caller health: `current * (1 - impact_probability)` (failed → `0`)
4. Rank impacted services; multi-fail adds `caused_by`
5. Predict which caller circuit breakers would open (**does not persist** breaker state)
6. Severity from blast-radius score
7. Save `SimulationRun` + timeline (`failed_service_id` = first id; `failed_service_ids` JSON)
8. **Restore live health** from the snapshot taken at start

Severity defaults: `< 25` LOW, `25–49` MEDIUM, `50–74` HIGH, `≥ 75` CRITICAL.

SSE: `GET /api/simulate/failure/{id}/stream` emits `blast_radius_start`, `service_affected`, `blast_radius_complete`. Computation finishes first; the stream only yields JSON events.

Timeline: `GET /api/simulations/{id}/timeline`.

---

## Feature 11 — Circuit-breaker simulation

**Using:** `circuit_breaker_service.py`. One simulated machine **per dependency**, not a real Resilience4j deployment.

States: `CLOSED` → `OPEN` → `HALF_OPEN` → `CLOSED` or back to `OPEN`.

| Transition | Rule |
| --- | --- |
| CLOSED → OPEN | simulated error rate ≥ 0.50 |
| OPEN → HALF_OPEN | cooldown elapsed (default 30s) |
| HALF_OPEN → CLOSED | simulated health ≥ 80 |
| HALF_OPEN → OPEN | health still below recovery |

`POST /api/circuit-breakers/simulate` **persists** (`kind: real_circuit_transition`). Failure simulation only **predicts** (`kind: predicted_circuit_transition`).

---

## Feature 12 — Reports

`POST /api/reports/generate` with `{ "simulation_id", "format": "json" | "markdown" }`.

Built from the **stored** simulation JSON, not a random recompute. Sections: executive summary, failed service, health, blast radius, affected services, impact ranking, criticality, circuit-breaker predictions, timeline, deterministic recommendations. Files under `storage/reports/`.

---

## Feature 13 — Admin, reset, security

| Endpoint | Gate | Effect |
| --- | --- | --- |
| `POST /api/dev/reset` | `ALLOW_DEV_RESET` (default true) | Truncate all tables. Frontend Settings uses this. |
| `POST /api/admin/reset` | header `X-Admin-Key` == `ADMIN_KEY` | Same wipe. Unset key → 403. |
| `POST /api/admin/seed-sample` | same admin key | Ingests `samples.generate_samples.build_sample_traces` |

Optional `API_KEY`: if set, all non-GET/HEAD/OPTIONS require header `X-API-Key`.

Startup never auto-seeds and never wipes.

---

## REST API

Prefixes: `/api` and `/api/v1` (same routers). Frontend uses `/api`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Process liveness (no DB) |
| GET | `/health/services` | Observed health list |
| GET | `/overview` | Dashboard summary + active dataset |
| GET | `/datasets/active` | Current workspace or null |
| POST | `/telemetry/traces` | Ingest Jaeger JSON (new dataset) |
| POST | `/telemetry/traces/upload` | Upload `.json` file |
| POST | `/telemetry/otlp` | Ingest OTLP JSON |
| GET | `/telemetry/ingestions` | Ingest history |
| GET | `/graph` | Nodes + edges for UI |
| GET | `/graph/validation` | Cycles / orphans |
| GET | `/graph/export` | GraphML or DOT download |
| GET | `/services` | Search + filter + pagination |
| GET | `/services/{id}` | Detail, metrics, criticality |
| PATCH | `/services/{id}` | Metadata / tier / override |
| GET | `/services/{id}/dashboard` | Aggregate for a service page |
| GET | `/services/{id}/upstream` | Direct callers |
| GET | `/services/{id}/downstream` | Direct callees |
| GET | `/services/{id}/health-history` | History with time filters |
| GET | `/criticality/rankings` | Ranked criticality |
| GET | `/criticality/{id}` | One service explanation |
| GET | `/blast-radius/{id}` | Blast radius for a failure |
| POST | `/simulate/failure` | Multi-service failure |
| POST | `/simulate/failure/{id}` | Single failure |
| GET | `/simulate/failure/{id}/stream` | SSE stream |
| GET | `/simulations` | Simulation history |
| GET | `/simulations/{id}` | Saved result |
| GET | `/simulations/{id}/timeline` | Incident timeline |
| GET | `/circuit-breakers` | List simulated breakers |
| GET | `/circuit-breakers/{id}` | One breaker |
| POST | `/circuit-breakers/simulate` | Evaluate state machine |
| POST | `/circuit-breakers/{id}/reset` | Force CLOSED |
| POST | `/circuit-breakers/{id}/transition` | Force a state |
| POST | `/reports/generate` | Markdown/JSON report |
| GET/PUT | `/config/thresholds` | Read/update analysis config |
| POST | `/config/topology` | Declarative topology JSON |
| POST | `/config/topology/upload` | Topology JSON/YAML file |
| POST | `/dev/reset` | Dev wipe |
| POST | `/admin/reset` | Admin wipe |
| POST | `/admin/seed-sample` | Admin sample ingest |
| POST | `/jaeger/test` | Test Jaeger Query API (no dataset) |
| GET | `/jaeger/test` | Same, query-param URL |
| POST | `/jaeger/connect` | Create one live dataset and start polling |
| GET | `/jaeger/status` | Live connection status |
| POST | `/jaeger/disconnect` | Stop polling; keep dataset |
| POST | `/jaeger/reconnect` | Resume polling on the same live dataset |
| GET | `/simulations/{id}/analysis` | Root cause + recommendations |

Service list query params: `q`, `tier`, `type`, `health_status`, `min_health`, `max_health`, `min_risk`, `max_risk`, error/latency/call ranges, `limit`, `offset`. Search matches name, normalized name, and operation names.

Pagination: `{ "items", "total", "limit", "offset" }`.

---

## Configuration

Environment (`.env.example`):

- `DATABASE_URL`
- `CORS_ORIGINS` (never `*` with credentials; credentials are off)
- `TRACE_UPLOAD_DIR`, `REPORT_STORAGE_DIR`
- `MAX_TRACE_FILE_SIZE_MB`, `LOG_LEVEL`, `THRESHOLDS_PATH`
- `ALLOW_DEV_RESET`
- `ADMIN_KEY`, `API_KEY`
- `JAEGER_QUERY_URL` (default `http://localhost:16686`) — **does not auto-connect**
- `JAEGER_POLL_INTERVAL_SECONDS`, `JAEGER_MAX_TRACES_PER_POLL`, `JAEGER_SERVICE_FILTER`

Live Jaeger starts only after `POST /api/jaeger/connect`. Startup does not poll Jaeger.

Analysis knobs live in `config/thresholds.yaml` and are loaded at startup. `PUT /api/config/thresholds` validates weights ≥ 0 and groups that must sum to 1.0, probabilities in `0..1`, health scores in `0..100`, positive durations, and logical ordering.

---

## Sample datasets

Generated by `python samples/generate_samples.py`.

- `sample_traces.json` — 10 services (checkout / auth / order / payment / inventory / db / user / cache / recommendations / notifications), including 4xx and 5xx
- `payment_incident_traces.json` — repeated checkout traces with many payment-gateway failures
- `sample_traces_otlp.json` — same topology in OTLP JSON

Expected graph edges from the normal sample include:

`checkout → payment-gateway`, `checkout → order-service`, `checkout → auth-service`, `order → inventory-service`, `order → db-service`, `payment-gateway → db-service`, `user-service → db-service`, `recommendation-engine → cache-service`, `notification-service → user-service`, `auth-service → user-service`.

---

## Frontend (what is wired vs API-only)

React 18 + Vite + xyflow. Home is the dependency map. Bootstrap uses **active dataset**, so refresh stays empty until import. Sample system is explicit “Load sample” (`/samples/sample_traces.json` via ingest).

**Wired:** import Jaeger JSON, load sample, click a node, inspect, simulate **one** failure, blast highlight, report download, settings/reset (`/api/dev/reset`).

**API-only (no UI yet):** config topology, multi-service fail, OTLP ingest, GraphML/DOT export, admin seed, PATCH metadata/tier.

---

## Tests

`cd backend && pytest` — **94 tests**.

Coverage includes ingest validation, unordered parents, duplicate ingest, mixed tag types, datasets (new import does not merge), schema migration of stale uniques, topology merge/replace/422, graph direction, cycles, GraphML/DOT, cache invalidation, health boundaries, 5-factor criticality + override, blast-radius direction (`B` fails → callers of `B`, not callees), simulation non-mutation, multi-fail max probability, circuit-breaker transitions, admin key, OTLP vs Jaeger topology, CORS, 404, and 422.

CI also runs `ruff check app tests`.

---

## Docker

`backend/Dockerfile`: Python 3.12-slim, `python run.py` on port 8000.

Root `docker-compose.yml` builds that image. Optional Postgres is commented; default remains SQLite.

---

## What is intentionally not implemented

No Kubernetes, Istio, Prometheus, Datadog, Slack, PagerDuty, live Jaeger connection, OpenTelemetry collector process, Redis, required Postgres, OAuth/SSO, ML anomaly detection, auto-remediation, real failover, or real circuit-breaker injection into another process.

UI is not yet wired to topology upload, multi-fail, OTLP, graph export, or PATCH metadata — those endpoints exist and are tested.
