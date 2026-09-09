import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  Activity,
  GitFork,
  LayoutDashboard,
  Settings,
  Shield,
  Waypoints,
} from "lucide-react";

const LINKS = [
  { to: "/app", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/app/graph", label: "Graph", icon: Waypoints },
  { to: "/app/services", label: "Services", icon: GitFork },
  { to: "/app/simulations", label: "Simulations", icon: Activity },
  { to: "/app/circuit-breakers", label: "Circuit breakers", icon: Shield },
  { to: "/app/settings", label: "Thresholds", icon: Settings },
];

export function AppShell() {
  const navigate = useNavigate();
  return (
    <div className="shell">
      <aside className="sidebar">
        <button className="brand" type="button" onClick={() => navigate("/")}>
          WEFT
        </button>
        {LINKS.map((link) => {
          const Icon = link.icon;
          return (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
            >
              <Icon size={16} />
              {link.label}
            </NavLink>
          );
        })}
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
