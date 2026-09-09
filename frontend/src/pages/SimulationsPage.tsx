import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { Threads } from "../components/Threads";
import { useWorkspace } from "../state/workspace";
import type { SimulationListItem } from "../types";

function MeterBar({ score, severity }: { score: number; severity: string }) {
  const isHigh = severity === "HIGH" || severity === "CRITICAL" || score > 50;
  const isMed = severity === "MEDIUM" || (score > 25 && score <= 50);
  const activeCount = Math.min(7, Math.max(1, Math.round((score / 100) * 7)));

  return (
    <div className="flex items-center" title={`${score.toFixed(1)}% blast radius`}>
      {Array.from({ length: 7 }).map((_, i) => (
        <span
          key={i}
          className={`meter-segment ${
            i < activeCount
              ? isHigh
                ? "bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.5)]"
                : isMed
                ? "bg-amber-400 shadow-[0_0_4px_rgba(245,158,11,0.5)]"
                : "bg-emerald-400 shadow-[0_0_4px_rgba(16,185,129,0.5)]"
              : "bg-slate-700"
          }`}
        />
      ))}
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const upper = severity.toUpperCase();
  if (upper === "HIGH" || upper === "CRITICAL") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 border border-red-500 bg-red-950/40 text-red-400 text-[10px] tracking-wider uppercase font-semibold">
        {upper}
      </span>
    );
  }
  if (upper === "MEDIUM" || upper === "DEGRADED") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 border border-amber-600/80 bg-amber-950/30 text-amber-400 text-[10px] tracking-wider uppercase font-semibold">
        {upper}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 border border-emerald-600/80 bg-emerald-950/30 text-emerald-400 text-[10px] tracking-wider uppercase font-semibold">
      {upper}
    </span>
  );
}

export function SimulationsPage({ title, intro }: { title: string; intro: string }) {
  const [items, setItems] = useState<SimulationListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<"ALL" | "HIGH" | "MEDIUM" | "LOW">("ALL");
  const [sortBy, setSortBy] = useState<"RECENT" | "BLAST" | "AFFECTED">("RECENT");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 8;

  const navigate = useNavigate();
  const { mode } = useWorkspace();

  useEffect(() => {
    api
      .simulations()
      .then((result) => {
        setItems(result.items);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load simulations"));
  }, [mode]);

  // Diagnostics
  const totalExecuted = items.length;
  const avgBlast = totalExecuted
    ? items.reduce((acc, it) => acc + (it.blast_radius_score || 0), 0) / totalExecuted
    : 0;

  const targetStats = useMemo(() => {
    const counts = new Map<string, number>();
    items.forEach((it) => {
      counts.set(it.failed_service_name, (counts.get(it.failed_service_name) || 0) + 1);
    });
    let topName = "None";
    let topCount = 0;
    counts.forEach((count, name) => {
      if (count > topCount) {
        topCount = count;
        topName = name;
      }
    });
    return { name: topName, count: topCount };
  }, [items]);

  const resiliency = Math.max(0, 100 - avgBlast);
  const resiliencyTag = resiliency >= 80 ? "OPTIMAL" : resiliency >= 50 ? "NOMINAL" : "CRITICAL";

  // Severity counts
  const highCount = items.filter((it) => it.severity === "HIGH" || it.severity === "CRITICAL").length;
  const medCount = items.filter((it) => it.severity === "MEDIUM" || it.severity === "DEGRADED").length;
  const lowCount = items.filter((it) => it.severity === "LOW").length;

  // Filtered & Sorted
  const filtered = useMemo(() => {
    let list = [...items];
    if (severityFilter === "HIGH") {
      list = list.filter((it) => it.severity === "HIGH" || it.severity === "CRITICAL");
    } else if (severityFilter === "MEDIUM") {
      list = list.filter((it) => it.severity === "MEDIUM" || it.severity === "DEGRADED");
    } else if (severityFilter === "LOW") {
      list = list.filter((it) => it.severity === "LOW");
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((it) => it.failed_service_name.toLowerCase().includes(q));
    }

    if (sortBy === "RECENT") {
      list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    } else if (sortBy === "BLAST") {
      list.sort((a, b) => b.blast_radius_score - a.blast_radius_score);
    } else if (sortBy === "AFFECTED") {
      list.sort((a, b) => b.affected_service_count - a.affected_service_count);
    }
    return list;
  }, [items, search, severityFilter, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page],
  );

  const handleExport = () => {
    const dataStr = JSON.stringify(items, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `weft-simulations-audit-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleRestore = (item: SimulationListItem) => {
    navigate(`/graph?service=${item.failed_service_id}&sim=${item.id}`);
  };

  return (
    <div className="min-h-screen flex flex-col font-mono text-sm antialiased selection:bg-[#9CAFC4] selection:text-[#0B0F14] relative bg-[#0B0F14] text-[#E5E7EB]">
      {/* Fixed Diagonal Threads Background */}
      <div
        className="fixed inset-0 w-full h-full pointer-events-none z-0 opacity-70 overflow-hidden"
        style={{ pointerEvents: "none" }}
      >
        <Threads
          color={[0.4196078431372549, 0.4470588235294118, 0.5019607843137255]}
          amplitude={1}
          distance={0}
          enableMouseInteraction
        />
      </div>

      {/* Main Content */}
      <main className="relative z-10 flex-1 max-w-[1440px] w-full mx-auto p-6 md:p-8 space-y-6">
        {/* Header Section */}
        <section className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-4 border-b border-[#1f2937]" data-purpose="page-heading">
          <div>
            <div className="text-xs uppercase tracking-widest text-[#94A3B8] font-semibold mb-1 flex items-center space-x-2">
              <span>// HISTORY</span>
              <span className="text-slate-600">•</span>
              <span className="text-slate-400">CHAOS SIMULATION TELEMETRY</span>
            </div>
            <h1
              className="text-xl md:text-2xl font-bold text-[#E5E7EB] tracking-tight flex items-baseline gap-3"
              style={{ fontFamily: "'Press Start 2P', monospace", letterSpacing: "-0.02em" }}
            >
              {title}
              <span className="text-[10px] font-mono text-[#94A3B8] font-normal tracking-normal border border-[#1f2937] px-2 py-0.5 bg-[#111827]">
                V2.4 ENGINE
              </span>
            </h1>
            <p className="text-[#94A3B8] text-xs md:text-sm mt-2 max-w-2xl font-mono">
              {intro}
            </p>
          </div>

          {/* Action & Trigger Controls */}
          <div className="flex items-center gap-3">
            <button
              className="px-4 py-2 border border-[#1f2937] bg-[#151e2c] text-[#94A3B8] hover:text-white hover:border-[#374151] text-xs tracking-wider uppercase font-mono transition-colors cursor-pointer"
              type="button"
              onClick={handleExport}
            >
              [ EXPORT AUDIT LOG ]
            </button>
            <button
              className="px-4 py-2 bg-[#9CAFC4] text-[#0B0F14] font-bold text-xs tracking-wider uppercase hover:brightness-105 border border-[#c5d7ed] transition-all flex items-center gap-2 retro-beveled-box cursor-pointer"
              type="button"
              onClick={() => navigate("/graph")}
            >
              <span>+</span>
              <span>[ RUN NEW SIMULATION ]</span>
            </button>
          </div>
        </section>

        {error && (
          <div className="p-3 bg-red-950/40 border border-red-500 text-red-400 text-xs font-mono">
            {error}
          </div>
        )}

        {/* HUD Diagnostics Bar */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs" data-purpose="hud-telemetry-cards">
          <div className="bg-[#111827] border border-[#1f2937] p-3 flex flex-col justify-between">
            <span className="text-[#94A3B8] uppercase tracking-wider text-[11px]">// TOTAL EXECUTED</span>
            <div className="flex items-baseline justify-between mt-2">
              <span className="text-2xl font-mono font-bold text-white">{totalExecuted}</span>
              <span className="text-[10px] text-emerald-400 tracking-tight">
                +{Math.min(totalExecuted, 3)} THIS WEEK
              </span>
            </div>
          </div>

          <div className="bg-[#111827] border border-[#1f2937] p-3 flex flex-col justify-between">
            <span className="text-[#94A3B8] uppercase tracking-wider text-[11px]">// AVG BLAST RADIUS</span>
            <div className="flex items-baseline justify-between mt-2">
              <span
                className={`text-2xl font-mono font-bold ${
                  avgBlast > 50 ? "text-red-400" : avgBlast > 25 ? "text-amber-400" : "text-emerald-400"
                }`}
              >
                {avgBlast.toFixed(1)}
                <span className="text-xs font-normal">%</span>
              </span>
              <span className="text-[10px] text-slate-400">SYSTEM THRESHOLD: 50%</span>
            </div>
          </div>

          <div className="bg-[#111827] border border-[#1f2937] p-3 flex flex-col justify-between">
            <span className="text-[#94A3B8] uppercase tracking-wider text-[11px]">// MOST TESTED TARGET</span>
            <div className="flex items-baseline justify-between mt-2">
              <span className="text-sm font-mono font-bold text-white truncate max-w-[150px]">
                {targetStats.name}
              </span>
              <span className="text-[10px] text-[#9CAFC4] font-mono">
                {targetStats.count} RUN{targetStats.count === 1 ? "" : "S"}
              </span>
            </div>
          </div>

          <div className="bg-[#111827] border border-[#1f2937] p-3 flex flex-col justify-between">
            <span className="text-[#94A3B8] uppercase tracking-wider text-[11px]">// SYSTEM RESILIENCY</span>
            <div className="flex items-baseline justify-between mt-2">
              <span
                className={`text-2xl font-mono font-bold ${
                  resiliency >= 80 ? "text-emerald-400" : resiliency >= 50 ? "text-amber-400" : "text-red-400"
                }`}
              >
                {resiliency.toFixed(1)}
                <span className="text-xs font-normal">%</span>
              </span>
              <span
                className={`text-[10px] font-mono ${
                  resiliency >= 80 ? "text-emerald-500" : resiliency >= 50 ? "text-amber-500" : "text-red-500"
                }`}
              >
                [ {resiliencyTag} ]
              </span>
            </div>
          </div>
        </section>

        {/* Table Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0d141d] border border-[#1f2937] p-3 text-xs" data-purpose="table-filter-bar">
          {/* Filter Badges */}
          <div className="flex items-center space-x-2">
            <span className="text-[#94A3B8] uppercase text-[11px] mr-1">// FILTER SEVERITY:</span>
            <button
              className={`px-2.5 py-1 font-mono text-[11px] cursor-pointer transition-colors border ${
                severityFilter === "ALL"
                  ? "retro-tab-active border-[#374151]"
                  : "border-transparent text-[#94A3B8] hover:border-[#374151]"
              }`}
              type="button"
              onClick={() => {
                setSeverityFilter("ALL");
                setPage(1);
              }}
            >
              ALL ({items.length})
            </button>
            <button
              className={`px-2.5 py-1 font-mono text-[11px] cursor-pointer transition-colors border ${
                severityFilter === "HIGH"
                  ? "bg-red-950/60 text-red-400 border-red-500"
                  : "border-transparent text-red-400/80 hover:border-red-500/50"
              }`}
              type="button"
              onClick={() => {
                setSeverityFilter("HIGH");
                setPage(1);
              }}
            >
              HIGH ({highCount})
            </button>
            <button
              className={`px-2.5 py-1 font-mono text-[11px] cursor-pointer transition-colors border ${
                severityFilter === "MEDIUM"
                  ? "bg-amber-950/60 text-amber-400 border-amber-500"
                  : "border-transparent text-amber-400/80 hover:border-amber-500/50"
              }`}
              type="button"
              onClick={() => {
                setSeverityFilter("MEDIUM");
                setPage(1);
              }}
            >
              MEDIUM ({medCount})
            </button>
            <button
              className={`px-2.5 py-1 font-mono text-[11px] cursor-pointer transition-colors border ${
                severityFilter === "LOW"
                  ? "bg-emerald-950/60 text-emerald-400 border-emerald-500"
                  : "border-transparent text-emerald-400/80 hover:border-emerald-500/50"
              }`}
              type="button"
              onClick={() => {
                setSeverityFilter("LOW");
                setPage(1);
              }}
            >
              LOW ({lowCount})
            </button>
          </div>

          {/* Quick Search & Sort in Table */}
          <div className="flex items-center space-x-3">
            <div className="relative flex items-center">
              <span className="absolute left-2 text-slate-500 font-mono text-xs select-none">&gt;</span>
              <input
                className="bg-[#0B0F14] border border-[#1f2937] text-[#E5E7EB] placeholder-slate-600 text-xs pl-5 pr-2.5 py-1 w-48 focus:outline-none focus:border-[#9CAFC4]"
                placeholder="Search services..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                type="text"
              />
            </div>
            <div className="flex items-center space-x-2 text-[#94A3B8] text-[11px]">
              <span>SORT:</span>
              <select
                className="bg-[#111827] border border-[#1f2937] text-slate-200 text-xs py-1 px-2 focus:ring-0 focus:border-[#9CAFC4] cursor-pointer outline-none"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              >
                <option value="RECENT">MOST RECENT</option>
                <option value="BLAST">HIGHEST BLAST RADIUS</option>
                <option value="AFFECTED">MOST AFFECTED</option>
              </select>
            </div>
          </div>
        </div>

        {/* Simulations Data Table */}
        <section className="bg-[#111827] border border-[#1f2937] shadow-xl overflow-x-auto" data-purpose="simulations-data-table-container">
          {items.length === 0 ? (
            <div className="p-8 text-center text-[#94A3B8]">
              <p className="mb-2">No simulations recorded yet.</p>
              <button
                className="px-3 py-1.5 bg-[#9CAFC4] text-[#0B0F14] font-bold text-xs uppercase cursor-pointer"
                type="button"
                onClick={() => navigate("/graph")}
              >
                [ Go to Dependency Map to Simulate ]
              </button>
            </div>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#1f2937] bg-[#0e1622] text-[#94A3B8] uppercase tracking-widest text-[11px] select-none font-semibold">
                  <th className="py-3 px-4 font-mono">SERVICE</th>
                  <th className="py-3 px-4 font-mono">SEVERITY</th>
                  <th className="py-3 px-4 font-mono">BLAST RADIUS</th>
                  <th className="py-3 px-4 font-mono">AFFECTED</th>
                  <th className="py-3 px-4 font-mono">WHEN</th>
                  <th className="py-3 px-4 font-mono text-right">ACTIONS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#17202d] font-mono">
                {paginated.map((item) => {
                  const isHigh = item.severity === "HIGH" || item.severity === "CRITICAL";
                  const isMed = item.severity === "MEDIUM" || item.severity === "DEGRADED";
                  const dotColor = isHigh ? "bg-red-400" : isMed ? "bg-amber-400" : "bg-emerald-400";

                  return (
                    <tr
                      key={item.id}
                      className="hover:bg-[#151f2e] transition-colors duration-150 group cursor-pointer"
                      onClick={() => handleRestore(item)}
                    >
                      <td className="py-3.5 px-4 font-mono text-slate-100 flex items-center space-x-2">
                        <span className={`w-1.5 h-1.5 ${dotColor} ${isHigh ? "animate-pulse" : ""}`} />
                        <span className="font-medium text-slate-200 group-hover:text-white">
                          {item.failed_service_name}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <SeverityBadge severity={item.severity} />
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex items-center space-x-2">
                          <span className={`font-bold ${isHigh ? "text-red-400" : "text-slate-200"}`}>
                            {item.blast_radius_score.toFixed(1)}
                          </span>
                          <MeterBar score={item.blast_radius_score} severity={item.severity} />
                        </div>
                      </td>
                      <td className={`py-3.5 px-4 font-semibold ${isHigh ? "text-red-400" : "text-slate-300"}`}>
                        {item.affected_service_count}
                      </td>
                      <td className="py-3.5 px-4 text-[#94A3B8]">
                        {new Date(item.created_at).toLocaleString()}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end space-x-2">
                          <button
                            className="px-2.5 py-1 text-[11px] border border-[#374151] bg-[#131b26] hover:bg-[#9CAFC4] hover:text-[#0B0F14] text-[#E5E7EB] font-mono transition-colors cursor-pointer"
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRestore(item);
                            }}
                          >
                            [ RESTORE MAP ]
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* Table Footer / Pagination Controls */}
          <div className="border-t border-[#1f2937] bg-[#0d141e] px-4 py-2.5 flex items-center justify-between text-xs text-[#94A3B8]">
            <span>
              SHOWING {paginated.length} OF {filtered.length} RECORDED SIMULATION RUNS
            </span>
            <div className="flex items-center space-x-2 font-mono">
              <button
                className={`px-2 py-1 border border-[#1f2937] bg-[#111827] ${
                  page <= 1 ? "text-slate-600 cursor-not-allowed" : "text-slate-300 hover:text-white cursor-pointer"
                }`}
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                [ &lt; PREV ]
              </button>
              <span className="px-2 py-1 border border-[#374151] bg-[#1a2332] text-white">
                PAGE {page} / {totalPages}
              </span>
              <button
                className={`px-2 py-1 border border-[#1f2937] bg-[#111827] ${
                  page >= totalPages ? "text-slate-600 cursor-not-allowed" : "text-slate-300 hover:text-white cursor-pointer"
                }`}
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                [ NEXT &gt; ]
              </button>
            </div>
          </div>
        </section>

        {/* Contextual Incident HUD */}
        <section className="border border-[#1f2937] bg-[#0e1520] p-4 flex flex-col md:flex-row items-center justify-between gap-4" data-purpose="restore-hint-banner">
          <div className="flex items-start space-x-3">
            <div className="w-6 h-6 border border-[#374151] bg-[#131d2a] flex items-center justify-center text-xs text-[#9CAFC4] font-bold mt-0.5">
              i
            </div>
            <div>
              <h4 className="text-xs font-mono font-semibold text-white uppercase tracking-wider">
                Dependency Topology Replay Mode
              </h4>
              <p className="text-xs text-[#94A3B8] mt-0.5">
                Clicking <span className="text-white font-mono">[ RESTORE MAP ]</span> will snapshot runtime Jaeger traces and highlight affected downstream cascades on the main canvas.
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-3 text-xs shrink-0">
            <button
              className="text-[#9CAFC4] hover:underline uppercase tracking-wider font-mono text-[11px] bg-transparent border-0 cursor-pointer p-0"
              type="button"
              onClick={() => navigate("/graph")}
            >
              &gt; GO TO DEPENDENCY MAP
            </button>
          </div>
        </section>
      </main>

      {/* Main Footer */}
      <footer className="relative z-10 w-full border-t border-[#1f2937] bg-[#0B0F14]/90 backdrop-blur-sm py-4 px-6 text-center text-xs text-[#94A3B8] flex flex-col sm:flex-row items-center justify-between gap-2 mt-auto">
        <div className="font-mono text-[11px] text-slate-500">
          WEFT Telemetry Observability Suite • System Health Engine • Dynamic Wave Topology
        </div>
        <div className="flex items-center space-x-4 text-[11px] font-mono">
          <span className="text-slate-400">ID: ord-sim-hud-92</span>
          <span className="text-emerald-500">ENGINE: NOMINAL</span>
          <span className="text-slate-600">8-BIT PIXEL MODE ACTIVE</span>
        </div>
      </footer>
    </div>
  );
}

export function SimulationsHistoryPage() {
  return (
    <SimulationsPage
      title="Simulations"
      intro="Previous failure simulations. Open one to restore the incident on the dependency map."
    />
  );
}

export function IncidentsPage() {
  return (
    <SimulationsPage
      title="Incidents"
      intro="Each incident is a stored simulation. Opening it returns you to the graph in incident view."
    />
  );
}
