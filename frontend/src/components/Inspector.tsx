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

  return (
    <aside className="inspector">
      <div className="eyebrow">{incident ? "Incident simulation" : "Service"}</div>
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
          <p className="muted">Simulating complete outage of {dashboard.service.name}.</p>
          <div className="blast-score">
            <div className="eyebrow">Blast radius</div>
            <div className="blast-number">{simulation.blast_radius_score.toFixed(0)} / 100</div>
            <div className="inspector-line">
              <span>
                <strong>{simulation.services_affected}</strong> services affected
              </span>
            </div>
            <div className="inspector-line">
              <span>
                <strong>{simulation.critical_services_affected}</strong> critical services affected
              </span>
            </div>
            <div className="inspector-line">
              <span>
                <strong>~{simulation.estimated_requests_affected.toLocaleString()}</strong> estimated requests
                affected
              </span>
            </div>
            <StatusPill value={simulation.severity} />
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
            <div className="eyebrow">Circuit breaker (predicted)</div>
            {simulation.predicted_circuit_transitions.length === 0 ? (
              <p className="muted">No predicted transitions.</p>
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
          {analysis?.root_cause.likely_root_cause ? (
            <div>
              <div className="eyebrow">Likely root cause</div>
              <div className="inspector-line">
                <span>{analysis.root_cause.likely_root_cause.service}</span>
                <StatusPill value={analysis.root_cause.likely_root_cause.confidence} />
              </div>
              <p className="muted">
                Error rate {(analysis.root_cause.likely_root_cause.error_rate * 100).toFixed(0)}% · health{" "}
                {Math.round(analysis.root_cause.likely_root_cause.health_score)} · criticality{" "}
                {analysis.root_cause.likely_root_cause.criticality_score.toFixed(1)}
              </p>
              {analysis.root_cause.likely_root_cause.evidence.map((item) => (
                <p key={item} className="muted">
                  {item}
                </p>
              ))}
            </div>
          ) : null}
          {analysis?.recommendations.length ? (
            <div>
              <div className="eyebrow">Recommended actions</div>
              <p className="muted">Simulation-only. WEFT does not execute remediation.</p>
              {analysis.recommendations.map((item, index) => (
                <div key={`${item.service}-${index}`} className="stack" style={{ gap: 4, marginBottom: 10 }}>
                  <div>
                    {item.priority}: {item.recommendation}
                  </div>
                  <div className="muted">{item.reason}</div>
                </div>
              ))}
            </div>
          ) : null}
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
