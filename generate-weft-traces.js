#!/usr/bin/env node
/**
 * NEXUS-IT → WEFT Dummy Trace Generator
 * ──────────────────────────────────────
 * Generates realistic Jaeger-format JSON traces for all NEXUS-IT
 * microservices. The output can be directly uploaded to WEFT.
 *
 * NO running Jaeger instance is required — this builds traces
 * synthetically based on the NEXUS-IT service topology.
 *
 * Usage:
 *   node generate-weft-traces.js
 *   node generate-weft-traces.js --traces 100
 *   node generate-weft-traces.js --output my-traces.json
 */

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(flag, def) {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : def;
}

const TRACE_COUNT = parseInt(getArg('--traces', '50'));
const OUTPUT      = getArg('--output', `weft-traces-${Date.now()}.json`);

// ── Helpers ──────────────────────────────────────────────────────────────────
function hexId(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}
function traceId()  { return hexId(16); }
function spanId()   { return hexId(8); }
function pick(arr)  { return arr[Math.floor(Math.random() * arr.length)]; }
function rand(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }

// ── Service definitions (matches NEXUS-IT architecture) ──────────────────────
const SERVICES = [
  'api-gateway',
  'auth-service',
  'catalog-service',
  'order-service',
  'billing-service',
  'user-service',
  'support-service',
  'asset-service',
  'notification-service',
  'analytics-service',
];

// Process map — each service gets a stable processID
function buildProcesses(serviceNames) {
  const procs = {};
  for (const svc of serviceNames) {
    procs[`p_${svc}`] = {
      serviceName: svc,
      tags: [
        { key: 'hostname',      type: 'string', value: `${svc}-pod-${hexId(3)}` },
        { key: 'ip',            type: 'string', value: `10.0.${rand(1,254)}.${rand(1,254)}` },
        { key: 'jaeger.version', type: 'string', value: 'Node-4.8.0' },
      ],
    };
  }
  return procs;
}

// ── Span builder ─────────────────────────────────────────────────────────────
function makeSpan(tId, sId, parentSId, service, opName, startMicros, durationMicros, extraTags = []) {
  const references = parentSId
    ? [{ refType: 'CHILD_OF', traceID: tId, spanID: parentSId }]
    : [];

  const tags = [
    ...extraTags,
    { key: 'span.kind',  type: 'string', value: parentSId ? 'server' : 'client' },
    { key: 'component',  type: 'string', value: 'express' },
  ];

  return {
    traceID:       tId,
    spanID:        sId,
    flags:         1,
    operationName: opName,
    references,
    startTime:     startMicros,
    duration:      durationMicros,
    tags,
    logs:          [],
    processID:     `p_${service}`,
    warnings:      null,
  };
}

// ── Scenario definitions ─────────────────────────────────────────────────────
// Each scenario returns { spans: [], involvedServices: [] }

function scenarioBrowseProducts(tId, baseTime) {
  const spans = [];
  const gw = 'api-gateway', auth = 'auth-service', cat = 'catalog-service';
  const rootId = spanId();

  // Root: POST /api/auth/login on gateway
  spans.push(makeSpan(tId, rootId, null, gw, 'POST /api/auth/login', baseTime, rand(80000, 200000), [
    { key: 'http.method', type: 'string', value: 'POST' },
    { key: 'http.url',    type: 'string', value: 'http://localhost:3000/api/auth/login' },
    { key: 'http.status_code', type: 'string', value: '200' },
    { key: 'http.route', type: 'string', value: '/api/auth/login' },
  ]));

  // Child: auth-service handles login
  const authSpan = spanId();
  spans.push(makeSpan(tId, authSpan, rootId, auth, 'POST /login', baseTime + 5000, rand(30000, 80000), [
    { key: 'http.method', type: 'string', value: 'POST' },
    { key: 'http.status_code', type: 'string', value: '200' },
    { key: 'db.type', type: 'string', value: 'postgresql' },
    { key: 'db.statement', type: 'string', value: 'SELECT * FROM users WHERE email = $1' },
  ]));

  // Gateway: GET /api/catalog
  const catRootId = spanId();
  const catStart = baseTime + rand(250000, 400000);
  spans.push(makeSpan(tId, catRootId, null, gw, 'GET /api/catalog', catStart, rand(50000, 150000), [
    { key: 'http.method', type: 'string', value: 'GET' },
    { key: 'http.url',    type: 'string', value: 'http://localhost:3000/api/catalog' },
    { key: 'http.status_code', type: 'string', value: '200' },
  ]));

  // Child: catalog-service
  const catChildId = spanId();
  spans.push(makeSpan(tId, catChildId, catRootId, cat, 'GET /products', catStart + 3000, rand(20000, 80000), [
    { key: 'http.method', type: 'string', value: 'GET' },
    { key: 'http.status_code', type: 'string', value: '200' },
    { key: 'db.type', type: 'string', value: 'postgresql' },
    { key: 'db.statement', type: 'string', value: 'SELECT * FROM products LIMIT 50' },
  ]));

  // Middleware spans on gateway
  for (const mw of ['query', 'expressInit', 'corsMiddleware', 'logger', 'jsonParser']) {
    spans.push(makeSpan(tId, spanId(), rootId, gw, `middleware - ${mw}`, baseTime + rand(1000, 4000), rand(500, 5000), [
      { key: 'express.name', type: 'string', value: mw },
      { key: 'express.type', type: 'string', value: 'middleware' },
    ]));
  }

  return { spans, involvedServices: [gw, auth, cat] };
}

function scenarioPlaceOrder(tId, baseTime) {
  const spans = [];
  const gw = 'api-gateway', order = 'order-service', billing = 'billing-service',
        notify = 'notification-service', analytics = 'analytics-service', cat = 'catalog-service';
  const rootId = spanId();
  const totalDuration = rand(400000, 900000);

  // Root: POST /api/orders on gateway
  spans.push(makeSpan(tId, rootId, null, gw, 'POST /api/orders', baseTime, totalDuration, [
    { key: 'http.method', type: 'string', value: 'POST' },
    { key: 'http.url',    type: 'string', value: 'http://localhost:3000/api/orders' },
    { key: 'http.status_code', type: 'string', value: '201' },
    { key: 'http.route', type: 'string', value: '/api/orders' },
  ]));

  // Gateway → order-service
  const orderSpanId = spanId();
  spans.push(makeSpan(tId, orderSpanId, rootId, gw, 'POST', baseTime + 10000, rand(200000, 500000), [
    { key: 'http.url',    type: 'string', value: 'http://localhost:3004/orders' },
    { key: 'http.method', type: 'string', value: 'POST' },
    { key: 'http.status_code', type: 'string', value: '201' },
    { key: 'net.peer.name', type: 'string', value: 'localhost' },
    { key: 'net.peer.port', type: 'string', value: '3004' },
  ]));

  // tcp.connect under POST
  spans.push(makeSpan(tId, spanId(), orderSpanId, gw, 'tcp.connect', baseTime + 12000, rand(5000, 25000), [
    { key: 'net.transport', type: 'string', value: 'ip_tcp' },
    { key: 'net.peer.name', type: 'string', value: 'localhost' },
    { key: 'net.peer.port', type: 'string', value: '3004' },
  ]));

  // order-service: POST /orders root
  const orderRootId = spanId();
  spans.push(makeSpan(tId, orderRootId, orderSpanId, order, 'POST /orders', baseTime + 30000, rand(150000, 350000), [
    { key: 'http.method', type: 'string', value: 'POST' },
    { key: 'http.status_code', type: 'string', value: '201' },
    { key: 'http.route', type: 'string', value: '/orders' },
  ]));

  // order-service middleware
  for (const mw of ['query', 'expressInit', 'corsMiddleware', 'logger', 'jsonParser']) {
    spans.push(makeSpan(tId, spanId(), orderRootId, order, `middleware - ${mw}`, baseTime + 32000 + rand(0, 5000), rand(500, 3000), [
      { key: 'express.name', type: 'string', value: mw },
      { key: 'express.type', type: 'string', value: 'middleware' },
    ]));
  }

  // order-service: request handler
  spans.push(makeSpan(tId, spanId(), orderRootId, order, 'request handler - /orders', baseTime + 45000, rand(1000, 5000), [
    { key: 'express.name', type: 'string', value: '/orders' },
    { key: 'express.type', type: 'string', value: 'request_handler' },
  ]));

  // order → catalog (price lookup)
  const catSpanId = spanId();
  spans.push(makeSpan(tId, catSpanId, orderRootId, order, 'GET', baseTime + 50000, rand(20000, 60000), [
    { key: 'http.url',    type: 'string', value: 'http://localhost:3002/products/p-001' },
    { key: 'http.method', type: 'string', value: 'GET' },
    { key: 'http.status_code', type: 'string', value: '200' },
  ]));
  spans.push(makeSpan(tId, spanId(), catSpanId, cat, 'GET /products/:id', baseTime + 52000, rand(10000, 40000), [
    { key: 'http.method', type: 'string', value: 'GET' },
    { key: 'http.status_code', type: 'string', value: '200' },
  ]));

  // order → billing (create invoice)
  const billSpanId = spanId();
  spans.push(makeSpan(tId, billSpanId, orderRootId, order, 'POST', baseTime + 120000, rand(30000, 80000), [
    { key: 'http.url',    type: 'string', value: 'http://localhost:3005/invoices' },
    { key: 'http.method', type: 'string', value: 'POST' },
    { key: 'http.status_code', type: 'string', value: '201' },
  ]));
  spans.push(makeSpan(tId, spanId(), billSpanId, billing, 'POST /invoices', baseTime + 122000, rand(20000, 60000), [
    { key: 'http.method', type: 'string', value: 'POST' },
    { key: 'http.status_code', type: 'string', value: '201' },
    { key: 'db.statement', type: 'string', value: 'INSERT INTO invoices ...' },
  ]));

  // order → notification (send order confirmation)
  const notifySpanId = spanId();
  spans.push(makeSpan(tId, notifySpanId, orderRootId, order, 'POST', baseTime + 200000, rand(15000, 40000), [
    { key: 'http.url',    type: 'string', value: 'http://localhost:3007/send' },
    { key: 'http.method', type: 'string', value: 'POST' },
    { key: 'http.status_code', type: 'string', value: '200' },
  ]));
  spans.push(makeSpan(tId, spanId(), notifySpanId, notify, 'POST /send', baseTime + 202000, rand(10000, 30000), [
    { key: 'http.method', type: 'string', value: 'POST' },
    { key: 'notification.type', type: 'string', value: 'ORDER_CONFIRMATION' },
    { key: 'notification.channel', type: 'string', value: pick(['email', 'sms', 'push']) },
  ]));

  // order → analytics (track event)
  const analyticsSpanId = spanId();
  spans.push(makeSpan(tId, analyticsSpanId, orderRootId, order, 'POST', baseTime + 250000, rand(10000, 30000), [
    { key: 'http.url',    type: 'string', value: 'http://localhost:3008/events' },
    { key: 'http.method', type: 'string', value: 'POST' },
    { key: 'http.status_code', type: 'string', value: '200' },
  ]));
  spans.push(makeSpan(tId, spanId(), analyticsSpanId, analytics, 'POST /events', baseTime + 252000, rand(5000, 20000), [
    { key: 'http.method', type: 'string', value: 'POST' },
    { key: 'event.type', type: 'string', value: 'ORDER_PLACED' },
  ]));

  // Gateway middleware
  for (const mw of ['query', 'expressInit', 'corsMiddleware', 'logger', 'jsonParser']) {
    spans.push(makeSpan(tId, spanId(), rootId, gw, `middleware - ${mw}`, baseTime + rand(1000, 4000), rand(500, 5000), [
      { key: 'express.name', type: 'string', value: mw },
      { key: 'express.type', type: 'string', value: 'middleware' },
      { key: 'http.route', type: 'string', value: '/' },
    ]));
  }

  return { spans, involvedServices: [gw, order, cat, billing, notify, analytics] };
}

function scenarioSupportTicket(tId, baseTime) {
  const spans = [];
  const gw = 'api-gateway', support = 'support-service', notify = 'notification-service',
        asset = 'asset-service', analytics = 'analytics-service';
  const rootId = spanId();

  const issues = [
    'VPN intermittent disconnects', 'Unable to login to cloud portal',
    'Slow query performance', 'SSL certificate expired', 'Printer not working',
  ];

  spans.push(makeSpan(tId, rootId, null, gw, 'POST /api/support', baseTime, rand(200000, 500000), [
    { key: 'http.method', type: 'string', value: 'POST' },
    { key: 'http.url',    type: 'string', value: 'http://localhost:3000/api/support' },
    { key: 'http.status_code', type: 'string', value: '201' },
  ]));

  // gateway → support-service
  const supportSpanId = spanId();
  spans.push(makeSpan(tId, supportSpanId, rootId, support, 'POST /tickets', baseTime + 8000, rand(100000, 300000), [
    { key: 'http.method', type: 'string', value: 'POST' },
    { key: 'http.status_code', type: 'string', value: '201' },
    { key: 'ticket.title', type: 'string', value: pick(issues) },
    { key: 'ticket.priority', type: 'string', value: pick(['low','medium','high','critical']) },
  ]));

  // support → asset-service (lookup affected asset)
  const assetSpanId = spanId();
  spans.push(makeSpan(tId, assetSpanId, supportSpanId, support, 'GET', baseTime + 20000, rand(15000, 50000), [
    { key: 'http.url',    type: 'string', value: 'http://localhost:3006/assets/ast-001' },
    { key: 'http.method', type: 'string', value: 'GET' },
  ]));
  spans.push(makeSpan(tId, spanId(), assetSpanId, asset, 'GET /assets/:id', baseTime + 22000, rand(8000, 30000), [
    { key: 'http.method', type: 'string', value: 'GET' },
    { key: 'http.status_code', type: 'string', value: '200' },
  ]));

  // support → notification (alert assigned agent)
  const notifySpanId = spanId();
  spans.push(makeSpan(tId, notifySpanId, supportSpanId, support, 'POST', baseTime + 80000, rand(15000, 40000), [
    { key: 'http.url',    type: 'string', value: 'http://localhost:3007/send' },
    { key: 'http.method', type: 'string', value: 'POST' },
  ]));
  spans.push(makeSpan(tId, spanId(), notifySpanId, notify, 'POST /send', baseTime + 82000, rand(10000, 25000), [
    { key: 'notification.type', type: 'string', value: 'TICKET_CREATED' },
    { key: 'notification.channel', type: 'string', value: 'email' },
  ]));

  // support → analytics
  const analyticsSpanId = spanId();
  spans.push(makeSpan(tId, analyticsSpanId, supportSpanId, support, 'POST', baseTime + 130000, rand(8000, 25000), [
    { key: 'http.url',    type: 'string', value: 'http://localhost:3008/events' },
    { key: 'http.method', type: 'string', value: 'POST' },
  ]));
  spans.push(makeSpan(tId, spanId(), analyticsSpanId, analytics, 'POST /events', baseTime + 132000, rand(5000, 15000), [
    { key: 'event.type', type: 'string', value: 'TICKET_CREATED' },
  ]));

  return { spans, involvedServices: [gw, support, asset, notify, analytics] };
}

function scenarioPayInvoice(tId, baseTime) {
  const spans = [];
  const gw = 'api-gateway', billing = 'billing-service', notify = 'notification-service', analytics = 'analytics-service';
  const rootId = spanId();

  spans.push(makeSpan(tId, rootId, null, gw, 'POST /api/billing/pay', baseTime, rand(150000, 350000), [
    { key: 'http.method', type: 'string', value: 'POST' },
    { key: 'http.url',    type: 'string', value: 'http://localhost:3000/api/billing/pay' },
    { key: 'http.status_code', type: 'string', value: '200' },
  ]));

  const billSpanId = spanId();
  spans.push(makeSpan(tId, billSpanId, rootId, billing, 'POST /pay', baseTime + 5000, rand(80000, 200000), [
    { key: 'http.method', type: 'string', value: 'POST' },
    { key: 'http.status_code', type: 'string', value: '200' },
    { key: 'payment.method', type: 'string', value: pick(['credit_card','wire_transfer','purchase_order']) },
    { key: 'db.statement', type: 'string', value: 'UPDATE invoices SET status=$1 WHERE id=$2' },
  ]));

  // billing → notification
  const notifySpanId = spanId();
  spans.push(makeSpan(tId, notifySpanId, billSpanId, billing, 'POST', baseTime + 100000, rand(15000, 40000), [
    { key: 'http.url', type: 'string', value: 'http://localhost:3007/send' },
    { key: 'http.method', type: 'string', value: 'POST' },
  ]));
  spans.push(makeSpan(tId, spanId(), notifySpanId, notify, 'POST /send', baseTime + 102000, rand(10000, 25000), [
    { key: 'notification.type', type: 'string', value: 'PAYMENT_RECEIVED' },
  ]));

  // billing → analytics
  const analyticsSpanId = spanId();
  spans.push(makeSpan(tId, analyticsSpanId, billSpanId, billing, 'POST', baseTime + 140000, rand(8000, 20000), [
    { key: 'http.url', type: 'string', value: 'http://localhost:3008/events' },
    { key: 'http.method', type: 'string', value: 'POST' },
  ]));
  spans.push(makeSpan(tId, spanId(), analyticsSpanId, analytics, 'POST /events', baseTime + 142000, rand(5000, 15000), [
    { key: 'event.type', type: 'string', value: 'PAYMENT_PROCESSED' },
  ]));

  return { spans, involvedServices: [gw, billing, notify, analytics] };
}

function scenarioAnalyticsDashboard(tId, baseTime) {
  const spans = [];
  const gw = 'api-gateway', analytics = 'analytics-service';
  const rootId = spanId();

  spans.push(makeSpan(tId, rootId, null, gw, 'GET /api/analytics/dashboard', baseTime, rand(60000, 180000), [
    { key: 'http.method', type: 'string', value: 'GET' },
    { key: 'http.url',    type: 'string', value: 'http://localhost:3000/api/analytics/dashboard' },
    { key: 'http.status_code', type: 'string', value: '200' },
  ]));

  const analyticsSpanId = spanId();
  spans.push(makeSpan(tId, analyticsSpanId, rootId, analytics, 'GET /dashboard', baseTime + 3000, rand(40000, 120000), [
    { key: 'http.method', type: 'string', value: 'GET' },
    { key: 'http.status_code', type: 'string', value: '200' },
    { key: 'db.type', type: 'string', value: 'postgresql' },
    { key: 'db.statement', type: 'string', value: 'SELECT * FROM analytics_events ORDER BY created_at DESC LIMIT 100' },
  ]));

  // analytics runs multiple aggregation queries
  for (const query of ['revenue_summary', 'order_stats', 'user_activity']) {
    spans.push(makeSpan(tId, spanId(), analyticsSpanId, analytics, `db.query - ${query}`, baseTime + rand(5000, 30000), rand(5000, 40000), [
      { key: 'db.type', type: 'string', value: 'postgresql' },
      { key: 'db.statement', type: 'string', value: `SELECT * FROM ${query}` },
    ]));
  }

  return { spans, involvedServices: [gw, analytics] };
}

function scenarioManageUsers(tId, baseTime) {
  const spans = [];
  const gw = 'api-gateway', users = 'user-service', auth = 'auth-service';
  const rootId = spanId();

  spans.push(makeSpan(tId, rootId, null, gw, 'GET /api/users', baseTime, rand(40000, 120000), [
    { key: 'http.method', type: 'string', value: 'GET' },
    { key: 'http.url',    type: 'string', value: 'http://localhost:3000/api/users' },
    { key: 'http.status_code', type: 'string', value: '200' },
  ]));

  const userSpanId = spanId();
  spans.push(makeSpan(tId, userSpanId, rootId, users, 'GET /users', baseTime + 3000, rand(20000, 80000), [
    { key: 'http.method', type: 'string', value: 'GET' },
    { key: 'http.status_code', type: 'string', value: '200' },
  ]));

  // user-service → auth-service (validate session)
  const authSpanId = spanId();
  spans.push(makeSpan(tId, authSpanId, userSpanId, users, 'GET', baseTime + 5000, rand(10000, 30000), [
    { key: 'http.url', type: 'string', value: 'http://localhost:3001/validate' },
    { key: 'http.method', type: 'string', value: 'GET' },
  ]));
  spans.push(makeSpan(tId, spanId(), authSpanId, auth, 'GET /validate', baseTime + 6000, rand(5000, 20000), [
    { key: 'http.method', type: 'string', value: 'GET' },
    { key: 'http.status_code', type: 'string', value: '200' },
  ]));

  return { spans, involvedServices: [gw, users, auth] };
}

function scenarioBrowseAssets(tId, baseTime) {
  const spans = [];
  const gw = 'api-gateway', asset = 'asset-service';
  const rootId = spanId();

  spans.push(makeSpan(tId, rootId, null, gw, 'GET /api/assets', baseTime, rand(50000, 150000), [
    { key: 'http.method', type: 'string', value: 'GET' },
    { key: 'http.url',    type: 'string', value: 'http://localhost:3000/api/assets' },
    { key: 'http.status_code', type: 'string', value: '200' },
  ]));

  const assetSpanId = spanId();
  spans.push(makeSpan(tId, assetSpanId, rootId, asset, 'GET /assets', baseTime + 3000, rand(30000, 100000), [
    { key: 'http.method', type: 'string', value: 'GET' },
    { key: 'http.status_code', type: 'string', value: '200' },
    { key: 'db.type', type: 'string', value: 'postgresql' },
    { key: 'db.statement', type: 'string', value: 'SELECT * FROM assets ORDER BY name' },
  ]));

  // detail fetch
  const detailId = spanId();
  const detailStart = baseTime + rand(160000, 250000);
  spans.push(makeSpan(tId, detailId, null, gw, 'GET /api/assets/ast-001', detailStart, rand(30000, 80000), [
    { key: 'http.method', type: 'string', value: 'GET' },
    { key: 'http.status_code', type: 'string', value: '200' },
  ]));
  spans.push(makeSpan(tId, spanId(), detailId, asset, 'GET /assets/:id', detailStart + 2000, rand(15000, 50000), [
    { key: 'http.method', type: 'string', value: 'GET' },
    { key: 'asset.id', type: 'string', value: 'ast-001' },
  ]));

  return { spans, involvedServices: [gw, asset] };
}

function scenarioHealthCheck(tId, baseTime) {
  const spans = [];
  const gw = 'api-gateway';
  const rootId = spanId();

  spans.push(makeSpan(tId, rootId, null, gw, 'GET /health', baseTime, rand(2000, 15000), [
    { key: 'http.method', type: 'string', value: 'GET' },
    { key: 'http.url',    type: 'string', value: 'http://localhost:3000/health' },
    { key: 'http.status_code', type: 'string', value: '200' },
  ]));

  // middleware
  for (const mw of ['query', 'expressInit', 'corsMiddleware']) {
    spans.push(makeSpan(tId, spanId(), rootId, gw, `middleware - ${mw}`, baseTime + rand(500, 2000), rand(200, 2000), [
      { key: 'express.name', type: 'string', value: mw },
      { key: 'express.type', type: 'string', value: 'middleware' },
    ]));
  }

  spans.push(makeSpan(tId, spanId(), rootId, gw, 'request handler - /health', baseTime + rand(3000, 5000), rand(200, 1000), [
    { key: 'express.name', type: 'string', value: '/health' },
    { key: 'express.type', type: 'string', value: 'request_handler' },
  ]));

  return { spans, involvedServices: [gw] };
}

function scenarioNotificationBulk(tId, baseTime) {
  const spans = [];
  const gw = 'api-gateway', notify = 'notification-service', users = 'user-service';
  const rootId = spanId();

  spans.push(makeSpan(tId, rootId, null, gw, 'POST /api/notify/bulk', baseTime, rand(200000, 500000), [
    { key: 'http.method', type: 'string', value: 'POST' },
    { key: 'http.url',    type: 'string', value: 'http://localhost:3000/api/notify/bulk' },
    { key: 'http.status_code', type: 'string', value: '200' },
  ]));

  const notifySpanId = spanId();
  spans.push(makeSpan(tId, notifySpanId, rootId, notify, 'POST /bulk', baseTime + 5000, rand(150000, 400000), [
    { key: 'http.method', type: 'string', value: 'POST' },
    { key: 'notification.type', type: 'string', value: 'ALERT' },
    { key: 'notification.recipients_count', type: 'string', value: '3' },
  ]));

  // notify → user-service (resolve recipient details)
  const userSpanId = spanId();
  spans.push(makeSpan(tId, userSpanId, notifySpanId, notify, 'GET', baseTime + 10000, rand(20000, 50000), [
    { key: 'http.url', type: 'string', value: 'http://localhost:3003/users' },
    { key: 'http.method', type: 'string', value: 'GET' },
  ]));
  spans.push(makeSpan(tId, spanId(), userSpanId, users, 'GET /users', baseTime + 12000, rand(10000, 30000), [
    { key: 'http.method', type: 'string', value: 'GET' },
    { key: 'http.status_code', type: 'string', value: '200' },
  ]));

  // Individual send spans
  for (let i = 0; i < 3; i++) {
    spans.push(makeSpan(tId, spanId(), notifySpanId, notify, `send - ${pick(['email','sms','push'])}`, baseTime + 60000 + (i * 30000), rand(10000, 30000), [
      { key: 'notification.channel', type: 'string', value: pick(['email','sms','push']) },
      { key: 'notification.recipient', type: 'string', value: pick(['u-001','u-002','u-003']) },
    ]));
  }

  return { spans, involvedServices: [gw, notify, users] };
}

function scenarioOrderStatusUpdate(tId, baseTime) {
  const spans = [];
  const gw = 'api-gateway', order = 'order-service', notify = 'notification-service', analytics = 'analytics-service';
  const rootId = spanId();
  const newStatus = pick(['processing','shipped','delivered']);

  spans.push(makeSpan(tId, rootId, null, gw, `PATCH /api/orders/:id/status`, baseTime, rand(150000, 350000), [
    { key: 'http.method', type: 'string', value: 'PATCH' },
    { key: 'http.url',    type: 'string', value: 'http://localhost:3000/api/orders/o-123/status' },
    { key: 'http.status_code', type: 'string', value: '200' },
  ]));

  const orderSpanId = spanId();
  spans.push(makeSpan(tId, orderSpanId, rootId, order, 'PATCH /orders/:id/status', baseTime + 5000, rand(80000, 200000), [
    { key: 'http.method', type: 'string', value: 'PATCH' },
    { key: 'order.new_status', type: 'string', value: newStatus },
    { key: 'db.statement', type: 'string', value: 'UPDATE orders SET status=$1 WHERE id=$2' },
  ]));

  // order → notification
  const notifySpanId = spanId();
  spans.push(makeSpan(tId, notifySpanId, orderSpanId, order, 'POST', baseTime + 100000, rand(15000, 40000), [
    { key: 'http.url', type: 'string', value: 'http://localhost:3007/send' },
    { key: 'http.method', type: 'string', value: 'POST' },
  ]));
  spans.push(makeSpan(tId, spanId(), notifySpanId, notify, 'POST /send', baseTime + 102000, rand(10000, 25000), [
    { key: 'notification.type', type: 'string', value: `ORDER_${newStatus.toUpperCase()}` },
  ]));

  // order → analytics
  const analyticsSpanId = spanId();
  spans.push(makeSpan(tId, analyticsSpanId, orderSpanId, order, 'POST', baseTime + 140000, rand(8000, 20000), [
    { key: 'http.url', type: 'string', value: 'http://localhost:3008/events' },
    { key: 'http.method', type: 'string', value: 'POST' },
  ]));
  spans.push(makeSpan(tId, spanId(), analyticsSpanId, analytics, 'POST /events', baseTime + 142000, rand(5000, 15000), [
    { key: 'event.type', type: 'string', value: `ORDER_STATUS_CHANGED` },
  ]));

  return { spans, involvedServices: [gw, order, notify, analytics] };
}

// ── Scenario registry ────────────────────────────────────────────────────────
const scenarioFns = [
  { fn: scenarioBrowseProducts,      weight: 15, name: 'Browse Products' },
  { fn: scenarioPlaceOrder,          weight: 20, name: 'Place Order' },
  { fn: scenarioSupportTicket,       weight: 12, name: 'Support Ticket' },
  { fn: scenarioPayInvoice,          weight: 10, name: 'Pay Invoice' },
  { fn: scenarioAnalyticsDashboard,  weight: 8,  name: 'Analytics Dashboard' },
  { fn: scenarioManageUsers,         weight: 8,  name: 'Manage Users' },
  { fn: scenarioBrowseAssets,        weight: 8,  name: 'Browse Assets' },
  { fn: scenarioHealthCheck,         weight: 5,  name: 'Health Check' },
  { fn: scenarioNotificationBulk,    weight: 7,  name: 'Bulk Notification' },
  { fn: scenarioOrderStatusUpdate,   weight: 7,  name: 'Order Status Update' },
];

function pickWeightedScenario() {
  const totalWeight = scenarioFns.reduce((s, sc) => s + sc.weight, 0);
  let r = Math.random() * totalWeight;
  for (const sc of scenarioFns) {
    r -= sc.weight;
    if (r <= 0) return sc;
  }
  return scenarioFns[0];
}

// ── Main ─────────────────────────────────────────────────────────────────────
function main() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   NEXUS-IT → WEFT Dummy Trace Generator         ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`  Traces : ${TRACE_COUNT}`);
  console.log(`  Output : ${OUTPUT}\n`);

  const allTraces   = [];
  const scenarioCounts = {};

  // Start time: ~1 hour ago, each trace is a few seconds apart
  let baseTime = (Date.now() - 3600000) * 1000; // microseconds

  for (let i = 0; i < TRACE_COUNT; i++) {
    const tId = traceId();
    const scenario = pickWeightedScenario();

    scenarioCounts[scenario.name] = (scenarioCounts[scenario.name] || 0) + 1;

    const { spans, involvedServices } = scenario.fn(tId, baseTime);

    allTraces.push({
      traceID:   tId,
      spans,
      processes: buildProcesses(involvedServices),
    });

    // Advance time by 2-10 seconds between traces
    baseTime += rand(2000000, 10000000);
  }

  // ── Assemble WEFT-compatible output ──────────────────────────────────────────
  // WEFT expects standard Jaeger format: { "data": [ ...traces... ] }
  const output = {
    data: allTraces,
  };

  const totalSpans = allTraces.reduce((s, t) => s + t.spans.length, 0);
  const allServices = new Set();
  allTraces.forEach(t => {
    Object.values(t.processes).forEach(p => allServices.add(p.serviceName));
  });

  // ── Write file ─────────────────────────────────────────────────────────────
  const outPath = path.resolve(OUTPUT);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  const fileSizeMB = (fs.statSync(outPath).size / 1024 / 1024).toFixed(2);

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   Generation Complete ✓                         ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`  File      : ${outPath}`);
  console.log(`  Size      : ${fileSizeMB} MB`);
  console.log(`  Traces    : ${allTraces.length}`);
  console.log(`  Spans     : ${totalSpans}`);
  console.log(`  Services  : ${allServices.size} (${Array.from(allServices).join(', ')})`);
  console.log('\n  Scenario breakdown:');
  Object.entries(scenarioCounts).sort((a, b) => b[1] - a[1]).forEach(([name, count]) => {
    console.log(`    ${name.padEnd(28)} ${count} traces`);
  });
  console.log(`\n  ✔ Upload ${path.basename(outPath)} to WEFT.\n`);
}

main();
