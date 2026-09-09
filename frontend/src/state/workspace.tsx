import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "../api";
import type {
  AppMode,
  CriticalityFilter,
  GraphResponse,
  GraphValidation,
  HealthFilter,
  IncidentAnalysis,
  IngestionResult,
  JaegerStatus,
  Overview,
  ServiceDashboard,
  SimulationResponse,
  TimelineEvent,
} from "../types";
import { criticalityBand } from "../types";

function liveFingerprint(status: JaegerStatus) {
  return [
    status.last_poll_time ?? "",
    String(status.poll_generation ?? 0),
    String(status.traces_ingested),
    String(status.graph_service_count ?? 0),
    String(status.graph_dependency_count ?? 0),
    String(status.services_discovered.length),
    status.lookback ?? "",
  ].join("|");
}

const EMPTY_GRAPH: GraphResponse = { nodes: [], edges: [] };

const DISCONNECTED: JaegerStatus = {
  is_running: false,
  status: "disconnected",
  jaeger_url: null,
  started_at: null,
  last_poll_time: null,
  traces_ingested: 0,
  services_discovered: [],
  error_message: null,
  dataset_id: null,
  poll_interval: 5,
  max_traces_per_poll: 50,
  service_filter: null,
  lookback: "5m",
  poll_generation: 0,
  graph_service_count: 0,
  graph_dependency_count: 0,
};

type WorkspaceValue = {
  mode: AppMode;
  overview: Overview | null;
  graph: GraphResponse;
  validation: GraphValidation | null;
  selectedId: string;
  dashboard: ServiceDashboard | null;
  simulation: SimulationResponse | null;
  timeline: TimelineEvent[];
  analysis: IncidentAnalysis | null;
  error: string | null;
  importOpen: boolean;
  jaegerOpen: boolean;
  jaeger: JaegerStatus;
  healthFilter: HealthFilter;
  criticalityFilter: CriticalityFilter;
  focusId: string;
  ingestResult: IngestionResult | null;
  visibleIds: Set<string> | null;
  openImport: () => void;
  closeImport: () => void;
  openJaeger: () => void;
  closeJaeger: () => void;
  refresh: (highlight?: string) => Promise<Overview>;
  selectService: (id: string, simId?: string | null) => Promise<void>;
  requestSimulate: () => void;
  cancelSimulate: () => void;
  runSimulate: () => Promise<void>;
  clearSimulation: () => Promise<void>;
  generateReport: () => Promise<void>;
  ingestFile: (file: File) => Promise<void>;
  ingestSample: () => Promise<void>;
  connectJaeger: (body: {
    jaeger_url: string;
    poll_interval: number;
    max_traces_per_poll: number;
    service_filter?: string | null;
    lookback?: string;
  }) => Promise<JaegerStatus>;
  refreshLiveJaeger: (body: {
    jaeger_url: string;
    poll_interval: number;
    max_traces_per_poll: number;
    service_filter?: string | null;
    lookback?: string;
  }) => Promise<JaegerStatus>;
  disconnectJaeger: () => Promise<void>;
  reconnectJaeger: () => Promise<void>;
  resetDatabase: () => Promise<void>;
  setHealthFilter: (value: HealthFilter) => void;
  setCriticalityFilter: (value: CriticalityFilter) => void;
  focusService: (id: string) => void;
  searchAndSelect: (query: string) => Promise<boolean>;
};

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<AppMode>("LOADING");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [graph, setGraph] = useState<GraphResponse>(EMPTY_GRAPH);
  const [validation, setValidation] = useState<GraphValidation | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [dashboard, setDashboard] = useState<ServiceDashboard | null>(null);
  const [simulation, setSimulation] = useState<SimulationResponse | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [analysis, setAnalysis] = useState<IncidentAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [jaegerOpen, setJaegerOpen] = useState(false);
  const [jaeger, setJaeger] = useState<JaegerStatus>(DISCONNECTED);
  const [healthFilter, setHealthFilter] = useState<HealthFilter>("");
  const [criticalityFilter, setCriticalityFilter] = useState<CriticalityFilter>("");
  const [focusId, setFocusId] = useState("");
  const [ingestResult, setIngestResult] = useState<IngestionResult | null>(null);
  const lastPollRef = useRef<string | null>(null);
  const refreshSeq = useRef(0);

  const applySystem = useCallback((nextOverview: Overview, nextGraph: GraphResponse, nextValidation: GraphValidation) => {
    setOverview(nextOverview);
    setGraph(nextGraph);
    setValidation(nextValidation);
    setSelectedId((current) => {
      if (!current || nextGraph.nodes.some((node) => node.id === current)) return current;
      setDashboard(null);
      setSimulation(null);
      setTimeline([]);
      setAnalysis(null);
      setFocusId("");
      return "";
    });
  }, []);

  const refresh = useCallback(async (highlight?: string) => {
    const seq = ++refreshSeq.current;
    const [nextOverview, nextGraph, nextValidation] = await Promise.all([
      api.overview(),
      api.graph(highlight),
      api.graphValidation(),
    ]);
    if (seq !== refreshSeq.current) return nextOverview;
    applySystem(nextOverview, nextGraph, nextValidation);
    return nextOverview;
  }, [applySystem]);

  const refreshJaeger = useCallback(async () => {
    try {
      const next = await api.jaegerStatus();
      setJaeger(next);
      return next;
    } catch {
      return null;
    }
  }, []);

  const bootstrap = useCallback(async () => {
    setMode("LOADING");
    setError(null);
    try {
      const [nextOverview, nextGraph, nextValidation, nextJaeger] = await Promise.all([
        api.overview(),
        api.graph(),
        api.graphValidation(),
        api.jaegerStatus().catch(() => DISCONNECTED),
      ]);
      applySystem(nextOverview, nextGraph, nextValidation);
      setJaeger(nextJaeger);
      lastPollRef.current = liveFingerprint(nextJaeger);
      setMode(nextOverview.active_dataset ? "READY" : "NO_DATA");
    } catch (err) {
      setOverview(null);
      setGraph(EMPTY_GRAPH);
      setValidation(null);
      setError(err instanceof Error ? err.message : "Unable to load system data.");
      setMode("ERROR");
    }
  }, [applySystem]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (!jaeger.is_running && jaeger.status !== "error") return;
    const timer = window.setInterval(async () => {
      const next = await refreshJaeger();
      if (!next) return;
      const fingerprint = liveFingerprint(next);
      const topologyChanged = fingerprint !== lastPollRef.current;
      const expected = next.graph_service_count ?? 0;
      const missingGraph = expected > 0 && graph.nodes.length === 0;
      const countMismatch = expected > 0 && graph.nodes.length !== expected;
      if (!topologyChanged && !missingGraph && !countMismatch) return;
      lastPollRef.current = fingerprint;
      try {
        const highlight =
          mode === "SIMULATION_COMPLETE" && simulation ? simulation.failed_service.id : undefined;
        await refresh(highlight);
        if (selectedId) {
          const detail = await api.dashboard(selectedId);
          setDashboard(detail);
        }
      } catch {
        /* keep last known graph */
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [
    jaeger.is_running,
    jaeger.status,
    refresh,
    refreshJaeger,
    mode,
    simulation,
    selectedId,
    graph.nodes.length,
  ]);

  const selectService = useCallback(
    async (id: string, simId?: string | null) => {
      setError(null);
      if (!id) {
        setSelectedId("");
        setDashboard(null);
        setSimulation(null);
        setTimeline([]);
        setAnalysis(null);
        setFocusId("");
        try {
          const next = await refresh();
          setMode(next.active_dataset ? "READY" : "NO_DATA");
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to reload graph");
          setMode("ERROR");
        }
        return;
      }
      try {
        const detail = await api.dashboard(id);
        setSelectedId(id);
        setDashboard(detail);
        setFocusId(id);
        if (simId) {
          const [saved, events, nextAnalysis] = await Promise.all([
            api.simulation(simId),
            api.timeline(simId),
            api.simulationAnalysis(simId),
          ]);
          setSimulation(saved);
          setTimeline(events.items);
          setAnalysis(nextAnalysis);
          await refresh(saved.failed_service.id);
          setMode("SIMULATION_COMPLETE");
          return;
        }
        if (mode === "SIMULATION_COMPLETE" && simulation?.failed_service.id === id) {
          return;
        }
        setSimulation(null);
        setTimeline([]);
        setAnalysis(null);
        await refresh();
        setMode("SERVICE_SELECTED");
      } catch (err) {
        setSelectedId("");
        setDashboard(null);
        setSimulation(null);
        setAnalysis(null);
        try {
          const next = await refresh();
          setMode(next.active_dataset ? "READY" : "NO_DATA");
        } catch {
          setMode("ERROR");
        }
        setError(err instanceof Error ? err.message : "Failed to load service");
      }
    },
    [mode, refresh, simulation],
  );

  const requestSimulate = useCallback(() => {
    if (!selectedId || !dashboard) return;
    setMode("SIMULATION_CONFIRMATION");
  }, [dashboard, selectedId]);

  const cancelSimulate = useCallback(() => {
    if (selectedId) setMode("SERVICE_SELECTED");
    else setMode(overview?.active_dataset ? "READY" : "NO_DATA");
  }, [overview, selectedId]);

  const runSimulate = useCallback(async () => {
    if (!selectedId) return;
    setMode("SIMULATING");
    setError(null);
    try {
      const result = await api.simulateFailure(selectedId);
      const [events, nextAnalysis] = await Promise.all([
        api.timeline(result.simulation_id),
        api.simulationAnalysis(result.simulation_id),
      ]);
      setSimulation(result);
      setTimeline(events.items);
      setAnalysis(nextAnalysis);
      await refresh(result.failed_service.id);
      setMode("SIMULATION_COMPLETE");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Simulation failed");
      setMode("ERROR");
    }
  }, [refresh, selectedId]);

  const clearSimulation = useCallback(async () => {
    setSimulation(null);
    setTimeline([]);
    setAnalysis(null);
    setError(null);
    try {
      await refresh();
      setMode(selectedId ? "SERVICE_SELECTED" : overview?.active_dataset ? "READY" : "NO_DATA");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restore live graph");
      setMode("ERROR");
    }
  }, [overview, refresh, selectedId]);

  const generateReport = useCallback(async () => {
    if (!simulation) return;
    const report = await api.reports(simulation.simulation_id, "markdown");
    const blob = new Blob([report.content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `weft-impact-${simulation.failed_service.name}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }, [simulation]);

  const ingestFile = useCallback(
    async (file: File) => {
      setError(null);
      try {
        const result = await api.uploadTrace(file);
        setIngestResult(result);
        await refreshJaeger();
        const next = await refresh();
        setMode(next.active_dataset ? "READY" : "NO_DATA");
        setImportOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Ingestion failed");
        throw err;
      }
    },
    [refresh, refreshJaeger],
  );

  const ingestSample = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/samples/sample_traces.json");
      if (!response.ok) throw new Error("Sample file is missing");
      const json = await response.json();
      const result = await api.ingestJson(json);
      setIngestResult(result);
      await refreshJaeger();
      const next = await refresh();
      setMode(next.active_dataset ? "READY" : "NO_DATA");
      setImportOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sample ingest failed");
      throw err;
    }
  }, [refresh, refreshJaeger]);

  const connectJaeger = useCallback(
    async (body: {
      jaeger_url: string;
      poll_interval: number;
      max_traces_per_poll: number;
      service_filter?: string | null;
      lookback?: string;
    }) => {
      let status;
      try {
        status = await api.jaegerConnect(body);
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          status = await api.jaegerStatus();
        } else {
          throw err;
        }
      }
      setJaeger(status);
      lastPollRef.current = liveFingerprint(status);
      const next = await refresh();
      setMode(next.active_dataset || status.is_running ? "READY" : "NO_DATA");
      setJaegerOpen(false);
      return status;
    },
    [refresh],
  );

  const refreshLiveJaeger = useCallback(
    async (body: {
      jaeger_url: string;
      poll_interval: number;
      max_traces_per_poll: number;
      service_filter?: string | null;
      lookback?: string;
    }) => {
      const status = await api.jaegerRefresh(body);
      setJaeger(status);
      lastPollRef.current = liveFingerprint(status);
      const next = await refresh();
      setMode(next.active_dataset || status.is_running ? "READY" : "NO_DATA");
      return status;
    },
    [refresh],
  );

  const disconnectJaeger = useCallback(async () => {
    const status = await api.jaegerDisconnect();
    setJaeger(status);
  }, []);

  const reconnectJaeger = useCallback(async () => {
    const status = await api.jaegerReconnect();
    setJaeger(status);
    lastPollRef.current = liveFingerprint(status);
    const next = await refresh();
    setMode(next.active_dataset ? "READY" : "NO_DATA");
  }, [refresh]);

  const resetDatabase = useCallback(async () => {
    setError(null);
    try {
      await api.jaegerDisconnect();
    } catch {
      /* already stopped */
    }
    await api.resetDatabase();
    setSelectedId("");
    setDashboard(null);
    setSimulation(null);
    setTimeline([]);
    setAnalysis(null);
    setIngestResult(null);
    setFocusId("");
    setGraph(EMPTY_GRAPH);
    setJaeger(DISCONNECTED);
    lastPollRef.current = null;
    const next = await refresh();
    setMode(next.active_dataset ? "READY" : "NO_DATA");
  }, [refresh]);

  const searchAndSelect = useCallback(
    async (query: string) => {
      const needle = query.trim();
      if (!needle) return false;
      const result = await api.services({ q: needle, limit: 10 });
      if (!result.items.length) return false;
      await selectService(result.items[0].id);
      return true;
    },
    [selectService],
  );

  const visibleIds = useMemo(() => {
    if (!healthFilter && !criticalityFilter) return null;
    const ids = new Set<string>();
    graph.nodes.forEach((node) => {
      const healthOk = !healthFilter || node.health_status === healthFilter;
      const critOk = !criticalityFilter || criticalityBand(node.criticality_score) === criticalityFilter;
      if (healthOk && critOk) ids.add(node.id);
    });
    return ids;
  }, [criticalityFilter, graph.nodes, healthFilter]);

  const value: WorkspaceValue = {
    mode,
    overview,
    graph,
    validation,
    selectedId,
    dashboard,
    simulation,
    timeline,
    analysis,
    error,
    importOpen,
    jaegerOpen,
    jaeger,
    healthFilter,
    criticalityFilter,
    focusId,
    ingestResult,
    visibleIds,
    openImport: () => setImportOpen(true),
    closeImport: () => setImportOpen(false),
    openJaeger: () => {
      setJaegerOpen(true);
      void refreshJaeger();
    },
    closeJaeger: () => setJaegerOpen(false),
    refresh,
    selectService,
    requestSimulate,
    cancelSimulate,
    runSimulate,
    clearSimulation,
    generateReport,
    ingestFile,
    ingestSample,
    connectJaeger,
    refreshLiveJaeger,
    disconnectJaeger,
    reconnectJaeger,
    resetDatabase,
    setHealthFilter,
    setCriticalityFilter,
    focusService: setFocusId,
    searchAndSelect,
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return value;
}
