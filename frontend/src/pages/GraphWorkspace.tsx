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
    overview,
    openImport,
    openJaeger,
    ingestSample,
    selectService,
    jaeger,
    reconnectJaeger,
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

  const empty =
    graph.nodes.length === 0 &&
    (overview?.service_count ?? 0) === 0 &&
    (jaeger.graph_service_count ?? 0) === 0;
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
          <div className="row">
            <button className="btn ghost" type="button" onClick={openImport}>
              Import Jaeger JSON
            </button>
            <button className="btn ghost" type="button" onClick={openJaeger}>
              Connect to Jaeger
            </button>
          </div>
        </div>
        {error && mode === "ERROR" ? <div className="error-banner">{error}</div> : null}
        {jaeger.status === "error" && graph.nodes.length > 0 ? (
          <div className="notice">
            Jaeger connection lost. Showing last known telemetry.{" "}
            <button className="linkish" type="button" onClick={() => void reconnectJaeger()}>
              Reconnect
            </button>
          </div>
        ) : null}
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
          {empty ? (
            <div className="empty-graph empty-graph-overlay">
              {jaeger.is_running || overview?.active_dataset ? (
                <>
                  <div className="eyebrow">{jaeger.is_running ? "Live ingestion active" : "Dataset loaded"}</div>
                  <h2>
                    {jaeger.is_running
                      ? "Waiting for traces from Jaeger."
                      : "This dataset has no services yet."}
                  </h2>
                  <p className="muted">
                    {jaeger.is_running
                      ? `Connected to ${jaeger.jaeger_url ?? "Jaeger"}. ${jaeger.services_discovered.length} service(s) discovered, ${jaeger.traces_ingested} traces ingested.${jaeger.last_poll_time ? ` Last poll ${new Date(jaeger.last_poll_time).toLocaleTimeString()}.` : ""}`
                      : "Import another file or connect to Jaeger to populate the graph."}
                  </p>
                  {jaeger.status === "error" ? (
                    <div className="error-banner">
                      {jaeger.error_message || "Jaeger connection lost."}{" "}
                      <button className="linkish" type="button" onClick={() => void reconnectJaeger()}>
                        Reconnect
                      </button>
                    </div>
                  ) : null}
                  <div className="row wrap">
                    <button className="btn" type="button" onClick={openJaeger}>
                      {jaeger.is_running ? "Live connection" : "Connect to Jaeger"}
                    </button>
                    <button className="btn ghost" type="button" onClick={openImport}>
                      Import Jaeger JSON
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="eyebrow">No system data loaded</div>
                  <h2>Import telemetry to reconstruct your service dependency graph.</h2>
                  <p className="muted">
                    {mode === "ERROR"
                      ? "Unable to load system data. The backend is unavailable or returned an error."
                      : "Nothing happens until you choose a source. WEFT will not invent a system for you."}
                  </p>
                  {mode !== "ERROR" ? (
                    <div className="row wrap">
                      <button className="btn" type="button" onClick={openImport}>
                        Import Jaeger JSON
                      </button>
                      <button className="btn" type="button" onClick={openJaeger}>
                        Connect to Jaeger
                      </button>
                      <button className="btn ghost" type="button" onClick={() => void ingestSample()}>
                        Load sample
                      </button>
                    </div>
                  ) : null}
                  {mode !== "ERROR" ? (
                    <p className="muted">
                      Import Jaeger JSON is static/pre-recorded telemetry. Connect to Jaeger is live Query API polling.
                      Load sample is an explicit local demonstration dataset.
                    </p>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
        </div>
      </section>
      <Inspector />
      <SimulateConfirm />
    </div>
  );
}
