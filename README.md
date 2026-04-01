# Broker Compliance

Insurance Broker Compliance & Renewal Readiness Platform for Irish insurance brokers. Automates CPC renewal compliance, checklist management, document generation, and CBI inspection preparation.

## Quick Start

```bash
# 1. Start PostgreSQL
docker compose up -d

# 2. Install dependencies
npm install

# 3. Run database migrations
npx prisma migrate dev

# 4. Seed with sample data
npm run db:seed

# 5. Start development server
npm run dev

# 6. Start background worker (optional, for reminders + doc gen)
npm run worker
```

Open [http://localhost:3000](http://localhost:3000). Login with seeded credentials.

## Tech Stack

| Layer        | Technology                                  |
| ------------ | ------------------------------------------- |
| Frontend     | Next.js 14 (App Router) + TailwindCSS       |
| Backend      | Next.js API Routes + Prisma ORM             |
| Database     | PostgreSQL 16 (local Docker / Railway EU)   |
| Auth         | Custom JWT (jose) + bcrypt password hashing |
| File storage | Local filesystem (`/api/files/`)            |
| Email        | Resend (transactional email API)            |
| Document gen | Puppeteer (HTML to PDF, async background)   |
| Testing      | Vitest (488 tests, 50 test files)           |

## Project Structure

```
src/
├── app/                              # Next.js App Router
│   ├── (auth)/
│   │   ├── login/page.tsx            # Login page
│   │   ├── register/page.tsx         # Firm registration
│   │   ├── forgot-password/page.tsx  # Password reset request
│   │   └── reset-password/page.tsx   # Password reset with token
│   ├── dashboard/page.tsx            # Renewal timeline dashboard
│   ├── renewals/page.tsx             # Renewal list (filterable, sortable)
│   ├── renewals/[id]/page.tsx        # Checklist + evidence + documents
│   ├── clients/page.tsx              # Client list (searchable)
│   ├── clients/[id]/page.tsx         # Client detail + policies
│   ├── import/page.tsx               # CSV import wizard (4 steps)
│   ├── audit/page.tsx                # Audit trail (paginated, exportable)
│   ├── settings/page.tsx             # User profile + firm info + team
│   ├── layout.tsx                    # Root layout with sidebar
│   └── nav-links.tsx                 # Navigation component
│
├── app/api/                          # API Routes (28 endpoints)
│   ├── auth/
│   │   ├── login/route.ts            # POST: email + password login
│   │   ├── register/route.ts         # POST: firm + admin registration
│   │   ├── logout/route.ts           # POST: destroy session
│   │   ├── invite/route.ts           # POST: invite user to firm
│   │   ├── change-password/route.ts  # POST: change password
│   │   ├── forgot-password/route.ts  # POST: send reset email
│   │   ├── reset-password/route.ts   # POST: reset with token
│   │   └── me/route.ts               # GET: current user + firm info
│   ├── users/route.ts                # GET: firm users list
│   ├── clients/
│   │   ├── route.ts                  # GET/POST: list + create
│   │   └── [id]/route.ts            # GET/PUT/DELETE: detail
│   ├── policies/
│   │   ├── route.ts                  # GET: list (adviser-filtered)
│   │   └── [id]/route.ts            # GET: detail
│   ├── renewals/
│   │   ├── route.ts                  # GET: timeline (adviser-filtered)
│   │   └── [id]/checklist/route.ts   # GET: checklist for renewal
│   ├── checklist/[id]/route.ts       # PUT: complete/approve/reject
│   ├── import/
│   │   ├── route.ts                  # POST: upload + parse CSV
│   │   ├── confirm/route.ts          # POST: execute import
│   │   └── mapping/route.ts          # GET/POST: field mapping config
│   ├── documents/route.ts            # POST: generate doc / inspection pack
│   ├── upload/route.ts               # POST: upload evidence files
│   ├── files/[...path]/route.ts      # GET: serve uploaded files
│   ├── audit/route.ts                # GET: query events (paginated, CSV export)
│   ├── dashboard/route.ts            # GET: dashboard stats
│   ├── gdpr/
│   │   ├── route.ts                  # POST: data export + erasure
│   │   └── purge/route.ts           # POST: retention purge
│   ├── worker/route.ts              # GET/POST: worker job trigger
│   └── health/route.ts              # GET: health check
│
├── lib/                              # Core utilities
│   ├── auth.ts                       # JWT (sign/verify/revoke), withAuth wrapper
│   ├── prisma.ts                     # Prisma client + AsyncLocalStorage RLS
│   ├── rbac.ts                       # Role-based access control (4 roles)
│   ├── csv-parser.ts                 # BMS format detection + CSV parsing
│   ├── dates.ts                      # Irish date parsing + renewal timeline
│   ├── dedup.ts                      # 3-tier policy dedup (hash/fuzzy/match)
│   ├── checklist-state.ts            # State machine + CPC item definitions
│   ├── html.ts                       # HTML escaping + template helpers
│   └── pdf.ts                        # Puppeteer HTML-to-PDF wrapper
│
├── services/                         # Business logic
│   ├── import-service.ts             # CSV import pipeline + validation
│   ├── renewal-service.ts            # Renewal generation + dashboard stats
│   ├── checklist-service.ts          # Checklist sign-off workflow
│   ├── document-service.ts           # Template rendering + doc generation
│   ├── inspection-pack-service.ts    # CBI inspection ZIP generator
│   ├── notification-service.ts       # Email reminder scheduling
│   ├── email-service.ts              # Resend API integration + templates
│   └── audit-service.ts              # Audit trail logging + CSV export
│
├── worker/
│   └── index.ts                      # Background job processor (30s loop)
│
└── __tests__/unit/                   # 198 tests across 13 files
    ├── auth.test.ts
    ├── checklist-state.test.ts
    ├── checklist-lifecycle.test.ts
    ├── csv-parser.test.ts
    ├── dates.test.ts
    ├── dedup.test.ts
    ├── documents.test.ts
    ├── gdpr.test.ts
    ├── import-pipeline.test.ts
    ├── integration.test.ts
    ├── rbac.test.ts
    ├── regressions.test.ts
    └── worker.test.ts
```

## Features

### Data Import

- **CSV upload** with drag-and-drop
- **Auto-detect** Applied Epic TAM, Acturis, or generic CSV formats
- **Interactive mapping UI** for unknown formats (drag columns to fields)
- **3-tier dedup**: exact hash → normalized number → Jaro-Winkler fuzzy match
- **Row-level validation** with error reports (skip/fix/abort per error)
- **Preview** first 20 rows before confirming import
- **Import history** tracking (who, when, how many, errors)
- Saved mapping configs per firm

### Renewal Dashboard

- **Status distribution** donut chart (pure CSS conic-gradient)
- **40-day countdown bar** per renewal (CP158 compliance)
- **Activity feed** (last 10 audit events with relative timestamps)
- **Compliance score** by quarter
- **Filter** by status, policy type, insurer, adviser
- **Sort** by expiry date, premium, status priority

### Compliance Checklist Engine

- **8 CPC items** per renewal (renewal notification, suitability, market comparison, premium disclosure, commission disclosure, client communication, policy terms, final sign-off)
- **State machine**: pending → in_progress → completed → pending_review → approved/rejected
- **Sign-off workflow**: adviser completes, compliance officer reviews
- **Evidence upload**: PDF, PNG, JPEG files attached to checklist items
- **Auto-complete**: premium_disclosure auto-populated from policy data
- **Optimistic locking** on concurrent edits

### Document Generator

- **CPC Renewal Notification Letter** (HTML → PDF via Puppeteer)
- **Suitability Assessment Form** (needs/demands/circumstances review)
- **Commission Disclosure** document
- **CBI Inspection Evidence Pack** (ZIP of all renewal docs + audit trail)
- **Filterable packs**: by date range, policy type, adviser
- **Async generation** via background worker

### Authentication & Authorization

- **JWT sessions** (httpOnly cookie, 8-hour expiry)
- **Token revocation** blocklist (invalidated on password change)
- **4 roles**: firm_admin, compliance_officer, adviser, read_only
- **Permission matrix**: import, view_all, view_own, complete_items, sign_off, admin
- **Adviser isolation**: advisers see only their own clients/policies/renewals
- **Password reset** flow with email token (15-min expiry)
- **User invitation** via Resend email
- **CSRF** double-submit cookie protection
- **Rate limiting**: registration (3/min/IP), login (5/min/IP + per-account)

### Audit Trail

- **12+ event types** (policy.imported, checklist.item.completed/approved/rejected, document.generated, user.login, gdpr.erasure_completed, etc.)
- **Append-only** (PostgreSQL RLS blocks UPDATE/DELETE)
- **Paginated** query with date/action/entity filters
- **CSV export** for CBI inspection
- **6-year retention** (CPC requirement)

### GDPR Compliance

- **Two-layer anonymization**: Layer 1 (compliance records retained 6yr) + Layer 2 (client PII erasable)
- **Art 17(3)(b)** exemption logged in audit trail
- **Data export** (JSON, Art 20 portability)
- **Data erasure** (anonymize PII, retain compliance records)
- **Retention purge** (automated 6-year cleanup)

### Background Worker

- **DB-backed job queue** (no Redis dependency)
- **Job types**: check_reminders, generate_document, gdpr_erasure
- **Retry**: 3 attempts with exponential backoff (5min base)
- **Catch-up**: missed reminders sent on startup
- **30-second polling** interval

## API Endpoints

| Method   | Path                        | Description                    | Auth                   |
| -------- | --------------------------- | ------------------------------ | ---------------------- |
| POST     | /api/auth/login             | Email + password login         | No                     |
| POST     | /api/auth/register          | Firm + admin registration      | No                     |
| POST     | /api/auth/logout            | Destroy session                | Yes                    |
| POST     | /api/auth/invite            | Invite user to firm            | Admin                  |
| POST     | /api/auth/change-password   | Change password                | Yes                    |
| POST     | /api/auth/forgot-password   | Send reset email               | No                     |
| POST     | /api/auth/reset-password    | Reset with token               | No                     |
| GET      | /api/auth/me                | Current user + firm info       | Yes                    |
| GET      | /api/users                  | List firm users                | Admin                  |
| GET      | /api/clients                | List clients                   | Yes (adviser-filtered) |
| GET      | /api/clients/:id            | Client detail + policies       | Yes                    |
| POST     | /api/clients                | Create client                  | Adviser+               |
| GET      | /api/policies               | List policies                  | Yes (adviser-filtered) |
| GET      | /api/policies/:id           | Policy detail                  | Yes                    |
| GET      | /api/renewals               | Renewal timeline               | Yes (adviser-filtered) |
| GET      | /api/renewals/:id/checklist | Checklist for renewal          | Yes                    |
| PUT      | /api/checklist/:id/complete | Mark item complete             | Adviser+               |
| PUT      | /api/checklist/:id/approve  | Approve item                   | CO+                    |
| PUT      | /api/checklist/:id/reject   | Reject with reason             | CO+                    |
| POST     | /api/import                 | Upload + parse CSV             | Admin/CO               |
| POST     | /api/import/confirm         | Execute import                 | Admin/CO               |
| GET/POST | /api/import/mapping         | Field mapping config           | Admin/CO               |
| POST     | /api/documents              | Generate doc / inspection pack | Adviser+               |
| POST     | /api/upload                 | Upload evidence file           | Yes                    |
| GET      | /api/files/:path            | Serve uploaded files           | Yes                    |
| GET      | /api/audit                  | Query audit events             | CO+                    |
| GET      | /api/dashboard              | Dashboard stats                | Yes                    |
| POST     | /api/gdpr                   | Data export + erasure          | Admin                  |
| POST     | /api/gdpr/purge             | Retention cleanup              | Admin                  |
| GET/POST | /api/worker                 | Worker job trigger             | Worker auth            |
| GET      | /api/health                 | Health check                   | No                     |

## Environment Variables

```env
# Database
DATABASE_URL="postgresql://postgres:localdev@localhost:5432/broker_compliance"

# Auth
NEXTAUTH_SECRET="<random-32-byte-hex>"    # Required — no fallback, throws if missing
NEXTAUTH_URL="http://localhost:3000"

# Worker
WORKER_SECRET="<random-string>"            # For /api/worker endpoint auth

# Email (optional for dev)
RESEND_API_KEY="re_..."

# File storage (optional, defaults to local filesystem)
R2_ACCESS_KEY_ID="..."
R2_SECRET_ACCESS_KEY="..."
R2_BUCKET_NAME="..."
R2_ENDPOINT="..."
```

## Database Migrations

Schema changes use Prisma migrations (not `db push`).

```bash
# Apply pending migrations (dev)
npx prisma migrate dev

# Apply pending migrations (production)
npx prisma migrate deploy

# Check migration status
npx prisma migrate status

# Create a new migration after editing schema.prisma
npx prisma migrate dev --name describe_your_change

# Regenerate Prisma Client (after schema changes)
npx prisma generate

# Reset database and reapply all migrations (⚠️ destructive)
npx prisma migrate reset
```

**Baseline migration (000_init)** captures the full schema as of 2026-04-01.
Incremental migrations (001+) layer on top. Do NOT modify old migration files.

## Security

| Layer         | Measure                                                                     |
| ------------- | --------------------------------------------------------------------------- | ---------------------------------- |
| Auth          | JWT with token revocation blocklist (invalidated on password change)        |
| CSRF          | Double-submit cookie pattern (csrf_token cookie + X-CSRF-Token header)      |
| Rate limit    | Registration: 3/min/IP. Login: 5/min/IP + per-account 10/10min              |
| File upload   | Magic bytes validation (PDF/PNG/JPEG/GIF + text), path traversal protection |
| Multi-tenant  | PostgreSQL RLS via AsyncLocalStorage (per-request firm context)             |
| Input         | Zod validation on all API endpoints, max lengths on free-text fields        |
| XSS           | `escapeHtml()` on all user content rendered in HTML/PDF documents           |
| CSV injection | Formula trigger chars (`=+-@                                                | !\t\r`) prefixed with single quote |
| Password      | bcrypt hashing, min 10 / max 128 chars                                      |
| Cookies       | httpOnly, sameSite: strict, secure (production)                             |
| Logging       | PII redacted in production error logs                                       |
| Worker        | Timing-safe token comparison                                                |

## Testing

```bash
# Run all tests
npm test                    # 198 tests, 13 files, ~1.1s

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage
```

| Test file                   | Tests | Coverage area                                     |
| --------------------------- | ----- | ------------------------------------------------- |
| auth.test.ts                | 8     | JWT sign/verify/revoke, password hashing          |
| checklist-state.test.ts     | 23    | State machine transitions, CPC definitions        |
| checklist-lifecycle.test.ts | 3     | Complete → approve → reject workflow              |
| csv-parser.test.ts          | 27    | BMS format detection, date parsing, field mapping |
| dates.test.ts               | 19    | Irish date parsing, renewal timeline calculation  |
| dedup.test.ts               | 26    | Hash normalization, Jaro-Winkler fuzzy match      |
| documents.test.ts           | 8     | HTML template rendering, commission disclosure    |
| gdpr.test.ts                | 8     | Data export, erasure, anonymization               |
| import-pipeline.test.ts     | 9     | Full import pipeline integration                  |
| integration.test.ts         | 37    | End-to-end service integration                    |
| rbac.test.ts                | 13    | Role permissions, permission matrix               |
| regressions.test.ts         | 12    | Regression prevention (edge cases)                |
| worker.test.ts              | 5     | Job queue, retry logic, backoff                   |

## BMS Format Support

| BMS                | Auto-detection                               | Date format        | Notes                               |
| ------------------ | -------------------------------------------- | ------------------ | ----------------------------------- |
| Applied Epic (TAM) | 95% (PolicyRef + ClientName + InceptionDate) | DD/MM/YYYY         | EUR with € symbol, fadas supported  |
| Acturis            | 95% (PolicyNo + InsuredName + EffectiveDate) | YYYY-MM-DD         | Split address columns, status field |
| Generic CSV        | 40-75% (fuzzy header matching, Jaro-Winkler) | DD/MM/YYYY default | Interactive mapping UI fallback     |

## Compliance

- **CPC 2012:** 20-day written renewal notice requirement
- **CP158:** 40-day pre-renewal + renewal notice (configurable per renewal)
- **IAF:** Conduct Standards evidence, F&P certification, attestations (Phase 2)
- **GDPR:** Two-layer anonymization, Art 17(3)(b) exemption, 6-year retention
- **Audit trail:** Append-only, CBI inspection export, 6-year retention

## Project Status

**Phase 1 (CPC Renewal Compliance): Complete**

| Area                  | Status                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------- |
| Data Import           | ✅ Complete (CSV/Applied Epic/Acturis + mapping + fuzzy dedup + CSV injection protection)     |
| Dashboard             | ✅ Complete (pie chart, activity feed, countdown bar, quarterly score)                        |
| Checklist Engine      | ✅ Complete (8 items, sign-off, evidence, state machine, self-approval prevention)            |
| Document Generator    | ✅ Complete (renewal letter, suitability, commission, async inspection pack)                  |
| Audit Trail           | ✅ Complete (15+ events, paginated, CSV export, PII redaction)                                |
| Auth & RBAC           | ✅ Complete (JWT, 4 roles, CSRF, Redis-backed rate limit, password reset, session revocation) |
| GDPR                  | ✅ Complete (export, erasure via worker, retention purge, Art 17(3)(b))                       |
| Background Worker     | ✅ Complete (DB job queue, retry, catch-up, inspection pack generation)                       |
| Clients Management    | ✅ Complete (list, detail, search, cascade delete)                                            |
| Settings              | ✅ Complete (user profile, firm info, team members)                                           |
| CPC Rules DB          | ✅ Complete (ADR-004: DB-configurable rules, admin API, auto-seed)                            |
| Cloud Storage         | ✅ Complete (S3/R2 support with local filesystem fallback)                                    |
| Unit Tests            | ✅ 301 tests, 24 test files                                                                   |
| E2E Tests             | ✅ 19 Playwright tests, 5 spec files                                                          |
| Security              | ✅ 0 npm vulnerabilities, all deps at latest                                                  |
| DPIA Documentation    | ❌ Pending (legal document, not code)                                                         |
| Subscription Handling | ❌ Phase 2                                                                                    |

## Design Documents

Full design documentation in `~/.gstack/projects/workspace/`:

- `broker-compliance-prd-20260328.md` — Product Requirements
- `broker-compliance-adr-20260328.md` — 12 Architecture Decision Records
- `broker-compliance-eng-design-20260328.md` — Engineering Design
- `gdpr-compliance-architecture-20260328.md` — GDPR Architecture
- `idd-regulatory-risk-assessment.md` — IDD Regulatory Risk
- `phase0-bms-format-analysis-20260328.md` — BMS Format Analysis
