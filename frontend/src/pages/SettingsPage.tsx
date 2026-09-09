import { useEffect, useState } from "react";
import { api } from "../api";
import { useWorkspace } from "../state/workspace";

export function SettingsPage() {
  const [data, setData] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [resetting, setResetting] = useState(false);
  const { resetDatabase, jaeger, disconnectJaeger, openJaeger } = useWorkspace();

  useEffect(() => {
    api
      .thresholds()
      .then((value) => setData(JSON.stringify(value, null, 2)))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load thresholds"));
  }, []);

  async function save() {
    try {
      const parsed = JSON.parse(data) as Record<string, unknown>;
      const updated = await api.updateThresholds(parsed);
      setData(JSON.stringify(updated, null, 2));
      setSaved(true);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid JSON or validation failed");
    }
  }

  async function reset() {
    if (!window.confirm("Clear all imported telemetry, simulations, and reports? This cannot be undone.")) return;
    setResetting(true);
    try {
      await resetDatabase();
      setSaved(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="page stack">
      <div>
        <div className="eyebrow">Configuration</div>
        <h1>Settings</h1>
        <p className="muted">Thresholds change how WEFT scores imported telemetry. They are not a second dataset.</p>
      </div>
      {error ? <div className="error-banner">{error}</div> : null}
      {saved ? <p>Saved.</p> : null}
      <div className="panel stack">
        <div className="eyebrow">Live Jaeger connection</div>
        <p className="muted">
          Status: {jaeger.is_running ? "connected" : jaeger.status}
          {jaeger.jaeger_url ? ` · ${jaeger.jaeger_url}` : ""}
        </p>
        <p className="muted">
          Poll interval: {jaeger.poll_interval}s · Lookback: {jaeger.lookback || "5m"} · Max traces:{" "}
          {jaeger.max_traces_per_poll}
          {jaeger.service_filter ? ` · Filter: ${jaeger.service_filter}` : " · Filter: all services"}
        </p>
        <div className="row">
          <button className="btn" type="button" onClick={openJaeger}>
            Connect to Jaeger
          </button>
          <button className="btn ghost" type="button" disabled={!jaeger.is_running} onClick={() => void disconnectJaeger()}>
            Disconnect
          </button>
        </div>
      </div>
      <div className="field">
        <label>Analysis thresholds</label>
        <textarea value={data} onChange={(event) => setData(event.target.value)} rows={22} />
      </div>
      <button className="btn" type="button" onClick={() => void save()}>
        Save thresholds
      </button>
      <div className="panel stack">
        <div className="eyebrow">Development reset</div>
        <p className="muted">
          Clears imported telemetry, simulations, and reports. This does not run on startup or on refresh. Live Jaeger
          polling is stopped first.
        </p>
        <button className="btn ghost" type="button" disabled={resetting} onClick={() => void reset()}>
          {resetting ? "Resetting…" : "Reset database"}
        </button>
      </div>
    </div>
  );
}
