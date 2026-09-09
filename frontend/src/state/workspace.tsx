import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api";
import type {
  AppMode,
  CriticalityFilter,
  GraphResponse,
  GraphValidation,
  HealthFilter,
  IngestionResult,
  Overview,
  ServiceDashboard,
  SimulationResponse,
  TimelineEvent,
} from "../types";
import { criticalityBand } from "../types";

const EMPTY_GRAPH: GraphResponse = { nodes: [], edges: [] };

type WorkspaceValue = {
  mode: AppMode;
  overview: Overview | null;
  graph: GraphResponse;
  validation: GraphValidation | null;
  selectedId: string;
  dashboard: ServiceDashboard | null;
  simulation: SimulationResponse | null;
  timeline: TimelineEvent[];
  error: string | null;
  importOpen: boolean;
  healthFilter: HealthFilter;
  criticalityFilter: CriticalityFilter;
  focusId: string;
  ingestResult: IngestionResult | null;
  visibleIds: Set<string> | null;
  openImport: () => void;
  closeImport: () => void;
  refresh: (highlight?: string) => Promise<Overview>;
  selectService: (id: string, simId?: string | null) => Promise<void>;
  requestSimulate: () => void;
  cancelSimulate: () => void;
  runSimulate: () => Promise<void>;
  clearSimulation: () => Promise<void>;
  generateReport: () => Promise<void>;
  ingestFile: (file: File) => Promise<void>;
  ingestSample: () => Promise<void>;
  resetDatabase: () => Promise<void>;
  setHealthFilter: (value: HealthFilter) => void;
  setCriticalityFilter: (value: CriticalityFilter) => void;
  focusService: (id: string) => void;
  searchAndSelect: (query: string) => boolean;
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
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [healthFilter, setHealthFilter] = useState<HealthFilter>("");
  const [criticalityFilter, setCriticalityFilter] = useState<CriticalityFilter>("");
  const [focusId, setFocusId] = useState("");
  const [ingestResult, setIngestResult] = useState<IngestionResult | null>(null);

  const applySystem = useCallback((nextOverview: Overview, nextGraph: GraphResponse, nextValidation: GraphValidation) => {
    setOverview(nextOverview);
    setGraph(nextGraph);
    setValidation(nextValidation);
  }, []);

  const refresh = useCallback(async (highlight?: string) => {
    const [nextOverview, nextGraph, nextValidation] = await Promise.all([
      api.overview(),
      api.graph(highlight),
      api.graphValidation(),
    ]);
    applySystem(nextOverview, nextGraph, nextValidation);
    return nextOverview;
  }, [applySystem]);

  const bootstrap = useCallback(async () => {
    setMode("LOADING");
    setError(null);
    try {
      const [nextOverview, nextGraph, nextValidation] = await Promise.all([
        api.overview(),
        api.graph(),
        api.graphValidation(),
      ]);
      applySystem(nextOverview, nextGraph, nextValidation);
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

  const selectService = useCallback(
    async (id: string, simId?: string | null) => {
      setError(null);
      if (!id) {
        setSelectedId("");
        setDashboard(null);
        setSimulation(null);
        setTimeline([]);
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
          const [saved, events] = await Promise.all([api.simulation(simId), api.timeline(simId)]);
          setSimulation(saved);
          setTimeline(events.items);
          await refresh(saved.failed_service.id);
          setMode("SIMULATION_COMPLETE");
          return;
        }
        if (mode === "SIMULATION_COMPLETE" && simulation?.failed_service.id === id) {
          return;
        }
        setSimulation(null);
        setTimeline([]);
        await refresh();
        setMode("SERVICE_SELECTED");
      } catch (err) {
        setSelectedId("");
        setDashboard(null);
        setSimulation(null);
        try {
          const next = await refresh();
          setMode(next.active_dataset ? "READY" : "NO_DATA");
        } catch {
          setMode("ERROR");
        }
        setError(err instanceof Error ? err.message : "Failed to load service");
      }
    },
    [mode, overview, refresh, simulation],
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
      const events = await api.timeline(result.simulation_id);
      setSimulation(result);
      setTimeline(events.items);
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
        const next = await refresh();
        setMode(next.active_dataset ? "READY" : "NO_DATA");
        setImportOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Ingestion failed");
        throw err;
      }
    },
    [refresh],
  );

  const ingestSample = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/samples/sample_traces.json");
      if (!response.ok) throw new Error("Sample file is missing");
      const json = await response.json();
      const result = await api.ingestJson(json);
      setIngestResult(result);
      const next = await refresh();
      setMode(next.active_dataset ? "READY" : "NO_DATA");
      setImportOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sample ingest failed");
      throw err;
    }
  }, [refresh]);

  const resetDatabase = useCallback(async () => {
    setError(null);
    await api.resetDatabase();
    setSelectedId("");
    setDashboard(null);
    setSimulation(null);
    setTimeline([]);
    setIngestResult(null);
    setFocusId("");
    setGraph(EMPTY_GRAPH);
    const next = await refresh();
    setMode(next.active_dataset ? "READY" : "NO_DATA");
  }, [refresh]);

  const searchAndSelect = useCallback(
    (query: string) => {
      const needle = query.trim().toLowerCase();
      if (!needle) return false;
      const match = graph.nodes.find((node) => node.name.toLowerCase().includes(needle));
      if (!match) return false;
      void selectService(match.id);
      return true;
    },
    [graph.nodes, selectService],
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
    error,
    importOpen,
    healthFilter,
    criticalityFilter,
    focusId,
    ingestResult,
    visibleIds,
    openImport: () => setImportOpen(true),
    closeImport: () => setImportOpen(false),
    refresh,
    selectService,
    requestSimulate,
    cancelSimulate,
    runSimulate,
    clearSimulation,
    generateReport,
    ingestFile,
    ingestSample,
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
