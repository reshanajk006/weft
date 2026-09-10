# WEFT

WEFT is a **deterministic service-dependency blast-radius analyzer**. Import Jaeger JSON (or OTLP JSON), optionally connect to a Jaeger Query API, and WEFT reconstructs the call graph, scores health and technical criticality, and lets you **simulate** a service failure.

It does **not** talk to Kubernetes, Prometheus, or production traffic. Simulated failures never stop real services and never mutate live health. Live Jaeger is **user-initiated only**: startup never seeds data and never opens a Jaeger connection, even if `JAEGER_QUERY_URL` is set.

**Graph rule:** edge `A → B` means A **calls** B. If B fails, A is in the blast radius (`nx.ancestors`). Callees of B are not affected just because they are called.

---

## Repository layout

```
weft/
├── backend/                 # FastAPI + SQLite + NetworkX
│   ├── app/                 # API, services, schemas, models
│   ├── config/thresholds.yaml
│   ├── samples/             # Jaeger and OTLP sample traces
│   ├── tests/
│   ├── IMPLEMENTATION.md   # Algorithms, endpoints, and behavior
│   └── README.md
├── frontend/                # React 18 + Vite + xyflow
├── docker-compose.yml       # Backend container on port 8000
└── .github/workflows/ci.yml
```

---

## What it does

| Capability | Notes |
| --- | --- |
| Jaeger JSON ingest | New dataset per manual import; replaces the on-screen graph |
| OTLP JSON ingest | Mapped into the same ingest path |
| Live Jaeger Query API | Connect / poll / refresh / disconnect; one live dataset |
| Health | Error-rate windows → HEALTHY / DEGRADED / UNHEALTHY |
| Technical criticality | Five weighted factors + optional override |
| Blast radius | Structural ancestors + probabilistic walk along callers |
| Failure simulation | Single (UI) or multi-service (API); restores live health |
| Circuit-breaker simulation | Predicted or persisted state machine per dependency |
| Hypothetical RCA | Simulation target is **not** a confirmed root cause |
| Observed RCA | Five-factor ranking from stored telemetry |
| Recommendations | CONTAINMENT / FALLBACK / RECOVERY / PREVENTION; never auto-executed |
| Virtual mitigation | FALLBACK what-if on a graph **copy**; not persisted |
| Reports | Markdown or JSON from a stored simulation |

---

## Requirements

- **Python 3.11+** (CI uses 3.12)
- **Node.js 20+** (for the UI)
- No Docker, Kubernetes, Redis, or PostgreSQL is required for local use

---

## Quick start

### 1. Backend

```bash
cd backend
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
copy .env.example .env    # Windows
# cp .env.example .env     # macOS / Linux

python run.py
```

API: [http://localhost:8000](http://localhost:8000)  
Swagger: [http://localhost:8000/docs](http://localhost:8000/docs)  
ReDoc: [http://localhost:8000/redoc](http://localhost:8000/redoc)

SQLite (`weft.db`) is created under `backend/` on first start.

### 2. Frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) (Vite uses the next free port if 5173 is taken). Vite proxies `/api` to `http://127.0.0.1:8000`.

---

## Using the UI

1. Open `/` (landing) and go to **Open analyzer**, or go to `/graph`.
2. **Import Jaeger JSON**, **Connect to Jaeger**, or **Load sample**.
3. Click a service on the map. Inspect health, callers, and callees.
4. **Simulate failure** — analysis only; live health is restored.
5. Review blast radius, hypothetical RCA (`NOT DETERMINED`), recommendations, and optional **virtual mitigation**.
6. Generate a report from `/reports`.

| Route | Page |
| --- | --- |
| `/` | Landing |
| `/graph` | Dependency map (primary workspace) |
| `/overview` | System summary |
| `/simulations` | Stored simulations |
| `/incidents` | Same history, incident wording |
| `/reports` | Generate markdown/JSON from a simulation |
| `/settings` | Thresholds, Jaeger connection, database reset |

The map is empty until telemetry is imported or Jaeger is connected. Sample traces are **not** loaded on startup.

---

## Sample data

Under `backend/samples/`:

- `sample_traces.json` — multi-service traffic (checkout, auth, order, payment, …)
- `payment_incident_traces.json` — payment-gateway 5xx incident
- `sample_traces_otlp.json` — same topology as OTLP JSON

Regenerate:

```bash
cd backend
python samples/generate_samples.py
```

Upload with curl:

```bash
curl -X POST http://localhost:8000/api/telemetry/traces/upload \
  -F "file=@backend/samples/sample_traces.json"
```

---

## Configuration

Copy [backend/.env.example](backend/.env.example). Important variables:

| Variable | Role |
| --- | --- |
| `DATABASE_URL` | Default `sqlite:///./weft.db` |
| `CORS_ORIGINS` | Includes Vite `5173`–`5175`; never `*` with credentials |
| `ALLOW_DEV_RESET` | Settings page wipe (`POST /api/dev/reset`) |
| `ADMIN_KEY` | Required for `/api/admin/*` |
| `API_KEY` | If set, write requests need header `X-API-Key` |
| `JAEGER_QUERY_URL` | Default only; does **not** auto-connect |
| `MAX_TRACE_FILE_SIZE_MB` | Upload cap (default 20) |

Analysis knobs live in [backend/config/thresholds.yaml](backend/config/thresholds.yaml) (`GET`/`PUT /api/config/thresholds`).

---

## API

Prefixes: **`/api`** and **`/api/v1`** (same routers). The UI uses `/api`.

| Area | Examples |
| --- | --- |
| Health / overview | `GET /api/health`, `GET /api/overview` |
| Telemetry | `POST /api/telemetry/traces`, `/upload`, `/otlp` |
| Graph | `GET /api/graph`, `/validation`, `/export` |
| Services | `GET /api/services`, dashboard, upstream, downstream |
| Criticality / blast radius | `/api/criticality/rankings`, `GET /api/blast-radius/{id}` |
| Simulation | `POST /api/simulate/failure/{id}`, SSE stream, history |
| Analysis | `GET /api/simulations/{id}/analysis`, `GET /api/analysis/root-cause` |
| Mitigation | `POST /api/simulations/{id}/mitigation` |
| Jaeger | `/api/jaeger/test`, `/connect`, `/refresh`, `/status`, `/disconnect` |
| Reports / config | `POST /api/reports/generate`, `GET/PUT /api/config/thresholds` |

Errors are always:

```json
{ "error": { "code": "SERVICE_NOT_FOUND", "message": "…", "details": {} } }
```

Full endpoint and algorithm detail: [backend/IMPLEMENTATION.md](backend/IMPLEMENTATION.md).

---

## Tests and lint

```bash
cd backend
pip install -r requirements.txt -r requirements-dev.txt
pytest
ruff check app tests
```

CI (`.github/workflows/ci.yml`) runs pytest and ruff on Python 3.12.

---

## Docker

Backend only:

```bash
docker compose up --build
```

Serves the API on port 8000. Optional Postgres is commented in `docker-compose.yml`; switch by setting `DATABASE_URL`.

The frontend is not in Compose. Run `npm run dev` locally, or build `frontend/` and point `/api` at the container.

---

## Deploying the UI (Vercel)

Vercel can host the **frontend** only. FastAPI (SQLite, SSE, Jaeger poll loop, uploads) needs a persistent host.

- **Root Directory:** `frontend`
- **Framework:** Vite
- **Install:** `npm install`
- **Build:** `npm run build`
- **Output:** `dist`

The UI calls relative `/api/...`. Locally that is the Vite proxy. In production, rewrite `/api/:path*` to your FastAPI origin, and set backend `CORS_ORIGINS` to the Vercel URL.

---

## What is intentionally not included

No Kubernetes, Istio, Prometheus, Datadog, Slack, PagerDuty, OpenTelemetry collector process, Redis, required Postgres, OAuth/SSO, ML anomaly detection, auto-remediation, or real circuit-breaker injection.

Recommendations and virtual mitigation never change production, SQLite topology, or live health.

---

## Further reading

- [backend/IMPLEMENTATION.md](backend/IMPLEMENTATION.md) — how ingest, health, blast radius, RCA, and live Jaeger work
- [backend/README.md](backend/README.md) — backend setup
- [frontend/README.md](frontend/README.md) — UI screens and proxy
