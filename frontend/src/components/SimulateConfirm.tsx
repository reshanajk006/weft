import { useWorkspace } from "../state/workspace";

export function SimulateConfirm() {
  const { mode, dashboard, cancelSimulate, runSimulate } = useWorkspace();
  if (mode !== "SIMULATION_CONFIRMATION" && mode !== "SIMULATING") return null;
  const name = dashboard?.service.name ?? "this service";
  const busy = mode === "SIMULATING";

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="eyebrow">Simulate failure</div>
        <h2>{name}</h2>
        <p className="muted">
          This is a safe simulation. No real service will be stopped or modified. WEFT will calculate blast radius,
          affected services, projected health, severity, affected requests, and circuit-breaker behavior.
        </p>
        {busy ? <p>Simulating complete outage…</p> : null}
        <div className="row">
          <button className="btn" type="button" disabled={busy} onClick={() => void runSimulate()}>
            {busy ? "Running…" : "Run simulation"}
          </button>
          <button className="btn ghost" type="button" disabled={busy} onClick={cancelSimulate}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
