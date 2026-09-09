import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { HeroGraph } from "../components/HeroGraph";

export function Landing() {
  const navigate = useNavigate();
  return (
    <div className="hero">
      <header className="hero-nav">
        <div className="brand" style={{ padding: 0 }}>
          WEFT
        </div>
        <div className="row">
          <button className="btn ghost" type="button" onClick={() => navigate("/app")}>
            Open analyzer
          </button>
          <button className="btn" type="button" onClick={() => navigate("/app?upload=1")}>
            Upload trace
            <ArrowRight size={16} />
          </button>
        </div>
      </header>
      <section className="hero-copy">
        <div className="eyebrow">Service dependency graph analyzer</div>
        <h1>See what fails when a service fails.</h1>
        <p className="muted" style={{ maxWidth: 560 }}>
          Upload one Jaeger JSON file. WEFT weaves services, health, technical criticality, and blast radius into a
          single deterministic picture — without touching production.
        </p>
      </section>
      <div className="hero-stage">
        <HeroGraph />
        <div className="legend" style={{ marginTop: 18 }}>
          <span>Threads draw caller → callee relationships.</span>
          <span>Payment pulses as the simulated failure. Checkout is the caller that feels it.</span>
        </div>
      </div>
    </div>
  );
}
