/**
 * NEXUS-IT Traffic Generator
 * Simulates realistic user traffic across all services so Jaeger has rich trace data.
 * Run: node traffic-generator.js
 */

const axios = require('axios');

const GW = process.env.GATEWAY_URL || 'http://localhost:3000';
const INTERVAL_MS = parseInt(process.env.INTERVAL_MS || '2000');

let tick = 0;
let stats = { success: 0, errors: 0, requests: 0 };

// ─── Helper ────────────────────────────────────────────────────────────────────
async function call(method, path, data, label) {
  stats.requests++;
  try {
    const res = await axios({ method, url: `${GW}${path}`, data, timeout: 8000 });
    stats.success++;
    if (process.env.VERBOSE) console.log(`  ✔ [${label}] ${method.toUpperCase()} ${path} → ${res.status}`);
    return res.data;
  } catch (err) {
    stats.errors++;
    const status = err.response?.status || 'ERR';
    if (process.env.VERBOSE) console.log(`  ✘ [${label}] ${method.toUpperCase()} ${path} → ${status} ${err.message}`);
    return null;
  }
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// ─── Scenario definitions ─────────────────────────────────────────────────────
const scenarios = [

  // 1. User logs in and views catalog
  async function browseProducts() {
    await call('post', '/api/auth/login', { email: 'john.doe@nexus-it.com', password: 'pass1234' }, 'auth');
    await call('get',  '/api/catalog', null, 'catalog');
    const cat = pick(['Data & AI', 'Cybersecurity', 'Cloud & Kubernetes', 'Observability']);
    await call('get',  `/api/catalog?category=${encodeURIComponent(cat)}`, null, 'catalog');
    const productIds = ['p-001','p-002','p-003','p-004','p-005','p-006','p-007','p-008','p-009','p-010','p-011','p-012'];
    await call('get',  `/api/catalog/${pick(productIds)}`, null, 'catalog');
  },

  // 2. Place a new order (hits catalog → order → billing → notification → analytics)
  async function placeOrder() {
    const productId = pick(['p-001','p-002','p-004','p-008','p-011']);
    await call('post', '/api/orders', {
      userId: pick(['u-001','u-002','u-003','u-005']),
      items: [{ productId, qty: rand(1, 3) }],
    }, 'order');
  },

  // 3. Pay an invoice
  async function payInvoice() {
    const invoices = await call('get', '/api/billing/invoices?status=pending', null, 'billing');
    if (invoices?.invoices?.length) {
      const inv = pick(invoices.invoices);
      await call('post', '/api/billing/pay', {
        invoiceId: inv.id, method: pick(['credit_card','wire_transfer','purchase_order']),
      }, 'billing');
    }
  },

  // 4. Create a support ticket
  async function createTicket() {
    const issues = [
      { title: 'VPN intermittent disconnects', category: 'networking', priority: 'high' },
      { title: 'Unable to login to cloud portal', category: 'access', priority: 'medium' },
      { title: 'Slow query performance on DB server', category: 'software', priority: 'high' },
      { title: 'Printer not working on floor 3', category: 'hardware', priority: 'low' },
      { title: 'SSL certificate expired on internal portal', category: 'security', priority: 'critical' },
      { title: 'IBM Watson quota exceeded', category: 'software', priority: 'medium' },
    ];
    const issue = pick(issues);
    await call('post', '/api/support', {
      userId: pick(['u-002','u-003','u-005']),
      ...issue,
      assetId: Math.random() > 0.5 ? pick(['ast-001','ast-002','ast-003','ast-004','ast-006']) : null,
    }, 'support');
  },

  // 5. Resolve a ticket
  async function resolveTicket() {
    const result = await call('get', '/api/support?status=open', null, 'support');
    if (result?.tickets?.length) {
      const t = pick(result.tickets);
      await call('patch', `/api/support/${t.id}`, { status: 'resolved', assignedAgent: pick(['agent-01','agent-02','agent-03']) }, 'support');
    }
  },

  // 6. Analytics dashboard check
  async function checkAnalytics() {
    await call('get', '/api/analytics/dashboard', null, 'analytics');
    await call('get', '/api/analytics/kpi', null, 'analytics');
    await call('get', '/api/analytics/reports/revenue', null, 'analytics');
  },

  // 7. List and fetch assets
  async function browseAssets() {
    await call('get', '/api/assets', null, 'asset');
    await call('get', '/api/assets/summary', null, 'asset');
    const ids = ['ast-001','ast-002','ast-003','ast-004','ast-005','ast-006','ast-007'];
    await call('get', `/api/assets/${pick(ids)}`, null, 'asset');
  },

  // 8. User management
  async function manageUsers() {
    await call('get', '/api/users', null, 'users');
    await call('get', `/api/users/${pick(['u-001','u-002','u-003','u-005'])}`, null, 'users');
  },

  // 9. Notification history
  async function checkNotifications() {
    await call('get', '/api/notify/history', null, 'notify');
    await call('get', '/api/notify/stats', null, 'notify');
  },

  // 10. Send bulk notification (e.g., maintenance alert)
  async function sendBulkAlert() {
    await call('post', '/api/notify/bulk', {
      recipients: ['u-001','u-002','u-003'],
      type: 'ALERT',
      subject: 'Scheduled Maintenance Tonight 22:00–02:00',
      body: 'NEXUS-IT platform will undergo scheduled maintenance. Please save your work.',
    }, 'notify');
  },

  // 11. Auth validation flow
  async function authFlow() {
    await call('get', '/api/auth/sessions', null, 'auth');
    await call('post', '/api/auth/validate', { token: 'invalid-token' }, 'auth');
  },

  // 12. Order status update flow
  async function updateOrderStatus() {
    const result = await call('get', '/api/orders?status=pending', null, 'orders');
    if (result?.orders?.length) {
      const o = pick(result.orders);
      await call('patch', `/api/orders/${o.id}/status`, { status: pick(['processing','shipped','delivered']) }, 'orders');
    }
  },

  // 13. Billing summary
  async function billingSummary() {
    await call('get', '/api/billing/summary', null, 'billing');
    await call('get', '/api/billing/invoices', null, 'billing');
  },

  // 14. Support stats
  async function supportStats() {
    await call('get', '/api/support/stats', null, 'support');
    await call('get', '/api/support', null, 'support');
  },

  // 15. Service discovery
  async function serviceDiscovery() {
    await call('get', '/api/services', null, 'gateway');
    await call('get', '/health', null, 'gateway');
  },
];

// ─── Runner ────────────────────────────────────────────────────────────────────
async function runTick() {
  tick++;
  const scenario = scenarios[tick % scenarios.length];
  const name = scenario.name;

  if (tick % 10 === 0) {
    console.log(`\n[${new Date().toISOString()}] Tick #${tick} | ✔ ${stats.success}  ✘ ${stats.errors}  Σ ${stats.requests}`);
  }

  try {
    await scenario();
  } catch (err) {
    console.error(`[Scenario: ${name}] Unhandled error:`, err.message);
  }
}

// ─── Entry ────────────────────────────────────────────────────────────────────
console.log(`\n╔══════════════════════════════════════════════════╗`);
console.log(`║  NEXUS-IT Traffic Generator                      ║`);
console.log(`║  Gateway : ${GW.padEnd(39)}║`);
console.log(`║  Interval: ${String(INTERVAL_MS + 'ms').padEnd(39)}║`);
console.log(`╚══════════════════════════════════════════════════╝\n`);
console.log('Starting in 3 seconds... (give services time to boot)\n');

setTimeout(() => {
  runTick();
  setInterval(runTick, INTERVAL_MS);
}, 3000);
