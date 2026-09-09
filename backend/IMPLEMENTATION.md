# WEFT Backend Implementation

This document describes **what is implemented**, **how it works**, and **what it uses**.

WEFT is a **deterministic dependency-graph blast-radius analyzer**. You import telemetry (Jaeger JSON or OTLP JSON), declare a topology, or **manually connect** to a Jaeger Query API. The backend derives services, edges, health, criticality, blast radius, failure simulation, circuit-breaker simulation, root-cause ranking, recommendations, and reports.

It does **not** talk to Kubernetes, Prometheus, or production traffic. Simulated failures never stop real services and do not mutate live health. Live Jaeger is **user-initiated only**: startup never seeds data and never opens a Jaeger connection, even if `JAEGER_QUERY_URL` is set.

**Graph rule (do not reverse):** edge `A → B` means A calls B. If B fails, A is affected (`nx.ancestors`). Callees of B are not in the blast radius just because they are called.

---

## Current status

| Area | Status |
| --- | --- |
| FastAPI REST API (`/api` and `/api/v1`) | Implemented |
| SQLite persistence + additive schema migration | Implemented |
| Dataset-scoped workspace (empty until import or connect) | Implemented |
| Jaeger JSON ingest + graph derivation | Implemented |
| OTLP JSON ingest | Implemented |
| Config-driven topology (JSON/YAML) | Implemented |
| Health, 5-factor criticality, blast radius | Implemented |
| Single + multi-service failure simulation | Implemented |
| Circuit-breaker simulation | Implemented |
| Deterministic root cause + recommendations | Implemented |
| Reports (include RCA), SSE, thresholds API | Implemented |
| Graph cache, GraphML/DOT export | Implemented |
| Admin reset/seed, optional API key | Implemented |
| Live Jaeger Query API (manual connect, poll, replace-window) | Implemented |
| Docker + GitHub Actions CI | Implemented |
| Automated tests | 98 pytest tests |
| React frontend (Vite + xyflow) | Implemented; live Jaeger + RCA wired |

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
| Live Jaeger HTTP | httpx (sync client; 4s timeout on the live loop) |
| Tests / lint | pytest, httpx, respx, ruff |
| Frontend (separate package) | React 18, Vite, xyflow |
| Packaging | `backend/Dockerfile`, root `docker-compose.yml` |
| CI | GitHub Actions: pytest + ruff on Python 3.12 |

Run locally: `cd backend && python run.py` (Uvicorn, host `0.0.0.0`, port `8000`, reload). Interactive docs: `/docs`, `/redoc`. Frontend: `cd frontend && npm run dev` (Vite, typically `5173`–`5175`; `/api` is proxied to `8000`).

---

## How a request flows

```
UI / curl
    → FastAPI route (thin, Pydantic response_model)
        → service layer (ingest, health, criticality, blast radius, simulation, live Jaeger)
            → SQLite (source of truth)
            → NetworkX DiGraph (compute only; copy of an in-process cache)
        → Pydantic schema
    → JSON
```

Routes never return ORM objects. Errors are always:

```json
{ "error": { "code": "SERVICE_NOT_FOUND", "message": "…", "details": {} } }
```

Unhandled exceptions become `500` with `INTERNAL_SERVER_ERROR` / `"An unexpected error occurred"` (`app/api/errors.py`). Jaeger reachability failures are `502` / `JAEGER_UNAVAILABLE`.

Startup (`app/main.py` lifespan):

1. Load settings from environment / `.env`
2. Configure logging
3. `create_all` + `ensure_dataset_schema` (additive ALTERs; rebuild tables with stale uniques)
4. Load `config/thresholds.yaml`
5. CORS (credentials off) + exception handlers
6. Global write-API-key dependency (no-op if `API_KEY` unset)
7. Mount the same routers at `/api` and `/api/v1`
8. **Do not** connect to Jaeger and **do not** seed traces
9. On shutdown: `LiveJaegerManager.shutdown()` stops the poll loop if it is running

---

## Layout

```
weft/
├── backend/
│   ├── app/
│   │   ├── main.py                 # FastAPI factory; dual /api + /api/v1
│   │   ├── api/routes/            # HTTP endpoints (including jaeger.py)
│   │   ├── api/errors.py          # JSON error envelope
│   │   ├── core/                  # settings, logging, exceptions, security
│   │   ├── config/thresholds.py   # YAML loader + Pydantic validation
│   │   ├── db/models/             # SQLAlchemy 2.x models
│   │   ├── db/database.py         # engine, sessions, schema migration
│   │   ├── schemas/               # Pydantic v2 response models
│   │   └── services/               # algorithms
│   │       ├── jaeger_client.py          # Jaeger Query HTTP
│   │       ├── live_jaeger_ingestion.py   # connect / poll / refresh
│   │       ├── trace_ingestion.py        # Jaeger JSON + live replace/prune
│   │       ├── root_cause_service.py
│   │       └── recommendation_service.py
│   ├── config/thresholds.yaml
│   ├── samples/                   # Jaeger + OTLP sample JSON
│   ├── tests/
│   ├── Dockerfile
│   ├── ruff.toml
│   ├── run.py
│   └── requirements.txt
├── frontend/                      # React workspace (consumes /api)
├── docker-compose.yml
└── .github/workflows/ci.yml
```

---

## Feature 1 — Empty workspace until import (datasets)

**Why:** SQLite used to look like “the system” on refresh. A new **manual** import must **replace** the on-screen graph, not merge with leftover rows. Live polling is the exception: it keeps **one** dataset and rebuilds it.

**How (`dataset_service.py`):**

- Each Jaeger/OTLP **manual** ingest calls `create_and_activate_dataset`, which marks every other `TelemetryDataset` inactive.
- Live Connect also creates **one** dataset (`Live Jaeger - {YYYY-MM-DD HH:MM}`) and activates it. Later polls pass that `dataset_id` and do **not** create another dataset.
- Graph, services, overview, simulation, and blast-radius queries are scoped to `is_active` dataset id.
- `GET /api/datasets/active` returns `null` when nothing is activated.
- Legacy rows with `dataset_id = NULL` are hidden.
- Startup does **not** wipe the DB.

**Uniqueness:** `(dataset_id, normalized_name)` for services; `(dataset_id, source, target)` for edges; `(dataset_id, trace_id, span_id)` for spans. Names are unique **case-insensitively within a dataset**.

**Schema (`database.py`):** old DBs had table-level UNIQUE on `(trace_id, span_id)`. Re-importing sample Jaeger IDs then collided. `ensure_dataset_schema` rebuilds those tables in place and adds columns (`source`, `owner`, `criticality_override`, `failed_service_ids`). SQLite connections use `check_same_thread=False` and a 30s busy timeout so live poll threads can share the file.

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

Within a dataset, re-uploading the same `(trace_id, span_id)` is skipped (idempotent). A **new manual ingest** creates a **new** dataset (and **stops** live polling via `get_live_manager().stop_sync()`), so the same Jaeger IDs can appear again.

After spans: recompute metrics **once** for the dataset (not once per trace), then health, criticality, circuit breakers, critical edge weights; invalidate graph cache.

### Manual import vs live replace

`ingest_jaeger_payload(..., dataset_id=None, replace=False)` is the manual path: new dataset, append-style skip of duplicate span IDs.

`ingest_jaeger_payload(..., dataset_id=<live id>, replace=True, keep_service_names=[...])` is the live path:

1. Delete all `span_records` for that dataset (`_replace_dataset_spans`)
2. Re-process traces from the current lookback window
3. Ensure a `Service` row exists for every name in Jaeger’s current `/api/services` list (`_ensure_named_services`), even if that service has **no traces** in the window
4. `_prune_stale_topology`: drop zero-call **trace** edges; drop services that Jaeger no longer lists (unless they are `source=config` or referenced by `SimulationRun.failed_service_id`). Circuit-breaker rows and incident rows that would block the delete are removed first
5. Recount services/dependencies, then health / criticality / breakers as usual

A poll that returns **zero traces** does **not** wipe spans. It calls `sync_live_catalog` instead: ensure catalog names, prune names missing from Jaeger, recompute health/criticality. The last known edges stay until a later poll has traces.

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

Per service and per dependency: call/span counts, error rate (`0` if count is `0`), avg/min/max latency, P95/P99 via linear interpolation on sorted samples. Live ingest loads all dataset spans in **one** query, then aggregates in memory.

---

## Data model (SQLite)

Default URL: `sqlite:///./weft.db`, resolved to an absolute path under `backend/`.

| Model | Role |
| --- | --- |
| `TelemetryDataset` | Active workspace; ingest activates a new one; live Connect reuses one |
| `Service` | Metrics, health, criticality, `source`, `owner`, `criticality_override` |
| `Dependency` | Directed edge `source → target` with `source` origin |
| `SpanRecord` | Individual spans used to recompute metrics |
| `ServiceOperation` | Operation names for search |
| `ServiceHealthHistory` | Snapshot after every health computation |
| `CriticalitySnapshot` | Explainable score breakdown |
| `TraceIngestion` | Ingest job metadata (including `live-jaeger-poll.json`) |
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
- Catalog-only live services (listed by Jaeger, no recent spans) appear as **orphan nodes**

**Cache:** module-level, keyed by dataset id, returns `graph.copy()`. Invalidated on ingest, live replace/prune, topology, `PATCH /services/{id}`, admin reset/seed, and test `reset_engine()`.

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

Uses spans inside a sliding window (default 10 seconds, relative to the latest span timestamp for that service). Empty window → all spans. Catalog-only services with zero spans stay HEALTHY 100. Every recompute writes `ServiceHealthHistory`.

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

Live polling does not mutate simulation health. If a live prune would delete a service that is `SimulationRun.failed_service_id`, that service is kept.

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

Built from the **stored** simulation JSON plus `analyze_root_cause` and `build_recommendations`. Sections: executive summary, failed service, health, blast radius, affected services, impact ranking, criticality, circuit-breaker predictions, timeline, **Root Cause**, recommendations. Files under `storage/reports/`.

---

## Feature 13 — Admin, reset, security

| Endpoint | Gate | Effect |
| --- | --- | --- |
| `POST /api/dev/reset` | `ALLOW_DEV_RESET` (default true) | Truncate all tables. Frontend Settings uses this. |
| `POST /api/admin/reset` | header `X-Admin-Key` == `ADMIN_KEY` | Same wipe. Unset key → 403. |
| `POST /api/admin/seed-sample` | same admin key | Ingests `samples.generate_samples.build_sample_traces` |

Optional `API_KEY`: if set, all non-GET/HEAD/OPTIONS require header `X-API-Key`.

Startup never auto-seeds and never wipes. Dev reset also disconnects live Jaeger if the frontend calls disconnect first.

---

## Feature 14 — Live Jaeger Query API

**Using:** `jaeger_client.py`, `live_jaeger_ingestion.py`, routes under `/api/jaeger`.

This is **not** an OpenTelemetry collector and does **not** control production. WEFT only **reads** the Jaeger Query HTTP JSON API.

### Client (`jaeger_client.py`)

- Normalizes the base URL (strip trailing `/`).
- `GET /api/services` → service catalog.
- `GET /api/traces` with **`start` and `end` in microseconds**, plus `service` and `limit`. The Query API’s `lookback` query param is **not** sent (it 400s or returns empty on many builds).
- Lookback strings (`1m`, `5m`, `15m`, `1h`, `1d`, or integer seconds) are converted locally to a `start`/`end` window.
- Connect/timeouts: live manager uses a 4s HTTP timeout.

### Manager (`LiveJaegerManager` singleton)

In-process only. Reload of Uvicorn wipes manager state; SQLite datasets remain.

| Action | Behavior |
| --- | --- |
| `POST /jaeger/test` | `get_services()` only. **No dataset.** |
| `POST /jaeger/connect` | Test Jaeger, create **one** dataset, first poll, start asyncio loop. Duplicate Connect to the **same URL** while running does **not** 409: it updates settings and polls again (`201`). |
| `POST /jaeger/refresh` | Poll now on the existing live dataset. 422 if not connected. |
| `GET /jaeger/status` | Snapshot: running flag, URL, last poll, traces in **this** window, catalog, `poll_generation`, graph counts, lookback, errors. |
| `POST /jaeger/disconnect` | Stop the loop. **Keep** the dataset and graph. |
| `POST /jaeger/reconnect` | Resume on the same `dataset_id` (`resume=True`). |

Connect payload (defaults):

| Field | Default | Notes |
| --- | --- | --- |
| `jaeger_url` | settings `JAEGER_QUERY_URL` | e.g. `http://localhost:16686` |
| `poll_interval` | 5 (min 5, max 3600) | Seconds between background polls |
| `max_traces_per_poll` | 50 | Split **fairly** across listed services (`max(1, limit // n)`) so later services are not starved |
| `service_filter` | all | Comma-separated names; `all` / empty = every Jaeger service |
| `lookback` | `5m` | Window used for `start`/`end` |
| `resume` | false | Reconnect path only |

### Poll pipeline (one cycle)

1. Bump an **epoch**. Fetch `/api/services` and traces **outside** the ingest lock (Jaeger HTTP must not block SQLite).
2. Under a threading lock: if this epoch is no longer the latest, **drop** the snapshot (prevents an old 7-service fetch from overwriting a newer 2-service reload).
3. If traces exist: `ingest_jaeger_payload(..., replace=True, keep_service_names=targets)`.
4. If traces are empty: `sync_live_catalog` only (do not delete spans).
5. `session.commit()`, then publish `poll_generation`, `last_poll_time`, `graph_service_count`, `graph_dependency_count`. Status is published **after** commit so `GET /graph` cannot race a generation bump against uncommitted rows.
6. Background loop: `asyncio.to_thread` + own SQLAlchemy session. Connect/refresh also poll in a worker thread so the event loop is not blocked on httpx.

If the **active** dataset is no longer the live one (user imported a file), the manager stops.

### What the map shows vs Jaeger UI

- **Nodes** = Jaeger `/api/services` (plus any services that appear in this window’s traces and are still in that list).
- **Edges** = parent→child from traces in the lookback window.
- A service that is listed but has no traces yet (e.g. `auth-service` just brought back) is an isolated node until traffic creates spans.
- A service **removed from Jaeger’s catalog** is pruned on the next successful poll, even if old spans would have kept it.
- Jaeger’s own UI may show fewer names if it is filtered to a search that has no traces; WEFT follows `/api/services` + the lookback traces it actually fetched.

---

## Feature 15 — Root cause and recommendations

**Using:** `root_cause_service.py`, `recommendation_service.py`, `GET /api/simulations/{id}/analysis`.

Deterministic scoring over the **already stored** simulation + live (non-mutated) service metrics. No ML.

Root-cause points (summed; candidates with score `≤ 0` dropped; top 8 returned):

| Condition | Points |
| --- | --- |
| This is the simulated failed service | +50 |
| UNHEALTHY | +25 |
| DEGRADED | +10 |
| Error rate ≥ critical threshold | +20 |
| Error rate ≥ degraded threshold | +8 |
| Latency ≥ very-high | +8 |
| Latency ≥ high | +4 |
| Effective criticality ≥ configured min | +8 |
| Upstream callers in the blast radius | +6 |
| Callee of the failed service and not HEALTHY | +4 |

Confidence: High if failed / error_rate ≥ 0.5 / health 0; Medium if score ≥ 25 or DEGRADED; else Low.

Recommendations are rule-based strings with evidence dicts: high/medium error rate, latency, blast-radius size, predicted breaker transitions, many critical/direct callers. If nothing trips, a LOW “continue monitoring” item is returned. **Simulation only — never executes** a breaker or a deploy.

The inspector loads this after a simulate. Reports embed the same analysis.

---

## REST API

Prefixes: `/api` and `/api/v1` (same routers). Frontend uses `/api`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Process liveness (no DB) |
| GET | `/health/services` | Observed health list |
| GET | `/overview` | Dashboard summary + active dataset |
| GET | `/datasets/active` | Current workspace or null |
| POST | `/telemetry/traces` | Ingest Jaeger JSON (**new** dataset; stops live poll) |
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
| GET | `/simulations/{id}/analysis` | Root cause + recommendations |
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
| POST | `/jaeger/connect` | Create one live dataset and start polling (`201`) |
| POST | `/jaeger/refresh` | Poll now; same dataset (`200`; `422` if disconnected) |
| GET | `/jaeger/status` | Live connection status |
| POST | `/jaeger/disconnect` | Stop polling; keep dataset |
| POST | `/jaeger/reconnect` | Resume polling on the same live dataset |

Service list query params: `q`, `tier`, `type`, `health_status`, `min_health`, `max_health`, `min_risk`, `max_risk`, error/latency/call ranges, `limit`, `offset`. Search matches name, normalized name, and operation names.

Pagination: `{ "items", "total", "limit", "offset" }`.

---

## Configuration

Environment (`.env.example`):

- `DATABASE_URL`
- `CORS_ORIGINS` (includes Vite `5173`–`5175`; never `*` with credentials; credentials are off)
- `TRACE_UPLOAD_DIR`, `REPORT_STORAGE_DIR`
- `MAX_TRACE_FILE_SIZE_MB`, `LOG_LEVEL`, `THRESHOLDS_PATH`
- `ALLOW_DEV_RESET`
- `ADMIN_KEY`, `API_KEY`
- `JAEGER_QUERY_URL` (default `http://localhost:16686`) — **does not auto-connect**
- `JAEGER_POLL_INTERVAL_SECONDS`, `JAEGER_MAX_TRACES_PER_POLL`, `JAEGER_SERVICE_FILTER` — defaults for settings; the Connect payload overrides them

Live Jaeger starts only after `POST /api/jaeger/connect`. Startup does not poll Jaeger.

Connect/UI defaults that matter for “how live it feels”: poll **5s**, lookback **5m**. Env `JAEGER_POLL_INTERVAL_SECONDS` default remains 30 for the settings object; the API schema default for a connect body is 5.

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

React 18 + Vite + xyflow. Home is the dependency map. Bootstrap uses **active dataset**, so refresh stays empty until import or Connect. Sample system is explicit “Load sample” (`/samples/sample_traces.json` via ingest).

**Wired:**

- Import Jaeger JSON (stops live poll, new dataset)
- Load sample
- Connect / Test / Refresh now / Disconnect / Reconnect
- Live header (status, last poll, graph service count)
- Status poll ~2s while `is_running`; graph refresh when `poll_generation` / catalog / counts change
- Stale graph HTTP responses are ignored (`refreshSeq`) so an older fetch cannot roll the map backward
- Graph canvas always mounted in a sized frame; `fitView` after nodes initialize
- Click a node, inspect, simulate **one** failure, blast highlight, incident RCA in the inspector, report download
- Settings: live status + `/api/dev/reset`

**API-only (no UI yet):** config topology, multi-service fail, OTLP ingest, GraphML/DOT export, admin seed, PATCH metadata/tier.

---

## Tests

`cd backend && pytest` — **98 tests**.

Coverage includes ingest validation, unordered parents, duplicate ingest, mixed tag types, datasets (new import does not merge), schema migration of stale uniques, topology merge/replace/422, graph direction, cycles, GraphML/DOT, cache invalidation, health boundaries, 5-factor criticality + override, blast-radius direction (`B` fails → callers of `B`, not callees), simulation non-mutation, multi-fail max probability, circuit-breaker transitions, admin key, OTLP vs Jaeger topology, CORS, 404, 422,

and live Jaeger: no auto-connect, test does not create a dataset, connect creates one live dataset, refresh does not 500 / does not create a dataset, disconnected refresh is 422, polls reuse the same dataset and re-ingest the window, a service missing from Jaeger’s catalog is dropped, a catalog-only service (no traces) is added, empty trace polls do not wipe the graph, new services in the window appear, disconnect keeps the dataset, reconnect reuses it, Jaeger down is 502, simulation after live ingest still restores health, manual import replaces the live workspace, traces queries send `start`/`end` not `lookback`, root-cause ranks the failed service, recommendations are evidence-backed.

CI also runs `ruff check app tests`.

---

## Docker

`backend/Dockerfile`: Python 3.12-slim, `python run.py` on port 8000.

Root `docker-compose.yml` builds that image. Optional Postgres is commented; default remains SQLite.

---

## What is intentionally not implemented

No Kubernetes, Istio, Prometheus, Datadog, Slack, PagerDuty, OpenTelemetry collector **process**, Redis, required Postgres, OAuth/SSO, ML anomaly detection, auto-remediation, real failover, or real circuit-breaker injection into another process.

Live Jaeger is **read-only Query API polling** after the user clicks Connect. It does not instrument apps, does not write traces, and does not start on boot.

UI is not yet wired to topology upload, multi-fail, OTLP, graph export, or PATCH metadata — those endpoints exist and are tested.
