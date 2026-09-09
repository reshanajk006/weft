# WEFT Frontend

Premium React UI for the WEFT backend. The landing page animates a caller/callee graph; the rest of the app is wired to the live API.

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

Open http://localhost:5173 (Vite uses the next free port if 5173 is taken).

Vite proxies `/api` to `http://127.0.0.1:8000`.

## Screens

- `/` landing with graph-thread animation
- `/app` overview, upload, sample ingest
- `/app/graph` interactive dependency graph
- `/app/services` search and filters
- `/app/services/:id` metrics, upstream/downstream, simulate failure
- `/app/simulations` history, timeline, reports
- `/app/circuit-breakers` CLOSED/OPEN/HALF_OPEN simulation
- `/app/settings` threshold JSON editor
