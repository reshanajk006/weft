# WEFT Frontend

The dependency graph is the primary workspace. WEFT does not show services until Jaeger telemetry is imported.

## Run

Start the backend first:

```bash
cd backend
python -m uvicorn app.main:app --reload --port 8000
```

Then:

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 (Vite uses the next free port if 5173 is taken). Vite proxies `/api` to `http://127.0.0.1:8000`.

## Screens

- `/` dependency map (empty until telemetry is imported)
- `/overview` system summary
- `/simulations` and `/incidents` stored failure simulations
- `/reports` reports generated from simulations
- `/settings` thresholds and explicit database reset

Sample traces are loaded only when you click **Load sample system**. They use the same ingestion API as a real Jaeger file.
