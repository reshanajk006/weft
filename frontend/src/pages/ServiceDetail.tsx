import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { StatusPill } from "../components/StatusPill";
import type { ServiceDashboard, SimulationResponse } from "../types";

export function ServiceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<ServiceDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sim, setSim] = useState<SimulationResponse | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    api
      .dashboard(id)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Not found"));
  }, [id]);

  async function simulate() {
    if (!id) return;
    setBusy(true);
    try {
      const result = await api.simulateFailure(id);
      setSim(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Simulation failed");
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <div className="page">
        {error ? <div className="error-banner">{error}</div> : <p className="muted">Loading…</p>}
      </div>
    );
  }

  return (
    <div className="page stack" style={{ gap: 20 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <div className="eyebrow">Service</div>
          <h1>{data.service.name}</h1>
        </div>
        <div className="row">
          <button className="btn ghost" type="button" onClick={() => navigate(`/app/graph?highlight=${data.service.id}`)}>
            View on graph
          </button>
          <button className="btn" type="button" disabled={busy} onClick={() => void simulate()}>
            {busy ? "Simulating…" : "Simulate failure"}
          </button>
        </div>
      </div>
      {error ? <div className="error-banner">{error}</div> : null}
      <div className="row">
        <StatusPill value={data.health.status} />
        <span className="muted">Health {data.health.score} · Criticality {data.criticality.score.toFixed(1)}</span>
      </div>
      <div className="stat-grid">
        <div className="metric">
          <span className="eyebrow">Calls</span>
          <b>{data.metrics.total_calls}</b>
        </div>
        <div className="metric">
          <span className="eyebrow">Error rate</span>
          <b>{(data.metrics.error_rate * 100).toFixed(1)}%</b>
        </div>
        <div className="metric">
          <span className="eyebrow">Avg latency</span>
          <b>{data.metrics.avg_latency_ms.toFixed(0)}ms</b>
        </div>
        <div className="metric">
          <span className="eyebrow">P95</span>
          <b>{data.metrics.p95_latency_ms?.toFixed(0) ?? "—"}ms</b>
        </div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="panel">
          <div className="eyebrow">Upstream callers</div>
          {data.upstream.length === 0 ? <p className="muted">None</p> : null}
          {data.upstream.map((item) => (
            <button key={item.id} className="nav-link" type="button" onClick={() => navigate(`/app/services/${item.id}`)}>
              {item.name}
            </button>
          ))}
        </div>
        <div className="panel">
          <div className="eyebrow">Downstream dependencies</div>
          {data.downstream.length === 0 ? <p className="muted">None</p> : null}
          {data.downstream.map((item) => (
            <button key={item.id} className="nav-link" type="button" onClick={() => navigate(`/app/services/${item.id}`)}>
              {item.name}
            </button>
          ))}
        </div>
      </div>
      <div className="panel">
        <div className="eyebrow">Technical criticality</div>
        {Object.entries(data.criticality.breakdown).map(([key, factor]) => (
          <div key={key} className="row" style={{ justifyContent: "space-between" }}>
            <span>{key.replaceAll("_", " ")}</span>
            <span className="mono">{factor.contribution.toFixed(1)}</span>
          </div>
        ))}
      </div>
      {sim ? (
        <div className="panel stack">
          <div className="eyebrow">Simulation result</div>
          <p>
            Severity {sim.severity} · blast radius {sim.blast_radius_score.toFixed(1)} · {sim.services_affected} services
          </p>
          <p className="muted">{sim.explanation}</p>
          <button className="btn ghost" type="button" onClick={() => navigate(`/app/simulations/${sim.simulation_id}`)}>
            Open incident timeline
          </button>
        </div>
      ) : null}
    </div>
  );
}
