# WEFT Backend Implementation

This document describes what is implemented in the WEFT backend and how it works.

WEFT is a **deterministic analysis and simulation platform**. The only required user input is a Jaeger-format JSON trace file. The backend derives the rest: services, dependencies, health, technical criticality, blast radius, failure simulation, circuit-breaker simulation, incident history, and reports.

It does **not** talk to a live Jaeger server, Kubernetes, Prometheus, or any production traffic path. Simulated failures and circuit breakers never stop real services.

---

## Current status

| Area | Status |
| --- | --- |
| Backend REST API | Implemented |
| SQLite persistence | Implemented |
| Jaeger ingest + graph derivation | Implemented |
| Health, criticality, blast radius | Implemented |
| Failure + circuit-breaker simulation | Implemented |
| Reports, SSE, thresholds API | Implemented |
| Automated tests | 57 tests, passing |
| Frontend | Not implemented (`frontend/.gitkeep` only) |

---

## How a request flows

```
Frontend / curl
    → FastAPI route (thin)
        → service layer (algorithms)
            → SQLAlchemy models (source of truth)
            → NetworkX DiGraph (compute only)
        → Pydantic schema
    → JSON response
```

Routes never return ORM objects. Every endpoint has a Pydantic `response_model`.

Startup (`app/main.py`):

1. Load settings from environment / `.env`
2. Configure logging
3. Create SQLite tables (`Base.metadata.create_all`)
4. Load `config/thresholds.yaml`
5. Register CORS and exception handlers
6. Mount all `/api` routers

---

## Layout

```
weft/
├── backend/
│   ├── app/
│   │   ├── main.py                 # FastAPI factory
│   │   ├── api/routes/            # HTTP endpoints
│   │   ├── core/                 # settings, logging, exceptions
│   │   ├── config/thresholds.py    # YAML loader + validation
│   │   ├── db/models/             # SQLAlchemy 2.x models
│   │   ├── schemas/              # Pydantic v2 response models
│   │   └── services/             # algorithms
│   ├── config/thresholds.yaml
│   ├── samples/                 # sample Jaeger JSON
│   ├── tests/
│   ├── run.py
│   └── requirements.txt
└── frontend/                    # empty placeholder
```

---

## Input: Jaeger JSON

Two equivalent ingest paths share `app/services/trace_ingestion.py`:

| Method | Endpoint |
| --- | --- |
| File upload | `POST /api/telemetry/traces/upload` |
| Raw JSON body | `POST /api/telemetry/traces` |

Uploads are stored under `data/traces/` with a generated filename (`{ingestion_id}.json`). User-supplied names are never used as filesystem paths. Max size is `MAX_TRACE_FILE_SIZE_MB` (default 20).

Supported Jaeger fields:

- `data[].traceID`
- `data[].spans[]` with `spanID`, `operationName`, `startTime`, `duration`, `tags`, `references`
- service name from `process.serviceName`, `processID` → `processes`, or tag `service.name`

### How dependencies are derived

Parent spans may appear before or after children. Ingestion therefore:

1. Build `span_id → service_name` for **all** spans first
2. Then resolve parent-child pairs

For each child span:

- `source` = parent span’s service
- `target` = current span’s service
- if they differ, create/update `source → target`

That edge means **source calls target**. Same-service parent/child does not create a self-edge.

Re-uploading the same `(trace_id, span_id)` is idempotent. Duplicate spans are skipped.

---

## Error and latency rules

A span is failed if:

- tag `error` is true (`true`, `True`, `"true"`, `1`, …), **or**
- `http.status_code` starts with `5`

`404` is **not** an error. Tag types are coerced so mixed string/int/bool values do not crash.

Jaeger `duration` is microseconds. Stored latency is milliseconds: `duration / 1000`.

Per service and per dependency the backend stores:

- call/span counts
- error count and error rate (`0` if count is `0`)
- avg / min / max latency
- P95 / P99 via linear interpolation on sorted samples

---

## Data model (SQLite)

Default URL: `sqlite:///./weft.db`, resolved to an absolute path under `backend/` so different working directories do not create extra databases.

| Model | Role |
| --- | --- |
| `Service` | Discovered service + aggregated metrics, health, criticality |
| `Dependency` | Directed edge `source → target` with unique `(source, target)` |
| `SpanRecord` | Individual spans used to recompute metrics |
| `ServiceOperation` | Operation names for search |
| `ServiceHealthHistory` | Snapshot after every health computation |
| `CriticalitySnapshot` | Explainable score breakdown |
| `TraceIngestion` | Ingest job metadata |
| `CircuitBreakerState` | Simulated breaker per dependency |
| `CircuitBreakerTransition` | Logged state changes |
| `SimulationRun` | Saved failure-simulation result JSON |
| `IncidentSimulation` | Timeline events |
| `ImpactReport` | Generated markdown/JSON report |

Service names are unique after case-insensitive normalization (`Payment-Service` and `payment-service` are the same row).

---

## Graph

`app/services/graph_service.py` builds a NetworkX `DiGraph` from the database on demand. The database is the source of truth; NetworkX is discarded after the request.

- **Node** = service
- **Edge** `A → B` means A calls B
- **Upstream of X** = predecessors (who calls X)
- **Downstream of X** = successors (who X calls)
- Cycles are allowed (`GET /api/graph/validation` reports them as warnings)

`GET /api/graph?highlight_service_id=...` annotates nodes for UI highlighting:

| `status` | Meaning |
| --- | --- |
| `FAILED` | Selected service |
| `DIRECTLY_AFFECTED` | Direct callers |
| `INDIRECTLY_AFFECTED` | Transitive callers |
| `NORMAL` | Not in blast radius |

Impacted edges are marked `IMPACTED`.

---

## Health

`app/services/health_service.py`

```
health_score = clamp(round((1 - error_rate) * 100), 0, 100)
```

| Status | Default rule |
| --- | --- |
| `HEALTHY` | `error_rate < 0.10` |
| `DEGRADED` | `0.10 ≤ error_rate < 0.50` |
| `UNHEALTHY` | `error_rate ≥ 0.50` |

Health uses spans inside a sliding window (default 10 seconds, relative to the latest span timestamp in that service). If the window is empty, all spans are used. Every recomputation writes a `ServiceHealthHistory` row.

---

## Technical criticality

Jaeger has no business-tier metadata, so scoring is technical only.

Each factor is normalized to `0..1` against the current dataset max, then weighted:

| Factor | Default weight | Raw value |
| --- | --- | --- |
| Call volume | 0.30 | `total_calls` |
| Error impact | 0.25 | `error_rate` |
| Latency impact | 0.25 | `avg_latency_ms` |
| Dependency impact | 0.20 | in-degree + out-degree |

```
score = 100 * (0.30*call_norm + 0.25*error_norm + 0.25*latency_norm + 0.20*dep_norm)
```

Every ranking includes the full breakdown (`weight`, `raw_value`, `normalized_score`, `contribution`). Rankings sort by score desc, then call volume desc, then name asc.

---

## Blast radius

If `A → B` and **B fails**, **A is affected**. Downstream callees of B are not.

Structural radius: `nx.ancestors(graph, failed_service)` plus the failed service itself.

Probabilistic radius: BFS through **predecessors**, starting at probability `1.0`:

```
caller_impact = failed_impact * edge_weight
```

- Critical edge weight default `0.90`
- Non-critical edge weight default `0.50`
- Stop when probability `< 0.10`
- Multiple paths keep the **maximum** probability

Edges are treated as critical when their call count is at/above the configured percentile of all edges.

Blast-radius score (0..100):

```
score = 100 * (
  0.40 * affected_ratio
+ 0.35 * mean(impact probabilities)
+ 0.25 * (affected criticality / all criticality)
)
```

The formula is returned in the response.

---

## Failure simulation

`POST /api/simulate/failure/{service_id}` is analysis only.

It:

1. Confirms the service exists
2. Computes structural + probabilistic blast radius
3. Projects caller health: `current * (1 - impact_probability)` (failed service → `0`)
4. Ranks impacted services
5. Predicts which caller circuit breakers would open
6. Assigns severity from blast-radius score
7. Saves `SimulationRun` + timeline events
8. **Restores live service health** so the database is unchanged

Severity defaults:

| Score | Severity |
| --- | --- |
| `< 25` | `LOW` |
| `25–49` | `MEDIUM` |
| `50–74` | `HIGH` |
| `≥ 75` | `CRITICAL` |

SSE: `GET /api/simulate/failure/{service_id}/stream` emits `blast_radius_start`, `service_affected`, `blast_radius_complete`. Computation finishes first; the stream only yields JSON events.

Timeline: `GET /api/simulations/{id}/timeline`

---

## Circuit-breaker simulation

This is a state machine on a **dependency**, not a real Resilience4j deployment.

States: `CLOSED` → `OPEN` → `HALF_OPEN` → `CLOSED` or back to `OPEN`.

| Transition | Rule |
| --- | --- |
| CLOSED → OPEN | simulated error rate ≥ threshold (default 0.50) |
| OPEN → HALF_OPEN | cooldown elapsed (default 30s) |
| HALF_OPEN → CLOSED | simulated health ≥ recovery threshold (default 80) |
| HALF_OPEN → OPEN | health still below recovery |

`POST /api/circuit-breakers/simulate` **persists** the transition (`kind: real_circuit_transition`).

Failure simulation only **predicts** opens on caller edges (`kind: predicted_circuit_transition`) and does not flip stored breaker state.

---

## Reports

`POST /api/reports/generate` with `{ "simulation_id", "format": "json" | "markdown" }`.

Reports are built from the **stored** simulation JSON, not recomputed randomly. Sections: executive summary, failed service, health, blast radius, affected services, impact ranking, criticality, circuit-breaker predictions, timeline, deterministic recommendations.

Files are written under `storage/reports/`.

---

## REST API

All JSON errors look like:

```json
{
  "error": {
    "code": "SERVICE_NOT_FOUND",
    "message": "Service '…' was not found",
    "details": {}
  }
}
```

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Process liveness (no DB) |
| GET | `/api/health/services` | Observed health list |
| GET | `/api/overview` | Dashboard summary |
| POST | `/api/telemetry/traces` | Ingest Jaeger JSON |
| POST | `/api/telemetry/traces/upload` | Upload `.json` file |
| GET | `/api/telemetry/ingestions` | Ingest history |
| GET | `/api/graph` | Nodes + edges for UI |
| GET | `/api/graph/validation` | Cycles / orphans |
| GET | `/api/services` | Search + filter + pagination |
| GET | `/api/services/{id}` | Detail, metrics, criticality |
| GET | `/api/services/{id}/dashboard` | Aggregate for a service page |
| GET | `/api/services/{id}/upstream` | Direct callers |
| GET | `/api/services/{id}/downstream` | Direct callees |
| GET | `/api/services/{id}/health-history` | History with time filters |
| GET | `/api/criticality/rankings` | Ranked technical criticality |
| GET | `/api/criticality/{id}` | One service explanation |
| GET | `/api/blast-radius/{id}` | Blast radius for a failure |
| POST | `/api/simulate/failure/{id}` | Failure simulation |
| GET | `/api/simulate/failure/{id}/stream` | SSE stream |
| GET | `/api/simulations` | Simulation history |
| GET | `/api/simulations/{id}` | Saved result |
| GET | `/api/simulations/{id}/timeline` | Incident timeline |
| GET | `/api/circuit-breakers` | List simulated breakers |
| GET | `/api/circuit-breakers/{id}` | One breaker |
| POST | `/api/circuit-breakers/simulate` | Evaluate state machine |
| POST | `/api/circuit-breakers/{id}/reset` | Force CLOSED |
| POST | `/api/circuit-breakers/{id}/transition` | Force a state |
| POST | `/api/reports/generate` | Markdown/JSON report |
| GET/PUT | `/api/config/thresholds` | Read/update analysis config |

Service list query params: `q`, `tier`, `type`, `health_status`, `min_health`, `max_health`, `min_risk`, `max_risk`, error/latency/call ranges, `limit`, `offset`. Search matches name, normalized name, and operation names.

Pagination shape: `{ "items", "total", "limit", "offset" }`.

Interactive docs: `/docs` and `/redoc`.

---

## Configuration

Environment (`.env.example`):

- `DATABASE_URL`
- `CORS_ORIGINS` (never `*` with credentials; credentials are off)
- `TRACE_UPLOAD_DIR`
- `REPORT_STORAGE_DIR`
- `MAX_TRACE_FILE_SIZE_MB`
- `LOG_LEVEL`

Analysis knobs live in `config/thresholds.yaml` and are loaded at startup. `PUT /api/config/thresholds` validates:

- weights ≥ 0 and groups that must sum to 1.0
- probabilities in `0..1`
- health scores in `0..100`
- positive durations
- logical ordering (e.g. degraded ≤ critical)

---

## Sample datasets

Generated by `python samples/generate_samples.py`.

- `sample_traces.json` — 10 services, checkout / auth / order / payment / inventory / db / user / cache / recommendations / notifications, including 4xx and 5xx
- `payment_incident_traces.json` — repeated checkout traces with many payment-gateway failures

Expected graph edges from the normal sample include:

`checkout → payment-gateway`, `checkout → order-service`, `checkout → auth-service`, `order → inventory-service`, `order → db-service`, `payment-gateway → db-service`, `user-service → db-service`, `recommendation-engine → cache-service`, `notification-service → user-service`, `auth-service → user-service`.

---

## Tests

`cd backend && pytest`

Coverage includes ingest validation, unordered parents, duplicate ingest, mixed tag types, graph direction, cycles, health boundaries, criticality determinism, blast-radius direction (`B` fails → callers of `B`, not callees), simulation non-mutation, circuit-breaker transitions, CORS, 404, and 422.

---

## What is intentionally not implemented

No Kubernetes, Istio, Prometheus, Datadog, Slack, PagerDuty, live Jaeger connection, OpenTelemetry collector, Redis, Postgres requirement, OAuth/SSO, ML anomaly detection, auto-remediation, real failover, or real circuit-breaker injection into another process.

The frontend is not built yet. The API is designed so a React UI can upload a trace, render `GET /api/graph`, click a node, simulate failure, highlight blast radius, show the timeline, and generate a report without reimplementing any scoring.
