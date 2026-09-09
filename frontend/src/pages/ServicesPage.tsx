import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { StatusPill } from "../components/StatusPill";
import type { ServiceSummary } from "../types";

export function ServicesPage() {
  const [items, setItems] = useState<ServiceSummary[]>([]);
  const [q, setQ] = useState("");
  const [health, setHealth] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function load() {
    try {
      const result = await api.services({ q, health_status: health || undefined, limit: 100 });
      setItems(result.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load services");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="page stack">
      <div>
        <div className="eyebrow">Catalog</div>
        <h1>Services</h1>
      </div>
      <form
        className="row"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search services" />
        <select value={health} onChange={(event) => setHealth(event.target.value)}>
          <option value="">All health</option>
          <option value="HEALTHY">Healthy</option>
          <option value="DEGRADED">Degraded</option>
          <option value="UNHEALTHY">Unhealthy</option>
        </select>
        <button className="btn" type="submit">
          Filter
        </button>
      </form>
      {error ? <div className="error-banner">{error}</div> : null}
      <table className="table">
        <thead>
          <tr>
            <th>Service</th>
            <th>Health</th>
            <th>Score</th>
            <th>Error rate</th>
            <th>Latency</th>
            <th>Calls</th>
            <th>Criticality</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="clickable" onClick={() => navigate(`/app/services/${item.id}`)}>
              <td>{item.name}</td>
              <td>
                <StatusPill value={item.health_status} />
              </td>
              <td className="mono">{item.health_score}</td>
              <td className="mono">{(item.error_rate * 100).toFixed(1)}%</td>
              <td className="mono">{item.avg_latency_ms.toFixed(1)} ms</td>
              <td className="mono">{item.total_calls}</td>
              <td className="mono">{item.criticality_score.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
