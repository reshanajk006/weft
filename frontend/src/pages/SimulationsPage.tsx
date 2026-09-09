import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { StatusPill } from "../components/StatusPill";

export function SimulationsPage() {
  const [items, setItems] = useState<Array<{ id: string; failed_service_name: string; severity: string; blast_radius_score: number; affected_service_count: number; created_at: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api
      .simulations()
      .then((result) => setItems(result.items))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load simulations"));
  }, []);

  return (
    <div className="page stack">
      <div>
        <div className="eyebrow">Incidents</div>
        <h1>Simulations</h1>
      </div>
      {error ? <div className="error-banner">{error}</div> : null}
      {items.length === 0 ? <p className="muted">No simulations yet. Open a service and click Simulate failure.</p> : null}
      <table className="table">
        <thead>
          <tr>
            <th>Failed service</th>
            <th>Severity</th>
            <th>Blast radius</th>
            <th>Affected</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="clickable" onClick={() => navigate(`/app/simulations/${item.id}`)}>
              <td>{item.failed_service_name}</td>
              <td>
                <StatusPill value={item.severity} />
              </td>
              <td className="mono">{item.blast_radius_score.toFixed(1)}</td>
              <td className="mono">{item.affected_service_count}</td>
              <td>{new Date(item.created_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
