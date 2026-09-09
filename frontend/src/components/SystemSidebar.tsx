import { useWorkspace } from "../state/workspace";

export function SystemSidebar() {
  const {
    mode,
    overview,
    healthFilter,
    criticalityFilter,
    setHealthFilter,
    setCriticalityFilter,
    openImport,
    openJaeger,
    ingestSample,
    jaeger,
  } = useWorkspace();

  const empty = mode === "NO_DATA" || mode === "ERROR" || !overview?.active_dataset;
  const serviceCount = overview?.service_count ?? (jaeger.is_running ? jaeger.graph_service_count ?? 0 : 0);
  const depCount = overview?.dependency_count ?? (jaeger.is_running ? jaeger.graph_service_count ? jaeger.graph_service_count - 1 : 0 : 0);

  return (
    <aside
      className="sidebar"
      style={{
        width: "256px",
        backgroundColor: "#111827",
        borderRight: "1px solid #374151",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "16px",
        overflowY: "auto",
        zIndex: 20,
        boxSizing: "border-box",
        fontFamily: "'Space Mono', monospace",
        flexShrink: 0,
      }}
      data-purpose="metrics-sidebar"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {/* Section: System Totals */}
        <div
          style={{
            border: "1px solid #374151",
            backgroundColor: "rgba(31, 41, 55, 0.6)",
            padding: "12px",
            borderRadius: "2px",
          }}
        >
          <div
            style={{
              fontSize: "10px",
              color: "#94A3B8",
              textTransform: "uppercase",
              marginBottom: "8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              borderBottom: "1px solid #374151",
              paddingBottom: "6px",
              letterSpacing: "0.08em",
              fontWeight: 700,
            }}
          >
            <span>// SYSTEM</span>
            <span style={{ width: "6px", height: "6px", backgroundColor: "#9CAFC4" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "11px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "2px 0",
                borderBottom: "1px solid rgba(55, 65, 81, 0.5)",
                color: "#94A3B8",
              }}
            >
              <span style={{ fontSize: "11px" }}>SERVICES</span>
              <span style={{ fontWeight: 700, color: "#E5E7EB" }}>
                {String(serviceCount).padStart(2, "0")}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "2px 0",
                color: "#94A3B8",
              }}
            >
              <span style={{ fontSize: "11px" }}>DEPENDENCIES</span>
              <span style={{ fontWeight: 700, color: "#E5E7EB" }}>
                {String(depCount).padStart(2, "0")}
              </span>
            </div>
          </div>
        </div>

        {/* Section: Health Breakdown */}
        <div
          style={{
            border: "1px solid #374151",
            backgroundColor: "rgba(31, 41, 55, 0.6)",
            padding: "12px",
            borderRadius: "2px",
          }}
        >
          <div
            style={{
              fontSize: "10px",
              color: "#94A3B8",
              textTransform: "uppercase",
              marginBottom: "10px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              borderBottom: "1px solid #374151",
              paddingBottom: "6px",
              letterSpacing: "0.08em",
              fontWeight: 700,
            }}
          >
            <span>// HEALTH BREAKDOWN</span>
            <span
              style={{
                fontSize: "9px",
                padding: "2px 6px",
                backgroundColor: "rgba(16, 185, 129, 0.15)",
                color: "#10b981",
                border: "1px solid rgba(16, 185, 129, 0.4)",
                borderRadius: "2px",
                fontWeight: 700,
              }}
            >
              LIVE
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "11px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "4px 0",
                borderBottom: "1px solid rgba(55, 65, 81, 0.5)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    backgroundColor: "#10b981",
                    borderRadius: "2px",
                    display: "inline-block",
                  }}
                />
                <span style={{ color: "#94A3B8" }}>Healthy</span>
              </div>
              <span style={{ fontWeight: 700, color: "#10b981" }}>
                {overview?.healthy_count ?? 0}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "4px 0",
                borderBottom: "1px solid rgba(55, 65, 81, 0.5)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    backgroundColor: "#f59e0b",
                    borderRadius: "2px",
                    display: "inline-block",
                  }}
                />
                <span style={{ color: "#94A3B8" }}>Degraded</span>
              </div>
              <span style={{ fontWeight: 700, color: "#f59e0b" }}>
                {overview?.degraded_count ?? 0}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "4px 0",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    backgroundColor: "#ef4444",
                    borderRadius: "2px",
                    display: "inline-block",
                  }}
                  className={(overview?.unhealthy_count ?? 0) > 0 ? "pixel-blink" : undefined}
                />
                <span style={{ color: (overview?.unhealthy_count ?? 0) > 0 ? "#ef4444" : "#94A3B8" }}>
                  Unhealthy
                </span>
              </div>
              <span style={{ fontWeight: 700, color: "#ef4444" }}>
                {overview?.unhealthy_count ?? 0}
              </span>
            </div>
          </div>
        </div>

        {/* Section: Filters */}
        <div
          style={{
            border: "1px solid #374151",
            backgroundColor: "rgba(31, 41, 55, 0.6)",
            padding: "12px",
            borderRadius: "2px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          <div
            style={{
              fontSize: "10px",
              color: "#94A3B8",
              textTransform: "uppercase",
              borderBottom: "1px solid #374151",
              paddingBottom: "6px",
              letterSpacing: "0.08em",
              fontWeight: 700,
            }}
          >
            // FILTERS
          </div>

          {/* Filter Health */}
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <label style={{ fontSize: "10px", color: "#94A3B8", fontWeight: 700 }}>HEALTH</label>
            <div style={{ position: "relative", width: "100%" }}>
              <select
                value={healthFilter}
                onChange={(event) =>
                  setHealthFilter(event.target.value as typeof healthFilter)
                }
                style={{
                  width: "100%",
                  border: "1px solid #374151",
                  fontSize: "11px",
                  color: "#E5E7EB",
                  backgroundColor: "#0B0F14",
                  padding: "6px 24px 6px 8px",
                  borderRadius: "2px",
                  outline: "none",
                  cursor: "pointer",
                  appearance: "none",
                }}
              >
                <option value="">All</option>
                <option value="HEALTHY">Healthy ({overview?.healthy_count ?? 0})</option>
                <option value="DEGRADED">Degraded ({overview?.degraded_count ?? 0})</option>
                <option value="UNHEALTHY">Unhealthy ({overview?.unhealthy_count ?? 0})</option>
              </select>
              <div
                style={{
                  pointerEvents: "none",
                  position: "absolute",
                  right: "8px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "#94A3B8",
                  fontSize: "9px",
                }}
              >
                ▼
              </div>
            </div>
          </div>

          {/* Filter Criticality */}
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <label style={{ fontSize: "10px", color: "#94A3B8", fontWeight: 700 }}>
              CRITICALITY
            </label>
            <div style={{ position: "relative", width: "100%" }}>
              <select
                value={criticalityFilter}
                onChange={(event) =>
                  setCriticalityFilter(event.target.value as typeof criticalityFilter)
                }
                style={{
                  width: "100%",
                  border: "1px solid #374151",
                  fontSize: "11px",
                  color: "#E5E7EB",
                  backgroundColor: "#0B0F14",
                  padding: "6px 24px 6px 8px",
                  borderRadius: "2px",
                  outline: "none",
                  cursor: "pointer",
                  appearance: "none",
                }}
              >
                <option value="">All</option>
                <option value="HIGH">High Criticality (&gt; 50)</option>
                <option value="MEDIUM">Medium (30 - 50)</option>
                <option value="LOW">Low (&lt; 30)</option>
              </select>
              <div
                style={{
                  pointerEvents: "none",
                  position: "absolute",
                  right: "8px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "#94A3B8",
                  fontSize: "9px",
                }}
              >
                ▼
              </div>
            </div>
          </div>
        </div>

        {empty && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              marginTop: "4px",
            }}
          >
            <button
              className="primary-map-btn"
              style={{ padding: "8px 12px", fontSize: "10px" }}
              type="button"
              onClick={openImport}
            >
              Import Jaeger JSON
            </button>
            <button
              className="overview-back-btn"
              style={{ width: "100%", justifyContent: "center", padding: "8px" }}
              type="button"
              onClick={openJaeger}
            >
              Connect to Jaeger
            </button>
            <button
              className="overview-back-btn"
              style={{ width: "100%", justifyContent: "center", padding: "8px" }}
              type="button"
              onClick={() => void ingestSample().catch(() => undefined)}
            >
              Load Sample
            </button>
          </div>
        )}
      </div>

      {/* Synced Status Footer */}
      <div
        style={{
          paddingTop: "12px",
          borderTop: "1px solid #374151",
          fontSize: "10px",
          color: "#94A3B8",
          marginTop: "16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
          <span
            style={{
              width: "7px",
              height: "7px",
              backgroundColor: jaeger.is_running || !empty ? "#10b981" : "#6B7280",
              borderRadius: "50%",
              display: "inline-block",
            }}
          />
          <span
            style={{
              fontSize: "9px",
              textTransform: "uppercase",
              color: jaeger.is_running || !empty ? "#10b981" : "#94A3B8",
              letterSpacing: "0.08em",
              fontWeight: 700,
            }}
          >
            SYNCED // TELEMETRY RUNTIME
          </span>
        </div>
        <p style={{ margin: 0, lineHeight: 1.4, fontSize: "10px", color: "#94A3B8" }}>
          {jaeger.is_running
            ? `Live Query polling (${jaeger.traces_ingested} traces).`
            : "Traces imported from OpenTelemetry v1.28 cluster."}
        </p>
      </div>
    </aside>
  );
}
