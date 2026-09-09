import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { StatusPill } from "../components/StatusPill";
import { useWorkspace } from "../state/workspace";
import type { RankingItem, SimulationListItem } from "../types";

export function OverviewPage() {
  const navigate = useNavigate();
  const { overview, mode, openImport } = useWorkspace();
  const [rankings, setRankings] = useState<RankingItem[]>([]);
  const [sims, setSims] = useState<SimulationListItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode === "NO_DATA" || mode === "ERROR") return;
    api
      .criticality()
      .then((rank) => {
        setRankings(rank.items);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load overview"));
    api
      .simulations()
      .then((sim) => setSims(sim.items))
      .catch(() => undefined);
  }, [mode]);

  const empty = !overview?.active_dataset;

  return (
    <div className="page stack">
      <div>
        <div className="eyebrow">Overview</div>
        <h1>System summary</h1>
        <p className="muted">Investigation happens on the dependency map. This page only summarizes imported telemetry.</p>
      </div>
      {error ? <div className="error-banner">{error}</div> : null}
      {empty ? (
        <>
          <p className="muted">No telemetry loaded.</p>
          <button className="btn" type="button" onClick={openImport}>
            Import Jaeger JSON
          </button>
        </>
      ) : (
        <>
          <div className="stat-grid">
            <div className="metric">
              <span className="eyebrow">Services</span>
              <b>{overview.service_count}</b>
            </div>
            <div className="metric">
              <span className="eyebrow">Dependencies</span>
              <b>{overview.dependency_count}</b>
            </div>
            <div className="metric">
              <span className="eyebrow">Healthy</span>
              <b>{overview.healthy_count}</b>
            </div>
            <div className="metric">
              <span className="eyebrow">Degraded</span>
              <b>{overview.degraded_count}</b>
            </div>
            <div className="metric">
              <span className="eyebrow">Unhealthy</span>
              <b>{overview.unhealthy_count}</b>
            </div>
          </div>
          <button className="btn" type="button" onClick={() => navigate("/")}>
            Open dependency map
          </button>
          <div className="panel">
            <div className="eyebrow">Attention required</div>
            {rankings.filter((item) => item.health !== "HEALTHY").length === 0 ? (
              <p className="muted">No degraded or unhealthy services.</p>
            ) : null}
            {rankings
              .filter((item) => item.health !== "HEALTHY")
              .map((item) => (
                <div
                  key={item.service_id}
                  className="inspector-line clickable"
                  onClick={() => navigate(`/?service=${item.service_id}`)}
                >
                  <span>{item.service}</span>
                  <StatusPill value={item.health} />
                </div>
              ))}
          </div>
          <div className="panel">
            <div className="eyebrow">Highest technical criticality</div>
            {rankings.slice(0, 5).map((item) => (
              <div
                key={item.service_id}
                className="inspector-line clickable"
                onClick={() => navigate(`/?service=${item.service_id}`)}
              >
                <span>
                  {item.rank}. {item.service}
                </span>
                <span className="mono">{item.score.toFixed(1)}</span>
              </div>
            ))}
          </div>
          <div className="panel">
            <div className="eyebrow">Recent simulations</div>
            {sims.length === 0 ? <p className="muted">No simulations yet.</p> : null}
            {sims.slice(0, 5).map((item) => (
              <div
                key={item.id}
                className="inspector-line clickable"
                onClick={() => navigate(`/?service=${item.failed_service_id}&sim=${item.id}`)}
              >
                <span>{item.failed_service_name}</span>
                <StatusPill value={item.severity} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
