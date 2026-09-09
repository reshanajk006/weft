import { useState } from "react";
import { Upload } from "lucide-react";
import { api } from "../api";
import type { IngestionResult } from "../types";

export function UploadPanel({ onDone }: { onDone?: (result: IngestionResult) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IngestionResult | null>(null);

  async function ingest(file: File) {
    setBusy(true);
    setError(null);
    try {
      const payload = await api.uploadTrace(file);
      setResult(payload);
      onDone?.(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function loadNamed(path: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(path);
      if (!response.ok) throw new Error("Sample file is missing");
      const json = await response.json();
      const payload = await api.ingestJson(json);
      setResult(payload);
      onDone?.(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sample ingest failed");
    } finally {
      setBusy(false);
    }
  }

  async function loadSample() {
    await loadNamed("/samples/sample_traces.json");
  }

  async function loadIncident() {
    await loadNamed("/samples/payment_incident_traces.json");
  }

  return (
    <div className="panel stack">
      <div className="eyebrow">Telemetry</div>
      <p className="muted">Upload a Jaeger JSON export. The graph is derived automatically.</p>
      <div className="row">
        <label className="btn">
          <Upload size={16} />
          {busy ? "Ingesting…" : "Upload JSON"}
          <input
            type="file"
            accept=".json,application/json"
            hidden
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void ingest(file);
              event.target.value = "";
            }}
          />
        </label>
        <button className="btn ghost" type="button" disabled={busy} onClick={() => void loadSample()}>
          Load sample traces
        </button>
        <button className="btn ghost" type="button" disabled={busy} onClick={() => void loadIncident()}>
          Load payment incident
        </button>
      </div>
      {error ? <div className="error-banner">{error}</div> : null}
      {result ? (
        <div className="muted">
          {result.services_discovered} services, {result.dependencies_discovered} dependencies, {result.spans_processed} spans.
        </div>
      ) : null}
    </div>
  );
}
