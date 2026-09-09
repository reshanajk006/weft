import type {
  GraphResponse,
  GraphValidation,
  IngestionResult,
  Overview,
  Paginated,
  RankingItem,
  ReportResponse,
  ServiceDashboard,
  ServiceSummary,
  SimulationListItem,
  SimulationResponse,
  TimelineEvent,
} from "./types";

export class ApiError extends Error {
  code: string;
  details: unknown;
  status: number;

  constructor(status: number, code: string, message: string, details: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: { message: text } };
    }
  }
  if (!response.ok) {
    const err = (payload as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error ?? {};
    throw new ApiError(
      response.status,
      err.code ?? "HTTP_ERROR",
      err.message ?? response.statusText,
      err.details ?? {},
    );
  }
  return payload as T;
}

export const api = {
  health: () => request<{ status: string; service: string; version: string }>("/api/health"),
  overview: () => request<Overview>("/api/overview"),
  activeDataset: () => request<{ dataset: Overview["active_dataset"] }>("/api/datasets/active"),
  graph: (highlight?: string) => {
    const query = highlight ? `?highlight_service_id=${encodeURIComponent(highlight)}` : "";
    return request<GraphResponse>(`/api/graph${query}`);
  },
  graphValidation: () => request<GraphValidation>("/api/graph/validation"),
  services: (params: Record<string, string | number | undefined> = {}) => {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "") search.set(key, String(value));
    });
    const suffix = search.toString() ? `?${search}` : "";
    return request<Paginated<ServiceSummary>>(`/api/services${suffix}`);
  },
  dashboard: (id: string) => request<ServiceDashboard>(`/api/services/${id}/dashboard`),
  criticality: () =>
    request<{ items: RankingItem[]; total: number }>("/api/criticality/rankings"),
  simulateFailure: (id: string) =>
    request<SimulationResponse>(`/api/simulate/failure/${id}`, { method: "POST" }),
  simulations: () => request<Paginated<SimulationListItem>>("/api/simulations"),
  simulation: (id: string) => request<SimulationResponse>(`/api/simulations/${id}`),
  timeline: (id: string) =>
    request<{ simulation_id: string; items: TimelineEvent[] }>(`/api/simulations/${id}/timeline`),
  reports: (simulationId: string, format: "markdown" | "json") =>
    request<ReportResponse>("/api/reports/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ simulation_id: simulationId, format }),
    }),
  thresholds: () => request<Record<string, unknown>>("/api/config/thresholds"),
  updateThresholds: (body: Record<string, unknown>) =>
    request("/api/config/thresholds", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  uploadTrace: async (file: File) => {
    const data = new FormData();
    data.append("file", file);
    return request<IngestionResult>("/api/telemetry/traces/upload", { method: "POST", body: data });
  },
  ingestJson: (payload: unknown) =>
    request<IngestionResult>("/api/telemetry/traces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  resetDatabase: () =>
    request<{ cleared: boolean; tables: Record<string, number> }>("/api/dev/reset", { method: "POST" }),
};
