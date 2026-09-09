import { FileText } from "lucide-react";
import { useWorkspace } from "../state/workspace";
import { StatusPill } from "./StatusPill";

export function Inspector() {
  const {
    mode,
    dashboard,
    simulation,
    timeline,
    analysis,
    error,
    selectService,
    requestSimulate,
    clearSimulation,
    generateReport,
    runMitigation,
  } = useWorkspace();

  if (!dashboard) {
    return (
      <aside className="inspector">
        <div className="eyebrow">Nothing selected</div>
        <h2>Inspect a service</h2>
        <p className="muted">Select a service to inspect its dependencies and simulate failure.</p>
      </aside>
    );
  }

  const incident = mode === "SIMULATION_COMPLETE" && simulation?.failed_service.id === dashboard.service.id;
  const root = analysis?.root_cause;
  const target = root?.selected_target;
  const observedStatus = root?.observed_status || target?.observed_status || dashboard.health.status;
  const observedScore = root?.observed_health_score ?? target?.observed_health_score ?? dashboard.health.score;
  const mitigation = simulation?.mitigation || analysis?.mitigation || null;
  const breakdown = simulation?.score_breakdown;

  return (
    <aside className="inspector">
      <div className="eyebrow">{incident ? "Hypothetical failure" : "Service"}</div>
      <h2>{dashboard.service.name}</h2>
      <div className="row">
        <StatusPill value={incident ? "FAILED" : dashboard.health.status} />
      </div>
      {error ? <div className="error-banner">{error}</div> : null}

      {!incident ? (
        <>
          <div className="stat-grid inspector-stats">
            <div className="metric">
              <span className="eyebrow">Health</span>
              <b>{Math.round(dashboard.health.score)}</b>
            </div>
            <div className="metric">
              <span className="eyebrow">Error rate</span>
              <b>{(dashboard.metrics.error_rate * 100).toFixed(1)}%</b>
            </div>
            <div className="metric">
              <span className="eyebrow">Avg latency</span>
              <b>{dashboard.metrics.avg_latency_ms.toFixed(0)} ms</b>
            </div>
            <div className="metric">
              <span className="eyebrow">Technical criticality</span>
              <b>{dashboard.criticality.score.toFixed(1)}</b>
            </div>
          </div>
          <div>
            <div className="eyebrow">Called by</div>
            {dashboard.upstream.length === 0 ? <p className="muted">None</p> : null}
            {dashboard.upstream.map((item) => (
              <div key={item.id} className="inspector-line">
                <button className="linkish" type="button" onClick={() => void selectService(item.id)}>
                  {item.name}
                </button>
              </div>
            ))}
          </div>
          <div>
            <div className="eyebrow">Calls</div>
            {dashboard.downstream.length === 0 ? <p className="muted">None</p> : null}
            {dashboard.downstream.map((item) => (
              <div key={item.id} className="inspector-line">
                <button className="linkish" type="button" onClick={() => void selectService(item.id)}>
                  {item.name}
                </button>
              </div>
            ))}
          </div>
          <div>
            <div className="eyebrow">Failure analysis</div>
            <p className="muted">What happens if this service fails?</p>
            <button className="btn" type="button" onClick={requestSimulate}>
              Simulate failure
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="fact-block">
            <div className="eyebrow">Observed fact</div>
            <div className="inspector-line">
              <span>Scenario</span>
              <span>Hypothetical failure</span>
            </div>
            <div className="inspector-line">
              <span>Target</span>
              <span>{dashboard.service.name}</span>
            </div>
            <div className="inspector-line">
              <span>Observed status</span>
              <StatusPill value={observedStatus} />
            </div>
            <div className="inspector-line">
              <span>Observed health</span>
              <b>{Math.round(Number(observedScore))}</b>
            </div>
            <div className="inspector-line">
              <span>Root cause</span>
              <span>{root?.root_cause_status || "NOT DETERMINED"}</span>
            </div>
            <p className="muted">{root?.disclaimer || root?.message}</p>
          </div>
          <div className="blast-score">
            <div className="eyebrow">Predicted impact</div>
            <div className="eyebrow">Blast radius</div>
            <div className="blast-number">{simulation.blast_radius_score.toFixed(0)} / 100</div>
            <div className="inspector-line">
              <span>
                <strong>{simulation.services_affected}</strong> services affected
              </span>
            </div>
            <div className="inspector-line">
              <span>
                Impact severity <StatusPill value={simulation.severity} />
              </span>
            </div>
            <div className="inspector-line">
              <span>
                Technical criticality {dashboard.criticality.score.toFixed(1)} / 100
              </span>
            </div>
            {breakdown ? (
              <>
                <div className="eyebrow">Blast-radius score breakdown</div>
                <div className="inspector-line">
                  <span>Affected-service ratio</span>
                  <span>{((breakdown.affected_ratio || 0) * 100).toFixed(1)}%</span>
                </div>
                <div className="inspector-line">
                  <span>Mean impact probability</span>
                  <span>
                    {(((breakdown.mean_impact_probability ?? breakdown.weighted_impact) || 0) * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="inspector-line">
                  <span>Affected criticality</span>
                  <span>
                    {(((breakdown.affected_criticality_ratio ?? breakdown.critical_service_factor) || 0) * 100).toFixed(1)}%
                  </span>
                </div>
              </>
            ) : null}
            <div className="inspector-line">
              <span>
                <strong>~{simulation.estimated_requests_affected.toLocaleString()}</strong> estimated requests
                affected
              </span>
            </div>
          </div>
          <div>
            <div className="eyebrow">Affected services ({simulation.affected_services.length})</div>
            {simulation.affected_services.map((item) => (
              <div key={item.service_id} className="inspector-line">
                <span>{item.service_name}</span>
                <StatusPill value={item.impact_level} />
              </div>
            ))}
          </div>
          <div>
            <div className="eyebrow">Incident summary</div>
            <p className="muted">{simulation.explanation}</p>
          </div>
          <div>
            <div className="eyebrow">Predicted circuit-breaker behavior</div>
            {simulation.predicted_circuit_transitions.length === 0 ? (
              <p className="muted">No predicted transitions. This is not actual breaker state.</p>
            ) : null}
            {simulation.predicted_circuit_transitions.map((item) => (
              <div key={item.dependency_id} className="stack" style={{ gap: 4, marginBottom: 10 }}>
                <div>
                  {item.source} → {item.target}
                </div>
                <div className="muted">
                  Predicted: {item.previous_state} → {item.new_state}
                </div>
                <div className="muted">{item.reason}</div>
              </div>
            ))}
          </div>
          <div>
            <div className="eyebrow">Root-cause evidence</div>
            <p className="muted">
              {root?.mode === "HYPOTHETICAL"
                ? "Not determined. The selected service is a simulation target, not a confirmed root cause."
                : root?.disclaimer}
            </p>
            {(root?.candidates || []).map((item) => (
              <div key={item.service_id} className="stack" style={{ gap: 4, marginBottom: 10 }}>
                <div className="inspector-line">
                  <span>{item.service}</span>
                  <StatusPill value={item.confidence} />
                </div>
                {(item.evidence_items || []).map((evidence) => (
                  <p key={`${item.service_id}-${evidence.factor}`} className="muted">
                    {evidence.factor}: +{evidence.points} — {evidence.explanation}
                  </p>
                ))}
              </div>
            ))}
          </div>
          {analysis?.recommendations.length ? (
            <div>
              <div className="eyebrow">Recommended response</div>
              <p className="muted">Recommendation only. WEFT does not execute remediation.</p>
              {analysis.recommendations.map((item, index) => (
                <div key={`${item.service}-${index}`} className="stack" style={{ gap: 4, marginBottom: 10 }}>
                  <div>
                    {item.category || item.priority}: {item.title || item.recommendation}
                  </div>
                  <div className="muted">{item.action || item.recommendation}</div>
                  <div className="muted">{item.reason}</div>
                </div>
              ))}
            </div>
          ) : null}
          <div>
            <div className="eyebrow">Virtual mitigation</div>
            <p className="muted">Predicted comparison only. Production changes executed: No.</p>
            {mitigation?.mitigated && mitigation.improvement ? (
              <div className="compare-grid">
                <div>
                  <div className="eyebrow">Without mitigation</div>
                  <div>Services: {mitigation.baseline.affected_services}</div>
                  <div>Tier-1: {mitigation.baseline.tier1_services_at_risk}</div>
                  <div>Score: {mitigation.baseline.blast_radius_score.toFixed(1)}</div>
                  <div>Caller health: {mitigation.baseline.projected_caller_health.toFixed(1)}</div>
                </div>
                <div>
                  <div className="eyebrow">With proposed mitigation</div>
                  <div>Services: {mitigation.mitigated.affected_services}</div>
                  <div>Tier-1: {mitigation.mitigated.tier1_services_at_risk}</div>
                  <div>Score: {mitigation.mitigated.blast_radius_score.toFixed(1)}</div>
                  <div>Caller health: {mitigation.mitigated.projected_caller_health.toFixed(1)}</div>
                </div>
              </div>
            ) : (
              <p className="muted">Mitigation comparison was not executed for this simulation.</p>
            )}
            <button className="btn" type="button" onClick={() => void runMitigation()}>
              Run virtual mitigation
            </button>
          </div>
          <div>
            <div className="eyebrow">Timeline</div>
            {timeline.map((event, index) => (
              <div key={`${event.type}-${index}`} className="timeline-mini">
                <strong>{event.type.replaceAll("_", " ")}</strong>
                <div className="muted">
                  {event.timestamp ? new Date(event.timestamp).toLocaleString() : ""} {event.message}
                </div>
              </div>
            ))}
          </div>
          <button className="btn" type="button" onClick={() => void generateReport()}>
            <FileText size={16} />
            Generate report
          </button>
          <button className="btn ghost" type="button" onClick={() => void clearSimulation()}>
            Clear simulation
          </button>
          <button className="btn ghost" type="button" onClick={() => void clearSimulation()}>
            Return to live system
          </button>
        </>
      )}
    </aside>
  );
}
