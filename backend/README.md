# WEFT Backend

WEFT is a dependency-graph-driven resilience analysis platform. The only required user input is a Jaeger-format JSON trace file. The backend derives services, dependencies, health, technical criticality, blast radius, failure simulations, and circuit-breaker simulations from that telemetry.

For a full description of what is implemented and how the algorithms work, see [IMPLEMENTATION.md](IMPLEMENTATION.md).

This application is an analysis and simulation engine. Simulated failures and circuit-breaker transitions do not control production traffic.

## Requirements

- Python 3.11 or newer
- No Docker, Kubernetes, Jaeger server, Redis, or PostgreSQL is required

## Local setup

```bash
cd backend
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
copy .env.example .env   # Windows
# cp .env.example .env   # macOS / Linux
```

## Run

```bash
cd backend
python -m uvicorn app.main:app --reload --port 8000
```

Or:

```bash
cd backend
python run.py
```

The API is available at:

- API: http://localhost:8000
- Swagger: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc
- OpenAPI: http://localhost:8000/openapi.json

The SQLite database is created automatically on startup (`weft.db` by default, resolved relative to the `backend/` directory). Existing local DBs pick up new columns via startup `ALTER TABLE` (no wipe). If a column add ever fails, delete `weft.db` and restart, or run `POST /api/dev/reset`.

Docker:

```bash
docker compose up --build
```

The container serves `/docs` on port 8000. Optional Postgres is commented in `docker-compose.yml`; only `DATABASE_URL` needs to change to switch.

## Expected user flow

1. Upload Jaeger JSON with `POST /api/telemetry/traces/upload` or `POST /api/telemetry/traces`
2. Inspect the derived graph with `GET /api/graph`
3. Inspect a service with `GET /api/services/{id}`
4. Simulate failure with `POST /api/simulate/failure/{service_id}`
5. Review blast radius, predicted circuit-breaker transitions, and incident timeline
6. Generate a Markdown or JSON report with `POST /api/reports/generate`

## Sample data

Two Jaeger datasets are included:

- `samples/sample_traces.json` — healthy-ish multi-service traffic
- `samples/payment_incident_traces.json` — payment-gateway incident with enough 5xx failures to degrade health

Regenerate them with:

```bash
cd backend
python samples/generate_samples.py
```

Upload example:

```bash
curl -X POST http://localhost:8000/api/telemetry/traces/upload ^
  -F "file=@samples/sample_traces.json"
```

## Tests

```bash
cd backend
pytest
```

## Configuration

Environment variables are documented in `.env.example`.

Analysis thresholds live in `config/thresholds.yaml` and can be read or updated at:

- `GET /api/config/thresholds`
- `PUT /api/config/thresholds`

CORS defaults to `http://localhost:3000` and `http://localhost:5173`.

## API surface

| Area | Endpoints |
| --- | --- |
| Health | `GET /api/health`, `GET /api/health/services`, `GET /api/overview` |
| Telemetry | `POST /api/telemetry/traces`, `POST /api/telemetry/traces/upload`, `POST /api/telemetry/otlp`, `GET /api/telemetry/ingestions` |
| Graph | `GET /api/graph`, `GET /api/graph/validation`, `GET /api/graph/export` |
| Services | `GET /api/services`, `GET/PATCH /api/services/{id}`, dashboard, upstream, downstream, health-history |
| Criticality | `GET /api/criticality/rankings`, `GET /api/criticality/{id}` |
| Blast radius | `GET /api/blast-radius/{id}` |
| Simulation | `POST /api/simulate/failure`, `POST /api/simulate/failure/{id}`, SSE stream, history, timeline |
| Circuit breakers | list, get, simulate, reset, transition |
| Reports | `POST /api/reports/generate` |
| Config | `GET/PUT /api/config/thresholds`, `POST /api/config/topology`, `POST /api/config/topology/upload` |
| Admin | `POST /api/admin/reset`, `POST /api/admin/seed-sample` (requires `X-Admin-Key`) |

`/api/v1/...` is the canonical prefix; `/api/...` remains supported. Write endpoints accept optional `X-API-Key` when `API_KEY` is set.

Blast-radius direction: if `A -> B` then `A` calls `B`. If `B` fails, `A` is affected. Structural blast radius uses graph ancestors, not descendants.
