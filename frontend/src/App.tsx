import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { CircuitBreakersPage } from "./pages/CircuitBreakersPage";
import { GraphPage } from "./pages/GraphPage";
import { Landing } from "./pages/Landing";
import { OverviewPage } from "./pages/Overview";
import { ServiceDetailPage } from "./pages/ServiceDetail";
import { ServicesPage } from "./pages/ServicesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SimulationDetailPage } from "./pages/SimulationDetail";
import { SimulationsPage } from "./pages/SimulationsPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/app" element={<AppShell />}>
        <Route index element={<OverviewPage />} />
        <Route path="graph" element={<GraphPage />} />
        <Route path="services" element={<ServicesPage />} />
        <Route path="services/:id" element={<ServiceDetailPage />} />
        <Route path="simulations" element={<SimulationsPage />} />
        <Route path="simulations/:id" element={<SimulationDetailPage />} />
        <Route path="circuit-breakers" element={<CircuitBreakersPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
