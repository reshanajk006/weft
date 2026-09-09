import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { GraphCanvas } from "../components/GraphCanvas";
import { UploadPanel } from "../components/UploadPanel";
import type { GraphResponse } from "../types";

export function GraphPage() {
  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [params] = useSearchParams();
  const [highlight, setHighlight] = useState(params.get("highlight") ?? "");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function load(id?: string) {
    try {
      setGraph(await api.graph(id || undefined));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load graph");
    }
  }

  useEffect(() => {
    void load(highlight);
  }, [highlight]);

  return (
    <div className="page stack" style={{ gap: 16, maxWidth: "none" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <div className="eyebrow">Topology</div>
          <h1>Dependency graph</h1>
        </div>
        {highlight ? (
          <button className="btn ghost" type="button" onClick={() => setHighlight("")}>
            Clear highlight
          </button>
        ) : null}
      </div>
      {error ? <div className="error-banner">{error}</div> : null}
      {!graph || graph.nodes.length === 0 ? <UploadPanel onDone={() => void load(highlight)} /> : null}
      {graph && graph.nodes.length > 0 ? (
        <>
          <div className="legend">
            <span className="dot" style={{ background: "#111" }} /> Failed
            <span className="dot" style={{ background: "#4a3f2f" }} /> Direct caller
            <span className="dot" style={{ background: "#bbb" }} /> Other
          </div>
          <GraphCanvas graph={graph} onSelect={setHighlight} />
          {highlight ? (
            <div className="row">
              <button className="btn" type="button" onClick={() => navigate(`/app/services/${highlight}`)}>
                Open service
              </button>
              <button
                className="btn ghost"
                type="button"
                onClick={() => {
                  api.simulateFailure(highlight).then((result) => navigate(`/app/simulations/${result.simulation_id}`));
                }}
              >
                Simulate failure
              </button>
              <button className="btn ghost" type="button" onClick={() => setHighlight("")}>
                Clear highlight
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
