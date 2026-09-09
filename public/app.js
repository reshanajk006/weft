/* ─────────────────────────────────────────────────────────────
   NEXUS-IT Dashboard — Main Application Script
   Talks to API Gateway at :3000
───────────────────────────────────────────────────────────── */

const API = 'http://localhost:3000/api';

// ── State ─────────────────────────────────────────────────────
let currentView = 'dashboard';
let allProducts = [];
let allUsers    = [];
let refreshTimer = null;

// ── Navigation ────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', e => {
    e.preventDefault();
    const view = item.dataset.view;
    switchView(view);
  });
});

function switchView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const el = document.getElementById(`view-${view}`);
  const nav = document.getElementById(`nav-${view}`);
  if (el) el.classList.add('active');
  if (nav) nav.classList.add('active');

  const titles = {
    dashboard: 'Dashboard',      catalog: 'Product Catalog',
    orders: 'Orders',            billing: 'Billing',
    support: 'Support Tickets',  assets: 'IT Assets',
    users: 'Users',              analytics: 'Analytics',
    health: 'Service Health',
  };
  document.getElementById('page-title').textContent  = titles[view] || view;
  document.getElementById('breadcrumb').textContent  = titles[view] || view;
  currentView = view;

  loadView(view);
}

function loadView(view) {
  switch (view) {
    case 'dashboard':  loadDashboard(); break;
    case 'catalog':    loadCatalog();   break;
    case 'orders':     loadOrders();    break;
    case 'billing':    loadBilling();   break;
    case 'support':    loadSupport();   break;
    case 'assets':     loadAssets();    break;
    case 'users':      loadUsers();     break;
    case 'analytics':  loadAnalytics(); break;
    case 'health':     loadHealth();    break;
  }
}

// ── API Helpers ───────────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}
async function apiPost(path, body) { return apiFetch(path, { method: 'POST', body: JSON.stringify(body) }); }
async function apiPatch(path, body) { return apiFetch(path, { method: 'PATCH', body: JSON.stringify(body) }); }

// ── Toast ─────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type]}</span><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

// ── Formatters ────────────────────────────────────────────────
const fmt$  = v => `$${Number(v).toLocaleString()}`;
const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) : '—';

function priorityBadge(p) {
  const map = { critical:'badge-red', high:'badge-amber', medium:'badge-blue', low:'badge-gray' };
  return `<span class="badge ${map[p]||'badge-gray'}">${p}</span>`;
}
function statusBadge(s) {
  const map = {
    active:'badge-green',    available:'badge-green',   healthy:'badge-green',
    pending:'badge-amber',   open:'badge-amber',        processing:'badge-amber',
    paid:'badge-blue',       delivered:'badge-blue',    resolved:'badge-blue',
    shipped:'badge-cyan',    in_progress:'badge-purple',
    inactive:'badge-gray',   decommissioned:'badge-gray', maintenance:'badge-amber',
  };
  return `<span class="badge ${map[s]||'badge-gray'}">${s.replace('_',' ')}</span>`;
}

// ── Refresh Button ─────────────────────────────────────────────
document.getElementById('refresh-btn').addEventListener('click', () => {
  loadView(currentView);
  checkGatewayHealth();
  toast('Data refreshed', 'success');
});

// ── Gateway Health Indicator ────────────────────────────────────
async function checkGatewayHealth() {
  const el = document.getElementById('gateway-status');
  try {
    await fetch(`http://localhost:3000/health`, { signal: AbortSignal.timeout(3000) });
    el.className = 'status-badge online';
    el.innerHTML = '<span class="status-dot"></span> Live';
  } catch {
    el.className = 'status-badge offline';
    el.innerHTML = '<span class="status-dot"></span> Offline';
  }
}

// ══════════════════════════════════════════════════════════════
// ── DASHBOARD ─────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════
async function loadDashboard() {
  const [orders, invoices, tickets, notifyStats, billingSummary] = await Promise.allSettled([
    apiFetch('/orders'),
    apiFetch('/billing/invoices'),
    apiFetch('/support'),
    apiFetch('/notify/stats'),
    apiFetch('/billing/summary'),
  ]);

  // KPIs
  const o = orders.value || {};
  const inv = invoices.value || {};
  const tkt = tickets.value || {};
  const kpis = [
    { label: 'Total Orders',       value: o.total ?? '—',                    icon: '📦', color: 'var(--accent)',  trend: '' },
    { label: 'Total Invoiced',     value: fmt$(inv.totalAmount ?? 0),        icon: '💰', color: 'var(--green)',   trend: '' },
    { label: 'Open Tickets',       value: tkt.tickets?.filter(t=>t.status!=='resolved').length ?? '—', icon: '🎫', color: 'var(--amber)', trend: '' },
    { label: 'Notifications Sent', value: notifyStats.value?.total ?? '—',   icon: '📬', color: 'var(--blue)',   trend: '' },
    { label: 'Revenue',            value: fmt$(billingSummary.value?.totalRevenue ?? 0), icon: '📈', color: 'var(--purple)', trend: '+12.3%' },
    { label: 'Outstanding',        value: fmt$(billingSummary.value?.outstanding ?? 0),  icon: '⏳', color: 'var(--red)',    trend: '' },
  ];

  document.getElementById('kpi-grid').innerHTML = kpis.map(k => `
    <div class="kpi-card" style="--kpi-color:${k.color}">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value">${k.value}</div>
      ${k.trend ? `<div class="kpi-trend up">${k.trend}</div>` : ''}
      <div class="kpi-icon">${k.icon}</div>
    </div>`).join('');

  // Recent orders
  const recentOrders = (o.orders || []).slice(-5).reverse();
  document.getElementById('recent-orders-list').innerHTML = recentOrders.length
    ? recentOrders.map(order => `
      <div class="list-item">
        <div class="list-item-left">
          <div class="list-item-title">${order.id}</div>
          <div class="list-item-sub">${order.items?.length ?? 0} item(s) · ${fmtDate(order.createdAt)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-weight:700;font-size:0.82rem;">${fmt$(order.total)}</span>
          ${statusBadge(order.status)}
        </div>
      </div>`).join('')
    : '<div class="empty-state">No orders yet</div>';

  // Open tickets
  const openTickets = (tkt.tickets || []).filter(t => t.status !== 'resolved').slice(0, 5);
  document.getElementById('open-tickets-list').innerHTML = openTickets.length
    ? openTickets.map(t => `
      <div class="list-item">
        <div class="list-item-left">
          <div class="list-item-title">${t.title}</div>
          <div class="list-item-sub">${t.id} · ${fmtDate(t.createdAt)}</div>
        </div>
        ${priorityBadge(t.priority)}
      </div>`).join('')
    : '<div class="empty-state">No open tickets 🎉</div>';

  // Notify stats
  const ns = notifyStats.value || {};
  document.getElementById('notify-stats-panel').innerHTML = `
    <div class="stats-grid">
      <div class="stat-box"><div class="val">${ns.total ?? 0}</div><div class="lbl">Total Sent</div></div>
      <div class="stat-box"><div class="val" style="color:var(--green)">${ns.delivered ?? 0}</div><div class="lbl">Delivered</div></div>
      <div class="stat-box"><div class="val" style="color:var(--red)">${ns.failed ?? 0}</div><div class="lbl">Failed</div></div>
      <div class="stat-box"><div class="val">${ns.deliveryRate ?? 100}%</div><div class="lbl">Delivery Rate</div></div>
    </div>`;

  // Billing summary
  const bs = billingSummary.value || {};
  document.getElementById('billing-summary-panel').innerHTML = `
    <div class="stats-grid">
      <div class="stat-box"><div class="val" style="color:var(--green)">${fmt$(bs.totalRevenue ?? 0)}</div><div class="lbl">Revenue</div></div>
      <div class="stat-box"><div class="val" style="color:var(--amber)">${fmt$(bs.outstanding ?? 0)}</div><div class="lbl">Outstanding</div></div>
      <div class="stat-box"><div class="val">${bs.invoiceCount ?? 0}</div><div class="lbl">Invoices</div></div>
      <div class="stat-box"><div class="val">${bs.transactionCount ?? 0}</div><div class="lbl">Transactions</div></div>
    </div>`;
}

// ══════════════════════════════════════════════════════════════
// ── CATALOG ───────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════
async function loadCatalog() {
  try {
    const data = await apiFetch('/catalog');
    allProducts = data.products || [];

    // Populate category filter
    const cats = [...new Set(allProducts.map(p => p.category))];
    const catSel = document.getElementById('catalog-category');
    catSel.innerHTML = '<option value="">All Categories</option>' +
      cats.map(c => `<option value="${c}">${c}</option>`).join('');

    renderProducts(allProducts);
  } catch (err) {
    toast('Failed to load catalog: ' + err.message, 'error');
  }
}

function filterCatalog(searchVal) {
  const search = searchVal !== undefined ? searchVal : document.getElementById('catalog-search').value;
  const cat    = document.getElementById('catalog-category').value;
  let filtered = allProducts;
  if (cat)    filtered = filtered.filter(p => p.category === cat);
  if (search) filtered = filtered.filter(p => p.name.toLowerCase().includes(search.toLowerCase()) || p.vendor.toLowerCase().includes(search.toLowerCase()));
  renderProducts(filtered);
}

function renderProducts(products) {
  const grid = document.getElementById('products-grid');
  if (!products.length) { grid.innerHTML = '<div class="empty-state">No products found</div>'; return; }

  const categoryColors = {
    'Data & AI': 'var(--accent)',       'AI & Automation': 'var(--purple)',
    'Cybersecurity': 'var(--red)',       'Cloud & Kubernetes': 'var(--blue)',
    'IT Operations': 'var(--cyan)',      'Observability': 'var(--green)',
    'Messaging': 'var(--amber)',         'Collaboration': 'var(--accent-2)',
    'Service Management': 'var(--blue)', 'Data Transfer': 'var(--cyan)',
    'Supply Chain': 'var(--amber)',      'Asset Management': 'var(--purple)',
  };

  grid.innerHTML = products.map(p => {
    const color = categoryColors[p.category] || 'var(--accent)';
    return `
    <div class="product-card">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:8px;">
        <span class="badge badge-gray">${p.category}</span>
        ${statusBadge(p.status)}
      </div>
      <div class="product-name">${p.name}</div>
      <div class="product-vendor">${p.vendor}</div>
      <div class="product-desc">${p.description}</div>
      <div class="product-footer">
        <div>
          <div class="product-price" style="color:${color}">${fmt$(p.price)}</div>
          <div style="font-size:0.68rem;color:var(--text-3);">${p.unit}</div>
        </div>
        <button class="btn-primary" style="font-size:0.72rem;padding:6px 12px;"
          onclick="quickOrder('${p.id}','${p.name.replace(/'/g,"\\'")}')">Order</button>
      </div>
    </div>`;
  }).join('');
}

function quickOrder(productId, name) {
  document.getElementById('order-product').value = productId;
  openModal('place-order-modal');
}

// ══════════════════════════════════════════════════════════════
// ── ORDERS ────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════
async function loadOrders() {
  const statusFilter = document.getElementById('orders-status-filter').value;
  try {
    const data = await apiFetch(`/orders${statusFilter ? '?status=' + statusFilter : ''}`);
    const orders = data.orders || [];

    document.getElementById('orders-table').innerHTML = `
      <table>
        <thead><tr>
          <th>Order ID</th><th>Items</th><th>Total</th><th>Status</th>
          <th>Created</th><th>Actions</th>
        </tr></thead>
        <tbody>${orders.length ? orders.map(o => `
          <tr>
            <td class="mono">${o.id}</td>
            <td>${o.items?.length ?? 0} item(s)</td>
            <td style="font-weight:700">${fmt$(o.total)}</td>
            <td>${statusBadge(o.status)}</td>
            <td class="text-muted">${fmtDate(o.createdAt)}</td>
            <td>
              ${o.status !== 'delivered' ? `
              <button class="btn-action" onclick="advanceOrder('${o.id}','${o.status}')">Advance</button>` : ''}
            </td>
          </tr>`).join('') : '<tr><td colspan="6" class="empty-state">No orders found</td></tr>'}
        </tbody>
      </table>`;
  } catch (err) {
    toast('Failed to load orders: ' + err.message, 'error');
  }
}

const ORDER_FLOW = { pending: 'processing', processing: 'shipped', shipped: 'delivered' };
async function advanceOrder(id, currentStatus) {
  const next = ORDER_FLOW[currentStatus];
  if (!next) return;
  try {
    await apiPatch(`/orders/${id}/status`, { status: next });
    toast(`Order ${id} → ${next}`, 'success');
    loadOrders();
  } catch (err) {
    toast('Failed: ' + err.message, 'error');
  }
}

async function placeOrder() {
  const userId    = document.getElementById('order-user').value;
  const productId = document.getElementById('order-product').value;
  const qty       = parseInt(document.getElementById('order-qty').value);

  try {
    const data = await apiPost('/orders', { userId, items: [{ productId, qty }] });
    toast(`Order ${data.order.id} placed — ${fmt$(data.order.total)}`, 'success');
    closeModal('place-order-modal');
    if (currentView === 'orders') loadOrders();
    if (currentView === 'dashboard') loadDashboard();
  } catch (err) {
    toast('Order failed: ' + err.message, 'error');
  }
}

// ══════════════════════════════════════════════════════════════
// ── BILLING ───────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════
async function loadBilling() {
  const statusFilter = document.getElementById('billing-status-filter').value;
  try {
    const data = await apiFetch(`/billing/invoices${statusFilter ? '?status=' + statusFilter : ''}`);
    const invoices = data.invoices || [];

    document.getElementById('billing-table').innerHTML = `
      <table>
        <thead><tr>
          <th>Invoice ID</th><th>Order</th><th>Amount</th><th>Status</th>
          <th>Issued</th><th>Due</th><th>Actions</th>
        </tr></thead>
        <tbody>${invoices.length ? invoices.map(inv => `
          <tr>
            <td class="mono">${inv.id}</td>
            <td class="mono">${inv.orderId}</td>
            <td style="font-weight:700">${fmt$(inv.amount)}</td>
            <td>${statusBadge(inv.status)}</td>
            <td class="text-muted">${fmtDate(inv.issuedAt)}</td>
            <td class="text-muted">${fmtDate(inv.dueAt)}</td>
            <td>
              ${inv.status === 'pending' ? `
              <button class="btn-action pay" onclick="payInvoice('${inv.id}')">Pay Now</button>` : ''}
            </td>
          </tr>`).join('') : '<tr><td colspan="7" class="empty-state">No invoices found</td></tr>'}
        </tbody>
      </table>`;
  } catch (err) {
    toast('Failed to load billing: ' + err.message, 'error');
  }
}

async function payInvoice(invoiceId) {
  try {
    const data = await apiPost('/billing/pay', { invoiceId, method: 'credit_card' });
    toast(`Invoice paid — ${data.transaction?.id}`, 'success');
    loadBilling();
  } catch (err) {
    toast('Payment failed: ' + err.message, 'error');
  }
}

// ══════════════════════════════════════════════════════════════
// ── SUPPORT ───────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════
async function loadSupport() {
  const priority = document.getElementById('support-priority-filter').value;
  const status   = document.getElementById('support-status-filter').value;
  let qs = [];
  if (priority) qs.push('priority=' + priority);
  if (status)   qs.push('status=' + status);

  try {
    const data = await apiFetch('/support' + (qs.length ? '?' + qs.join('&') : ''));
    const tickets = data.tickets || [];

    document.getElementById('support-table').innerHTML = `
      <table>
        <thead><tr>
          <th>Ticket ID</th><th>Title</th><th>Category</th><th>Priority</th>
          <th>Status</th><th>Created</th><th>Actions</th>
        </tr></thead>
        <tbody>${tickets.length ? tickets.map(t => `
          <tr>
            <td class="mono">${t.id}</td>
            <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${t.title}">${t.title}</td>
            <td>${t.category}</td>
            <td>${priorityBadge(t.priority)}</td>
            <td>${statusBadge(t.status)}</td>
            <td class="text-muted">${fmtDate(t.createdAt)}</td>
            <td>
              ${t.status !== 'resolved' ? `
              <button class="btn-action resolve" onclick="resolveTicket('${t.id}')">Resolve</button>` : ''}
            </td>
          </tr>`).join('') : '<tr><td colspan="7" class="empty-state">No tickets found</td></tr>'}
        </tbody>
      </table>`;
  } catch (err) {
    toast('Failed to load support: ' + err.message, 'error');
  }
}

async function resolveTicket(id) {
  try {
    await apiPatch(`/support/${id}`, { status: 'resolved', assignedAgent: 'agent-01' });
    toast(`Ticket ${id} resolved`, 'success');
    loadSupport();
  } catch (err) {
    toast('Failed: ' + err.message, 'error');
  }
}

async function createTicket() {
  const body = {
    title:    document.getElementById('ticket-title').value,
    category: document.getElementById('ticket-category').value,
    priority: document.getElementById('ticket-priority').value,
    userId:   document.getElementById('ticket-user').value,
  };
  if (!body.title.trim()) { toast('Title is required', 'error'); return; }

  try {
    const data = await apiPost('/support', body);
    toast(`Ticket ${data.ticket.id} created`, 'success');
    closeModal('create-ticket-modal');
    if (currentView === 'support') loadSupport();
  } catch (err) {
    toast('Failed: ' + err.message, 'error');
  }
}

// ══════════════════════════════════════════════════════════════
// ── ASSETS ────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════
async function loadAssets() {
  const typeFilter   = document.getElementById('asset-type-filter').value;
  const statusFilter = document.getElementById('asset-status-filter').value;
  let qs = [];
  if (typeFilter)   qs.push('type=' + typeFilter);
  if (statusFilter) qs.push('status=' + statusFilter);

  try {
    const [assetsData, summaryData] = await Promise.all([
      apiFetch('/assets' + (qs.length ? '?' + qs.join('&') : '')),
      apiFetch('/assets/summary'),
    ]);

    const summary = summaryData || {};
    document.getElementById('asset-summary').innerHTML = [
      { label: 'Total Assets',     value: summary.total || 0,          color: 'var(--accent)' },
      { label: 'Total Value',      value: fmt$(summary.totalValue||0), color: 'var(--green)' },
      { label: 'Expiring Soon',    value: summary.expiringSoonCount||0,color: 'var(--amber)' },
      { label: 'Under Maintenance',value: summary.byStatus?.maintenance||0, color: 'var(--red)' },
    ].map(k => `
      <div class="kpi-card" style="--kpi-color:${k.color}">
        <div class="kpi-label">${k.label}</div>
        <div class="kpi-value">${k.value}</div>
      </div>`).join('');

    const assets = assetsData.assets || [];
    document.getElementById('assets-table').innerHTML = `
      <table>
        <thead><tr>
          <th>ID</th><th>Name</th><th>Type</th><th>Serial</th>
          <th>Location</th><th>Status</th><th>Cost</th><th>Warranty</th>
        </tr></thead>
        <tbody>${assets.length ? assets.map(a => `
          <tr>
            <td class="mono">${a.id}</td>
            <td style="font-weight:500">${a.name}</td>
            <td>${a.type}</td>
            <td class="mono text-muted">${a.serial}</td>
            <td class="text-muted">${a.location}</td>
            <td>${statusBadge(a.status)}</td>
            <td>${fmt$(a.cost)}</td>
            <td class="text-muted">${fmtDate(a.warrantyExpiry)}</td>
          </tr>`).join('') : '<tr><td colspan="8" class="empty-state">No assets found</td></tr>'}
        </tbody>
      </table>`;
  } catch (err) {
    toast('Failed to load assets: ' + err.message, 'error');
  }
}

async function addAsset() {
  const body = {
    name: document.getElementById('new-asset-name').value,
    type: document.getElementById('new-asset-type').value,
    serial: document.getElementById('new-asset-serial').value,
    location: document.getElementById('new-asset-location').value,
    cost: parseInt(document.getElementById('new-asset-cost').value) || 0,
    purchaseDate: new Date().toISOString().split('T')[0],
    warrantyExpiry: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  };
  if (!body.name) { toast('Name is required', 'error'); return; }
  try {
    const data = await apiPost('/assets', body);
    toast(`Asset ${data.asset.id} registered`, 'success');
    closeModal('add-asset-modal');
    loadAssets();
  } catch (err) {
    toast('Failed: ' + err.message, 'error');
  }
}

// ══════════════════════════════════════════════════════════════
// ── USERS ─────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════
async function loadUsers() {
  try {
    const data = await apiFetch('/users');
    allUsers = data.users || [];
    renderUsers(allUsers);
  } catch (err) {
    toast('Failed to load users: ' + err.message, 'error');
  }
}

function filterUsers(search) {
  const filtered = allUsers.filter(u =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    u.department?.toLowerCase().includes(search.toLowerCase())
  );
  renderUsers(filtered);
}

function renderUsers(users) {
  const grid = document.getElementById('users-grid');
  if (!users.length) { grid.innerHTML = '<div class="empty-state">No users found</div>'; return; }

  const roleColors = { admin: 'var(--purple)', manager: 'var(--blue)', user: 'var(--text-3)' };
  grid.innerHTML = users.map(u => {
    const initials = u.name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
    return `
    <div class="user-card">
      <div class="user-card-header">
        <div class="user-avatar-lg">${initials}</div>
        <div class="user-info">
          <div class="name">${u.name}</div>
          <div class="email">${u.email}</div>
        </div>
      </div>
      <div class="user-meta">
        <div class="user-meta-row">
          <span>Role</span>
          <span class="badge badge-purple" style="color:${roleColors[u.role]}">${u.role}</span>
        </div>
        <div class="user-meta-row">
          <span>Department</span>
          <span style="font-size:0.78rem">${u.department || '—'}</span>
        </div>
        <div class="user-meta-row">
          <span>Status</span>
          ${statusBadge(u.status)}
        </div>
        <div class="user-meta-row">
          <span>Last Login</span>
          <span style="font-size:0.72rem;color:var(--text-3)">${u.lastLogin ? fmtDate(u.lastLogin) : 'Never'}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

async function addUser() {
  const body = {
    name:       document.getElementById('new-user-name').value,
    email:      document.getElementById('new-user-email').value,
    role:       document.getElementById('new-user-role').value,
    department: document.getElementById('new-user-dept').value,
    password:   'changeme123',
  };
  if (!body.name || !body.email) { toast('Name and email required', 'error'); return; }
  try {
    const data = await apiPost('/users', body);
    toast(`User ${data.user.name} created`, 'success');
    closeModal('add-user-modal');
    loadUsers();
  } catch (err) {
    toast('Failed: ' + err.message, 'error');
  }
}

// ══════════════════════════════════════════════════════════════
// ── ANALYTICS ─────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════
async function loadAnalytics() {
  try {
    const [kpiData, dashData, revenueData] = await Promise.all([
      apiFetch('/analytics/kpi'),
      apiFetch('/analytics/dashboard'),
      apiFetch('/analytics/reports/revenue'),
    ]);

    // KPI cards
    const kpis = kpiData.kpis || [];
    const statusColor = { good: 'var(--green)', warn: 'var(--amber)', bad: 'var(--red)' };
    document.getElementById('analytics-kpi-grid').innerHTML = kpis.map(k => `
      <div class="kpi-card" style="--kpi-color:${statusColor[k.status]||'var(--accent)'}">
        <div class="kpi-label">${k.name}</div>
        <div class="kpi-value">${k.value}${k.unit}</div>
        <div class="kpi-trend ${k.trend.startsWith('+') ? 'up' : 'down'}">${k.trend}</div>
      </div>`).join('');

    // Revenue bar chart
    const months = revenueData.monthly || [];
    const maxRev = Math.max(...months.map(m => m.revenue));
    document.getElementById('revenue-chart').innerHTML = `
      <div class="bar-chart">
        ${months.map(m => `
        <div class="bar-wrap">
          <div class="bar-val">${Math.round(m.revenue/1000)}k</div>
          <div class="bar" style="height:${Math.round((m.revenue/maxRev)*100)}%"></div>
          <div class="bar-label">${m.month}</div>
        </div>`).join('')}
      </div>
      <div style="text-align:center;font-size:0.75rem;color:var(--text-3);margin-top:8px;">
        Total Revenue: ${fmt$(revenueData.totalRevenue)}
      </div>`;

    // Event breakdown
    const breakdown = dashData.eventBreakdown || {};
    const maxCount  = Math.max(...Object.values(breakdown), 1);
    document.getElementById('event-breakdown').innerHTML = `
      <div class="event-list">
        ${Object.entries(breakdown).sort((a,b)=>b[1]-a[1]).map(([name, count]) => `
        <div class="event-row">
          <span class="ename">${name}</span>
          <div class="ebar-bg"><div class="ebar-fill" style="width:${(count/maxCount*100).toFixed(1)}%"></div></div>
          <span class="ecount">${count}</span>
        </div>`).join('') || '<div class="empty-state">No events yet</div>'}
      </div>`;
  } catch (err) {
    toast('Failed to load analytics: ' + err.message, 'error');
  }
}

// ══════════════════════════════════════════════════════════════
// ── SERVICE HEALTH ────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════
const SERVICES = [
  { name: 'API Gateway',           port: 3000, key: 'api-gateway' },
  { name: 'Auth Service',          port: 3001, key: 'auth-service' },
  { name: 'User Service',          port: 3002, key: 'user-service' },
  { name: 'Product Catalog',       port: 3003, key: 'catalog-service' },
  { name: 'Order Service',         port: 3004, key: 'order-service' },
  { name: 'Billing Service',       port: 3005, key: 'billing-service' },
  { name: 'Notification Service',  port: 3006, key: 'notification-service' },
  { name: 'Analytics Service',     port: 3007, key: 'analytics-service' },
  { name: 'Asset Management',      port: 3008, key: 'asset-service' },
  { name: 'Support Service',       port: 3009, key: 'support-service' },
];

async function loadHealth() {
  const grid = document.getElementById('health-grid');
  grid.innerHTML = SERVICES.map(s => `
    <div class="health-card" id="hc-${s.key}">
      <div class="health-card-header">
        <div class="health-svc-name">${s.name}</div>
        <span class="badge badge-gray" id="hbadge-${s.key}">Checking…</span>
      </div>
      <div class="health-detail" id="hdetail-${s.key}">
        <div class="health-row"><span class="label">Port</span><span class="val">${s.port}</span></div>
      </div>
      <div class="health-url">http://localhost:${s.port}/health</div>
    </div>`).join('');

  // Probe each service
  SERVICES.forEach(async s => {
    const badge  = document.getElementById(`hbadge-${s.key}`);
    const detail = document.getElementById(`hdetail-${s.key}`);
    const start  = Date.now();
    try {
      const res  = await fetch(`http://localhost:${s.port}/health`, { signal: AbortSignal.timeout(4000) });
      const data = await res.json();
      const lat  = Date.now() - start;

      badge.className = 'badge badge-green';
      badge.textContent = 'Healthy';

      const extra = Object.entries(data)
        .filter(([k]) => !['service','status','timestamp'].includes(k))
        .map(([k,v]) => `<div class="health-row"><span class="label">${k}</span><span class="val">${v}</span></div>`)
        .join('');

      detail.innerHTML = `
        <div class="health-row"><span class="label">Latency</span><span class="val">${lat}ms</span></div>
        <div class="health-row"><span class="label">Status</span><span class="val" style="color:var(--green)">OK</span></div>
        ${extra}
        <div class="health-row"><span class="label">Checked</span><span class="val">${new Date().toLocaleTimeString()}</span></div>`;
    } catch (err) {
      const lat = Date.now() - start;
      badge.className = 'badge badge-red';
      badge.textContent = 'Offline';
      detail.innerHTML = `
        <div class="health-row"><span class="label">Latency</span><span class="val">${lat}ms</span></div>
        <div class="health-row"><span class="label">Error</span><span class="val" style="color:var(--red)">Unreachable</span></div>`;
    }
  });
}

// ── Modals ────────────────────────────────────────────────────
function openModal(id) {
  document.getElementById(id).classList.add('open');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.remove('open');
  });
});

// ── Init ──────────────────────────────────────────────────────
(function init() {
  loadDashboard();
  checkGatewayHealth();
  // Auto-refresh every 30s
  setInterval(() => {
    loadView(currentView);
    checkGatewayHealth();
  }, 30000);
})();
