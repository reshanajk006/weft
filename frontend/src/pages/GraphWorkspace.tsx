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
    <div className="flex flex-col h-[calc(100vh-54px)] bg-[#0B0F14] text-[#E5E7EB] font-mono overflow-hidden select-none">
      <main className="workspace flex-1 flex overflow-hidden bg-[#0B0F14] relative z-10">
        <SystemSidebar />
        <section className="graph-stage flex-1 relative flex flex-col bg-[#0B0F14] overflow-hidden" data-purpose="graph-viewport">
          {/* Diagonal Flowing Threads Wave Background (Canvas / SVG Wave Pattern) */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
            <svg
              className="w-full h-full opacity-35"
              preserveAspectRatio="none"
              viewBox="0 0 1200 800"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                <linearGradient id="waveGrad" x1="0%" x2="100%" y1="0%" y2="100%">
                  <stop offset="0%" stopColor="#6B7280" stopOpacity="0.05" />
                  <stop offset="50%" stopColor="#6B7280" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#6B7280" stopOpacity="0.05" />
                </linearGradient>
              </defs>
              <path d="M-100,50 C200,150 400,-50 700,200 C1000,450 1100,250 1400,400" fill="none" stroke="url(#waveGrad)" strokeWidth="1.2" />
              <path d="M-100,100 C220,200 420,0 720,250 C1020,500 1120,300 1400,450" fill="none" stroke="url(#waveGrad)" strokeWidth="1.2" />
              <path d="M-100,150 C240,250 440,50 740,300 C1040,550 1140,350 1400,500" fill="none" stroke="url(#waveGrad)" strokeWidth="1.2" />
              <path d="M-100,200 C260,300 460,100 760,350 C1060,600 1160,400 1400,550" fill="none" stroke="url(#waveGrad)" strokeWidth="1.2" />
              <path d="M-100,250 C280,350 480,150 780,400 C1080,650 1180,450 1400,600" fill="none" stroke="url(#waveGrad)" strokeWidth="1.2" />
              <path d="M-100,300 C300,400 500,200 800,450 C1100,700 1200,500 1400,650" fill="none" stroke="url(#waveGrad)" strokeWidth="1.2" />
              <path d="M-100,350 C320,450 520,250 820,500 C1120,750 1220,550 1400,700" fill="none" stroke="url(#waveGrad)" strokeWidth="1.2" />
              <path d="M-100,400 C340,500 540,300 840,550 C1140,800 1240,600 1400,750" fill="none" stroke="url(#waveGrad)" strokeWidth="1.2" />
              <path d="M-100,450 C360,550 560,350 860,600 C1160,850 1260,650 1400,800" fill="none" stroke="url(#waveGrad)" strokeWidth="1.2" />
              <path d="M-100,500 C380,600 580,400 880,650 C1180,900 1280,700 1400,850" fill="none" stroke="url(#waveGrad)" strokeWidth="1.2" />
              <path d="M-100,550 C400,650 600,450 900,700 C1200,950 1300,750 1400,900" fill="none" stroke="url(#waveGrad)" strokeWidth="1.2" />
            </svg>
          </div>

          {/* Top Graph Banner: Title, Editorial Serif Header, Subtitle, Legend & Action Button */}
          <div className="relative z-10 px-6 py-4 flex items-start justify-between border-b border-[#374151] bg-[#111827]/85 backdrop-blur-sm shrink-0">
            <div className="max-w-2xl">
              <div className="flex items-center space-x-3">
                <span className="px-2 py-0.5 font-mono text-[9px] font-bold tracking-wider rounded-xs bg-[#9CAFC4] text-[#0B0F14]">
                  HUD-MAP
                </span>
                <h1
                  className="text-lg md:text-xl text-[#E5E7EB] font-bold tracking-tight"
                  style={{ fontFamily: "'Press Start 2P', monospace", letterSpacing: "-0.02em" }}
                >
                  Dependency Map
                </h1>
              </div>
              <p className="text-xs text-[#94A3B8] font-mono mt-1.5 leading-relaxed">
                Upstream services (left) call downstream dependencies (right). Select any service to inspect blast radius.
              </p>
              {/* Graph Status Legend */}
              <div className="flex items-center space-x-4 mt-2.5 text-xs font-mono flex-wrap gap-y-1">
                <div className="flex items-center space-x-1.5">
                  <span className="w-2 h-2 bg-[#10b981] rounded-xs inline-block" />
                  <span className="text-[#94A3B8] text-[11px]">Healthy</span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <span className="w-2 h-2 bg-[#f59e0b] rounded-xs inline-block" />
                  <span className="text-[#94A3B8] text-[11px]">Degraded</span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <span className="w-2 h-2 bg-[#ef4444] rounded-xs inline-block" />
                  <span className="text-[#94A3B8] text-[11px]">Unhealthy</span>
                </div>
                <div className="flex items-center space-x-1.5 text-[#94A3B8]">
                  <span className="font-mono text-xs text-[#9CAFC4]">►</span>
                  <span className="text-[11px] text-[#94A3B8]">Calls</span>
                </div>
                {incident ? (
                  <>
                    <div className="flex items-center space-x-1.5">
                      <span className="w-2 h-2 bg-[#ef4444] rounded-xs inline-block" />
                      <span className="text-[#ef4444] text-[11px] font-semibold">Failed Target</span>
                    </div>
                    <div className="flex items-center space-x-1.5">
                      <span className="w-2 h-2 bg-[#f59e0b] rounded-xs inline-block" />
                      <span className="text-[#f59e0b] text-[11px] font-semibold">Directly Affected</span>
                    </div>
                    <div className="flex items-center space-x-1.5">
                      <span className="w-2 h-2 bg-[#d4b44a] rounded-xs inline-block" />
                      <span className="text-[#d4b44a] text-[11px] font-semibold">Indirectly Affected</span>
                    </div>
                  </>
                ) : null}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center space-x-2 shrink-0">
              <button
                className="flex items-center space-x-2 px-3.5 py-2 font-mono text-xs font-bold tracking-wider uppercase cursor-pointer rounded-sm hover:brightness-105 active:brightness-95 transition-all shadow-sm"
                style={{ backgroundColor: "#9CAFC4", color: "#0B0F14", border: "1px solid #cbd5e1" }}
                type="button"
                onClick={openImport}
              >
                <span className="text-xs">▲</span>
                <span>Import Jaeger JSON</span>
              </button>
              <button
                className="flex items-center space-x-2 px-3 py-2 font-mono text-xs font-semibold tracking-wider text-[#94A3B8] hover:text-[#E5E7EB] bg-[#1F2937] hover:bg-[#374151] border border-[#374151] cursor-pointer rounded-sm transition-colors"
                type="button"
                onClick={openJaeger}
              >
                <span>Connect Jaeger</span>
              </button>
            </div>
          </div>

          {/* Error and Notices */}
          {error && mode === "ERROR" ? (
            <div className="mx-6 mt-3 px-4 py-2.5 bg-[#ef4444]/15 border border-[#ef4444] text-[#ef4444] text-xs font-mono rounded-sm">
              {error}
            </div>
          ) : null}
          {jaeger.status === "error" && graph.nodes.length > 0 ? (
            <div className="mx-6 mt-3 px-4 py-2 bg-[#f59e0b]/15 border border-[#f59e0b] text-[#f59e0b] text-xs font-mono rounded-sm flex items-center justify-between">
              <span>Jaeger connection lost. Showing last known telemetry.</span>
              <button className="underline cursor-pointer font-bold ml-2" type="button" onClick={() => void reconnectJaeger()}>
                Reconnect
              </button>
            </div>
          ) : null}
          {validation?.has_cycles ? (
            <div className="mx-6 mt-3 px-4 py-2 bg-[#f59e0b]/15 border border-[#f59e0b] text-[#f59e0b] text-xs font-mono rounded-sm">
              Circular dependencies detected ({validation.cycle_count}). Analysis still runs; cycles are warnings.
            </div>
          ) : null}

          {/* Graph Diagram Stage */}
          <div className="relative flex-1 w-full h-full min-h-[460px] overflow-hidden" id="diagram-container">
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
                        <button className="btn ghost" type="button" onClick={openJaeger}>
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
      </main>
    </div>
  );
}
