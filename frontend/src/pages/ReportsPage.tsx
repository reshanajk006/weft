import { useEffect, useState } from "react";
import { api } from "../api";
import { StatusPill } from "../components/StatusPill";
import type { ReportResponse, SimulationListItem } from "../types";

export function ReportsPage() {
  const [items, setItems] = useState<SimulationListItem[]>([]);
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .simulations()
      .then((result) => setItems(result.items))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load reports"));
  }, []);

  async function generate(id: string, format: "markdown" | "json") {
    try {
      const payload = await api.reports(id, format);
      setReport(payload);
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

  return (
    <div className="page stack">
      <div>
        <div className="eyebrow">Reports</div>
        <h1>Incident impact reports</h1>
        <p className="muted">Reports are generated from stored failure simulations. They are not independent documents.</p>
      </div>
      {error ? <div className="error-banner">{error}</div> : null}
      {items.length === 0 ? <p className="muted">Run a failure simulation from the graph first.</p> : null}
      {items.map((item) => (
        <div key={item.id} className="panel row" style={{ justifyContent: "space-between" }}>
          <div>
            <div>{item.failed_service_name}</div>
            <div className="muted">
              <StatusPill value={item.severity} /> blast radius {item.blast_radius_score.toFixed(0)} ·{" "}
              {item.affected_service_count} services · {new Date(item.created_at).toLocaleString()}
            </div>
          </div>
          <div className="row">
            <button className="btn" type="button" onClick={() => void generate(item.id, "markdown")}>
              View report
            </button>
            <button className="btn ghost" type="button" onClick={() => void generate(item.id, "json")}>
              Export
            </button>
          </div>
        </div>
      ))}
      {report ? (
        <div className="panel">
          <div className="eyebrow">Preview</div>
          <div className="pre">{report.content}</div>
        </div>
      ) : null}
    </div>
  );
}
