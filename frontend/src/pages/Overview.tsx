import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { StatusPill } from "../components/StatusPill";
import { UploadPanel } from "../components/UploadPanel";
import type { Overview } from "../types";
import type { RankingItem } from "../types";

export function OverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [rankings, setRankings] = useState<RankingItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const showUpload = params.get("upload") === "1" || (data && data.service_count === 0);

  async function load() {
    try {
      setData(await api.overview());
      const ranked = await api.criticality();
      setRankings(ranked.items);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Backend is not reachable. Start it on port 8000.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="page stack" style={{ gap: 22 }}>
      <div>
        <div className="eyebrow">Platform</div>
        <h1>Overview</h1>
      </div>
      {error ? <div className="error-banner">{error}</div> : null}
      {showUpload ? <UploadPanel onDone={() => void load()} /> : null}
      {data ? (
        <>
          <div className="stat-grid">
            <div className="metric">
              <span className="eyebrow">Services</span>
              <b>{data.service_count}</b>
            </div>
            <div className="metric">
              <span className="eyebrow">Dependencies</span>
              <b>{data.dependency_count}</b>
            </div>
            <div className="metric">
              <span className="eyebrow">Average health</span>
              <b>{data.average_health_score.toFixed(1)}</b>
            </div>
            <div className="metric">
              <span className="eyebrow">Open breakers</span>
              <b>{data.open_circuit_breakers}</b>
            </div>
          </div>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div className="panel stack">
              <div className="eyebrow">Health mix</div>
              <div>Healthy {data.healthy_count}</div>
              <div>Degraded {data.degraded_count}</div>
              <div>Unhealthy {data.unhealthy_count}</div>
            </div>
            <div className="panel stack">
              <div className="eyebrow">Highest technical criticality</div>
              {data.highest_risk_service ? (
                <>
                  <h2>{data.highest_risk_service.name}</h2>
                  <StatusPill value={data.highest_risk_service.health_status} />
                  <button className="btn ghost" type="button" onClick={() => navigate(`/app/services/${data.highest_risk_service!.id}`)}>
                    Open service
                  </button>
                </>
              ) : (
                <p className="muted">Ingest a trace to rank services.</p>
              )}
            </div>
          </div>
          {data.latest_simulation ? (
            <div className="panel row" style={{ justifyContent: "space-between" }}>
              <div>
                <div className="eyebrow">Latest simulation</div>
                <div>
                  {data.latest_simulation.failed_service_name} · {data.latest_simulation.severity}
                </div>
              </div>
              <button className="btn ghost" type="button" onClick={() => navigate(`/app/simulations/${data.latest_simulation!.id}`)}>
                View timeline
              </button>
            </div>
          ) : null}
          {rankings.length ? (
            <div className="panel">
              <div className="eyebrow">Technical criticality</div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Service</th>
                    <th>Score</th>
                    <th>Health</th>
                  </tr>
                </thead>
                <tbody>
                  {rankings.slice(0, 8).map((item) => (
                    <tr key={item.service_id} className="clickable" onClick={() => navigate(`/app/services/${item.service_id}`)}>
                      <td className="mono">{item.rank}</td>
                      <td>{item.service}</td>
                      <td className="mono">{item.score.toFixed(1)}</td>
                      <td>
                        <StatusPill value={item.health} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
