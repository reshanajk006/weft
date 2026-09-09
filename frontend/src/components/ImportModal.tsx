import { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../state/workspace";

const STAGES = [
  "Uploading telemetry",
  "Parsing traces",
  "Discovering services",
  "Building dependencies",
  "Calculating health",
  "Calculating technical criticality",
];

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function validateJaeger(text: string): { ok: boolean; message: string } {
  try {
    const parsed = JSON.parse(text) as { data?: unknown };
    if (!parsed || typeof parsed !== "object") return { ok: false, message: "Not a JSON object" };
    if (!Array.isArray(parsed.data)) return { ok: false, message: "Missing Jaeger data[] array" };
    return { ok: true, message: `Valid JSON · ${parsed.data.length} traces` };
  } catch {
    return { ok: false, message: "Invalid JSON" };
  }
}

export function ImportModal() {
  const { importOpen, closeImport, ingestFile, ingestSample, overview, ingestResult } = useWorkspace();
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("No file selected");
  const [valid, setValid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(-1);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!importOpen) {
      setFile(null);
      setStatus("No file selected");
      setValid(false);
      setBusy(false);
      setStage(-1);
      setDone(false);
      setError(null);
    }
  }, [importOpen]);

  useEffect(() => {
    if (!busy) return;
    setStage(0);
    const timer = window.setInterval(() => {
      setStage((value) => (value < STAGES.length - 1 ? value + 1 : value));
    }, 280);
    return () => window.clearInterval(timer);
  }, [busy]);

  const mergeNote = Boolean(overview?.active_dataset);

  const fileLabel = useMemo(() => {
    if (!file) return null;
    return `${file.name} · ${formatSize(file.size)}`;
  }, [file]);

  if (!importOpen) return null;

  async function onFile(next: File | null) {
    setFile(next);
    setDone(false);
    setError(null);
    if (!next) {
      setValid(false);
      setStatus("No file selected");
      return;
    }
    const text = await next.text();
    const check = validateJaeger(text);
    setValid(check.ok);
    setStatus(check.message);
  }

  async function analyze() {
    if (!file || !valid) return;
    setBusy(true);
    setError(null);
    try {
      await ingestFile(file);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ingestion failed");
    } finally {
      setBusy(false);
    }
  }

  async function sample() {
    setBusy(true);
    setError(null);
    try {
      await ingestSample();
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sample ingest failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !busy && closeImport()}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="eyebrow">Import telemetry</div>
        <h2>Upload Jaeger JSON</h2>
        <p className="muted">
          Upload a Jaeger JSON export. WEFT will reconstruct the services and dependencies observed in your traces.
        </p>
        {mergeNote ? (
          <p className="muted">
            This import replaces the graph currently on screen. Previous imports stay stored but are no longer shown.
          </p>
        ) : null}
        <label className="dropzone">
          <input
            type="file"
            accept=".json,application/json"
            hidden
            disabled={busy}
            onChange={(event) => void onFile(event.target.files?.[0] ?? null)}
          />
          {fileLabel ?? "Drag JSON here or choose a file"}
        </label>
        <div className="inspector-line">
          <span>Validation</span>
          <span className={valid ? "ok" : "muted"}>{status}</span>
        </div>
        {busy ? (
          <ol className="stages">
            {STAGES.map((item, index) => (
              <li key={item} className={index <= stage ? "active" : ""}>
                {item}
              </li>
            ))}
          </ol>
        ) : null}
        {done ? (
          <div className="p-2.5 bg-slate-900 border border-slate-700 text-xs font-mono text-slate-200 space-y-1">
            <div>System reconstructed successfully.</div>
            {ingestResult?.errors_detected ? (
              <div className="text-amber-400 font-semibold">
                [!] {ingestResult.errors_detected} trace error(s) recorded from JSON. Incident report generated.
              </div>
            ) : null}
          </div>
        ) : null}
        {error ? <div className="error-banner">{error}</div> : null}
        <div className="row">
          <button className="btn" type="button" disabled={!valid || busy} onClick={() => void analyze()}>
            {busy ? "Analyzing…" : "Analyze system"}
          </button>
          <button className="btn ghost" type="button" disabled={busy} onClick={() => void sample()}>
            Load sample system
          </button>
          <button className="btn ghost" type="button" disabled={busy} onClick={closeImport}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
