import { useEffect, useState } from "react";
import { api } from "../api";
import { StatusPill } from "../components/StatusPill";
import type { CircuitBreakerItem } from "../types";

export function CircuitBreakersPage() {
  const [items, setItems] = useState<CircuitBreakerItem[]>([]);
  const [dependencyId, setDependencyId] = useState("");
  const [errorRate, setErrorRate] = useState(0.75);
  const [health, setHealth] = useState(25);
  const [elapsed, setElapsed] = useState(30);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const result = await api.circuitBreakers();
    setItems(result.items);
    if (!dependencyId && result.items[0]) setDependencyId(result.items[0].dependency.dependency_id);
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, []);

  async function simulate() {
    try {
      const result = (await api.simulateBreaker({
        dependency_id: dependencyId,
        simulated_error_rate: errorRate,
        simulated_health_score: health,
        elapsed_seconds: elapsed,
      })) as { previous_state: string; new_state: string; reason: string };
      setMessage(`${result.previous_state} → ${result.new_state}. ${result.reason}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Simulation failed");
    }
  }

  return (
    <div className="page stack" style={{ gap: 18 }}>
      <div>
        <div className="eyebrow">State machine</div>
        <h1>Circuit breakers</h1>
        <p className="muted">Simulation only. These states do not control production traffic.</p>
      </div>
      {error ? <div className="error-banner">{error}</div> : null}
      <div className="panel stack">
        <div className="field">
          <label>Dependency</label>
          <select value={dependencyId} onChange={(event) => setDependencyId(event.target.value)}>
            {items.map((item) => (
              <option key={item.id} value={item.dependency.dependency_id}>
                {item.dependency.source} → {item.dependency.target} ({item.state})
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Simulated error rate {errorRate.toFixed(2)}</label>
          <input type="range" min={0} max={1} step={0.01} value={errorRate} onChange={(event) => setErrorRate(Number(event.target.value))} />
        </div>
        <div className="field">
          <label>Simulated health {health}</label>
          <input type="range" min={0} max={100} step={1} value={health} onChange={(event) => setHealth(Number(event.target.value))} />
        </div>
        <div className="field">
          <label>Elapsed seconds (for OPEN cooldown)</label>
          <input type="number" min={0} value={elapsed} onChange={(event) => setElapsed(Number(event.target.value))} />
        </div>
        <button className="btn" type="button" onClick={() => void simulate()} disabled={!dependencyId}>
          Evaluate transition
        </button>
        {message ? <p>{message}</p> : null}
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Source</th>
            <th>Target</th>
            <th>State</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{item.dependency.source}</td>
              <td>{item.dependency.target}</td>
              <td>
                <StatusPill value={item.state} />
              </td>
              <td>
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => {
                    api
                      .resetBreaker(item.id)
                      .then(() => load())
                      .catch((err) => setError(err instanceof Error ? err.message : "Reset failed"));
                  }}
                >
                  Reset
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
