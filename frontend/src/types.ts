export type AppMode =
  | "NO_DATA"
  | "LOADING"
  | "READY"
  | "SERVICE_SELECTED"
  | "SIMULATION_CONFIRMATION"
  | "SIMULATING"
  | "SIMULATION_COMPLETE"
  | "ERROR";

export type HealthStatus = "HEALTHY" | "DEGRADED" | "UNHEALTHY";

export interface Overview {
  service_count: number;
  dependency_count: number;
  healthy_count: number;
  degraded_count: number;
  unhealthy_count: number;
  average_health_score: number;
  highest_risk_service: {
    id: string;
    name: string;
    criticality_score: number;
    health_status: string;
    health_score: number;
  } | null;
  latest_simulation: {
    id: string;
    failed_service_id: string;
    failed_service_name: string;
    severity: string;
    blast_radius_score: number;
    created_at: string;
  } | null;
  open_circuit_breakers: number;
  active_dataset: {
    id: string;
    name: string;
    source: string | null;
    status: string;
    created_at: string;
    service_count: number;
    dependency_count: number;
  } | null;
}

export interface GraphNode {
  id: string;
  name: string;
  status: string;
  health_status: string;
  health_score: number;
  criticality_score: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  call_count: number;
  error_rate: number;
  avg_latency_ms: number;
  critical_weight: number;
  status: string;
}

export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphValidation {
  has_cycles: boolean;
  cycle_count: number;
  cycles: Array<{ services: string[]; service_ids: string[] }>;
  orphan_services: string[];
  dependency_count: number;
  service_count: number;
}

export interface ServiceSummary {
  id: string;
  name: string;
  normalized_name: string;
  health_status: HealthStatus;
  health_score: number;
  error_rate: number;
  avg_latency_ms: number;
  total_calls: number;
  total_spans: number;
  criticality_score: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface NeighborService {
  id: string;
  name: string;
  health_status: string;
  health_score: number;
  criticality_score: number;
  call_count: number;
  error_rate: number;
  avg_latency_ms: number;
}

export interface ServiceDetail {
  id: string;
  name: string;
  normalized_name: string;
  health: { status: string; score: number; error_rate: number };
  metrics: {
    total_calls: number;
    total_spans: number;
    error_count: number;
    error_rate: number;
    avg_latency_ms: number;
    min_latency_ms: number | null;
    max_latency_ms: number | null;
    p95_latency_ms: number | null;
    p99_latency_ms: number | null;
    sample_count: number;
  };
  criticality: {
    service: string;
    service_id: string;
    score: number;
    breakdown: Record<string, { weight: number; raw_value: number; normalized_score: number; contribution: number }>;
  };
  dependency_counts: { upstream: number; downstream: number };
  upstream_count: number;
  downstream_count: number;
  last_seen_at: string | null;
}

export interface ServiceDashboard {
  service: ServiceSummary;
  metrics: ServiceDetail["metrics"];
  health: { status: string; score: number; error_rate: number };
  criticality: ServiceDetail["criticality"];
  upstream: NeighborService[];
  downstream: NeighborService[];
  recent_health_history: Array<{
    id: string;
    health_score: number;
    health_status: string;
    error_rate: number;
    calculated_at: string;
  }>;
  circuit_breakers: CircuitBreakerItem[];
  recent_simulations: Array<Record<string, unknown>>;
}

export interface AffectedService {
  service_id: string;
  service_name: string;
  impact_probability: number;
  distance: number;
  direct: boolean;
  impact_level: string;
  criticality_score: number;
  current_health_score: number;
  projected_health_score?: number;
}

export interface SimulationResponse {
  simulation_id: string;
  failed_service: { id: string; name: string };
  severity: string;
  blast_radius_score: number;
  services_affected: number;
  critical_services_affected: number;
  estimated_requests_affected: number;
  directly_affected: AffectedService[];
  indirectly_affected: AffectedService[];
  affected_services: AffectedService[];
  predicted_circuit_transitions: Array<{
    circuit_breaker_id: string | null;
    dependency_id: string;
    source: string;
    target: string;
    previous_state: string;
    new_state: string;
    reason: string;
    kind: string;
  }>;
  explanation: string;
  created_at: string;
}

export interface SimulationListItem {
  id: string;
  failed_service_id: string;
  failed_service_name: string;
  severity: string;
  blast_radius_score: number;
  affected_service_count: number;
  created_at: string;
}

export interface TimelineEvent {
  timestamp: string;
  type: string;
  service: string | null;
  message: string;
  previous_state: string | null;
  new_state: string | null;
}

export interface CircuitBreakerItem {
  id: string;
  dependency: {
    source: string;
    target: string;
    source_service_id: string;
    target_service_id: string;
    dependency_id: string;
  };
  state: string;
  failure_threshold: number;
  cooldown_seconds: number;
  recovery_threshold: number;
  opened_at: string | null;
  last_transition_at: string | null;
}

export interface IngestionResult {
  ingestion_id: string;
  dataset_id?: string | null;
  dataset_name?: string | null;
  filename: string | null;
  traces_processed: number;
  spans_processed: number;
  services_discovered: number;
  dependencies_discovered: number;
  errors_detected: number;
  status: string;
}

export interface RankingItem {
  rank: number;
  service: string;
  service_id: string;
  score: number;
  health: string;
  health_score: number;
  error_rate: number;
  avg_latency_ms: number;
  call_volume: number;
}

export interface ReportResponse {
  report_id: string;
  simulation_id: string;
  format: string;
  content: string;
  created_at: string;
}

export interface JaegerStatus {
  is_running: boolean;
  status: string;
  jaeger_url: string | null;
  started_at: string | null;
  last_poll_time: string | null;
  traces_ingested: number;
  services_discovered: string[];
  error_message: string | null;
  dataset_id: string | null;
  poll_interval: number;
  max_traces_per_poll: number;
  service_filter: string | null;
  lookback?: string;
  poll_generation?: number;
  graph_service_count?: number;
  graph_dependency_count?: number;
}

export interface JaegerTestResult {
  ok: boolean;
  jaeger_url: string;
  services: string[];
  service_count: number;
}

export interface RootCauseCandidate {
  service_id: string;
  service: string;
  score: number;
  confidence: string;
  health_status: string;
  health_score: number;
  error_rate: number;
  avg_latency_ms: number;
  criticality_score: number;
  called_by: string[];
  calls: string[];
  evidence: string[];
}

export interface RecommendationItem {
  priority: string;
  service: string;
  recommendation: string;
  reason: string;
  evidence: Record<string, unknown>;
}

export interface IncidentAnalysis {
  simulation_id: string;
  root_cause: {
    simulation_id: string;
    likely_root_cause: RootCauseCandidate | null;
    candidates: RootCauseCandidate[];
  };
  recommendations: RecommendationItem[];
}

export type HealthFilter = "" | "HEALTHY" | "DEGRADED" | "UNHEALTHY";
export type CriticalityFilter = "" | "HIGH" | "MEDIUM" | "LOW";

export function criticalityBand(score: number): "HIGH" | "MEDIUM" | "LOW" {
  if (score >= 70) return "HIGH";
  if (score >= 40) return "MEDIUM";
  return "LOW";
}
