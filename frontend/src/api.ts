import type {
  BlastRadiusResponse,
  CircuitBreakerItem,
  GraphResponse,
  IngestionResult,
  Overview,
  Paginated,
  ReportResponse,
  ServiceDashboard,
  ServiceDetail,
  ServiceSummary,
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
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const err = payload?.error ?? {};
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
  graph: (highlight?: string) => {
    const query = highlight ? `?highlight_service_id=${encodeURIComponent(highlight)}` : "";
    return request<GraphResponse>(`/api/graph${query}`);
  },
  services: (params: Record<string, string | number | undefined> = {}) => {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "") search.set(key, String(value));
    });
    const suffix = search.toString() ? `?${search}` : "";
    return request<Paginated<ServiceSummary>>(`/api/services${suffix}`);
  },
  service: (id: string) => request<ServiceDetail>(`/api/services/${id}`),
  dashboard: (id: string) => request<ServiceDashboard>(`/api/services/${id}/dashboard`),
  blastRadius: (id: string) => request<BlastRadiusResponse>(`/api/blast-radius/${id}`),
  criticality: () => request<{ items: Array<{ rank: number; service: string; service_id: string; score: number; health: string; health_score: number; error_rate: number; avg_latency_ms: number; call_volume: number }> }>("/api/criticality/rankings"),
  simulateFailure: (id: string) =>
    request<SimulationResponse>(`/api/simulate/failure/${id}`, { method: "POST" }),
  simulations: () => request<Paginated<{ id: string; failed_service_id: string; failed_service_name: string; severity: string; blast_radius_score: number; affected_service_count: number; created_at: string }>>("/api/simulations"),
  simulation: (id: string) => request<SimulationResponse>(`/api/simulations/${id}`),
  timeline: (id: string) => request<{ simulation_id: string; items: TimelineEvent[] }>(`/api/simulations/${id}/timeline`),
  circuitBreakers: () => request<{ items: CircuitBreakerItem[]; total: number }>("/api/circuit-breakers"),
  simulateBreaker: (body: { dependency_id: string; simulated_error_rate: number; simulated_health_score: number; elapsed_seconds?: number }) =>
    request("/api/circuit-breakers/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  resetBreaker: (id: string) =>
    request<CircuitBreakerItem>(`/api/circuit-breakers/${id}/reset`, { method: "POST" }),
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
};
