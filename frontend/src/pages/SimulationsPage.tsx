import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { StatusPill } from "../components/StatusPill";
import { useWorkspace } from "../state/workspace";
import type { SimulationListItem } from "../types";

export function SimulationsPage({ title, intro }: { title: string; intro: string }) {
  const [items, setItems] = useState<SimulationListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { mode } = useWorkspace();

  useEffect(() => {
    api
      .simulations()
      .then((result) => setItems(result.items))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load simulations"));
  }, [mode]);

  return (
    <div className="page stack">
      <div>
        <div className="eyebrow">History</div>
        <h1>{title}</h1>
        <p className="muted">{intro}</p>
      </div>
      {error ? <div className="error-banner">{error}</div> : null}
      {items.length === 0 ? <p className="muted">No simulations yet. Select a service on the map and simulate failure.</p> : null}
      <table className="table">
        <thead>
          <tr>
            <th>Service</th>
            <th>Severity</th>
            <th>Blast radius</th>
            <th>Affected</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.id}
              className="clickable"
              onClick={() => navigate(`/?service=${item.failed_service_id}&sim=${item.id}`)}
            >
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

export function SimulationsHistoryPage() {
  return (
    <SimulationsPage
      title="Simulations"
      intro="Previous failure simulations. Open one to restore the incident on the dependency map."
    />
  );
}

export function IncidentsPage() {
  return (
    <SimulationsPage
      title="Incidents"
      intro="Each incident is a stored simulation. Opening it returns you to the graph in incident view."
    />
  );
}
