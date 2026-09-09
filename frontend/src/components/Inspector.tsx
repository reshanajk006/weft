import { FileText } from "lucide-react";
import { useWorkspace } from "../state/workspace";
import { StatusPill } from "./StatusPill";

function renderAsciiBar(val: number) {
  const blocks = Math.min(8, Math.max(0, Math.round((Math.max(0, val) / 100) * 8)));
  const filled = "■".repeat(blocks);
  const empty = "□".repeat(8 - blocks);
  return `[${filled}${empty}]`;
}

export function Inspector() {
  const {
    mode,
    dashboard,
    simulation,
    timeline,
    analysis,
    error,
    selectService,
    requestSimulate,
    clearSimulation,
    generateReport,
    runMitigation,
  } = useWorkspace();

  if (!dashboard) {
    return (
      <aside
        className="inspector"
        style={{
          width: "320px",
          backgroundColor: "#111827",
          borderLeft: "1px solid #374151",
          padding: "16px",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "14px",
          fontFamily: "'Space Mono', monospace",
          zIndex: 20,
          boxSizing: "border-box",
          flexShrink: 0,
        }}
        data-purpose="service-inspector"
      >
        <div
          style={{
            border: "1px solid #374151",
            backgroundColor: "rgba(31, 41, 55, 0.6)",
            padding: "16px",
            borderRadius: "2px",
          }}
        >
          <div style={{ fontSize: "10px", color: "#94A3B8", textTransform: "uppercase", marginBottom: "6px", fontWeight: 700 }}>
            // SERVICE INSPECTOR
          </div>
          <h2 style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: "20px", fontWeight: 400, color: "#E5E7EB", margin: "0 0 8px 0" }}>
            Nothing selected
          </h2>
          <p style={{ fontSize: "12px", color: "#94A3B8", margin: 0, lineHeight: 1.5 }}>
            &gt; Click any node on the dependency map to inspect technical telemetry, dependencies, and simulate blast radius.
          </p>
        </div>
      </aside>
    );
  }

  const incident = mode === "SIMULATION_COMPLETE" && simulation?.failed_service.id === dashboard.service.id;
  const root = analysis?.root_cause;
  const target = root?.selected_target;
  const observedStatus = root?.observed_status || target?.observed_status || dashboard.health.status;
  const observedScore = root?.observed_health_score ?? target?.observed_health_score ?? dashboard.health.score;
  const mitigation = simulation?.mitigation || analysis?.mitigation || null;
  const breakdown = simulation?.score_breakdown;

  return (
    <aside
      className="inspector"
      style={{
        width: "320px",
        backgroundColor: "#111827",
        borderLeft: "1px solid #374151",
        padding: "16px",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        gap: "16px",
        fontFamily: "'Space Mono', monospace",
        zIndex: 20,
        boxSizing: "border-box",
        flexShrink: 0,
      }}
      data-purpose="service-inspector"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {/* Header & Target Identity */}
        <div
          style={{
            border: "1px solid #374151",
            backgroundColor: "rgba(31, 41, 55, 0.6)",
            padding: "14px",
            borderRadius: "2px",
          }}
        >
          <div
            style={{
              fontSize: "10px",
              color: "#94A3B8",
              textTransform: "uppercase",
              marginBottom: "4px",
              letterSpacing: "0.08em",
              fontWeight: 700,
            }}
          >
            // {incident ? "HYPOTHETICAL FAILURE" : "TARGET SERVICE"}
          </div>
          <h2
            style={{
              fontFamily: "'Newsreader', Georgia, serif",
              fontSize: "22px",
              fontWeight: 400,
              color: "#E5E7EB",
              margin: "0 0 8px 0",
              letterSpacing: "-0.01em",
            }}
          >
            {dashboard.service.name}
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <StatusPill value={incident ? "FAILED" : dashboard.health.status} />
            <span
              style={{
                fontSize: "9px",
                padding: "2px 6px",
                backgroundColor: "#1F2937",
                border: "1px solid #374151",
                color: "#94A3B8",
                fontWeight: 700,
              }}
            >
              {(dashboard.criticality?.score ?? dashboard.service.criticality_score ?? 0) >= 50
                ? "HIGH CRIT"
                : (dashboard.criticality?.score ?? dashboard.service.criticality_score ?? 0) >= 30
                ? "MED CRIT"
                : "LOW CRIT"}
            </span>
          </div>
        </div>

        {error && <div className="error-banner" style={{ margin: 0, fontSize: "11px" }}>{error}</div>}

        {!incident ? (
          <>
            {/* Technical Telemetry Metrics Grid (2x2) */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              {/* Metric 1: Health Score */}
              <div
                style={{
                  border: "1px solid #374151",
                  backgroundColor: "#1F2937",
                  padding: "10px",
                  borderRadius: "2px",
                }}
              >
                <div style={{ fontSize: "10px", color: "#94A3B8", textTransform: "uppercase", marginBottom: "2px" }}>
                  HEALTH
                </div>
                <div style={{ fontSize: "20px", fontWeight: 700, color: "#E5E7EB" }}>
                  {Math.round(dashboard.health.score)}
                </div>
                <div style={{ fontSize: "10px", color: "#10b981", marginTop: "4px", letterSpacing: "-1px" }}>
                  {renderAsciiBar(dashboard.health.score)}
                </div>
              </div>

              {/* Metric 2: Error Rate */}
              <div
                style={{
                  border: "1px solid #374151",
                  backgroundColor: "#1F2937",
                  padding: "10px",
                  borderRadius: "2px",
                }}
              >
                <div style={{ fontSize: "10px", color: "#94A3B8", textTransform: "uppercase", marginBottom: "2px" }}>
                  ERROR RATE
                </div>
                <div style={{ fontSize: "20px", fontWeight: 700, color: "#E5E7EB" }}>
                  {(dashboard.metrics.error_rate * 100).toFixed(1)}%
                </div>
                <div
                  style={{
                    fontSize: "10px",
                    color: dashboard.metrics.error_rate > 0.05 ? "#ef4444" : "#6B7280",
                    marginTop: "4px",
                    letterSpacing: "-1px",
                  }}
                >
                  {renderAsciiBar(dashboard.metrics.error_rate * 100)}
                </div>
              </div>

              {/* Metric 3: Avg Latency */}
              <div
                style={{
                  border: "1px solid #374151",
                  backgroundColor: "#1F2937",
                  padding: "10px",
                  borderRadius: "2px",
                }}
              >
                <div style={{ fontSize: "10px", color: "#94A3B8", textTransform: "uppercase", marginBottom: "2px" }}>
                  AVG LATENCY
                </div>
                <div style={{ fontSize: "20px", fontWeight: 700, color: "#E5E7EB" }}>
                  {dashboard.metrics.avg_latency_ms.toFixed(0)}
                  <span style={{ fontSize: "11px", color: "#94A3B8", marginLeft: "2px" }}>ms</span>
                </div>
                <div style={{ fontSize: "10px", color: "#f59e0b", marginTop: "4px", letterSpacing: "-1px" }}>
                  {renderAsciiBar(Math.min(100, dashboard.metrics.avg_latency_ms / 5))}
                </div>
              </div>

              {/* Metric 4: Technical Criticality */}
              <div
                style={{
                  border: "1px solid #374151",
                  backgroundColor: "#1F2937",
                  padding: "10px",
                  borderRadius: "2px",
                }}
              >
                <div style={{ fontSize: "10px", color: "#94A3B8", textTransform: "uppercase", marginBottom: "2px" }}>
                  CRITICALITY
                </div>
                <div style={{ fontSize: "20px", fontWeight: 700, color: "#E5E7EB" }}>
                  {dashboard.criticality.score.toFixed(1)}
                </div>
                <div style={{ fontSize: "10px", color: "#9CAFC4", marginTop: "4px", letterSpacing: "-1px" }}>
                  {renderAsciiBar(dashboard.criticality.score)}
                </div>
              </div>
            </div>

            {/* Dependency Relations: Called By */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{ fontSize: "10px", color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                &gt; CALLED BY
              </div>
              {dashboard.upstream.length === 0 ? (
                <p style={{ fontSize: "11px", color: "#6B7280", margin: 0 }}>None (Ingress root node)</p>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {dashboard.upstream.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => void selectService(item.id)}
                      style={{
                        fontFamily: "'Space Mono', monospace",
                        fontSize: "11px",
                        color: "#E5E7EB",
                        backgroundColor: "#0B0F14",
                        border: "1px solid #374151",
                        padding: "4px 8px",
                        borderRadius: "2px",
                        cursor: "pointer",
                        transition: "border-color 0.15s",
                      }}
                    >
                      {item.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Dependency Relations: Calls */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{ fontSize: "10px", color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                &gt; CALLS
              </div>
              {dashboard.downstream.length === 0 ? (
                <p style={{ fontSize: "11px", color: "#6B7280", margin: 0 }}>None (Leaf service)</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  {dashboard.downstream.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => void selectService(item.id)}
                      style={{
                        backgroundColor: "#0B0F14",
                        border: "1px solid #374151",
                        color: "#E5E7EB",
                        padding: "6px 8px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        borderRadius: "2px",
                        cursor: "pointer",
                        fontSize: "11px",
                        fontFamily: "'Space Mono', monospace",
                      }}
                    >
                      <span>{item.name}</span>
                      <span style={{ width: "6px", height: "6px", backgroundColor: "#10b981", borderRadius: "50%" }} />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Section: Failure Analysis & Blast Radius */}
            <div
              style={{
                borderTop: "1px solid #374151",
                paddingTop: "12px",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              <div style={{ fontSize: "10px", color: "#ef4444", textTransform: "uppercase", fontWeight: 700 }}>
                // FAILURE ANALYSIS
              </div>
              <p style={{ fontSize: "11px", color: "#94A3B8", margin: 0, lineHeight: 1.4 }}>
                What happens if this service fails?
              </p>

              <button
                className="primary-map-btn"
                style={{
                  width: "100%",
                  padding: "10px",
                  fontSize: "11px",
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                }}
                type="button"
                onClick={requestSimulate}
              >
                [ SIMULATE FAILURE BLAST RADIUS ]
              </button>
            </div>
          </>
        ) : (
          /* When in Simulation Incident Mode */
          <>
            {/* Fact Block */}
            <div
              style={{
                border: "1px solid #374151",
                backgroundColor: "rgba(31, 41, 55, 0.6)",
                padding: "12px",
                borderRadius: "2px",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                fontSize: "11px",
              }}
            >
              <div style={{ fontSize: "10px", color: "#ef4444", textTransform: "uppercase", fontWeight: 700, marginBottom: "4px" }}>
                // OBSERVED FACT
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", color: "#94A3B8" }}>
                <span>Scenario</span>
                <span style={{ color: "#E5E7EB" }}>Hypothetical failure</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", color: "#94A3B8" }}>
                <span>Target</span>
                <span style={{ color: "#E5E7EB", fontWeight: 700 }}>{dashboard.service.name}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", color: "#94A3B8" }}>
                <span>Observed status</span>
                <StatusPill value={observedStatus} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", color: "#94A3B8" }}>
                <span>Observed health</span>
                <span style={{ color: "#ef4444", fontWeight: 700 }}>{Math.round(Number(observedScore))}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", color: "#94A3B8" }}>
                <span>Root cause</span>
                <span style={{ color: "#E5E7EB" }}>{root?.root_cause_status || "NOT DETERMINED"}</span>
              </div>
              {root?.disclaimer && <p style={{ fontSize: "10px", color: "#6B7280", margin: "4px 0 0 0" }}>{root.disclaimer}</p>}
            </div>

            {/* Blast Radius Score Block */}
            <div
              style={{
                border: "1px solid #ef4444",
                backgroundColor: "rgba(239, 68, 68, 0.08)",
                padding: "12px",
                borderRadius: "2px",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              }}
            >
              <div style={{ fontSize: "10px", color: "#ef4444", textTransform: "uppercase", fontWeight: 700 }}>
                // PREDICTED IMPACT &amp; BLAST RADIUS
              </div>
              <div style={{ fontSize: "28px", fontWeight: 700, color: "#ef4444", lineHeight: 1 }}>
                {simulation.blast_radius_score.toFixed(0)} <span style={{ fontSize: "14px", color: "#94A3B8" }}>/ 100</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#94A3B8" }}>
                <span>Services affected:</span>
                <span style={{ color: "#E5E7EB", fontWeight: 700 }}>{simulation.services_affected}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#94A3B8" }}>
                <span>Impact severity:</span>
                <StatusPill value={simulation.severity} />
              </div>
              {breakdown && (
                <div style={{ borderTop: "1px solid rgba(239, 68, 68, 0.2)", paddingTop: "6px", marginTop: "4px", fontSize: "10px", color: "#94A3B8" }}>
                  <div>Affected ratio: {((breakdown.affected_ratio || 0) * 100).toFixed(1)}%</div>
                  <div>Mean probability: {(((breakdown.mean_impact_probability ?? breakdown.weighted_impact) || 0) * 100).toFixed(1)}%</div>
                </div>
              )}
            </div>

            {/* Affected Services */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{ fontSize: "10px", color: "#94A3B8", textTransform: "uppercase" }}>
                &gt; AFFECTED SERVICES ({simulation.affected_services.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {simulation.affected_services.map((item) => (
                  <div
                    key={item.service_id}
                    style={{
                      backgroundColor: "#0B0F14",
                      border: "1px solid #374151",
                      padding: "6px 8px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      fontSize: "11px",
                    }}
                  >
                    <span style={{ color: "#E5E7EB" }}>{item.service_name}</span>
                    <StatusPill value={item.impact_level} />
                  </div>
                ))}
              </div>
            </div>

            {/* Virtual Mitigation */}
            <div
              style={{
                border: "1px solid #374151",
                backgroundColor: "#1F2937",
                padding: "10px",
                borderRadius: "2px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              <div style={{ fontSize: "10px", color: "#9CAFC4", textTransform: "uppercase", fontWeight: 700 }}>
                // VIRTUAL MITIGATION
              </div>
              {mitigation?.mitigated && mitigation.improvement ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "10px" }}>
                  <div style={{ border: "1px solid #374151", padding: "6px", backgroundColor: "#0B0F14" }}>
                    <div style={{ color: "#94A3B8" }}>BASELINE</div>
                    <div style={{ color: "#ef4444" }}>Score: {mitigation.baseline.blast_radius_score.toFixed(1)}</div>
                    <div>Affected: {mitigation.baseline.affected_services}</div>
                  </div>
                  <div style={{ border: "1px solid #10b981", padding: "6px", backgroundColor: "#0B0F14" }}>
                    <div style={{ color: "#10b981" }}>MITIGATED</div>
                    <div style={{ color: "#10b981" }}>Score: {mitigation.mitigated.blast_radius_score.toFixed(1)}</div>
                    <div>Affected: {mitigation.mitigated.affected_services}</div>
                  </div>
                </div>
              ) : (
                <p style={{ fontSize: "10px", color: "#94A3B8", margin: 0 }}>Comparison not executed.</p>
              )}
              <button
                className="overview-back-btn"
                style={{ width: "100%", justifyContent: "center", padding: "6px", fontSize: "10px" }}
                type="button"
                onClick={() => void runMitigation()}
              >
                Run Virtual Mitigation
              </button>
            </div>

            {/* Action Buttons */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <button
                className="primary-map-btn"
                style={{ width: "100%", padding: "8px", fontSize: "11px" }}
                type="button"
                onClick={() => void generateReport()}
              >
                <FileText size={14} />
                <span>Generate Incident Report</span>
              </button>
              <button
                className="overview-back-btn"
                style={{ width: "100%", justifyContent: "center", padding: "8px" }}
                type="button"
                onClick={() => void clearSimulation()}
              >
                Return to Live System
              </button>
            </div>
          </>
        )}
      </div>

      {/* Inspector Footer */}
      <div
        style={{
          borderTop: "1px solid #374151",
          paddingTop: "10px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "10px",
          color: "#94A3B8",
          marginTop: "12px",
        }}
      >
        <span>ID: {dashboard.service.id.slice(0, 12)}</span>
        <span style={{ color: "#10b981", fontWeight: 700 }}>RUNTIME OK</span>
      </div>
    </aside>
  );
}
