/**
 * NEXUS-IT Chaos & Manual Error Injection Middleware
 * Allows dynamic injection of manual errors via:
 * 1. HTTP Headers: `x-inject-error` (e.g., "500", "503") or `x-fail-service` (e.g., "order-service")
 * 2. Dynamic Runtime Rules: Configured via API endpoints POST /api/chaos/inject
 *
 * By default, operations run 100% properly without any errors until manually triggered.
 */

const { trace, SpanStatusCode } = require('@opentelemetry/api');

// Global in-memory chaos state across the process/service
const chaosState = {
  activeRules: {}, // e.g. { 'order-service': { errorRate: 1.0, statusCode: 500, message: 'Manual order service failure' } }
};

/**
 * Express middleware to intercept requests and inject manual errors if requested/configured
 */
function chaosMiddleware(serviceName) {
  return (req, res, next) => {
    // 1. Check HTTP header override (per-request manual error)
    const headerErrorCode = req.headers['x-inject-error'];
    const headerTargetService = req.headers['x-fail-service'];

    let shouldError = false;
    let statusCode = 500;
    let errorMessage = `Manual error injected in ${serviceName}`;

    if (headerErrorCode) {
      if (!headerTargetService || headerTargetService === serviceName) {
        shouldError = true;
        statusCode = parseInt(headerErrorCode, 10) || 500;
        errorMessage = `Manual error injected via x-inject-error header into ${serviceName}`;
      }
    }

    // 2. Check dynamic runtime rule for this service
    if (!shouldError && chaosState.activeRules[serviceName]) {
      const rule = chaosState.activeRules[serviceName];
      if (Math.random() < (rule.errorRate ?? 1.0)) {
        shouldError = true;
        statusCode = rule.statusCode || 500;
        errorMessage = rule.message || `Manual runtime error injected into ${serviceName}`;
      }
    }

    if (shouldError) {
      // Record error on active OpenTelemetry span
      const currentSpan = trace.getActiveSpan();
      const err = new Error(errorMessage);

      if (currentSpan) {
        currentSpan.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage });
        currentSpan.recordException(err);
        currentSpan.setAttribute('error', true);
        currentSpan.setAttribute('http.status_code', statusCode);
        currentSpan.setAttribute('chaos.manual_error', true);
      }

      console.error(`\x1b[31m[CHAOS INJECTED] ${serviceName} → HTTP ${statusCode}: ${errorMessage}\x1b[0m`);
      return res.status(statusCode).json({
        error: 'Manual Error Injected',
        service: serviceName,
        statusCode,
        message: errorMessage,
        timestamp: new Date().toISOString(),
      });
    }

    next();
  };
}

function injectErrorRule(serviceName, options = {}) {
  chaosState.activeRules[serviceName] = {
    errorRate: options.errorRate !== undefined ? options.errorRate : 1.0,
    statusCode: options.statusCode || 500,
    message: options.message || `Manual failure injected into ${serviceName}`,
  };
  console.log(`[CHAOS CONFIG] Activated manual error rule for ${serviceName}:`, chaosState.activeRules[serviceName]);
  return chaosState.activeRules[serviceName];
}

function clearErrorRule(serviceName) {
  if (serviceName) {
    delete chaosState.activeRules[serviceName];
    console.log(`[CHAOS CONFIG] Cleared manual error rule for ${serviceName}`);
  } else {
    chaosState.activeRules = {};
    console.log(`[CHAOS CONFIG] Cleared all manual error rules`);
  }
}

function getChaosState() {
  return chaosState;
}

module.exports = {
  chaosMiddleware,
  injectErrorRule,
  clearErrorRule,
  getChaosState,
};
