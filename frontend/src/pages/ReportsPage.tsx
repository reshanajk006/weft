import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { Threads } from "../components/Threads";
import type { ReportResponse, SimulationListItem } from "../types";

function SeverityBadge({ severity }: { severity: string }) {
  const upper = severity.toUpperCase();
  if (upper === "HIGH" || upper === "CRITICAL") {
    return (
      <span className="px-2 py-0.5 text-[11px] font-bold border border-red-500/70 bg-red-500/10 text-red-400">
        {upper}
      </span>
    );
  }
  if (upper === "MEDIUM" || upper === "DEGRADED") {
    return (
      <span className="px-2 py-0.5 text-[11px] font-bold border border-amber-500/70 bg-amber-500/10 text-amber-400">
        {upper}
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 text-[11px] font-bold border border-emerald-500/70 bg-emerald-500/10 text-emerald-400">
      {upper}
    </span>
  );
}

function MeterBlock({ score, severity }: { score: number; severity: string }) {
  const isHigh = severity === "HIGH" || severity === "CRITICAL" || score > 50;
  const isMed = severity === "MEDIUM" || (score > 25 && score <= 50);
  const activeCount = Math.min(5, Math.max(1, Math.round((score / 100) * 5)));

  return (
    <span className="inline-flex items-center ml-1 mr-1" title={`${score.toFixed(1)}% impact`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <span
          key={i}
          className={`meter-block ${
            i < activeCount
              ? isHigh
                ? "bg-red-400"
                : isMed
                ? "bg-amber-400"
                : "bg-emerald-400"
              : "bg-slate-700"
          }`}
        />
      ))}
    </span>
  );
}

function downloadReportAsPdf(serviceName: string, simulationId: string, markdownContent: string) {
  const win = window as unknown as {
    jspdf?: {
      jsPDF: new (options?: Record<string, unknown>) => {
        internal: { pageSize: { getWidth: () => number; getHeight: () => number } };
        setFillColor: (r: number, g?: number, b?: number, a?: string) => void;
        setDrawColor: (r: number, g: number, b: number) => void;
        setTextColor: (r: number, g?: number, b?: number) => void;
        setFont: (fontName: string, fontStyle?: string) => void;
        setFontSize: (size: number) => void;
        rect: (x: number, y: number, w: number, h: number, style?: string) => void;
        line: (x1: number, y1: number, x2: number, y2: number) => void;
        text: (text: string, x: number, y: number) => void;
        splitTextToSize: (text: string, maxW: number) => string[];
        addPage: () => void;
        save: (filename: string) => void;
      };
    };
  };

  const jsPDFConstructor = win.jspdf?.jsPDF;
  if (jsPDFConstructor) {
    try {
      const doc = new jsPDFConstructor({
        orientation: "portrait",
        unit: "pt",
        format: "letter",
      });

      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 40;
      const contentWidth = pageWidth - margin * 2;

      // Dark background
      doc.setFillColor(11, 15, 20);
      doc.rect(0, 0, pageWidth, pageHeight, "F");

      // Top title card
      doc.setFillColor(17, 24, 39);
      doc.setDrawColor(55, 65, 81);
      doc.rect(margin, margin, contentWidth, 54, "FD");

      doc.setFont("courier", "bold");
      doc.setFontSize(9);
      doc.setTextColor(156, 175, 196);
      doc.text("// WEFT TELEMETRY OBSERVABILITY SUITE", margin + 12, margin + 20);

      doc.setFont("courier", "bold");
      doc.setFontSize(13);
      doc.setTextColor(229, 231, 235);
      doc.text(`INCIDENT IMPACT REPORT: ${serviceName.toUpperCase()}`, margin + 12, margin + 40);

      // Meta info
      doc.setFont("courier", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(148, 163, 184);
      doc.text(
        `SIMULATION ID: ${simulationId}   |   GENERATED: ${new Date().toLocaleString()}`,
        margin,
        margin + 74,
      );

      doc.setDrawColor(55, 65, 81);
      doc.line(margin, margin + 82, pageWidth - margin, margin + 82);

      let y = margin + 100;
      const lines = markdownContent.split("\n");

      for (const raw of lines) {
        if (y > pageHeight - 45) {
          doc.addPage();
          doc.setFillColor(11, 15, 20);
          doc.rect(0, 0, pageWidth, pageHeight, "F");
          y = margin + 15;
        }

        const line = raw.trimEnd();

        if (line.startsWith("# ")) {
          doc.setFont("courier", "bold");
          doc.setFontSize(11);
          doc.setTextColor(229, 231, 235);
          doc.text(line.replace("# ", "").toUpperCase(), margin, y);
          y += 16;
        } else if (line.startsWith("## ")) {
          doc.setFont("courier", "bold");
          doc.setFontSize(9.5);
          doc.setTextColor(156, 175, 196);
          doc.text(line.replace("## ", "").toUpperCase(), margin, y);
          y += 14;
        } else if (line.startsWith("- ") || line.startsWith("* ")) {
          doc.setFont("courier", "normal");
          doc.setFontSize(8);
          doc.setTextColor(203, 213, 225);
          const wrapped = doc.splitTextToSize("• " + line.slice(2), contentWidth - 10);
          for (const w of wrapped) {
            if (y > pageHeight - 45) {
              doc.addPage();
              doc.setFillColor(11, 15, 20);
              doc.rect(0, 0, pageWidth, pageHeight, "F");
              y = margin + 15;
            }
            doc.text(w, margin + 10, y);
            y += 11;
          }
        } else if (line.trim() === "") {
          y += 5;
        } else {
          doc.setFont("courier", "normal");
          doc.setFontSize(8);
          doc.setTextColor(203, 213, 225);
          const wrapped = doc.splitTextToSize(line, contentWidth);
          for (const w of wrapped) {
            if (y > pageHeight - 45) {
              doc.addPage();
              doc.setFillColor(11, 15, 20);
              doc.rect(0, 0, pageWidth, pageHeight, "F");
              y = margin + 15;
            }
            doc.text(w, margin, y);
            y += 11;
          }
        }
      }

      doc.save(`weft-report-${serviceName}-${simulationId.slice(0, 8)}.pdf`);
      return;
    } catch (e) {
      console.warn("jsPDF export error, falling back", e);
    }
  }

  // Fallback: standard printable document trigger
  const printWindow = window.open("", "_blank");
  if (printWindow) {
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>weft-report-${serviceName}-${simulationId.slice(0, 8)}</title>
          <style>
            body { font-family: monospace; background: #fff; color: #111; padding: 32px; font-size: 11px; }
            pre { white-space: pre-wrap; word-wrap: break-word; font-family: monospace; font-size: 11px; }
            h2 { font-size: 14px; margin-bottom: 4px; }
            p { color: #555; font-size: 10px; margin-top: 0; }
            @media print { body { padding: 0; } }
          </style>
        </head>
        <body>
          <h2>WEFT Incident Impact Report: ${serviceName}</h2>
          <p>Simulation ID: ${simulationId} | Generated: ${new Date().toLocaleString()}</p>
          <hr/>
          <pre>${markdownContent.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
          <script>window.onload = function() { window.print(); };</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  }
}

export function ReportsPage() {
  const [items, setItems] = useState<SimulationListItem[]>([]);
  const [report, setReport] = useState<(ReportResponse & { serviceName?: string }) | null>(null);
  const [loadingReportId, setLoadingReportId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<"ALL" | "HIGH" | "MEDIUM" | "LOW">("ALL");
  const [sortBy, setSortBy] = useState<"RECENT" | "BLAST" | "AFFECTED">("RECENT");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 6;

  const navigate = useNavigate();

  useEffect(() => {
    api
      .simulations()
      .then((result) => {
        setItems(result.items);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load reports"));
  }, []);

  async function generate(id: string, format: "pdf" | "json", serviceName = "service") {
    try {
      setLoadingReportId(id);
      setError(null);
      if (format === "pdf") {
        // Fetch report markdown from backend
        const payload = await api.reports(id, "markdown");
        setReport({ ...payload, serviceName });
        // Download in PDF format
        downloadReportAsPdf(serviceName, id, payload.content);
      } else {
        const payload = await api.reports(id, "json");
        setReport({ ...payload, serviceName });
        const blob = new Blob([payload.content], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `weft-report-${serviceName}-${id.slice(0, 8)}.json`;
        link.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Report generation failed");
    } finally {
      setLoadingReportId(null);
    }
  }

  function exportAllCsv() {
    if (!items.length) return;
    const headers = ["Simulation ID", "Service Name", "Severity", "Blast Radius Score", "Affected Services", "Timestamp"];
    const rows = items.map((it) => [
      it.id,
      `"${it.failed_service_name.replace(/"/g, '""')}"`,
      it.severity,
      it.blast_radius_score.toFixed(1),
      it.affected_service_count,
      `"${new Date(it.created_at).toISOString()}"`,
    ]);
    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `weft-incident-reports-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // Diagnostics calculations
  const totalAudits = items.length;
  const avgImpact = totalAudits
    ? items.reduce((acc, it) => acc + (it.blast_radius_score || 0), 0) / totalAudits
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

  const resiliency = Math.max(0, 100 - avgImpact);
  const resiliencyTag = resiliency >= 80 ? "OPTIMAL" : resiliency >= 50 ? "NOMINAL" : "CRITICAL";

  // Severity counts
  const highCount = items.filter((it) => it.severity === "HIGH" || it.severity === "CRITICAL").length;
  const medCount = items.filter((it) => it.severity === "MEDIUM" || it.severity === "DEGRADED").length;
  const lowCount = items.filter((it) => it.severity === "LOW").length;

  // Filter & Sort
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

  return (
    <div className="min-h-screen flex flex-col font-mono text-sm antialiased bg-[#0B0F14] text-[#E5E7EB] selection:bg-[#9CAFC4] selection:text-[#0B0F14] relative">
      {/* Background WebGL Shader Canvas & Dot Matrix Overlay */}
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
      <div className="fixed inset-0 pointer-events-none z-0 dot-matrix-bg" />

      {/* Main Content Area */}
      <main className="relative z-10 flex-1 max-w-7xl w-full mx-auto px-4 lg:px-8 py-8 space-y-8">
        {/* Title & Editorial Subheader */}
        <section className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-2" data-purpose="page-title-banner">
          <div>
            <div className="text-xs uppercase tracking-widest text-[#94A3B8] mb-1">
              // REPORTS • INCIDENT IMPACT AUDIT
            </div>
            <h1
              className="text-xl md:text-2xl font-bold text-[#E5E7EB] tracking-tight flex items-baseline gap-3"
              style={{ fontFamily: "'Press Start 2P', monospace", letterSpacing: "-0.02em" }}
            >
              Incident impact reports
            </h1>
            <p className="text-xs md:text-sm text-[#94A3B8] mt-2 max-w-2xl font-mono leading-relaxed">
              Reports are generated from stored failure simulations. They are not independent documents.
            </p>
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-3">
            <button
              className="px-4 py-2 border border-[#334155] bg-[#111827]/90 text-slate-300 hover:text-white hover:bg-slate-800 text-xs tracking-wider transition-colors font-mono cursor-pointer"
              type="button"
              onClick={exportAllCsv}
            >
              [ EXPORT ALL CSV ]
            </button>
            <button
              className="px-4 py-2 bg-[#9CAFC4] text-[#0B0F14] font-semibold hover:brightness-105 text-xs tracking-wider transition-colors font-mono cursor-pointer border border-[#c5d7ed]"
              type="button"
              onClick={() => navigate("/graph")}
            >
              + [ GENERATE NEW REPORT ]
            </button>
          </div>
        </section>

        {error && (
          <div className="p-3 bg-red-950/40 border border-red-500 text-red-400 text-xs font-mono">
            {error}
          </div>
        )}

        {/* Summary Telemetry Strip */}
        <section aria-label="System Metrics" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="retro-card p-4 border border-[#1E293B]">
            <div className="text-[11px] text-[#64748B] tracking-wider mb-2">// TOTAL AUDITS GENERATED</div>
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-bold text-white tracking-tight">{totalAudits}</span>
              <span className="text-xs text-emerald-400 font-mono font-medium">
                +{Math.min(totalAudits, 4)} THIS MONTH
              </span>
            </div>
          </div>

          <div className="retro-card p-4 border border-[#1E293B]">
            <div className="text-[11px] text-[#64748B] tracking-wider mb-2">// AVG IMPACT RADIUS</div>
            <div className="flex items-baseline justify-between">
              <div
                className={`text-3xl font-bold tracking-tight ${
                  avgImpact > 50 ? "text-red-400" : avgImpact > 25 ? "text-amber-400" : "text-emerald-400"
                }`}
              >
                {avgImpact.toFixed(1)}
                <span className="text-lg font-normal text-[#94A3B8]">%</span>
              </div>
              <span className="text-[10px] text-[#64748B] font-mono">THRESHOLD: 50%</span>
            </div>
          </div>

          <div className="retro-card p-4 border border-[#1E293B]">
            <div className="text-[11px] text-[#64748B] tracking-wider mb-2">// CRITICAL PATH SERVICES</div>
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold text-slate-200 truncate font-mono max-w-[150px]">
                {targetStats.name}
              </span>
              <span className="text-xs text-[#94A3B8] font-mono">{targetStats.count} AUDITED</span>
            </div>
          </div>

          <div className="retro-card p-4 border border-[#1E293B]">
            <div className="text-[11px] text-[#64748B] tracking-wider mb-2">// SYSTEM RESILIENCY</div>
            <div className="flex items-baseline justify-between">
              <div
                className={`text-3xl font-bold tracking-tight ${
                  resiliency >= 80 ? "text-emerald-400" : resiliency >= 50 ? "text-amber-400" : "text-red-400"
                }`}
              >
                {resiliency.toFixed(1)}
                <span className="text-lg font-normal text-[#94A3B8]">%</span>
              </div>
              <span
                className={`text-[10px] border px-1.5 py-0.5 font-mono ${
                  resiliency >= 80
                    ? "text-emerald-400 border-emerald-500/30 bg-emerald-950/40"
                    : resiliency >= 50
                    ? "text-amber-400 border-amber-500/30 bg-amber-950/40"
                    : "text-red-400 border-red-500/30 bg-red-950/40"
                }`}
              >
                [ {resiliencyTag} ]
              </span>
            </div>
          </div>
        </section>

        {/* Filter & Sort Controls */}
        <section className="retro-card p-3 border border-[#1E293B] flex flex-wrap items-center justify-between gap-4 text-xs">
          {/* Filter Severity */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[#64748B]">// FILTER SEVERITY:</span>
            <div className="flex items-center gap-1.5">
              <button
                className={`px-2.5 py-1 font-mono text-[11px] cursor-pointer transition-colors border ${
                  severityFilter === "ALL"
                    ? "bg-slate-800 text-slate-100 border-slate-600 font-semibold"
                    : "text-[#94A3B8] hover:text-slate-200 border-transparent hover:border-slate-700"
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
                    ? "bg-red-950/60 text-red-400 border-red-500 font-semibold"
                    : "text-[#94A3B8] hover:text-red-300 border-transparent hover:border-red-900"
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
                    ? "bg-amber-950/60 text-amber-400 border-amber-500 font-semibold"
                    : "text-[#94A3B8] hover:text-amber-300 border-transparent hover:border-amber-900"
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
                    ? "bg-emerald-950/60 text-emerald-400 border-emerald-500 font-semibold"
                    : "text-[#94A3B8] hover:text-emerald-300 border-transparent hover:border-emerald-900"
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
          </div>

          {/* Quick Search & Sort Filter */}
          <div className="flex items-center gap-3">
            <div className="relative flex items-center">
              <span className="absolute left-2 text-slate-500 font-mono text-xs select-none">&gt;</span>
              <input
                className="bg-[#111827] border border-[#1E293B] text-[#E5E7EB] placeholder-slate-600 text-xs pl-5 pr-2.5 py-1 w-44 focus:outline-none focus:border-[#9CAFC4]"
                placeholder="Search services..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                type="text"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[#64748B]">SORT:</span>
              <select
                className="px-3 py-1 bg-[#111827] border border-[#1E293B] text-slate-200 text-xs outline-none focus:border-[#9CAFC4] cursor-pointer"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              >
                <option value="RECENT">MOST RECENT</option>
                <option value="BLAST">HIGHEST BLAST RADIUS</option>
                <option value="AFFECTED">MOST AFFECTED</option>
              </select>
            </div>
          </div>
        </section>

        {/* Live Report Preview Card (if generated) */}
        {report && (
          <section className="retro-card p-5 border border-[#334155] space-y-3 bg-[#0d141d]/95">
            <div className="flex items-center justify-between border-b border-[#1E293B] pb-3">
              <div className="flex items-center space-x-2">
                <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                <span className="font-mono text-xs text-white uppercase font-bold tracking-wider">
                  REPORT PREVIEW // SIMULATION ID: {report.simulation_id.slice(0, 8)}
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  className="px-2.5 py-1 text-xs border border-[#334155] bg-[#9CAFC4] hover:brightness-105 text-[#0B0F14] font-bold font-mono cursor-pointer"
                  type="button"
                  onClick={() => {
                    downloadReportAsPdf(
                      report.serviceName || "service",
                      report.simulation_id,
                      report.content
                    );
                  }}
                >
                  [ DOWNLOAD PDF ]
                </button>
                <button
                  className="px-2.5 py-1 text-xs border border-[#334155] bg-[#111827] hover:bg-[#1E293B] text-slate-200 font-mono cursor-pointer"
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(report.content);
                  }}
                >
                  [ COPY ]
                </button>
                <button
                  className="px-2.5 py-1 text-xs border border-red-500/50 bg-red-950/30 hover:bg-red-950/60 text-red-400 font-mono cursor-pointer"
                  type="button"
                  onClick={() => setReport(null)}
                >
                  [ CLOSE PREVIEW ]
                </button>
              </div>
            </div>
            <pre className="text-xs font-mono text-slate-300 bg-[#0B0F14] p-4 border border-[#1E293B] overflow-x-auto max-h-72 whitespace-pre-wrap leading-relaxed">
              {report.content}
            </pre>
          </section>
        )}

        {/* Incident Impact Reports List */}
        <section aria-label="Incident Reports List" className="space-y-3">
          {items.length === 0 ? (
            <div className="retro-card p-8 text-center text-[#94A3B8] border border-[#1E293B]">
              <p className="mb-3">No incident reports recorded yet.</p>
              <button
                className="px-3.5 py-2 bg-[#9CAFC4] text-[#0B0F14] font-bold text-xs uppercase cursor-pointer"
                type="button"
                onClick={() => navigate("/graph")}
              >
                [ Run a failure simulation on the graph ]
              </button>
            </div>
          ) : (
            paginated.map((item) => {
              const isHigh = item.severity === "HIGH" || item.severity === "CRITICAL";
              const isGenerating = loadingReportId === item.id;

              return (
                <div
                  key={item.id}
                  className="retro-card p-5 border border-[#1E293B] hover:border-slate-600 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all"
                >
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <span className="text-base font-semibold text-slate-100 font-mono tracking-tight">
                        {item.failed_service_name}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-[#94A3B8]">
                      {/* Severity Badge */}
                      <SeverityBadge severity={item.severity} />

                      {/* Blast radius, Service count, Timestamp */}
                      <div className="flex items-center gap-2 font-mono">
                        <span className={isHigh ? "text-red-400 font-semibold" : "text-slate-300"}>
                          blast radius {item.blast_radius_score.toFixed(0)}
                        </span>
                        <MeterBlock score={item.blast_radius_score} severity={item.severity} />
                        <span>•</span>
                        <span>{item.affected_service_count} services</span>
                        <span>•</span>
                        <span className="text-[#64748B]">
                          {new Date(item.created_at).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Row Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      className="px-4 py-2 bg-[#9CAFC4] hover:brightness-105 text-[#0B0F14] font-semibold text-xs tracking-wide shadow transition-colors font-mono cursor-pointer disabled:opacity-50"
                      type="button"
                      disabled={isGenerating}
                      onClick={() => void generate(item.id, "pdf", item.failed_service_name)}
                    >
                      {isGenerating ? "Generating PDF…" : "View report (PDF)"}
                    </button>
                    <button
                      className="px-4 py-2 border border-slate-700 bg-[#111827]/90 hover:bg-slate-800 text-slate-200 text-xs tracking-wide transition-colors font-mono cursor-pointer disabled:opacity-50"
                      type="button"
                      disabled={isGenerating}
                      onClick={() => void generate(item.id, "json", item.failed_service_name)}
                    >
                      Export
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </section>

        {/* Pagination HUD & Callout */}
        <section className="space-y-4 pt-2">
          {/* Pagination Row */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#64748B]">
            <div>
              <span>
                SHOWING {paginated.length} OF {filtered.length} RECORDED IMPACT REPORTS
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                className={`px-3 py-1 bg-[#111827] border border-[#1E293B] ${
                  page <= 1 ? "text-slate-600 cursor-not-allowed" : "text-[#94A3B8] hover:text-white hover:border-slate-600 cursor-pointer"
                } transition-colors`}
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                [ &lt; PREV ]
              </button>
              <span className="px-3 py-1 bg-slate-900 border border-slate-700 text-slate-200 font-mono">
                PAGE {page} / {totalPages}
              </span>
              <button
                className={`px-3 py-1 bg-[#111827] border border-[#1E293B] ${
                  page >= totalPages ? "text-slate-600 cursor-not-allowed" : "text-[#94A3B8] hover:text-white hover:border-slate-600 cursor-pointer"
                } transition-colors`}
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                [ NEXT &gt; ]
              </button>
            </div>
          </div>

          {/* Telemetry Info Callout */}
          <div className="retro-card p-4 border border-[#1E293B] flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-5 h-5 flex items-center justify-center border border-slate-600 text-slate-300 text-xs font-mono shrink-0 mt-0.5">
                i
              </div>
              <div className="space-y-1">
                <div className="text-xs font-semibold text-slate-200 uppercase tracking-wider font-mono">
                  IMMUTABLE SIMULATION AUDITS
                </div>
                <p className="text-xs text-[#94A3B8] font-mono leading-relaxed">
                  Each report contains deterministic snapshot topologies, blast radius telemetry, and downstream propagation graphs generated during chaos experiments.
                </p>
              </div>
            </div>
            <button
              className="hidden md:inline-flex items-center gap-1 text-xs text-[#9CAFC4] hover:text-white shrink-0 font-mono tracking-wider bg-transparent border-0 cursor-pointer"
              type="button"
              onClick={() => navigate("/graph")}
            >
              &gt; GO TO DEPENDENCY MAP
            </button>
          </div>
        </section>
      </main>

      {/* Terminal Footer */}
      <footer className="relative z-20 border-t border-[#1E293B] bg-[#0B0F14]/95 text-[11px] text-[#64748B] px-4 lg:px-8 py-3 mt-8">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 font-mono">
          <div className="flex items-center gap-2">
            <span>WEFT Telemetry Observability Suite</span>
            <span>•</span>
            <span>Incident Impact Engine</span>
            <span>•</span>
            <span>Dynamic Wave Topology</span>
          </div>
          <div className="flex items-center gap-4">
            <span>ID: rpt-audit-hud-04</span>
            <span>
              ENGINE: <strong className="text-emerald-400 font-normal">NOMINAL</strong>
            </span>
            <span className="text-slate-500">8-BIT TELEMETRY ACTIVE</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
