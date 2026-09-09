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
    ingestSample,
  } = useWorkspace();
  const empty = mode === "NO_DATA" || mode === "ERROR" || !overview?.active_dataset;

  return (
    <aside className="sidebar">
      <div className="eyebrow">System</div>
      {empty ? (
        <>
          <p className="muted">No telemetry loaded.</p>
          <button className="btn" type="button" onClick={openImport}>
            Import Jaeger JSON
          </button>
          <button className="btn ghost" type="button" onClick={() => void ingestSample().catch(() => undefined)}>
            Load sample system
          </button>
        </>
      ) : (
        <>
          <div className="inspector-line">
            <span>Services</span>
            <strong>{overview?.service_count ?? 0}</strong>
          </div>
          <div className="inspector-line">
            <span>Dependencies</span>
            <strong>{overview?.dependency_count ?? 0}</strong>
          </div>
          <div className="eyebrow" style={{ marginTop: 16 }}>
            Health
          </div>
          <div className="inspector-line">
            <span>
              <span className="dot healthy" /> Healthy
            </span>
            <span>{overview?.healthy_count ?? 0}</span>
          </div>
          <div className="inspector-line">
            <span>
              <span className="dot degraded" /> Degraded
            </span>
            <span>{overview?.degraded_count ?? 0}</span>
          </div>
          <div className="inspector-line">
            <span>
              <span className="dot unhealthy" /> Unhealthy
            </span>
            <span>{overview?.unhealthy_count ?? 0}</span>
          </div>
        </>
      )}
      <div className="eyebrow" style={{ marginTop: 18 }}>
        Filters
      </div>
      <div className="field">
        <label>Health</label>
        <select value={healthFilter} onChange={(event) => setHealthFilter(event.target.value as typeof healthFilter)}>
          <option value="">All</option>
          <option value="HEALTHY">Healthy</option>
          <option value="DEGRADED">Degraded</option>
          <option value="UNHEALTHY">Unhealthy</option>
        </select>
      </div>
      <div className="field">
        <label>Criticality</label>
        <select
          value={criticalityFilter}
          onChange={(event) => setCriticalityFilter(event.target.value as typeof criticalityFilter)}
        >
          <option value="">All</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
        </select>
      </div>
    </aside>
  );
}
