/**
 * Shared HTTP client with propagation headers
 * Ensures trace context flows across service boundaries
 */
const axios = require('axios');
const { context, propagation } = require('@opentelemetry/api');

function createServiceClient(baseURL, timeout = 5000) {
  const client = axios.create({ baseURL, timeout });

  // Inject trace context into every outgoing request
  client.interceptors.request.use((config) => {
    const headers = {};
    propagation.inject(context.active(), headers);
    config.headers = { ...config.headers, ...headers };
    return config;
  });

  return client;
}

// Pre-built clients for each service
const SERVICE_URLS = {
  auth:         process.env.AUTH_URL         || 'http://localhost:3001',
  user:         process.env.USER_URL         || 'http://localhost:3002',
  catalog:      process.env.CATALOG_URL      || 'http://localhost:3003',
  order:        process.env.ORDER_URL        || 'http://localhost:3004',
  billing:      process.env.BILLING_URL      || 'http://localhost:3005',
  notification: process.env.NOTIFICATION_URL || 'http://localhost:3006',
  analytics:    process.env.ANALYTICS_URL    || 'http://localhost:3007',
  asset:        process.env.ASSET_URL        || 'http://localhost:3008',
  support:      process.env.SUPPORT_URL      || 'http://localhost:3009',
};

const clients = Object.fromEntries(
  Object.entries(SERVICE_URLS).map(([name, url]) => [name, createServiceClient(url)])
);

module.exports = { clients, createServiceClient, SERVICE_URLS };
