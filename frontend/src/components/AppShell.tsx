import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Search, Settings } from "lucide-react";
import { useState } from "react";
import { ImportModal } from "./ImportModal";
import { JaegerConnectModal } from "./JaegerConnectModal";
import { useWorkspace } from "../state/workspace";

const TABS: { to: string; label: string; end?: boolean }[] = [
  { to: "/graph", label: "Dependency Map" },
  { to: "/overview", label: "Overview" },
  { to: "/simulations", label: "Simulations" },
  { to: "/reports", label: "Incident Reports" },
];

function LiveStatus() {
  const { jaeger, reconnectJaeger } = useWorkspace();
  const last = jaeger.last_poll_time ? new Date(jaeger.last_poll_time).toLocaleTimeString() : null;

  if (jaeger.status === "error") {
    return (
      <div className="live-status error">
        <span>CONNECTION ERROR</span>
        <button className="btn ghost" type="button" onClick={() => void reconnectJaeger()}>
          Reconnect
        </button>
      </div>
    );
  }
  if (jaeger.is_running) {
    return (
      <div className="live-status on">
        <span className="live-dot" />
        LIVE
        <span className="muted">
          {last ? `Last update ${last}` : "Connected to Jaeger"}
          {jaeger.graph_service_count ? ` · ${jaeger.graph_service_count} services` : ""}
        </span>
      </div>
    );
  }
  return (
    <div className="live-status off">
      <span className="live-dot off" />
      OFFLINE
    </div>
  );
}

export function AppShell() {
  const navigate = useNavigate();
  const { searchAndSelect } = useWorkspace();
  const [query, setQuery] = useState("");
  const [miss, setMiss] = useState(false);

  return (
    <div className="app-root">
      <header className="topbar">
        <button className="brand" type="button" onClick={() => navigate("/")}>
          <span className="brand-icon">W</span>
          <span>Weft</span>
        </button>
        <nav className="top-nav">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) => `top-link${isActive ? " active" : ""}`}
            >
              {({ isActive }) => (
                <>
                  {isActive && <span className="w-1.5 h-1.5 bg-[#0b0f14] pixel-blink inline-block" />}
                  <span>[ {tab.label.toUpperCase()} ]</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <LiveStatus />
        <form
          className="top-search"
          onSubmit={(event) => {
            event.preventDefault();
            if (!query.trim()) return;
            void searchAndSelect(query).then((found) => {
              setMiss(!found);
              if (found) navigate("/graph");
            });
          }}
        >
          <Search size={14} />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setMiss(false);
            }}
            placeholder="Search services…"
            aria-label="Search services"
          />
        </form>
        {miss ? <span className="muted">No results</span> : null}
        <button className="icon-btn" type="button" onClick={() => navigate("/settings")} aria-label="Settings">
          <Settings size={16} />
        </button>
      </header>
      <Outlet />
      <ImportModal />
      <JaegerConnectModal />
    </div>
  );
}
