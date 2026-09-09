import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import { StatusPill } from "../components/StatusPill";
import type { SimulationResponse, TimelineEvent } from "../types";

export function SimulationDetailPage() {
  const { id } = useParams();
  const [sim, setSim] = useState<SimulationResponse | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [report, setReport] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([api.simulation(id), api.timeline(id)])
      .then(([simulation, events]) => {
        setSim(simulation);
        setTimeline(events.items);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Not found"));
  }, [id]);

  async function generate(format: "markdown" | "json") {
    if (!id) return;
    try {
      const payload = await api.reports(id, format);
      setReport(payload.content);
      const blob = new Blob([payload.content], { type: format === "json" ? "application/json" : "text/markdown" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `weft-report.${format === "json" ? "json" : "md"}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Report failed");
    }
  }

  if (!sim) {
    return (
      <div className="page">
        {error ? <div className="error-banner">{error}</div> : <p className="muted">Loading…</p>}
      </div>
    );
  }

  return (
    <div className="page stack" style={{ gap: 18 }}>
      <div>
        <div className="eyebrow">Simulation</div>
        <h1>{sim.failed_service.name}</h1>
      </div>
      <div className="row">
        <StatusPill value={sim.severity} />
        <span className="muted">
          Blast radius {sim.blast_radius_score.toFixed(1)} · {sim.services_affected} services · {sim.estimated_requests_affected} estimated requests
        </span>
      </div>
      <p className="muted">{sim.explanation}</p>
      <div className="row">
        <button className="btn" type="button" onClick={() => void generate("markdown")}>
          Generate Markdown report
        </button>
        <button className="btn ghost" type="button" onClick={() => void generate("json")}>
          Generate JSON report
        </button>
      </div>
      <div className="panel">
        <div className="eyebrow">Affected services</div>
        <table className="table">
          <thead>
            <tr>
              <th>Service</th>
              <th>Probability</th>
              <th>Distance</th>
              <th>Impact</th>
            </tr>
          </thead>
          <tbody>
            {sim.affected_services.map((item) => (
              <tr key={item.service_id}>
                <td>{item.service_name}</td>
                <td className="mono">{item.impact_probability.toFixed(2)}</td>
                <td className="mono">{item.distance}</td>
                <td>
                  <StatusPill value={item.impact_level} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel">
        <div className="eyebrow">Predicted circuit transitions</div>
        {sim.predicted_circuit_transitions.length === 0 ? <p className="muted">None</p> : null}
        {sim.predicted_circuit_transitions.map((item) => (
          <div key={item.dependency_id}>
            {item.source} → {item.target}: {item.previous_state} → {item.new_state}
          </div>
        ))}
      </div>
      <div className="panel">
        <div className="eyebrow">Incident timeline</div>
        <div className="timeline">
          {timeline.map((event, index) => (
            <div className="timeline-item" key={`${event.type}-${index}`}>
              <div className="muted">{new Date(event.timestamp).toLocaleString()}</div>
              <div>
                <strong>{event.type}</strong>
                <div>{event.message}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {report ? (
        <div className="panel">
          <div className="eyebrow">Report preview</div>
          <div className="pre">{report}</div>
        </div>
      ) : null}
    </div>
  );
}
