# NEXUS-IT Enterprise Dummy Platform - Implementation & Architecture

This document provides a complete technical specification of the NEXUS-IT Enterprise Dummy Platform, its microservices topology, OpenTelemetry tracing instrumentation, synthetic trace generation engine, and manual error throwing/chaos injection subsystem.

---

## 1. System Overview

The **NEXUS-IT Dummy Platform** is an IBM-style simulated enterprise environment consisting of **10 Node.js microservices**, an **API Gateway**, a **BFF Frontend Dashboard**, and an **Embedded Jaeger / OpenTelemetry Collector**.

Its primary role is serving as the telemetry data producer and testbed for **WEFT** (Deterministic Resilience & Cascade Failure Analysis Platform).

> [!NOTE]
> **Default Health Guarantee**: By default, all 10 microservices and traffic generation scenarios run **100% cleanly and properly** (producing HTTP 200 OK responses and healthy OpenTelemetry trace spans) **until a manual error is explicitly injected or thrown**.

---

## 2. Implementation Status

| Component / Subsystem | Status | Description |
| --- | --- | --- |
| **Microservices Architecture** | Implemented | 10 independent Express.js services with inter-service REST clients |
| **API Gateway** | Implemented | Central routing on port 3000 forwarding calls to downstream services |
| **OpenTelemetry Instrumentation** | Implemented | Auto & manual instrumentation via OTLP HTTP (`shared/tracer.js`) |
| **Trace Propagation** | Implemented | Context propagation (`traceparent`) via `shared/httpClient.js` |
| **Manual Error Injection Engine** | Implemented | Dynamic Chaos middleware (`shared/chaos.js`) supporting per-request & dynamic rules |
| **Chaos Control API** | Implemented | Gateway REST endpoints (`/api/chaos/inject`, `/api/chaos/reset`) |
| **Synthetic Trace Generator** | Implemented | Standalone generator (`generate-weft-traces.js`) with CLI fault flags |
| **Traffic Generator** | Implemented | Multi-scenario continuous load simulator (`traffic-generator.js`) |
| **Embedded Jaeger Exporter** | Implemented | In-memory Jaeger collector & file exporter (`embedded-jaeger.js`) |

---

## 3. Microservice Topology & Port Mapping

```
                               ┌─────────────────┐
                               │   API Gateway   │ :3000
                               └────────┬────────┘
             ┌──────────────────────────┼──────────────────────────┐
      ┌──────▼──────┐            ┌──────▼──────┐            ┌──────▼──────┐
      │Auth Service │            │User Service │            │  Catalog    │
      │   :3001     │            │   :3002     │            │   :3003     │
      └─────────────┘            └──────┬──────┘            └──────┬──────┘
                                        │                          │
      ┌──────────────┐           ┌──────▼──────┐            ┌──────▼──────┐
      │Order Service │           │   Support   │            │  Analytics  │
      │   :3004      │           │   :3009     │            │   :3007     │
      └──┬──┬──┬─────┘           └──────┬──────┘            └─────────────┘
         │  │  │                        │                          ▲
      ┌──▼─┐│  └──►┌──────────┐         │       ┌────────────┐     │
      │Bill││      │Notification◄───────┴───────┤Asset :3008 ├─────┘
      │3005││      │  :3006   │                 └────────────┘
      └──┬─┘│      └──────────┘
         └──►Analytics :3007
```

### Services Specification

| Service Name | Port | Base URL | Primary Role & Dependencies |
| --- | --- | --- | --- |
| **API Gateway** | `3000` | `http://localhost:3000` | Entry point & proxy for all enterprise APIs |
| **Auth Service** | `3001` | `http://localhost:3001` | Authentication & JWT token issuance → calls `user-service` |
| **User Service** | `3002` | `http://localhost:3002` | User profiles & account management |
| **Product Catalog** | `3003` | `http://localhost:3003` | IT product & software catalog |
| **Order Service** | `3004` | `http://localhost:3004` | Purchase orders → calls `catalog`, `billing`, `notification`, `analytics` |
| **Billing Service** | `3005` | `http://localhost:3005` | Invoicing & payment processing → calls `notification` |
| **Notification Service** | `3006` | `http://localhost:3006` | Email / SMS alert dispatch |
| **Analytics Service** | `3007` | `http://localhost:3007` | KPI event logging & revenue reporting |
| **Asset Management** | `3008` | `http://localhost:3008` | Hardware/software asset tracking → calls `support`, `notification`, `analytics` |
| **Support Service** | `3009` | `http://localhost:3009` | IT helpdesk tickets → calls `user`, `asset`, `notification`, `analytics` |

---

## 4. Manual Error Throwing & Chaos Injection Subsystem

To test WEFT's cascade failure analysis, blast radius calculation, and circuit breaker simulation, manual errors can be thrown/injected into any microservice without modifying source code.

```
Incoming Request
      │
      ▼
┌────────────────────────────────────────────────────────┐
│ Express Chaos Middleware (shared/chaos.js)             │
│                                                        │
│  1. Check HTTP Header (x-inject-error / x-fail-service)│
│  2. Check Dynamic Chaos State (activeRules)            │
└──────────────────────────┬─────────────────────────────┘
                           │
             ┌─────────────┴─────────────┐
             ▼                           ▼
      [ Match Error Rule ]       [ Clean Operation ]
             │                           │
             ├─ Set Span Status = ERROR  ├─ Execute Handler
             ├─ Record Exception Span    └─ Return HTTP 200
             ├─ Set HTTP Status = 500
             └─ Return Error Response
```

### Method 1: Throw Manual Errors via HTTP Headers (Per-Request)

You can throw a manual error on any specific HTTP request by passing custom HTTP headers. The gateway and microservice clients automatically propagate these headers downstream.

- `x-inject-error`: Specifies the HTTP error code to throw (e.g. `500`, `503`, `504`).
- `x-fail-service`: (Optional) Specifies which exact downstream service should throw the error (e.g., `order-service`, `billing-service`).

#### Examples:

```bash
# Force HTTP 500 error on API Gateway
curl -i -H "x-inject-error: 500" http://localhost:3000/api/orders

# Force HTTP 503 error specifically on billing-service during order creation
curl -i -H "x-inject-error: 503" -H "x-fail-service: billing-service" \
  -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -d '{"userId":"u-001","items":[{"productId":"p-001","qty":1}]}'
```

---

### Method 2: Dynamic Runtime Chaos REST API (Gateway Control)

You can dynamically configure microservices to throw manual errors at runtime via REST API endpoints on the API Gateway (`:3000`).

#### 1. Inject Manual Error Rule (`POST /api/chaos/inject`)

```bash
curl -X POST http://localhost:3000/api/chaos/inject \
  -H "Content-Type: application/json" \
  -d '{
    "service": "billing-service",
    "statusCode": 500,
    "errorRate": 1.0,
    "message": "Manual Database Connection Pool Exhausted"
  }'
```

*Response:*
```json
{
  "status": "SUCCESS",
  "rule": {
    "errorRate": 1,
    "statusCode": 500,
    "message": "Manual Database Connection Pool Exhausted"
  },
  "currentRules": {
    "billing-service": {
      "errorRate": 1,
      "statusCode": 500,
      "message": "Manual Database Connection Pool Exhausted"
    }
  }
}
```

#### 2. Reset / Clear Manual Errors (`DELETE /api/chaos/reset`)

```bash
# Clear manual error rule for billing-service
curl -X DELETE "http://localhost:3000/api/chaos/reset?service=billing-service"

# Reset all manual error rules across all services
curl -X DELETE "http://localhost:3000/api/chaos/reset"
```

#### 3. View Current Chaos Status (`GET /api/chaos/status`)

```bash
curl http://localhost:3000/api/chaos/status
```

---

### Method 3: Synthetic Trace Generator CLI Flags

If you are generating offline Jaeger JSON trace files directly via `generate-weft-traces.js` (without running live microservices), you can throw manual errors using CLI flags.

```bash
# Generate 50 traces with 100% manual error rate injected into billing-service
node generate-weft-traces.js --traces 50 --fail-service billing-service --error-rate 1.0 --output traces-billing-failure.json

# Use NPM convenience script
npm run generate-errors
```

When `--fail-service` is set, matching spans in the trace output will include:
- `error: true` boolean tag
- `http.status_code: 500` (or customized via `--error-code`)
- `chaos.manual_error: true` tag

---

## 5. Telemetry & OpenTelemetry Pipeline

1. **Tracer Factory (`shared/tracer.js`)**:
   Initializes `@opentelemetry/sdk-node` with OTLP HTTP trace exporter sending spans to `http://localhost:4318/v1/traces`.
2. **Context Propagation (`shared/httpClient.js`)**:
   Uses `@opentelemetry/api` `propagation.inject()` to pass W3C `traceparent` headers across HTTP calls between microservices.
3. **Jaeger Ingestion / Embedded Exporter (`embedded-jaeger.js`)**:
   Receives standard OpenTelemetry spans, stores them in memory, and exports clean Jaeger JSON formatted trace files (`weft-traces-export.json`) compatible with WEFT.

---

## 6. Directory Layout

```
dummy/
├── IMPLEMENTATION.md         # This technical specification
├── README.md                 # Quickstart guide
├── package.json              # Service dependencies & scripts
├── generate-weft-traces.js   # Synthetic trace generator with chaos flags
├── traffic-generator.js      # Continuous load generator
├── embedded-jaeger.js        # Embedded Jaeger OTLP trace collector
├── export-traces.js          # Jaeger API trace exporter script
├── frontend-server.js        # BFF server for dashboard UI
├── shared/
│   ├── tracer.js             # OpenTelemetry SDK tracer initialization
│   ├── httpClient.js         # Axios client with traceparent propagation
│   └── chaos.js              # Express manual error & chaos middleware
└── services/                 # 10 Microservices
    ├── gateway/              # API Gateway (:3000) + Chaos API
    ├── auth/                 # Auth Service (:3001)
    ├── user/                 # User Service (:3002)
    ├── catalog/              # Catalog Service (:3003)
    ├── order/                # Order Service (:3004)
    ├── billing/              # Billing Service (:3005)
    ├── notification/         # Notification Service (:3006)
    ├── analytics/            # Analytics Service (:3007)
    ├── asset/                # Asset Service (:3008)
    └── support/              # Support Service (:3009)
```

---

## 7. Runbook & Commands

### Running Baseline (Clean / Healthy)

```bash
# 1. Start all microservices + embedded Jaeger + Gateway + Dashboard
npm start

# 2. Run healthy background traffic generator (in another terminal)
npm run traffic

# 3. Generate 50 clean synthetic trace file directly
npm run generate-traces
```

### Running with Manual Error Throwing

```bash
# 1. Inject manual error into order-service via REST API
curl -X POST http://localhost:3000/api/chaos/inject \
  -H "Content-Type: application/json" \
  -d '{"service":"order-service","statusCode":500}'

# 2. Generate trace file with explicit manual error on billing-service
npm run generate-errors

# 3. Clear all manual errors and restore healthy baseline
curl -X DELETE http://localhost:3000/api/chaos/reset
```
