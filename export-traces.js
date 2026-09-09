#!/usr/bin/env node
/**
 * NEXUS-IT → WEFT Jaeger Trace Exporter
 * ──────────────────────────────────────
 * Queries the Jaeger HTTP API and exports all traces as a single
 * consolidated JSON file ready to upload to WEFT.
 *
 * Usage:
 *   node export-traces.js
 *   node export-traces.js --limit 2000 --lookback 24h
 *   node export-traces.js --output my-traces.json
 *
 * Output: weft-traces-export.json  (default)
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');

// ── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(flag, def) {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : def;
}

const JAEGER_HOST = getArg('--jaeger',   'localhost');
const JAEGER_PORT = getArg('--port',     '16686');
const LIMIT       = getArg('--limit',    '2000');
const LOOKBACK    = getArg('--lookback', '24h');
const OUTPUT      = getArg('--output',   `weft-traces-export-${Date.now()}.json`);

const BASE = `http://${JAEGER_HOST}:${JAEGER_PORT}`;

// ── HTTP helper ────────────────────────────────────────────────────────────────
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error for ${url}: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   NEXUS-IT → WEFT Jaeger Trace Exporter         ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`  Jaeger : ${BASE}`);
  console.log(`  Limit  : ${LIMIT} traces per service`);
  console.log(`  Lookback: ${LOOKBACK}`);
  console.log(`  Output : ${OUTPUT}\n`);

  // 1. Discover all services
  console.log('[ 1/4 ] Discovering services...');
  let services = [];
  try {
    const svcResp = await fetchJSON(`${BASE}/api/services`);
    services = (svcResp.data || []).filter(s => s !== 'jaeger-query');
    console.log(`        Found ${services.length} services: ${services.join(', ')}`);
  } catch (err) {
    console.error(`\n  ✘ Cannot reach Jaeger at ${BASE}`);
    console.error(`    Make sure Jaeger is running: docker run -p 16686:16686 -p 4318:4318 jaegertracing/all-in-one`);
    console.error(`    Error: ${err.message}\n`);
    process.exit(1);
  }

  if (!services.length) {
    console.warn('\n  ⚠ No services found in Jaeger yet.');
    console.warn('    Run the traffic generator first: npm run traffic\n');
    process.exit(0);
  }

  // 2. Fetch operations per service
  console.log('[ 2/4 ] Fetching operations...');
  const operationsMap = {};
  await Promise.all(services.map(async svc => {
    try {
      const resp = await fetchJSON(`${BASE}/api/services/${encodeURIComponent(svc)}/operations`);
      operationsMap[svc] = resp.data || [];
    } catch {
      operationsMap[svc] = [];
    }
  }));

  // 3. Fetch traces for each service
  console.log('[ 3/4 ] Fetching traces...');
  const allTraces    = [];
  const traceIdsSeen = new Set();
  const serviceStats = {};

  for (const svc of services) {
    process.stdout.write(`        ${svc.padEnd(30)}`);
    try {
      const url  = `${BASE}/api/traces?service=${encodeURIComponent(svc)}&limit=${LIMIT}&lookback=${LOOKBACK}`;
      const resp = await fetchJSON(url);
      const traces = resp.data || [];

      let newCount = 0;
      for (const trace of traces) {
        if (!traceIdsSeen.has(trace.traceID)) {
          traceIdsSeen.add(trace.traceID);
          allTraces.push(trace);
          newCount++;
        }
      }

      serviceStats[svc] = {
        totalFetched: traces.length,
        uniqueNew: newCount,
        operations: operationsMap[svc] || [],
      };
      console.log(`→ ${traces.length} traces (${newCount} unique)`);
    } catch (err) {
      serviceStats[svc] = { error: err.message };
      console.log(`→ ERROR: ${err.message}`);
    }
  }

  // 4. Build dependency graph from spans
  console.log('[ 4/4 ] Extracting dependency graph...');
  const edges    = {};  // "svcA→svcB" → { count, operations: Set }
  const nodeSet  = new Set();

  for (const trace of allTraces) {
    const processes = trace.processes || {};
    const spans     = trace.spans || [];

    // Build spanId → serviceName map
    const spanService = {};
    for (const span of spans) {
      const proc = processes[span.processID];
      if (proc) spanService[span.spanID] = proc.serviceName;
    }

    // Find parent→child service calls
    for (const span of spans) {
      const childSvc = spanService[span.spanID];
      if (!childSvc) continue;
      nodeSet.add(childSvc);

      for (const ref of (span.references || [])) {
        if (ref.refType === 'CHILD_OF') {
          const parentSvc = spanService[ref.spanID];
          if (parentSvc && parentSvc !== childSvc) {
            const key = `${parentSvc}→${childSvc}`;
            if (!edges[key]) edges[key] = { from: parentSvc, to: childSvc, count: 0, operations: [] };
            edges[key].count++;
            if (span.operationName && !edges[key].operations.includes(span.operationName)) {
              edges[key].operations.push(span.operationName);
            }
          }
        }
      }
    }
  }

  const dependencyGraph = {
    nodes: Array.from(nodeSet).map(name => ({ name, ...serviceStats[name] })),
    edges: Object.values(edges).sort((a, b) => b.count - a.count),
  };

  // ── Assemble output ─────────────────────────────────────────────────────────
  // WEFT expects the standard Jaeger format: { "data": [...traces...] }
  // Each trace must include its "processes" map alongside "spans".
  const output = {
    data: allTraces,  // Required top-level key for WEFT ingestion
    meta: {
      exportedAt:   new Date().toISOString(),
      exportedBy:   'nexus-it-dummy-platform',
      jaegerHost:   BASE,
      lookback:     LOOKBACK,
      traceLimit:   parseInt(LIMIT),
      totalTraces:  allTraces.length,
      totalSpans:   allTraces.reduce((s, t) => s + (t.spans?.length || 0), 0),
      totalServices: services.length,
    },
    services,
    serviceStats,
    dependencyGraph,
  };

  // ── Write file ──────────────────────────────────────────────────────────────
  const outPath = path.resolve(OUTPUT);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  const fileSizeMB = (fs.statSync(outPath).size / 1024 / 1024).toFixed(2);

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   Export Complete ✓                              ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`  File      : ${outPath}`);
  console.log(`  Size      : ${fileSizeMB} MB`);
  console.log(`  Traces    : ${output.meta.totalTraces}`);
  console.log(`  Spans     : ${output.meta.totalSpans}`);
  console.log(`  Services  : ${services.length}`);
  console.log(`  Dep edges : ${dependencyGraph.edges.length}`);
  console.log('\n  Dependency Graph:');
  dependencyGraph.edges.forEach(e => {
    console.log(`    ${e.from.padEnd(28)} → ${e.to} (${e.count} calls)`);
  });
  console.log(`\n  ✔ Upload ${path.basename(outPath)} to WEFT.\n`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
