import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { StatusPill } from "../components/StatusPill";
import { Threads } from "../components/Threads";
import { useWorkspace } from "../state/workspace";
import type { RankingItem, SimulationListItem } from "../types";

function SegmentedMeter({ score, isUnhealthy }: { score: number; isUnhealthy: boolean }) {
  const activeCount = Math.min(10, Math.max(1, Math.round(score / 10)));
  return (
    <div className="pixel-meter hidden sm:inline-flex">
      {Array.from({ length: 10 }).map((_, i) => (
        <span
          key={i}
          className={`pixel-meter-block ${
            i < activeCount ? (isUnhealthy ? "active-rose" : "active-ice") : ""
          }`}
        />
      ))}
    </div>
  );
}

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

  const total = overview?.service_count || 0;
  const healthyPct = total && overview ? (((overview.healthy_count || 0) / total) * 100).toFixed(1) : "0";
  const degradedPct = total && overview ? (((overview.degraded_count || 0) / total) * 100).toFixed(1) : "0";
  const unhealthyPct = total && overview ? (((overview.unhealthy_count || 0) / total) * 100).toFixed(1) : "0";

  const attentionRequiredList = rankings.filter((item) => item.health !== "HEALTHY");

  return (
    <div className="overview-page" style={{ position: "relative", minHeight: "100vh", overflow: "hidden" }}>
      {/* Diagonal Threads Graph Wave Background */}
      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "1080px",
          height: "1080px",
          pointerEvents: "none",
          zIndex: 0,
          opacity: 0.65,
        }}
      >
        <div style={{ width: "1080px", height: "1080px", position: "relative" }}>
          <Threads
            color={[0.4196078431372549, 0.4470588235294118, 0.5019607843137255]}
            amplitude={1}
            distance={0}
            enableMouseInteraction
          />
        </div>
      </div>

      <div className="overview-container" style={{ position: "relative", zIndex: 1 }}>
        {/* Page Title & Navigation Banner */}
        <section className="overview-banner" data-purpose="page-title-banner">
          <div>
            <p className="overview-eyebrow">
              <span
                className="w-2 h-2 inline-block bg-[#9cafc4] pixel-blink"
                style={{ boxShadow: "0 0 4px #9cafc4" }}
              />
              SYSTEM SUMMARY // IMPORTED TELEMETRY
            </p>
            <h1 className="overview-title">Overview</h1>
            <p className="overview-subtitle">
              &gt; Investigation happens on the dependency map. This page only summarizes imported telemetry.
            </p>
          </div>
        </section>

        {error ? <div className="error-banner text-xs py-2 px-3">{error}</div> : null}

        {/* 1. Metric Cards Row: 5 Cards in One Horizontal Row on Desktop */}
        <section className="stat-grid" data-purpose="summary-stats-grid">
          <div className="stat-tile">
            <div className="stat-tile-header">
              <span className="stat-tile-label">SERVICES</span>
              <span className="w-2 h-2 bg-[#9cafc4]" style={{ boxShadow: "0 0 4px #9cafc4" }} />
            </div>
            <div className="stat-tile-footer">
              <span className="stat-tile-val">{overview?.service_count ?? 0}</span>
              <span className="badge-pct steel">[NODE]</span>
            </div>
          </div>

          <div className="stat-tile">
            <div className="stat-tile-header">
              <span className="stat-tile-label">DEPENDENCIES</span>
              <span className="w-2 h-2 bg-[#6b7280]" />
            </div>
            <div className="stat-tile-footer">
              <span className="stat-tile-val">{overview?.dependency_count ?? 0}</span>
              <span className="badge-pct steel">[EDGES]</span>
            </div>
          </div>

          <div className="stat-tile">
            <div className="stat-tile-header">
              <span className="stat-tile-label" style={{ color: "#22c55e" }}>
                HEALTHY
              </span>
              <span className="w-2 h-2 bg-[#22c55e]" style={{ boxShadow: "0 0 4px #22c55e" }} />
            </div>
            <div className="stat-tile-footer">
              <span className="stat-tile-val">{overview?.healthy_count ?? 0}</span>
              <span className="badge-pct healthy">{healthyPct}%</span>
            </div>
          </div>

          <div className="stat-tile">
            <div className="stat-tile-header">
              <span className="stat-tile-label" style={{ color: "#f59e0b" }}>
                DEGRADED
              </span>
              <span className="w-2 h-2 bg-[#f59e0b]" />
            </div>
            <div className="stat-tile-footer">
              <span className="stat-tile-val">{overview?.degraded_count ?? 0}</span>
              <span className="badge-pct degraded">{degradedPct}%</span>
            </div>
          </div>

          <div
            className={`stat-tile ${
              (overview?.unhealthy_count || 0) > 0 ? "unhealthy-alert" : ""
            }`}
          >
            <div className="stat-tile-header">
              <span className="stat-tile-label" style={{ color: "#fda4af" }}>
                UNHEALTHY
              </span>
              <span
                className={`w-2 h-2 bg-[#9f1239] ${
                  (overview?.unhealthy_count || 0) > 0 ? "pixel-blink" : ""
                }`}
                style={{ boxShadow: "0 0 4px #9f1239" }}
              />
            </div>
            <div className="stat-tile-footer">
              <span className="stat-tile-val">{overview?.unhealthy_count ?? 0}</span>
              <span className="badge-pct unhealthy">{unhealthyPct}%</span>
            </div>
          </div>
        </section>

        {/* 2. Open Dependency Map Control Strip */}
        <section data-purpose="primary-map-cta">
          <button
            className="primary-map-btn"
            type="button"
            onClick={() => navigate("/graph")}
          >
            <span style={{ fontSize: "0.9rem" }}>→</span>
            <span>Open Dependency Map</span>
          </button>
        </section>

        {empty ? (
          <div className="dashboard-panel text-center" style={{ padding: "48px 24px" }}>
            <p
              style={{
                fontFamily: "'Courier Prime', monospace",
                color: "#94a3b8",
                fontSize: "14px",
                marginBottom: "16px",
              }}
            >
              &gt; No telemetry loaded into workspace.
            </p>
            <button
              className="primary-map-btn"
              style={{
                maxWidth: "260px",
                margin: "0 auto",
                padding: "12px 20px",
                fontSize: "11px",
              }}
              type="button"
              onClick={openImport}
            >
              Import Jaeger JSON
            </button>
          </div>
        ) : (
          <>
            {/* 3. Alert / Attention Panel */}
            <section
              className={`dashboard-panel ${attentionRequiredList.length > 0 ? "alert" : ""}`}
              data-purpose="alert-panel"
            >
              <div className="panel-header">
                <div className="panel-title">
                  <span
                    style={{
                      width: "14px",
                      height: "14px",
                      fontSize: "9px",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: "#881337",
                      color: "#ffffff",
                      fontFamily: "'Space Mono', monospace",
                      fontWeight: 700,
                    }}
                  >
                    !
                  </span>
                  <span>ATTENTION REQUIRED // CRITICAL INCIDENT DETECTED</span>
                </div>
                {attentionRequiredList.length > 0 ? (
                  <span className="badge-pct unhealthy font-mono">
                    [ {attentionRequiredList.length} INCIDENT(S) ]
                  </span>
                ) : null}
              </div>

              {attentionRequiredList.length === 0 ? (
                <p
                  style={{
                    fontFamily: "'Courier Prime', monospace",
                    fontSize: "13px",
                    color: "#94a3b8",
                    margin: "8px 0",
                  }}
                >
                  &gt; No degraded or unhealthy services detected.
                </p>
              ) : (
                <div className="service-list">
                  {attentionRequiredList.map((item) => (
                    <div
                      key={item.service_id}
                      className="alert-item"
                      onClick={() => navigate(`/graph?service=${item.service_id}`)}
                    >
                      <div className="alert-item-left">
                        <div className="alert-icon">!</div>
                        <div>
                          <span
                            style={{
                              fontFamily: "'Space Mono', monospace",
                              fontSize: "14px",
                              fontWeight: 700,
                              color: "#e5e7eb",
                              letterSpacing: "0.02em",
                            }}
                          >
                            {item.service}
                          </span>
                          <p
                            style={{
                              fontFamily: "'Courier Prime', monospace",
                              fontSize: "13px",
                              color: "#94a3b8",
                              margin: "3px 0 0 0",
                            }}
                          >
                            &gt; Higher error-rate exceeding 99.9th percentile SLA threshold
                          </p>
                        </div>
                      </div>
                      <div className="alert-pill">
                        <span className="w-2 h-2 bg-white pixel-blink" />
                        <span>{item.health}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* 4. Service Health Section (Highest Technical Criticality) */}
            <section className="dashboard-panel" data-purpose="criticality-table">
              <div className="panel-header">
                <h2 className="panel-title">
                  <span style={{ color: "#9cafc4" }}>▲</span>
                  <span>HIGHEST TECHNICAL CRITICALITY</span>
                </h2>
                <span className="panel-badge">[ TOP 5 SERVICES ]</span>
              </div>

              {rankings.length === 0 ? (
                <p
                  style={{
                    fontFamily: "'Courier Prime', monospace",
                    fontSize: "13px",
                    color: "#94a3b8",
                    margin: "8px 0",
                  }}
                >
                  &gt; No services found.
                </p>
              ) : (
                <div className="service-list">
                  {rankings.slice(0, 5).map((item, idx) => {
                    const isUnhealthy = item.health === "UNHEALTHY" || item.health === "DEGRADED";
                    return (
                      <div
                        key={item.service_id}
                        className={`service-row ${isUnhealthy ? "unhealthy" : ""}`}
                        onClick={() => navigate(`/graph?service=${item.service_id}`)}
                      >
                        <div className="service-row-left">
                          <span
                            className="service-row-rank"
                            style={{ color: isUnhealthy ? "#fda4af" : "#6b7280" }}
                          >
                            {String(idx + 1).padStart(2, "0")}.
                          </span>
                          <span
                            style={{
                              width: "10px",
                              height: "10px",
                              display: "inline-block",
                              backgroundColor:
                                item.health === "HEALTHY"
                                  ? "#22c55e"
                                  : item.health === "DEGRADED"
                                  ? "#f59e0b"
                                  : "#9f1239",
                            }}
                            className={
                              item.health === "UNHEALTHY" ? "pixel-blink" : undefined
                            }
                          />
                          <span className="service-row-name">{item.service}</span>
                        </div>
                        <div className="service-row-right">
                          <SegmentedMeter score={item.score} isUnhealthy={isUnhealthy} />
                          <span
                            className={`service-score-badge ${isUnhealthy ? "unhealthy" : ""}`}
                          >
                            {item.score.toFixed(1)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* 5. Recent Simulations Section */}
            <section className="dashboard-panel" data-purpose="simulations-table">
              <div className="panel-header">
                <h2 className="panel-title">
                  <span style={{ color: "#9cafc4" }}>◈</span>
                  <span>RECENT SIMULATIONS</span>
                </h2>
                <span className="panel-badge">[ SIMULATION HISTORY ]</span>
              </div>

              {sims.length === 0 ? (
                <p
                  style={{
                    fontFamily: "'Courier Prime', monospace",
                    fontSize: "13px",
                    color: "#94a3b8",
                    margin: "8px 0",
                  }}
                >
                  &gt; No simulations yet.
                </p>
              ) : (
                <div className="service-list">
                  {sims.slice(0, 5).map((item) => (
                    <div
                      key={item.id}
                      className="service-row"
                      onClick={() =>
                        navigate(`/graph?service=${item.failed_service_id}&sim=${item.id}`)
                      }
                    >
                      <div className="service-row-left">
                        <span
                          style={{
                            color: "#9cafc4",
                            fontFamily: "'Space Mono', monospace",
                            fontSize: "12px",
                          }}
                        >
                          &gt;
                        </span>
                        <span className="service-row-name">
                          {item.failed_service_name}
                        </span>
                      </div>
                      <StatusPill value={item.severity} />
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Page Footer */}
            <footer className="overview-footer">
              <p>WEFT Telemetry Observability Suite • System Health Engine • 8-Bit Pixel Mode</p>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
