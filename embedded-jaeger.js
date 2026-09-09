/**
 * Embedded Jaeger Server & OTLP Collector for NEXUS-IT
 * ───────────────────────────────────────────────────
 * Provides zero-dependency Jaeger tracing for environments without Docker.
 * 
 * Ports:
 *  - 4318 : OTLP/HTTP Trace Collector (receives spans from microservices)
 *  - 16686: Jaeger Web UI & REST API (compatible with Jaeger UI and export scripts)
 */

const express = require('express');
const cors = require('cors');

const otlpApp = express();
const jaegerApp = express();

otlpApp.use(cors());
otlpApp.use(express.json({ limit: '50mb' }));

jaegerApp.use(cors());
jaegerApp.use(express.json());

// In-memory trace storage
const traceStore = new Map(); // traceID -> Jaeger trace object
const serviceSet = new Set();
const serviceOperations = new Map(); // serviceName -> Set(opNames)

/**
 * Convert OTLP resourceSpans payload into standard Jaeger trace format
 */
function processOtlpPayload(body) {
  if (!body || !body.resourceSpans) return;

  for (const rSpan of body.resourceSpans) {
    // Extract service name from resource attributes
    const resourceAttrs = rSpan.resource?.attributes || [];
    let serviceName = 'unknown-service';
    for (const attr of resourceAttrs) {
      if (attr.key === 'service.name' && attr.value?.stringValue) {
        serviceName = attr.value.stringValue;
        break;
      }
    }
    serviceSet.add(serviceName);
    if (!serviceOperations.has(serviceName)) {
      serviceOperations.set(serviceName, new Set());
    }

    const scopeSpans = rSpan.scopeSpans || rSpan.instrumentationLibrarySpans || [];
    for (const sSpan of scopeSpans) {
      const spans = sSpan.spans || [];
      for (const span of spans) {
        const traceID = span.traceId;
        const spanID = span.spanId;
        const operationName = span.name || 'unnamed-operation';
        serviceOperations.get(serviceName).add(operationName);

        // Convert OTLP timestamp (nanoseconds string or number) to microseconds
        const startTimeMicros = span.startTimeUnixNano
          ? Math.floor(Number(span.startTimeUnixNano) / 1000)
          : Date.now() * 1000;
        const endTimeMicros = span.endTimeUnixNano
          ? Math.floor(Number(span.endTimeUnixNano) / 1000)
          : startTimeMicros;
        const durationMicros = Math.max(1, endTimeMicros - startTimeMicros);

        // Convert attributes
        const tags = (span.attributes || []).map(attr => ({
          key: attr.key,
          type: 'string',
          value: attr.value?.stringValue || attr.value?.intValue || JSON.stringify(attr.value || {})
        }));

        // Convert references / parentSpanId
        const references = [];
        if (span.parentSpanId) {
          references.push({
            refType: 'CHILD_OF',
            traceID,
            spanID: span.parentSpanId
          });
        }

        // Process ID for Jaeger
        const processID = `p_${serviceName}`;

        const jaegerSpan = {
          traceID,
          spanID,
          flags: 1,
          operationName,
          references,
          startTime: startTimeMicros,
          duration: durationMicros,
          tags,
          logs: (span.events || []).map(evt => ({
            timestamp: Math.floor(Number(evt.timeUnixNano || 0) / 1000),
            fields: (evt.attributes || []).map(a => ({ key: a.key, value: a.value?.stringValue || '' }))
          })),
          processID,
          warnings: null
        };

        if (!traceStore.has(traceID)) {
          traceStore.set(traceID, {
            traceID,
            spans: [],
            processes: {
              [processID]: {
                serviceName,
                tags: []
              }
            }
          });
        }

        const traceObj = traceStore.get(traceID);
        traceObj.processes[processID] = { serviceName, tags: [] };
        
        // Avoid duplicate spans
        if (!traceObj.spans.some(s => s.spanID === spanID)) {
          traceObj.spans.push(jaegerSpan);
        }
      }
    }
  }
}

// ── 1. OTLP Receiver Endpoint (Port 4318) ───────────────────────────────────
otlpApp.post('/v1/traces', (req, res) => {
  try {
    processOtlpPayload(req.body);
    res.status(200).json({ partialSuccess: {} });
  } catch (err) {
    console.error('[Jaeger Collector] Error processing trace payload:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// ── 2. Jaeger REST API (Port 16686) ──────────────────────────────────────────
jaegerApp.get('/api/services', (req, res) => {
  res.json({
    data: Array.from(serviceSet),
    total: serviceSet.size,
    limit: 0,
    offset: 0,
    errors: null
  });
});

jaegerApp.get('/api/services/:service/operations', (req, res) => {
  const svc = req.params.service;
  const ops = Array.from(serviceOperations.get(svc) || []);
  res.json({
    data: ops,
    total: ops.length,
    limit: 0,
    offset: 0,
    errors: null
  });
});

jaegerApp.get('/api/traces', (req, res) => {
  const { service, limit = 100 } = req.query;
  const maxLimit = parseInt(limit, 10);
  const resultTraces = [];

  for (const traceObj of traceStore.values()) {
    if (service) {
      // Check if trace contains any span belonging to this service
      const belongsToService = Object.values(traceObj.processes).some(
        p => p.serviceName === service
      );
      if (!belongsToService) continue;
    }
    resultTraces.push(traceObj);
    if (resultTraces.length >= maxLimit) break;
  }

  res.json({
    data: resultTraces,
    total: resultTraces.length,
    limit: maxLimit,
    offset: 0,
    errors: null
  });
});

jaegerApp.get('/api/traces/:traceID', (req, res) => {
  const traceObj = traceStore.get(req.params.traceID);
  if (traceObj) {
    res.json({ data: [traceObj], total: 1, limit: 0, offset: 0, errors: null });
  } else {
    res.status(404).json({ errors: [{ code: 404, msg: 'Trace not found' }] });
  }
});

// ── 3. Embedded Jaeger Web UI ────────────────────────────────────────────────
jaegerApp.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>NEXUS-IT Jaeger UI</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0f172a; --card: #1e293b; --accent: #6366f1; --border: #334155; --text: #f8fafc; --muted: #94a3b8;
    }
    body { margin: 0; font-family: 'Inter', sans-serif; background: var(--bg); color: var(--text); }
    header { background: #020617; padding: 1rem 2rem; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border); }
    .brand { display: flex; align-items: center; gap: 0.75rem; font-weight: 700; font-size: 1.25rem; }
    .badge { background: #312e81; color: #a5b4fc; padding: 0.25rem 0.6rem; border-radius: 9999px; font-size: 0.75rem; }
    .container { padding: 2rem; max-width: 1200px; margin: 0 auto; }
    .controls { display: grid; grid-template-columns: 2fr 2fr 1fr 1fr; gap: 1rem; background: var(--card); padding: 1.25rem; border-radius: 0.75rem; border: 1px solid var(--border); margin-bottom: 2rem; }
    select, button, input { background: #0f172a; border: 1px solid var(--border); color: #fff; padding: 0.6rem 1rem; border-radius: 0.5rem; font-size: 0.9rem; }
    button { background: var(--accent); cursor: pointer; font-weight: 600; border: none; }
    button:hover { opacity: 0.9; }
    .trace-card { background: var(--card); border: 1px solid var(--border); border-radius: 0.75rem; padding: 1.25rem; margin-bottom: 1rem; }
    .trace-header { display: flex; justify-content: space-between; margin-bottom: 0.75rem; }
    .trace-id { font-family: monospace; color: #a5b4fc; font-weight: 600; }
    .span-bar { height: 8px; background: #334155; border-radius: 4px; overflow: hidden; margin-top: 0.5rem; position: relative; }
    .span-segment { height: 100%; position: absolute; border-radius: 2px; }
    .export-btn { background: #059669; margin-left: auto; display: inline-flex; align-items: center; gap: 0.5rem; }
    pre { background: #090d16; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; font-size: 0.85rem; color: #38bdf8; }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
      Jaeger Trace Viewer <span class="badge">NEXUS-IT Embedded</span>
    </div>
    <div>
      <button class="export-btn" onclick="exportJSON()">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
        Download All Traces JSON
      </button>
    </div>
  </header>
  <div class="container">
    <div class="controls">
      <div>
        <label style="display:block; font-size:0.8rem; color:var(--muted); margin-bottom:0.4rem;">Service</label>
        <select id="serviceSelect" style="width:100%" onchange="loadTraces()"><option value="">All Services</option></select>
      </div>
      <div>
        <label style="display:block; font-size:0.8rem; color:var(--muted); margin-bottom:0.4rem;">Limit Traces</label>
        <input type="number" id="limitInput" value="50" style="width:100%">
      </div>
      <div style="display:flex; align-items:flex-end;">
        <button onclick="loadTraces()" style="width:100%">Find Traces</button>
      </div>
      <div style="display:flex; align-items:flex-end;">
        <button onclick="loadStats()" style="width:100%; background:#475569">Refresh</button>
      </div>
    </div>
    
    <div id="statsSummary" style="margin-bottom: 1.5rem; color: var(--muted); font-size:0.9rem;"></div>
    <div id="traceList"></div>
  </div>

  <script>
    async function loadServices() {
      const res = await fetch('/api/services');
      const data = await res.json();
      const sel = document.getElementById('serviceSelect');
      sel.innerHTML = '<option value="">All Services (' + (data.data.length || 0) + ')</option>';
      (data.data || []).forEach(svc => {
        sel.innerHTML += '<option value="' + svc + '">' + svc + '</option>';
      });
    }

    async function loadTraces() {
      const svc = document.getElementById('serviceSelect').value;
      const limit = document.getElementById('limitInput').value;
      const url = '/api/traces?limit=' + limit + (svc ? '&service=' + encodeURIComponent(svc) : '');
      const res = await fetch(url);
      const json = await res.json();

      const list = document.getElementById('traceList');
      const stats = document.getElementById('statsSummary');
      stats.innerHTML = 'Showing <b>' + json.data.length + '</b> traces captured in memory.';
      list.innerHTML = '';

      if (!json.data.length) {
        list.innerHTML = '<div style="text-align:center; padding:3rem; color:var(--muted);">No traces recorded yet. Make sure traffic generator or API calls are running!</div>';
        return;
      }

      json.data.forEach(t => {
        const rootSpan = t.spans[0] || {};
        const svcNames = Object.values(t.processes).map(p => p.serviceName).join(', ');
        const card = document.createElement('div');
        card.className = 'trace-card';
        card.innerHTML = \`
          <div class="trace-header">
            <div>
              <span class="trace-id">ID: \${t.traceID}</span>
              <div style="font-weight:600; font-size:1.1rem; margin-top:0.25rem;">\${rootSpan.operationName || 'Trace Root'}</div>
              <div style="font-size:0.85rem; color:var(--muted); margin-top:0.2rem;">Services involved: <b>\${svcNames}</b> (\${t.spans.length} spans)</div>
            </div>
            <div style="text-align:right">
              <span style="font-size:0.85rem; color:#a5b4fc">\${(rootSpan.duration / 1000).toFixed(2)} ms</span>
            </div>
          </div>
          <button style="font-size:0.75rem; background:#334155; padding:0.3rem 0.6rem;" onclick="toggleTraceJSON('\${t.traceID}')">Toggle JSON</button>
          <div id="json-\${t.traceID}" style="display:none; margin-top:1rem;">
            <pre>\${JSON.stringify(t, null, 2)}</pre>
          </div>
        \`;
        list.appendChild(card);
      });
    }

    function toggleTraceJSON(id) {
      const el = document.getElementById('json-' + id);
      el.style.display = el.style.display === 'none' ? 'block' : 'none';
    }

    async function exportJSON() {
      const res = await fetch('/api/traces?limit=5000');
      const json = await res.json();
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'weft-jaeger-traces.json';
      a.click();
    }

    loadServices();
    loadTraces();
  </script>
</body>
</html>
  `);
});

// Start ports
const OTLP_PORT = process.env.OTLP_PORT || 4318;
const JAEGER_PORT = process.env.JAEGER_PORT || 16686;

otlpApp.listen(OTLP_PORT, () => {
  console.log(`[Embedded Jaeger] OTLP Collector listening on http://localhost:${OTLP_PORT}/v1/traces`);
});

jaegerApp.listen(JAEGER_PORT, () => {
  console.log(`[Embedded Jaeger] Jaeger UI & API listening on http://localhost:${JAEGER_PORT}`);
});
