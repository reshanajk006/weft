import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { GraphWorkspace } from "./pages/GraphWorkspace";
import { LandingPage } from "./pages/LandingPage";
import { OverviewPage } from "./pages/OverviewPage";
import { ReportsPage } from "./pages/ReportsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { IncidentsPage, SimulationsHistoryPage } from "./pages/SimulationsPage";
import { WorkspaceProvider, useWorkspace } from "./state/workspace";

function ServiceRedirect() {
  const { id } = useParams();
  const { mode } = useWorkspace();
  if (mode === "LOADING") return null;
  if (!id || mode === "NO_DATA" || mode === "ERROR") return <Navigate to="/graph" replace />;
  return <Navigate to={`/graph?service=${id}`} replace />;
}

export default function App() {
  return (
    <WorkspaceProvider>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/landing" element={<LandingPage />} />
        <Route element={<AppShell />}>
          <Route path="/graph" element={<GraphWorkspace />} />
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/simulations" element={<SimulationsHistoryPage />} />
          <Route path="/incidents" element={<IncidentsPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/service/:id" element={<ServiceRedirect />} />
          <Route path="/simulate/:id" element={<ServiceRedirect />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </WorkspaceProvider>
  );
}
