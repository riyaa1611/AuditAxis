# AuditAxis

**Compliance and Audit Trail Engine for SAP S/4HANA**

AuditAxis is a production-ready SAP CAP (Cloud Application Programming Model) application that captures, chains, and monitors every business object change flowing out of SAP S/4HANA. It provides tamper-evident audit logs via SHA-256 hash chaining, real-time alerting through webhooks, multi-tenant isolation, observability with Prometheus metrics, and a Fiori Elements dashboard for auditors and administrators.

---

## Architecture

```
┌──────────────┐   CloudEvents    ┌──────────────────────────────────────┐
│  SAP S/4HANA │ ───────────────► │          SAP Event Mesh              │
└──────────────┘                  └────────────────┬─────────────────────┘
                                                   │
                                                   ▼
                                  ┌──────────────────────────────────────┐
                                  │         AuditAxis CAP Service        │
                                  │                                      │
                                  │  ┌────────────┐  ┌───────────────┐  │
                                  │  │   Event     │  │  Enrichment   │  │
                                  │  │  Handler    │──│   Service     │  │
                                  │  └─────┬──────┘  └───────────────┘  │
                                  │        │                             │
                                  │        ▼                             │
                                  │  ┌────────────┐  ┌───────────────┐  │
                                  │  │ Hash Chain  │  │    Alert      │  │
                                  │  │  Engine     │  │   Engine      │──│──► Teams / Slack
                                  │  └─────┬──────┘  └───────┬───────┘  │
                                  │        │                  │          │
                                  │        ▼                  ▼          │
                                  │  ┌────────────┐  ┌───────────────┐  │
                                  │  │  HANA Cloud │  │   Report      │  │
                                  │  │  HDI        │  │   Service     │──│──► CSV / Excel
                                  │  └────────────┘  └───────────────┘  │
                                  │                                      │
                                  │  ┌────────────┐  ┌───────────────┐  │
                                  │  │ Telemetry & │  │  Archive &    │  │
                                  │  │ Metrics     │  │  Retention    │  │
                                  │  └────────────┘  └───────────────┘  │
                                  │                                      │
                                  │  ┌────────────┐  ┌───────────────┐  │
                                  │  │ Rate Limit  │  │  Dead Letter  │  │
                                  │  │ Middleware  │  │  Queue (DLQ)  │  │
                                  │  └────────────┘  └───────────────┘  │
                                  └──────────────────────────────────────┘
                                                   │
                                                   ▼
                                  ┌──────────────────────────────────────┐
                                  │   Fiori Elements Dashboard (UI5)     │
                                  │   List Report  ·  Object Page        │
                                  └──────────────────────────────────────┘
```

| Layer | Technology |
|---|---|
| Runtime | SAP CAP Node.js v7 on Cloud Foundry |
| Database | SAP HANA Cloud (HDI container) |
| Messaging | SAP Event Mesh (CloudEvents) |
| Authentication | SAP XSUAA (JWT) |
| API Protocol | OData V4 |
| Frontend | SAP Fiori Elements (UI5 v1.120) |
| Observability | Prometheus-compatible metrics at `/metrics` |
| CI/CD | GitHub Actions (test → build → deploy) |
| Testing | Jest with coverage |

---

## Key Features

- **Tamper-Evident Hash Chains** — SHA-256 append-only chain per object type with segment-based optimized verification
- **Real-Time Alerting** — Configurable rules with webhook dispatch to Microsoft Teams, Slack, or generic HTTP
- **Multi-Tenant Isolation** — JWT-based tenant resolution with automatic CDS query filtering
- **Dead Letter Queue** — Failed events captured with exponential backoff retry (base 2s, max 5min, 5 retries)
- **Data Retention & Archival** — Scheduled nightly archival of expired records to compressed JSON, with manual trigger support
- **Prometheus Observability** — Pipeline latency, ingestion rates, alert dispatch timing, queue depth, and chain verification metrics
- **Rate Limiting** — Sliding-window per-user rate limiter (100 req/min default, stricter limits for heavy endpoints)
- **Async Processing Queue** — p-queue with concurrency control for high-throughput event ingestion
- **Report Generation** — CSV and Excel (XLSX) audit trail reports for compliance
- **Fiori Elements Dashboard** — List Report + Object Page with filtering, pagination, and drill-down
- **API Access Logging** — Every API call logged for security auditing
- **CI/CD Pipeline** — GitHub Actions workflow for automated testing, building, and BTP deployment

---

## Project Structure

```
AuditAxis/
├── .github/
│   └── workflows/
│       └── deploy.yml                # CI/CD: test → build → deploy to SAP BTP
├── app/
│   └── fiori-dashboard/              # Fiori Elements UI
│       ├── annotations.cds           # UI annotations (List Report + Object Page)
│       ├── xs-app.json               # App Router config
│       ├── package.json
│       └── webapp/
│           ├── Component.js
│           ├── index.html
│           └── manifest.json
├── db/
│   ├── schema.cds                    # Core data model (10 entities, multi-tenant)
│   └── audit-model.cds              # Reusable types and aspects
├── srv/
│   ├── audit-service.cds            # OData service definition (entities, actions, functions, types)
│   ├── audit-service.js             # Main service handler (ingestion, stats, DLQ retry, archival)
│   ├── event-handler.js             # Event Mesh subscriber with DLQ integration
│   ├── enrichment-service.js        # User/org enrichment with caching
│   ├── hashchain-engine.js          # SHA-256 hash chain with segment optimization
│   ├── alert-engine.js              # Rule evaluation + webhook dispatch with telemetry
│   ├── report-service.js            # CSV and Excel report generation
│   ├── archive-service.js           # Data retention & archival to compressed JSON
│   └── tenant-context.js            # Multi-tenant JWT resolution & CDS query isolation
├── util/
│   ├── hash.js                      # SHA-256 helper
│   ├── verification.js              # Chain integrity verification algorithm
│   ├── enrichment-cache.js          # In-memory TTL cache
│   ├── telemetry.js                 # Prometheus-compatible metrics registry
│   ├── event-retry.js               # Dead letter queue with exponential backoff
│   └── rate-limit.js                # Sliding-window rate limiter middleware
├── test/
│   ├── hash.test.js                 # SHA-256 utility tests
│   ├── verification.test.js         # Chain integrity verification tests
│   ├── telemetry.test.js            # Metrics registry tests
│   └── rate-limit.test.js           # Rate limiter tests
├── server.js                        # Custom CAP bootstrap (middleware, cron jobs)
├── package.json
├── jest.config.js                   # Jest test configuration
├── .cdsrc.json                      # CDS config (dev profile with mocked auth)
├── mta.yaml                         # MTA deployment descriptor
└── xs-security.json                 # XSUAA scopes, roles, role-collections
```

---

## Data Model

### Entities

| Entity | Purpose |
|---|---|
| **AuditLog** | Immutable record of every captured change (object, user, timestamp, hash links) |
| **AuditLogItem** | Field-level detail (field name, old value, new value) per AuditLog entry |
| **ObjectConfig** | Configuration per object type — which fields to monitor, retention period |
| **AlertRule** | Rules that trigger notifications when specific change patterns are detected |
| **AlertLog** | Log of every triggered alert with delivery status |
| **HashChain** | Head pointer per object type storing the latest hash and sequence number |
| **FailedEventQueue** | Dead letter queue for events that failed processing (with retry metadata) |
| **ArchiveLog** | Record of each archival operation (date, object type, record count, storage path) |
| **HashSegment** | Checkpoint every 1000 records for optimized hash chain verification |
| **ApiAccessLog** | Security audit log for all API endpoint access |

### Relationships

```
AuditLog 1 ──── * AuditLogItem     (Composition)
AuditLog 1 ──── * AlertLog         (Association)
AlertRule 1 ──── * AlertLog        (Association)
```

### Multi-Tenant Isolation

All core entities include a `tenantScoped` aspect that adds a `tenantId` field. The `TenantContext` middleware automatically:
- Resolves the tenant from the XSUAA JWT `zid` (zone ID) claim
- Injects `tenantId` on all `CREATE` operations
- Adds `tenantId` filter on all `READ` operations

---

## Core Services

### 1. Event Handler (`srv/event-handler.js`)

Subscribes to SAP Event Mesh topics following the pattern `sap/s4/beh/<ObjectType>/v1/changed`. Parses incoming CloudEvent messages and feeds them into the ingestion pipeline. Also listens on a generic `auditaxis/ingest` topic for custom integrations.

**Resilience:** Failed events are automatically routed to the Dead Letter Queue with full error context for later retry.

### 2. Enrichment Service (`srv/enrichment-service.js`)

Enriches raw audit events with:
- User full name
- User roles
- Organizational unit

Uses an in-memory TTL cache (5-minute default) to minimize calls to the S/4HANA user API. Gracefully degrades when the remote service is unavailable.

### 3. Hash Chain Engine (`srv/hashchain-engine.js`)

Maintains a tamper-evident append-only chain per object type:

```
currentHash = SHA256( canonicalPayload + previousHash )
```

- The genesis record uses `000...0` (64 zeroes) as its previous hash.
- Each new record extends the chain and updates the `HashChain` head.
- **Segment Optimization:** Every 1000 records, a `HashSegment` checkpoint is created. Verification first validates segment boundaries before falling back to full traversal.
- The `verifyChain(objectType)` function detects any tampering and reports the first break.

### 4. Alert Engine (`srv/alert-engine.js`)

Evaluates all active `AlertRule` entries against each incoming audit event. When a rule matches (by object type, change type, and/or field name):
1. Creates an `AlertLog` record with status `NEW`.
2. Dispatches a webhook notification to the configured channel.
3. Updates the status to `SENT` or `FAILED`.
4. Records telemetry (trigger count, dispatch latency).

Supported webhook formats:
- **Microsoft Teams** — Adaptive MessageCard
- **Slack** — `{ "text": "..." }`
- **Generic HTTP** — JSON payload

### 5. Report Service (`srv/report-service.js`)

Generates audit trail reports for a given object type and date range:
- **CSV** — via `csv-stringify`
- **Excel (XLSX)** — via `exceljs` with styled header rows

Reports flatten audit log headers and field-level items into one row per field change.

### 6. Archive Service (`srv/archive-service.js`)

Manages data retention and archival:
- Queries records past the configured retention period per object type
- Exports to gzip-compressed JSON files
- Records archival metadata in the `ArchiveLog` entity
- Deletes archived records from the primary store
- Runs automatically nightly at 02:00 via `node-cron`, or manually via the `triggerArchival` action

### 7. Dead Letter Queue (`util/event-retry.js`)

Failed events are captured with:
- Full event payload (JSON)
- Error message and stack trace
- Exponential backoff retry scheduling (2s base, 5min max, 5 retries)
- Status tracking: `PENDING` → `RETRYING` → `RESOLVED` or `DEAD`
- Automatic retry processing every 5 minutes via scheduled job

---

## API Endpoints

OData V4 service exposed at `/api/audit/`:

### Entity Sets

| Endpoint | Access | Description |
|---|---|---|
| `GET /AuditLogs` | Auditor, Admin | Query audit records with filtering, pagination, expand to items/alerts |
| `GET /AuditLogItems` | Auditor, Admin | Query field-level changes |
| `GET /Alerts` | Auditor, Admin | Query triggered alerts |
| `GET /ObjectConfigs` | Admin | Manage monitored object configurations |
| `GET /AlertRules` | Admin | Manage alert rules |
| `GET /HashChains` | Auditor, Admin | View hash chain heads |
| `GET /FailedEvents` | Admin | View dead letter queue entries |
| `GET /ArchiveLogs` | Auditor, Admin | View archival history |
| `GET /HashSegments` | Auditor, Admin | View hash chain verification segments |

### Actions & Functions

| Endpoint | Type | Access | Description |
|---|---|---|---|
| `POST /ingestEvents` | Action | System | Batch ingest audit events |
| `GET /verifyChain(objectType='...')` | Function | Auditor | Verify hash chain integrity |
| `POST /generateReport` | Action | Auditor | Generate CSV/Excel report |
| `GET /getStats()` | Function | Auditor | Aggregated statistics (totals, per-type counts, alert summary, ingestion rate) |
| `GET /getUserActivity(userId='...')` | Function | Auditor | Activity timeline for a specific user |
| `GET /getObjectTimeline(objectKey='...')` | Function | Auditor | Change timeline for a specific object |
| `POST /retryFailedEvent` | Action | Admin | Retry a specific failed event from the DLQ |
| `POST /triggerArchival` | Action | Admin | Manually trigger archival for an object type |

### Observability

| Endpoint | Description |
|---|---|
| `GET /metrics` | Prometheus-compatible metrics (pipeline latency, ingestion rate, alert counts, queue depth, DB operation timing) |

---

## Security

### XSUAA Scopes

| Scope | Purpose |
|---|---|
| `AuditAxis.Admin` | Full read/write access to configurations, alert rules, DLQ management |
| `AuditAxis.Auditor` | Read-only access to logs, chain verification, report generation, stats |
| `AuditAxis.System` | System-to-system scope for event ingestion |

### Role Collections

| Role Collection | Included Scopes |
|---|---|
| AuditAxis Administrator | Admin + Auditor |
| AuditAxis Auditor | Auditor |
| AuditAxis System | System |

### Security Hardening

- **Immutability:** `AuditLog`, `AuditLogItem`, and `AlertLog` reject all `UPDATE` and `DELETE` operations at both CDS and handler level
- **Rate Limiting:** Sliding-window per-user limits — 100 req/min general, 10/min for report generation, 20/min for chain verification
- **API Access Logging:** Every request logged to `ApiAccessLog` (user, endpoint, IP, user agent)
- **Multi-Tenant Isolation:** CDS-level query filtering ensures tenants never see each other's data

---

## Observability & Metrics

AuditAxis exposes Prometheus-compatible metrics at `GET /metrics`:

| Metric | Type | Description |
|---|---|---|
| `audit_events_ingested_total` | Counter | Total events ingested (by object type) |
| `audit_pipeline_latency_ms` | Histogram | End-to-end processing latency |
| `alert_trigger_count` | Counter | Alerts triggered (by object type, rule) |
| `chain_verification_failures` | Counter | Hash chain verification failures |
| `db_operation_latency_ms` | Histogram | Database operation timing |
| `alert_dispatch_latency_ms` | Histogram | Webhook dispatch latency |
| `failed_events_total` | Counter | Events that failed processing |
| `ingestion_queue_size` | Gauge | Current async processing queue depth |
| `event_mesh_consumer_lag` | Gauge | Estimated Event Mesh consumer lag |

---

## Getting Started

### Prerequisites

- Node.js >= 18
- SAP CAP CLI (`@sap/cds-dk`)
- SAP BTP Cloud Foundry environment (for deployment)
- SAP HANA Cloud instance (for production)

### Local Development

```bash
# Install dependencies
npm install

# Run with in-memory SQLite and mocked authentication
cds watch
```

The dev profile (`.cdsrc.json`) provides three mocked users:

| User | Password | Role |
|---|---|---|
| `admin` | `admin` | AuditAxis.Admin |
| `auditor` | `auditor` | AuditAxis.Auditor |
| `system` | `system` | AuditAxis.System |

### Running Tests

```bash
# Run unit tests with coverage
npm test
```

Tests cover: SHA-256 hashing, chain integrity verification, Prometheus telemetry registry, and rate limiting.

### Build for Production

```bash
cds build --production
```

### Deploy to SAP BTP

```bash
# Build the MTA archive
mbt build

# Deploy to Cloud Foundry
cf deploy mta_archives/auditaxis_1.0.0.mtar
```

---

## CI/CD Pipeline

The GitHub Actions workflow (`.github/workflows/deploy.yml`) runs automatically on pushes and PRs to `main`:

| Stage | Trigger | Description |
|---|---|---|
| **Test** | push, PR | Install deps, run `npm test` |
| **Build** | After Test passes | `cds build --production`, upload artifact |
| **Deploy** | push to `main` only | Download artifact, build MTA, `cf deploy` to BTP |

### Required GitHub Secrets

| Secret | Description |
|---|---|
| `CF_API` | Cloud Foundry API endpoint |
| `CF_USERNAME` | CF login username |
| `CF_PASSWORD` | CF login password |
| `CF_ORG` | CF organization |
| `CF_SPACE` | CF space |

---

## Fiori Elements UI

The dashboard is a standard Fiori Elements List Report + Object Page application:

- **List Report** — Filterable table of audit log entries with columns for object type, user, change type, timestamp, and transaction code
- **Object Page** — Detailed view with sections for general info, hash chain data, field-level changes (sub-table), and triggered alerts
- Additional list reports are available for **Alerts**, **Object Configurations**, and **Alert Rules**

Access the UI in local development at: `http://localhost:4004/fiori-dashboard/webapp/index.html`

---

## Event Mesh Integration

AuditAxis subscribes to S/4HANA change events via SAP Event Mesh. Topic patterns:

```
sap/s4/beh/{ObjectType}/v1/changed   – per-object-type topics
auditaxis/ingest                      – generic ingest topic
```

Active subscriptions are driven by the `ObjectConfig` entity — only object types marked `active: true` are subscribed.

### CloudEvent Payload (Expected)

```json
{
  "objectKey": "4500000123",
  "userId": "JSMITH",
  "timestamp": "2026-03-08T10:30:00Z",
  "changeType": "UPDATE",
  "transactionCode": "ME21N",
  "fields": [
    { "fieldName": "NET_PRICE", "oldValue": "100.00", "newValue": "150.00" },
    { "fieldName": "CURRENCY", "oldValue": "USD", "newValue": "EUR" }
  ]
}
```

---

## Scheduled Jobs

| Job | Schedule | Description |
|---|---|---|
| Data Archival | Nightly at 02:00 | Archives records past retention period to compressed JSON |
| DLQ Retry | Every 5 minutes | Retries pending failed events with exponential backoff |

Both jobs run via `node-cron` registered during CAP server bootstrap. If `node-cron` is unavailable, the jobs are silently disabled and can be triggered manually via the admin API.

---

## Performance

| Metric | Target |
|---|---|
| Event processing latency | < 3 seconds end-to-end |
| Throughput | 500 events/sec (p-queue concurrency: 20) |
| Enrichment cache TTL | 5 minutes (configurable) |
| Batch processing | 50 events per batch |
| Alert dispatch | Async fire-and-forget with status tracking |
| Hash segment size | 1000 records per segment |
| DLQ retry backoff | 2s base, 5min max, 5 retries |
| Rate limit (general) | 100 requests/min per user |
| Rate limit (reports) | 10 requests/min per user |
| Rate limit (verification) | 20 requests/min per user |

---

## License

UNLICENSED — Internal use only.
