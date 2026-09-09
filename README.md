# NEXUS-IT Enterprise Dummy Platform

A realistic IBM-style IT enterprise platform with **10 microservices** instrumented with **OpenTelemetry → Jaeger** tracing, built to test the **WEFT** resilience analysis platform.

---

## Architecture

```
                    ┌─────────────────┐
                    │   API Gateway   │ :3000
                    └────────┬────────┘
            ┌────────────────┼────────────────┐
     ┌──────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐
     │Auth Service │  │User Service │  │  Catalog    │
     │   :3001     │  │   :3002     │  │   :3003     │
     └─────────────┘  └──────┬──────┘  └──────┬──────┘
                             │                 │
     ┌──────────────┐  ┌─────▼──────┐  ┌──────▼──────┐
     │Order Service │  │  Support   │  │  Analytics  │
     │   :3004      │  │   :3009     │  │   :3007     │
     └──┬──┬──┬─────┘  └──────┬──────┘  └─────────────┘
        │  │  │               │
     ┌──▼─┐│  └──►┌──────────┐│  ┌────────────┐
     │Bill││      │Notification◄──│Asset :3008│
     │3005││      │  :3006    │   └────────────┘
     └──┬─┘│      └──────────┘
        └──►Analytics :3007
```

## Services & Ports

| Service | Port | Description |
|---|---|---|
| **API Gateway** | 3000 | Routes all traffic, proxies to services |
| **Auth Service** | 3001 | Login, JWT tokens, session management |
| **User Service** | 3002 | User CRUD, activity log |
| **Product Catalog** | 3003 | IT product & software catalog (IBM, Red Hat, Cisco) |
| **Order Service** | 3004 | Purchase order management |
| **Billing Service** | 3005 | Invoicing and payment processing |
| **Notification Service** | 3006 | Email/SMS delivery |
| **Analytics Service** | 3007 | Event ingestion, KPIs, revenue reports |
| **Asset Management** | 3008 | IT hardware/software asset tracking |
| **Support Service** | 3009 | Helpdesk ticket management with SLA |
| **Frontend Server** | 4000 | Dashboard UI |

## Dependency Graph (for WEFT)

```
order-service   → catalog-service    (validate products)
order-service   → billing-service    (create invoice)
order-service   → notification-service (confirm order)
order-service   → analytics-service  (record event)
billing-service → notification-service (invoice created, payment)
user-service    → notification-service (welcome email)
user-service    → support-service    (fetch user tickets)
auth-service    → user-service       (record login)
catalog-service → analytics-service  (product views)
asset-service   → support-service    (asset tickets)
asset-service   → notification-service (maintenance alerts)
asset-service   → analytics-service  (asset events)
support-service → user-service       (enrich ticket)
support-service → asset-service      (enrich ticket)
support-service → notification-service (ticket created/resolved)
support-service → analytics-service  (ticket events)
```

## Quick Start

### Prerequisites
- Node.js 18+
- Jaeger running locally on port 4318 (OTLP HTTP)

### Start Jaeger (Docker)
```bash
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest
```

### Install & Run
```bash
cd dummy/
npm install

# Start all 10 services + frontend
npm start

# Open dashboard
open http://localhost:4000

# View traces in Jaeger
open http://localhost:16686
```

### Generate Traffic (for WEFT analysis)
```bash
# In a separate terminal
npm run traffic

# Verbose mode
VERBOSE=1 npm run traffic

# Faster traffic (every 500ms)
INTERVAL_MS=500 npm run traffic
```

## API Reference

All routes go through the gateway at `http://localhost:3000`.

### Auth
| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/login` | Login with email/password |
| POST | `/api/auth/logout` | Logout |
| POST | `/api/auth/validate` | Validate token |
| POST | `/api/auth/refresh` | Refresh token |
| GET  | `/api/auth/sessions` | List active sessions |

### Users
| Method | Path | Description |
|---|---|---|
| GET    | `/api/users` | List users |
| GET    | `/api/users/:id` | Get user + recent tickets |
| POST   | `/api/users` | Create user |
| PUT    | `/api/users/:id` | Update user |
| DELETE | `/api/users/:id` | Delete user |
| POST   | `/api/users/events` | Record user activity event |

### Product Catalog
| Method | Path | Description |
|---|---|---|
| GET  | `/api/catalog` | List products (`?category=`, `?vendor=`, `?search=`) |
| GET  | `/api/catalog/categories` | List all categories |
| GET  | `/api/catalog/:id` | Get product detail |
| POST | `/api/catalog` | Add product |
| PUT  | `/api/catalog/:id` | Update product |

### Orders
| Method | Path | Description |
|---|---|---|
| GET   | `/api/orders` | List orders (`?userId=`, `?status=`) |
| GET   | `/api/orders/:id` | Get order |
| POST  | `/api/orders` | Place order (calls catalog, billing, notification, analytics) |
| PATCH | `/api/orders/:id/status` | Update order status |

### Billing
| Method | Path | Description |
|---|---|---|
| GET  | `/api/billing/invoices` | List invoices |
| GET  | `/api/billing/invoices/:id` | Get invoice + transactions |
| POST | `/api/billing/invoices` | Create invoice |
| POST | `/api/billing/pay` | Process payment |
| GET  | `/api/billing/summary` | Revenue summary |

### Notifications
| Method | Path | Description |
|---|---|---|
| POST | `/api/notify/send` | Send notification |
| POST | `/api/notify/bulk` | Bulk send |
| GET  | `/api/notify/history` | Notification history |
| GET  | `/api/notify/stats` | Delivery stats |

### Analytics
| Method | Path | Description |
|---|---|---|
| POST | `/api/analytics/event` | Ingest event |
| GET  | `/api/analytics/events` | List events |
| GET  | `/api/analytics/dashboard` | Dashboard summary |
| GET  | `/api/analytics/reports/revenue` | Revenue report |
| GET  | `/api/analytics/kpi` | KPI metrics |

### Assets
| Method | Path | Description |
|---|---|---|
| GET    | `/api/assets` | List assets (`?type=`, `?status=`) |
| GET    | `/api/assets/summary` | Asset inventory summary |
| GET    | `/api/assets/:id` | Get asset + open tickets |
| POST   | `/api/assets` | Register asset |
| PATCH  | `/api/assets/:id` | Update asset |
| DELETE | `/api/assets/:id` | Decommission asset |

### Support
| Method | Path | Description |
|---|---|---|
| GET    | `/api/support` | List tickets (`?userId=`, `?status=`, `?priority=`) |
| GET    | `/api/support/stats` | Ticket statistics |
| GET    | `/api/support/:id` | Get ticket + user + asset + SLA |
| POST   | `/api/support` | Create ticket |
| PATCH  | `/api/support/:id` | Update ticket |
| POST   | `/api/support/:id/notes` | Add note to ticket |

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `JAEGER_ENDPOINT` | `http://localhost:4318/v1/traces` | OTLP exporter URL |
| `GATEWAY_URL` | `http://localhost:3000` | Gateway URL (traffic generator) |
| `INTERVAL_MS` | `2000` | Traffic generation interval |
| `VERBOSE` | - | Set any value for verbose traffic logs |
| `FRONTEND_PORT` | `4000` | Frontend server port |

## Service Credentials (for testing)

| Email | Password | Role |
|---|---|---|
| admin@nexus-it.com | admin123 | Admin |
| john.doe@nexus-it.com | pass1234 | User |
| jane.smith@nexus-it.com | secureX9 | Manager |
