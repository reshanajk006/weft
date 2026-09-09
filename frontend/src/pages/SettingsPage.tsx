import { useEffect, useState } from "react";
import { api } from "../api";

export function SettingsPage() {
  const [data, setData] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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

  return (
    <div className="page stack">
      <div>
        <div className="eyebrow">Configuration</div>
        <h1>Analysis thresholds</h1>
        <p className="muted">These are WEFT settings, not a second user dataset. Weights that must sum to 1.0 are validated by the API.</p>
      </div>
      {error ? <div className="error-banner">{error}</div> : null}
      {saved ? <p>Saved.</p> : null}
      <div className="field">
        <label>JSON</label>
        <textarea value={data} onChange={(event) => setData(event.target.value)} rows={24} />
      </div>
      <button className="btn" type="button" onClick={() => void save()}>
        Save thresholds
      </button>
    </div>
  );
}
