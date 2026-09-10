import { useEffect, useState } from "react";
import { api } from "../api";
import { useWorkspace } from "../state/workspace";

const LOOKBACKS = ["1m", "5m", "15m", "1h"];

export function JaegerConnectModal() {
  const { jaegerOpen, closeJaeger, connectJaeger, refreshLiveJaeger, disconnectJaeger, jaeger } = useWorkspace();
  const [url, setUrl] = useState(jaeger.jaeger_url || "http://localhost:16686");
  const [pollInterval, setPollInterval] = useState(jaeger.poll_interval || 5);
  const [maxTraces, setMaxTraces] = useState(jaeger.max_traces_per_poll || 50);
  const [serviceFilter, setServiceFilter] = useState(jaeger.service_filter || "");
  const [lookback, setLookback] = useState(jaeger.lookback || "5m");
  const [testing, setTesting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [testNote, setTestNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jaegerOpen) return;
    setUrl(jaeger.jaeger_url || "http://localhost:16686");
    setPollInterval(jaeger.poll_interval || 5);
    setMaxTraces(jaeger.max_traces_per_poll || 50);
    setServiceFilter(jaeger.service_filter || "");
    setLookback(jaeger.lookback || "5m");
    setError(null);
    setTestNote(null);
  }, [
    jaegerOpen,
    jaeger.jaeger_url,
    jaeger.poll_interval,
    jaeger.max_traces_per_poll,
    jaeger.service_filter,
    jaeger.lookback,
  ]);

  if (!jaegerOpen) return null;

  const live = jaeger.is_running;
  const statusLabel = connecting
    ? live
      ? "Refreshing from Jaeger…"
      : "Connecting to Jaeger…"
    : live
      ? `Live ingestion active${jaeger.services_discovered.length ? ` · ${jaeger.services_discovered.length} services` : ""}`
      : jaeger.status === "error"
        ? `Connection error${jaeger.error_message ? ` · ${jaeger.error_message}` : ""}`
        : testNote || "Disconnected";

  const payload = {
    jaeger_url: url,
    poll_interval: Math.max(5, pollInterval),
    max_traces_per_poll: maxTraces,
    service_filter: serviceFilter.trim() || null,
    lookback,
  };

  async function test() {
    setTesting(true);
    setError(null);
    try {
      const result = await api.jaegerTest(url);
      setTestNote(`Reachable. Services discovered: ${result.service_count}. Dataset not created.`);
    } catch (err) {
      setTestNote(null);
      setError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setTesting(false);
    }
  }

  async function connect() {
    setConnecting(true);
    setError(null);
    try {
      if (live) {
        const status = await refreshLiveJaeger(payload);
        if (status.status === "error") {
          setError(status.error_message || "Refresh failed");
        }
      } else {
        await connectJaeger(payload);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : live ? "Refresh failed" : "Connect failed");
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    setConnecting(true);
    setError(null);
    try {
      await disconnectJaeger();
      closeJaeger();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disconnect failed");
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !connecting && closeJaeger()}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="eyebrow">Live Jaeger connection</div>
        <h2>Connect to Jaeger Query API</h2>
        <p className="muted">
          WEFT polls Jaeger on this interval and rebuilds the map from traces in the lookback window. A deleted
          service leaves the map once it is gone from that window. This does not control production traffic.
        </p>
        <div className="field">
          <label>Jaeger Query URL</label>
          <input style={{ color: "#111" }} value={url} onChange={(event) => setUrl(event.target.value)} disabled={connecting} />
        </div>
        <div className="field">
          <label>Poll interval (seconds)</label>
          <input
            style={{ color: "#111" }}
            type="number"
            min={5}
            value={pollInterval}
            onChange={(event) => setPollInterval(Number(event.target.value) || 5)}
            disabled={connecting}
          />
        </div>
        <div className="field">
          <label>Trace lookback</label>
          <select value={lookback} onChange={(event) => setLookback(event.target.value)} disabled={connecting}>
            {LOOKBACKS.map((item) => (
              <option key={item} value={item}>
                Last {item}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Maximum traces per poll</label>
          <input
            type="number"
            min={1}
            value={maxTraces}
            onChange={(event) => setMaxTraces(Number(event.target.value) || 50)}
            disabled={connecting}
          />
        </div>
        <div className="field">
          <label>Service filter</label>
          <input
            value={serviceFilter}
            onChange={(event) => setServiceFilter(event.target.value)}
            placeholder="All services"
            disabled={connecting}
          />
        </div>
        <div className="inspector-line">
          <span>Status</span>
          <span>{statusLabel}</span>
        </div>
        {error ? <div className="error-banner">{error}</div> : null}
        <div className="row">
          <button className="btn ghost" type="button" disabled={testing || connecting} onClick={() => void test()}>
            {testing ? "Testing…" : "Test connection"}
          </button>
          <button className="btn" type="button" disabled={connecting} onClick={() => void connect()}>
            {connecting ? (live ? "Refreshing…" : "Connecting…") : live ? "Refresh now" : "Connect"}
          </button>
          {live ? (
            <button className="btn ghost" type="button" disabled={connecting} onClick={() => void disconnect()}>
              Disconnect
            </button>
          ) : (
            <button className="btn ghost" type="button" disabled={connecting} onClick={closeJaeger}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
