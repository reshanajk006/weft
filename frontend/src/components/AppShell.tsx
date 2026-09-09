import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Search, Settings } from "lucide-react";
import { useState } from "react";
import { ImportModal } from "./ImportModal";
import { useWorkspace } from "../state/workspace";

const TABS = [
  { to: "/overview", label: "Overview" },
  { to: "/", label: "Dependency Map", end: true },
  { to: "/simulations", label: "Simulations" },
  { to: "/incidents", label: "Incidents" },
  { to: "/reports", label: "Reports" },
];

export function AppShell() {
  const navigate = useNavigate();
  const { searchAndSelect, graph } = useWorkspace();
  const [query, setQuery] = useState("");
  const [miss, setMiss] = useState(false);

  return (
    <div className="app-root">
      <header className="topbar">
        <button className="brand" type="button" onClick={() => navigate("/")}>
          WEFT
        </button>
        <nav className="top-nav">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) => `top-link${isActive ? " active" : ""}`}
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
        <form
          className="top-search"
          onSubmit={(event) => {
            event.preventDefault();
            if (!query.trim()) return;
            if (graph.nodes.length === 0) {
              setMiss(true);
              return;
            }
            const found = searchAndSelect(query);
            setMiss(!found);
            if (found) navigate("/");
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
    </div>
  );
}
