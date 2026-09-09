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

function TelemetryBarRow({
  item,
  idx,
  maxScore,
  onClick,
}: {
  item: RankingItem;
  idx: number;
  maxScore: number;
  onClick: () => void;
}) {
  const isUnhealthy = item.health === "UNHEALTHY" || item.health === "DEGRADED";
  const totalBlocks = 20;
  const activeBlocks = Math.max(1, Math.min(totalBlocks, Math.round((item.score / maxScore) * totalBlocks)));

  return (
    <div
      className={`telemetry-bar-row ${isUnhealthy ? "unhealthy" : ""}`}
      onClick={onClick}
    >
      <div className="flex items-center gap-3 min-w-[140px] sm:min-w-[180px]">
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
          className={item.health === "UNHEALTHY" ? "pixel-blink" : undefined}
        />
        <span className="service-row-name truncate">{item.service}</span>
      </div>

      {/* Proportional Segmented Capsule Bar */}
      <div
        className="telemetry-capsule flex-1 mx-3 sm:mx-4"
        style={{
          border: `1px solid ${
            isUnhealthy ? "rgba(159, 18, 57, 0.65)" : "rgba(34, 197, 94, 0.45)"
          }`,
          boxShadow: isUnhealthy
            ? "0 0 10px rgba(159, 18, 57, 0.25)"
            : "0 0 10px rgba(34, 197, 94, 0.2)",
        }}
      >
        {Array.from({ length: totalBlocks }).map((_, i) => (
          <span
            key={i}
            className={`telemetry-pill-block ${
              i < activeBlocks
                ? isUnhealthy
                  ? "active-unhealthy"
                  : "active-healthy"
                : "inactive"
            }`}
          />
        ))}
      </div>

      {/* Score Badge */}
      <span
        className="service-score-badge flex-shrink-0"
        style={{
          color: isUnhealthy ? "#fda4af" : "#4ade80",
          backgroundColor: isUnhealthy ? "rgba(136, 19, 55, 0.25)" : "rgba(34, 197, 94, 0.12)",
          borderColor: isUnhealthy ? "rgba(159, 18, 57, 0.5)" : "rgba(34, 197, 94, 0.35)",
        }}
      >
        {item.score.toFixed(1)}
      </span>
    </div>
  );
}

function MiniTopologySvg({
  top5,
  graphEdges,
  onSelectService,
}: {
  top5: RankingItem[];
  graphEdges: { source: string; target: string; call_count?: number }[];
  onSelectService: (id: string) => void;
}) {
  const positions = [
    { x: 170, y: 46 },
    { x: 82, y: 130 },
    { x: 258, y: 130 },
    { x: 78, y: 226 },
    { x: 236, y: 226 },
  ];

  const edgeList: { from: number; to: number; isUnhealthy: boolean }[] = [];
  top5.forEach((source, sIdx) => {
    top5.forEach((target, tIdx) => {
      if (sIdx !== tIdx) {
        const hasEdge = graphEdges.some(
          (e) =>
            (e.source === source.service_id && e.target === target.service_id) ||
            (e.source === source.service && e.target === target.service)
        );
        if (hasEdge) {
          edgeList.push({
            from: sIdx,
            to: tIdx,
            isUnhealthy: target.health !== "HEALTHY" || source.health !== "HEALTHY",
          });
        }
      }
    });
  });

  const finalEdges =
    edgeList.length > 0
      ? edgeList
      : [
          { from: 0, to: 1, isUnhealthy: top5[1]?.health !== "HEALTHY" },
          { from: 0, to: 2, isUnhealthy: top5[2]?.health !== "HEALTHY" },
          { from: 1, to: 3, isUnhealthy: top5[3]?.health !== "HEALTHY" },
          { from: 1, to: 4, isUnhealthy: top5[4]?.health !== "HEALTHY" },
          { from: 2, to: 4, isUnhealthy: top5[4]?.health !== "HEALTHY" },
        ];

  return (
    <div
      style={{
        background: "#080d14",
        border: "1px solid #1f2937",
        boxShadow: "inset 1px 1px 0 rgba(255, 255, 255, 0.03)",
        position: "relative",
        height: "100%",
        minHeight: "290px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <svg
        viewBox="0 0 340 290"
        className="w-full h-full"
        style={{ maxHeight: "360px" }}
      >
        <defs>
          <pattern id="topo-grid" width="22" height="22" patternUnits="userSpaceOnUse">
            <path
              d="M 22 0 L 0 0 0 22"
              fill="none"
              stroke="rgba(255, 255, 255, 0.035)"
              strokeWidth="1"
            />
          </pattern>
          <filter id="topo-glow-green" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="topo-glow-burgundy" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <marker id="topo-arrow-green" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <polygon points="0 1, 5 3, 0 5" fill="#10b981" />
          </marker>
          <marker id="topo-arrow-burgundy" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <polygon points="0 1, 5 3, 0 5" fill="#9f1239" />
          </marker>
        </defs>

        <rect width="100%" height="100%" fill="url(#topo-grid)" />

        {/* Directed Edges */}
        {finalEdges.map((edge, idx) => {
          const fromPos = positions[edge.from];
          const toPos = positions[edge.to];
          if (!fromPos || !toPos) return null;

          const dx = toPos.x - fromPos.x;
          const dy = toPos.y - fromPos.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist === 0) return null;
          const offset = 22;
          const x1 = fromPos.x + (dx / dist) * offset;
          const y1 = fromPos.y + (dy / dist) * offset;
          const x2 = toPos.x - (dx / dist) * (offset + 4);
          const y2 = toPos.y - (dy / dist) * (offset + 4);

          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;

          return (
            <g key={idx}>
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={edge.isUnhealthy ? "#9f1239" : "#38bdf8"}
                strokeWidth={edge.isUnhealthy ? "1.5" : "1.2"}
                strokeDasharray={edge.isUnhealthy ? "none" : "3 3"}
                markerEnd={
                  edge.isUnhealthy
                    ? "url(#topo-arrow-burgundy)"
                    : "url(#topo-arrow-green)"
                }
                opacity={0.8}
              />
              <rect
                x={midX - 6}
                y={midY - 6}
                width="12"
                height="12"
                fill="#0b0f14"
                stroke={edge.isUnhealthy ? "#9f1239" : "#475569"}
                strokeWidth="1"
                rx="2"
              />
              <text
                x={midX}
                y={midY + 3}
                textAnchor="middle"
                fill={edge.isUnhealthy ? "#fda4af" : "#94a3b8"}
                fontSize="7.5"
                fontFamily="'Space Mono', monospace"
              >
                ≡
              </text>
            </g>
          );
        })}

        {/* Nodes */}
        {top5.map((item, idx) => {
          const pos = positions[idx];
          if (!pos) return null;
          const isUnhealthy = item.health === "UNHEALTHY" || item.health === "DEGRADED";

          return (
            <g
              key={item.service_id}
              onClick={() => onSelectService(item.service_id)}
              style={{ cursor: "pointer" }}
            >
              <circle
                cx={pos.x}
                cy={pos.y}
                r="17"
                fill="none"
                stroke={isUnhealthy ? "#9f1239" : "#10b981"}
                strokeWidth="2"
                filter={isUnhealthy ? "url(#topo-glow-burgundy)" : "url(#topo-glow-green)"}
              />
              <circle
                cx={pos.x}
                cy={pos.y}
                r="12"
                fill="#0b0f14"
                stroke={isUnhealthy ? "#fda4af" : "#4ade80"}
                strokeWidth="1.25"
              />
              <circle
                cx={pos.x}
                cy={pos.y}
                r="4"
                fill={isUnhealthy ? "#9f1239" : "#10b981"}
              />

              <text
                x={pos.x}
                y={pos.y + 28}
                textAnchor="middle"
                fill="#e5e7eb"
                fontSize="8.5"
                fontWeight="700"
                fontFamily="'Space Mono', monospace"
              >
                {item.service.length > 15 ? `${item.service.slice(0, 13)}…` : item.service}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function OverviewPage() {
  const navigate = useNavigate();
  const { overview, mode, openImport, graph } = useWorkspace();
  const [criticalityView, setCriticalityView] = useState<"combo" | "bars" | "topology" | "list">("combo");
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
              <div className="panel-header flex items-center justify-between flex-wrap gap-2">
                <h2 className="panel-title">
                  <span style={{ color: "#9cafc4" }}>▲</span>
                  <span>HIGHEST TECHNICAL CRITICALITY</span>
                </h2>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    className={`telemetry-tab ${criticalityView === "combo" ? "active" : ""}`}
                    onClick={() => setCriticalityView("combo")}
                    title="Side-by-side telemetry bars & topology map"
                  >
                    [ ⊞ SPLIT ]
                  </button>
                  <button
                    type="button"
                    className={`telemetry-tab ${criticalityView === "bars" ? "active" : ""}`}
                    onClick={() => setCriticalityView("bars")}
                    title="Proportional telemetry bars"
                  >
                    [ ▰ BARS ]
                  </button>
                  <button
                    type="button"
                    className={`telemetry-tab ${criticalityView === "topology" ? "active" : ""}`}
                    onClick={() => setCriticalityView("topology")}
                    title="Mini dependency topology network"
                  >
                    [ 🕸 TOPOLOGY ]
                  </button>
                  <button
                    type="button"
                    className={`telemetry-tab ${criticalityView === "list" ? "active" : ""}`}
                    onClick={() => setCriticalityView("list")}
                    title="Classic list view"
                  >
                    [ ≡ LIST ]
                  </button>
                </div>
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
              ) : (() => {
                const top5 = rankings.slice(0, 5);
                const maxScore = Math.max(50, ...top5.map((s) => s.score));

                if (criticalityView === "combo") {
                  return (
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
                      <div className="lg:col-span-7 flex flex-col gap-2.5">
                        {top5.map((item, idx) => (
                          <TelemetryBarRow
                            key={item.service_id}
                            item={item}
                            idx={idx}
                            maxScore={maxScore}
                            onClick={() => navigate(`/graph?service=${item.service_id}`)}
                          />
                        ))}
                      </div>
                      <div className="lg:col-span-5 min-h-[300px]">
                        <MiniTopologySvg
                          top5={top5}
                          graphEdges={graph?.edges || []}
                          onSelectService={(id) => navigate(`/graph?service=${id}`)}
                        />
                      </div>
                    </div>
                  );
                }

                if (criticalityView === "bars") {
                  return (
                    <div className="flex flex-col gap-2.5">
                      {top5.map((item, idx) => (
                        <TelemetryBarRow
                          key={item.service_id}
                          item={item}
                          idx={idx}
                          maxScore={maxScore}
                          onClick={() => navigate(`/graph?service=${item.service_id}`)}
                        />
                      ))}
                    </div>
                  );
                }

                if (criticalityView === "topology") {
                  return (
                    <div className="min-h-[340px]">
                      <MiniTopologySvg
                        top5={top5}
                        graphEdges={graph?.edges || []}
                        onSelectService={(id) => navigate(`/graph?service=${id}`)}
                      />
                    </div>
                  );
                }

                // Default / Classic List
                return (
                  <div className="service-list">
                    {top5.map((item, idx) => {
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
                );
              })()}
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
