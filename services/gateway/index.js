require('../../shared/tracer').initTracer('api-gateway');

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const axios = require('axios');

const { chaosMiddleware, injectErrorRule, clearErrorRule, getChaosState } = require('../../shared/chaos');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// Mount Chaos & Manual Error Injection Middleware
app.use(chaosMiddleware('api-gateway'));

// Service URLs
const SERVICES = {
  auth: process.env.AUTH_SERVICE_URL || 'http://localhost:3001',
  user: process.env.USER_SERVICE_URL || 'http://localhost:3002',
  catalog: process.env.CATALOG_SERVICE_URL || 'http://localhost:3003',
  order: process.env.ORDER_SERVICE_URL || 'http://localhost:3004',
  billing: process.env.BILLING_SERVICE_URL || 'http://localhost:3005',
  notification: process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3006',
  analytics: process.env.ANALYTICS_SERVICE_URL || 'http://localhost:3007',
  asset: process.env.ASSET_SERVICE_URL || 'http://localhost:3008',
  support: process.env.SUPPORT_SERVICE_URL || 'http://localhost:3009',
};

// Helper to forward chaos headers to downstream microservices
function forwardChaosHeaders(req) {
  const headers = {};
  if (req.headers['x-inject-error']) headers['x-inject-error'] = req.headers['x-inject-error'];
  if (req.headers['x-fail-service']) headers['x-fail-service'] = req.headers['x-fail-service'];
  return headers;
}

// Health Check
app.get('/health', (req, res) => res.json({ service: 'api-gateway', status: 'UP', timestamp: new Date().toISOString() }));

// Chaos Management Endpoints
app.post('/api/chaos/inject', (req, res) => {
  const { service, statusCode = 500, errorRate = 1.0, message } = req.body;
  if (!service) return res.status(400).json({ error: 'Service name required (e.g. order-service)' });
  const rule = injectErrorRule(service, { statusCode, errorRate, message });
  res.json({ status: 'SUCCESS', rule, currentRules: getChaosState().activeRules });
});

app.delete('/api/chaos/reset', (req, res) => {
  const { service } = req.query;
  clearErrorRule(service);
  res.json({ status: 'SUCCESS', currentRules: getChaosState().activeRules });
});

app.get('/api/chaos/status', (req, res) => {
  res.json(getChaosState());
});

// Forwarding Routes
app.post('/api/auth/login', async (req, res) => {
  try {
    const response = await axios.post(`${SERVICES.auth}/login`, req.body);
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || { error: err.message });
  }
});

app.get('/api/catalog', async (req, res) => {
  try {
    const response = await axios.get(`${SERVICES.catalog}/products`, { params: req.query });
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || { error: err.message });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const response = await axios.post(`${SERVICES.order}/orders`, req.body);
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || { error: err.message });
  }
});

app.get('/api/orders/:id', async (req, res) => {
  try {
    const response = await axios.get(`${SERVICES.order}/orders/${req.params.id}`);
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || { error: err.message });
  }
});

app.get('/api/billing/invoices/:userId', async (req, res) => {
  try {
    const response = await axios.get(`${SERVICES.billing}/invoices/user/${req.params.userId}`);
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || { error: err.message });
  }
});

app.get('/api/assets', async (req, res) => {
  try {
    const response = await axios.get(`${SERVICES.asset}/assets`);
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || { error: err.message });
  }
});

app.post('/api/support/tickets', async (req, res) => {
  try {
    const response = await axios.post(`${SERVICES.support}/tickets`, req.body);
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || { error: err.message });
  }
});

app.get('/api/analytics/dashboard', async (req, res) => {
  try {
    const response = await axios.get(`${SERVICES.analytics}/dashboard`);
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || { error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[api-gateway] Listening on port ${PORT}`);
});
