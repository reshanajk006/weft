/**
 * OpenTelemetry tracer factory
 * Call initTracer(serviceName) at the top of each service BEFORE any other imports
 */
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
const { trace, SpanStatusCode } = require('@opentelemetry/api');

const JAEGER_ENDPOINT = process.env.JAEGER_ENDPOINT || 'http://localhost:4318/v1/traces';

function initTracer(serviceName) {
  const exporter = new OTLPTraceExporter({ url: JAEGER_ENDPOINT });

  const sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
      [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
      'deployment.environment': 'staging',
      'team': 'nexus-it-platform',
    }),
    traceExporter: exporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-http': { enabled: true },
        '@opentelemetry/instrumentation-express': { enabled: true },
      }),
    ],
  });

  sdk.start();

  process.on('SIGTERM', () => sdk.shutdown());
  process.on('SIGINT', () => sdk.shutdown());

  console.log(`[${serviceName}] OpenTelemetry tracing initialized → ${JAEGER_ENDPOINT}`);
  return sdk;
}

function getTracer(serviceName) {
  return trace.getTracer(serviceName, '1.0.0');
}

/**
 * Wrap an async function in a manual span
 */
async function withSpan(tracer, spanName, attributes, fn) {
  const span = tracer.startSpan(spanName, { attributes });
  try {
    const result = await fn(span);
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (err) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    span.recordException(err);
    throw err;
  } finally {
    span.end();
  }
}

module.exports = { initTracer, getTracer, withSpan };
