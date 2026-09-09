import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { GraphCanvas } from "../components/GraphCanvas";
import { Inspector } from "../components/Inspector";
import { SimulateConfirm } from "../components/SimulateConfirm";
import { SystemSidebar } from "../components/SystemSidebar";
import { useWorkspace } from "../state/workspace";

export function GraphWorkspace() {
  const [params, setSearchParams] = useSearchParams();
  const {
    mode,
    graph,
    validation,
    selectedId,
    focusId,
    simulation,
    error,
    visibleIds,
    openImport,
    selectService,
  } = useWorkspace();

  const hydrated = useRef(false);

  useEffect(() => {
    if (mode === "LOADING" || hydrated.current) return;
    if (mode === "NO_DATA" || mode === "ERROR") {
      hydrated.current = true;
      return;
    }
    hydrated.current = true;
    if (params.get("upload") === "1") openImport();
    const service = params.get("service");
    const sim = params.get("sim");
    if (service) void selectService(service, sim);
  }, [mode, openImport, params, selectService]);

  useEffect(() => {
    if (!hydrated.current || mode === "LOADING") return;
    const next = new URLSearchParams();
    if (selectedId) next.set("service", selectedId);
    if (mode === "SIMULATION_COMPLETE" && simulation) next.set("sim", simulation.simulation_id);
    setSearchParams(next, { replace: true });
  }, [mode, selectedId, setSearchParams, simulation]);

  const empty = graph.nodes.length === 0;
  const failedId = mode === "SIMULATION_COMPLETE" ? simulation?.failed_service.id ?? null : null;
  const incident = mode === "SIMULATION_COMPLETE";

  return (
    <div className="workspace">
      <SystemSidebar />
      <section className="graph-stage">
        <div className="graph-toolbar">
          <div>
            <div className="eyebrow">Dependency map</div>
            <p className="muted">A → B means A calls B. If B fails, A is in the blast radius.</p>
          </div>
          <button className="btn ghost" type="button" onClick={openImport}>
            Import Jaeger JSON
          </button>
        </div>
        {error && mode === "ERROR" ? <div className="error-banner">{error}</div> : null}
        {validation?.has_cycles ? (
          <div className="notice">
            Circular dependencies detected ({validation.cycle_count}). Analysis still runs; cycles are warnings.
          </div>
        ) : null}
        <div className="legend graph-legend">
          <span>
            <span className="dot healthy" /> Healthy
          </span>
          <span>
            <span className="dot degraded" /> Degraded
          </span>
          <span>
            <span className="dot unhealthy" /> Unhealthy
          </span>
          <span>→ Calls</span>
          {incident ? (
            <>
              <span>
                <span className="dot failed" /> Failed
              </span>
              <span>
                <span className="dot direct" /> Directly affected
              </span>
              <span>
                <span className="dot indirect" /> Indirectly affected
              </span>
            </>
          ) : null}
        </div>
        <div className="graph-frame">
          {empty ? (
            <div className="empty-graph">
              <div className="eyebrow">Empty dependency map</div>
              <h2>Your dependency map will appear here.</h2>
              <p className="muted">
                {mode === "ERROR"
                  ? "Unable to load system data."
                  : "No telemetry has been imported yet. Import a Jaeger JSON export to reconstruct your system."}
              </p>
              <div className="row">
                <button className="btn" type="button" onClick={openImport}>
                  Import Jaeger JSON
                </button>
              </div>
            </div>
          ) : (
            <GraphCanvas
              graph={graph}
              selectedId={selectedId}
              focusId={focusId}
              failedId={failedId}
              dimmed={visibleIds}
              onSelect={(id) => {
                if (!id && incident) return;
                void selectService(id);
              }}
            />
          )}
        </div>
      </section>
      <Inspector />
      <SimulateConfirm />
    </div>
  );
}
