# Broker Compliance

Insurance Broker Compliance & Renewal Readiness Platform for Irish insurance brokers. Automates CPC renewal compliance, checklist management, document generation, and CBI inspection preparation. **AI Agent** processes inbound insurer emails, extracts policy data, and generates suggested database updates.

## Quick Start

```bash
# 1. Start PostgreSQL + Redis
docker compose up -d

# 2. Install dependencies
npm install

# 3. Run database migrations
npx prisma migrate dev

# 4. Seed with sample data
npm run db:seed

# 5. Start development server
npm run dev

# 6. Start background worker (optional, for email processing + reminders)
npm run worker
```

Open [http://localhost:3000](http://localhost:3000). Login with seeded credentials.

## Tech Stack

| Layer        | Technology                                  |
| ------------ | ------------------------------------------- |
| Frontend     | Next.js 14 (App Router) + TailwindCSS       |
| Backend      | Next.js API Routes + Prisma ORM             |
| Database     | PostgreSQL 16 (local Docker / Railway EU)   |
| Queue        | BullMQ + Redis (email processing jobs)      |
| Auth         | Custom JWT (jose) + bcrypt password hashing |
| File storage | Local filesystem (`/api/files/`)            |
| Email        | Resend (transactional email API)            |
| LLM          | OpenAI API (GPT-4o-mini, classification + extraction) |
| Document gen | Puppeteer (HTML to PDF, async background)   |
| Testing      | Vitest (518 tests, 55 test files)           |

## Project Structure

```
src/
├── app/                              # Next.js App Router
│   ├── (auth)/                       # Login, register, password reset
│   ├── dashboard/                    # Renewal timeline dashboard
│   ├── renewals/                     # Renewal list + checklist
│   ├── clients/                      # Client management
│   ├── agent/                        # AI Agent dashboard
│   │   ├── page.tsx                  # Pending actions + activity feed
│   │   ├── config/page.tsx           # Agent configuration
│   │   ├── metrics/page.tsx          # Performance dashboard + charts
│   │   ├── onboarding/page.tsx       # 3-step setup wizard
│   │   └── actions/[id]/page.tsx     # Action detail + thread history
│   ├── audit/                        # Audit trail
│   └── settings/                     # User + firm settings
│
├── app/api/                          # API Routes (58 endpoints)
│   ├── auth/                         # Authentication endpoints
│   ├── agent/
│   │   ├── ingest/route.ts           # POST: webhook email ingestion
│   │   ├── config/route.ts           # GET/PUT: agent configuration
│   │   ├── actions/                  # CRUD + confirm/modify/reject/reverse
│   │   ├── emails/                   # Email list + detail
│   │   ├── events/route.ts           # SSE real-time events
│   │   ├── metrics/route.ts          # Agent performance metrics
│   │   ├── learning/route.ts         # Learning insights
│   │   ├── health/route.ts           # Agent health check
│   │   └── oauth/                    # Gmail + Outlook + IMAP connections
│   ├── worker/route.ts               # Background job processor
│   └── ...                           # Other API routes
│
├── lib/
│   ├── agent/
│   │   ├── classifier.ts             # Email classification (LLM)
│   │   ├── extractor.ts              # Data extraction (LLM)
│   │   ├── pii.ts                    # PII desensitization (Eircode, PPS, names)
│   │   ├── matcher.ts                # Record matching (exact + fuzzy + multi-field)
│   │   ├── action-generator.ts       # Action generation from extraction
│   │   ├── action-executor.ts        # Action execution (create/update/cancel)
│   │   └── learning.ts               # Learning feedback loop
│   ├── auth.ts                       # JWT + RBAC
│   ├── prisma.ts                     # Prisma client + RLS context
│   └── ...                           # Other utilities
│
├── services/
│   ├── agent/
│   │   ├── pipeline.ts               # Email processing pipeline
│   │   └── notifications.ts          # Digest + urgent + accuracy alerts
│   ├── email/                        # Email parsing + attachment extraction
│   │   ├── oauth/                    # Gmail/Outlook OAuth + polling
│   │   └── imap/                     # IMAP connector + polling
│   └── ...                           # Other services
│
└── __tests__/unit/                   # 55 test files, 518 tests
```

## Features

### AI Agent (Phase 2)

**Core value proposition:** "Forward your emails. We handle the rest."

#### Email Ingestion
- **Mode A: Forwarding address** — unique `agent-{firmId}@ingest.{domain}` per firm
- **Mode B: Direct connection** — Gmail OAuth, Outlook OAuth, or raw IMAP
- **Email parsing** — mailparser with multipart, attachment extraction
- **Email threading** — RFC 5322 Message-ID / In-Reply-To / References grouping
- **Dedup** — unique constraint on firmId + messageId
- **Daily limit** — 200 emails/firm/day
- **Rate limit** — 100/min per firm (webhook ingestion)
- **HMAC-SHA256** webhook signature verification

#### Agent Engine
- **Classification** — GPT-4o-mini classifies emails as insurance/non-insurance by type
- **PII desensitization** — regex + heuristic tokenizer before LLM (Eircode, PPS, names, emails, phones, policy numbers, IBANs, addresses)
- **Extraction** — structured data extraction (renewal, new policy, claim, cancellation)
- **Thread context** — desensitized snippets from previous emails in thread
- **Record matching** — exact policy number → fuzzy (Levenshtein) → multi-field (name + insurer)
- **Action generation** — update_policy, create_policy, create_client, cancel_policy, flag_for_review
- **Learning feedback** — past corrections injected into extraction prompts
- **Dynamic threshold** — match strictness varies with classification confidence

#### Execution Modes
- **Suggestion mode** — all actions queued for human review (default)
- **Auto-execute mode** — high-confidence actions (≥95%) executed automatically
- **24h undo window** — reverse any executed action within 24 hours
- **Bulk confirm** — atomic claim + execution with rollback on failure
- **Per-action-type overrides** (configurable per firm)

#### Dashboard
- **Pending actions queue** — inline editing, bulk confirm, keyboard shortcuts
- **Activity feed** — real-time via SSE (Server-Sent Events)
- **Action detail** — email body preview, thread history, modification audit trail
- **Performance metrics** — accuracy trend (7/14/30d), action distribution, email volume
- **Learning insights** — common extraction mistakes, correction patterns
- **3-step onboarding wizard** — connect email → forward test email → ready

#### Notifications
- **Daily digest** — email summary for compliance officers/admins
- **Urgent alerts** — claims, cancellations, low-confidence actions
- **Accuracy trend alerts** — declining accuracy over 3 consecutive days
- **Auto-execute notifications** — with undo link for 24h window
- **Configurable** — on/off per notification type, digest delivery time

#### Config
- **Email connection** — forwarding address, Gmail/Outlook OAuth, IMAP
- **Test email** — verify agent is receiving emails
- **Execution mode** — suggestion / auto-execute with confidence threshold
- **Notification preferences** — digest on/off + time, urgent on/off
- **Insurer domains** — pre-built top 20 Irish insurers + custom
- **Attachment processing** — on/off toggle

### Data Import

- **CSV upload** with drag-and-drop
- **Auto-detect** Applied Epic TAM, Acturis, or generic CSV formats
- **Interactive mapping UI** for unknown formats
- **3-tier dedup**: exact hash → normalized number → Jaro-Winkler fuzzy match
- **Row-level validation** with error reports
- **Import history** tracking

### Renewal Dashboard

- **Status distribution** chart
- **40-day countdown bar** per renewal (CP158 compliance)
- **Activity feed** with relative timestamps
- **Compliance score** by quarter
- **Filter** by status, policy type, insurer, adviser

### Compliance Checklist Engine

- **8 CPC items** per renewal (renewal notification, suitability, market comparison, premium disclosure, commission disclosure, client communication, policy terms, final sign-off)
- **State machine**: pending → in_progress → completed → pending_review → approved/rejected
- **Sign-off workflow**: adviser completes, compliance officer reviews
- **Evidence upload**: PDF, PNG, JPEG files

### Document Generator

- **CPC Renewal Notification Letter** (HTML → PDF via Puppeteer)
- **Suitability Assessment Form**
- **Commission Disclosure** document
- **CBI Inspection Evidence Pack** (ZIP of all renewal docs + audit trail)
- **Async generation** via background worker

### Authentication & Authorization

- **JWT sessions** (httpOnly cookie, 8-hour expiry)
- **Token revocation** blocklist (Redis-backed with in-memory fallback)
- **4 roles**: firm_admin, compliance_officer, adviser, read_only
- **CSRF** double-submit cookie protection
- **Rate limiting** on all endpoints
- **Password reset** flow with SHA-256 hashed tokens

### Audit Trail

- **15+ event types** (agent.email_received, agent.action_confirmed, agent.action_reversed, policy.imported, checklist.item.approved, etc.)
- **Append-only** (RLS blocks UPDATE/DELETE)
- **CSV export** for CBI inspection
- **6-year retention** (CPC requirement)

### GDPR Compliance

- **Two-layer anonymization**: Layer 1 (compliance records retained 6yr) + Layer 2 (client PII erasable)
- **Art 17(3)(b)** exemption logged in audit trail
- **Data export** (JSON, Art 20 portability)
- **Data erasure** (anonymize PII, retain compliance records)
- **Retention purge** (automated 6-year cleanup)

### Background Worker

- **BullMQ + Redis** job queue (with in-memory fallback)
- **Job types**: email processing, metrics aggregation, reminders, document generation
- **Retry**: 3 attempts with exponential backoff
- **Daily metrics** aggregation at 00:05 UTC
- **60-second** mailbox polling interval
- **Stale email** detection and re-queueing (5min timeout)

## API Endpoints (Agent)

| Method   | Path                                  | Description                    | Auth                    |
| -------- | ------------------------------------- | ------------------------------ | ----------------------- |
| POST     | /api/agent/ingest                     | Webhook email ingestion        | HMAC-SHA256             |
| GET      | /api/agent/config                     | Agent configuration            | firm_admin              |
| PUT      | /api/agent/config                     | Update configuration           | firm_admin              |
| GET      | /api/agent/config/forwarding-address  | Get/generate forwarding addr   | firm_admin              |
| GET      | /api/agent/config/insurer-domains     | Get insurer domain list        | firm_admin              |
| PUT      | /api/agent/config/insurer-domains     | Update insurer domains         | firm_admin              |
| POST     | /api/agent/config/test-email          | Check for received test email  | firm_admin              |
| GET      | /api/agent/actions                    | List actions (filtered, paged) | agent:view_own/view_all |
| GET      | /api/agent/actions/pending            | Pending actions queue          | agent:view_own          |
| GET      | /api/agent/actions/:id                | Action detail + thread         | agent:view_own          |
| PUT      | /api/agent/actions/:id/confirm        | Confirm action                 | agent:confirm_action    |
| PUT      | /api/agent/actions/:id/modify         | Modify + confirm               | agent:modify_action     |
| PUT      | /api/agent/actions/:id/reject         | Reject with reason             | agent:reject_action     |
| PUT      | /api/agent/actions/:id/reverse        | Undo (24h window)              | agent:reverse_action    |
| POST     | /api/agent/actions/bulk-confirm        | Bulk confirm (max 50)          | agent:bulk_confirm      |
| GET      | /api/agent/actions/export              | CSV export                     | agent:view_own          |
| GET      | /api/agent/emails                      | List emails                    | agent:view_own          |
| GET      | /api/agent/emails/:id                  | Email detail                   | agent:view_own          |
| GET      | /api/agent/emails/export               | CSV export                     | agent:view_own          |
| GET      | /api/agent/events                      | SSE real-time events           | Yes                     |
| GET      | /api/agent/metrics                     | Performance metrics            | agent:view_own          |
| GET      | /api/agent/learning                    | Learning insights              | agent:view_own          |
| GET      | /api/agent/health                      | Agent health check             | Yes                     |
| GET      | /api/agent/oauth/gmail/authorize       | Gmail OAuth start              | firm_admin              |
| GET      | /api/agent/oauth/gmail/callback         | Gmail OAuth callback           | No (OAuth redirect)     |
| GET      | /api/agent/oauth/outlook/authorize      | Outlook OAuth start            | firm_admin              |
| GET      | /api/agent/oauth/outlook/callback        | Outlook OAuth callback         | No (OAuth redirect)     |
| POST     | /api/agent/oauth/imap/connect            | IMAP connection                | firm_admin              |
| DELETE   | /api/agent/oauth/disconnect              | Disconnect email               | firm_admin              |
| POST     | /api/agent/oauth/imap/disconnect         | Disconnect IMAP                | firm_admin              |

## Environment Variables

```env
# Database
DATABASE_URL="postgresql://postgres:localdev@localhost:5432/broker_compliance"

# Auth
NEXTAUTH_SECRET="<random-32-byte-hex>"    # Required — no fallback, throws if missing
NEXTAUTH_URL="http://localhost:3000"

# Worker
WORKER_SECRET="<random-string>"            # For /api/worker endpoint auth

# Redis (for BullMQ email processing queue)
REDIS_URL="redis://localhost:6379"

# Email (optional for dev)
RESEND_API_KEY="re_..."

# Webhook (for email ingestion)
WEBHOOK_SECRET="<random-string>"           # HMAC-SHA256 signature verification

# LLM
OPENAI_API_KEY="sk-..."                    # GPT-4o-mini for classification + extraction

# OAuth (for Gmail/Outlook connection)
GMAIL_OAUTH_CLIENT_ID="..."
GMAIL_OAUTH_CLIENT_SECRET="..."
OUTLOOK_OAUTH_CLIENT_ID="..."
OUTLOOK_OAUTH_CLIENT_SECRET="..."

# File storage (optional, defaults to local filesystem)
R2_ACCESS_KEY_ID="..."
R2_SECRET_ACCESS_KEY="..."
R2_BUCKET_NAME="..."
R2_ENDPOINT="..."
```

## Database Migrations

```bash
# Apply pending migrations (dev)
npx prisma migrate dev

# Apply pending migrations (production)
npx prisma migrate deploy

# Create a new migration after editing schema.prisma
npx prisma migrate dev --name describe_your_change

# Regenerate Prisma Client
npx prisma generate

# Check migration status
npx prisma migrate status
```

## Security

| Layer         | Measure                                                                    |
| ------------- | -------------------------------------------------------------------------- |
| Auth          | JWT with token revocation blocklist (Redis + in-memory fallback)           |
| CSRF          | Double-submit cookie pattern (csrf_token cookie + X-CSRF-Token header)     |
| Rate limit    | Per-endpoint rate limits (registration, login, actions, config, ingest)     |
| File access   | Segment-based firmId validation, path traversal protection                 |
| Multi-tenant  | PostgreSQL RLS via AsyncLocalStorage (per-request firm context)            |
| Input         | Zod validation on all API endpoints                                        |
| XSS           | `esc()` on all user content in notification email HTML templates            |
| CSV injection | Formula trigger chars prefixed with single quote                            |
| PII           | Desensitization before LLM (Eircode, PPS, names, addresses, phones, etc.) |
| Webhook       | HMAC-SHA256 signature verification with timing-safe comparison             |
| Password      | bcrypt hashing, SHA-256 reset tokens                                       |
| Cookies       | httpOnly, sameSite: strict, secure (production)                            |

## Testing

```bash
# Run all tests
npm test                    # 518 tests, 55 files, ~6s

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage
```

| Test file                     | Tests | Coverage area                         |
| ----------------------------- | ----- | ------------------------------------- |
| pipeline-pii-leakage.test.ts  | 7     | PII desensitization (Eircode/PPS/etc) |
| agent-classifier.test.ts      | 7     | Email classification                  |
| agent-action-generator.test.ts| 4     | Action generation logic               |
| agent-actions-api.test.ts     | 30+   | Action CRUD + confirm/modify/reject   |
| agent-rbac.test.ts            | 6     | Agent permission matrix               |
| agent-metrics-learning.test.ts| 2     | Learning insights + metrics           |
| action-reverse.test.ts        | 20+   | Reverse/reversal logic                |
| email-threading.test.ts       | 3     | Thread ID resolution                  |
| pipeline-resume.test.ts       | 2     | Pipeline checkpoint resume            |
| reset-token-store.test.ts     | 7     | Password reset token hashing          |
| regressions.test.ts           | 12    | Regression prevention                 |
| checklist-state.test.ts       | 23    | State machine transitions             |
| dedup.test.ts                 | 26    | Hash normalization, fuzzy match       |
| csv-parser.test.ts            | 27    | BMS format detection                  |
| gdpr.test.ts                  | 8     | Data export, erasure                  |
| ...                           | ...   | ...                                   |

## Compliance

- **CPC 2012:** 20-day written renewal notice requirement
- **CP158:** 40-day pre-renewal + renewal notice (configurable per renewal)
- **IAF:** Conduct Standards evidence, F&P certification, attestations (Phase 2)
- **GDPR:** PII desensitization before LLM, two-layer anonymization, Art 17(3)(b) exemption, 6-year retention
- **Audit trail:** Append-only, CBI inspection export, 6-year retention

## Project Status

| Area                  | Status                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------- |
| AI Agent Engine       | ✅ Complete (classification, extraction, matching, pipeline, learning)                    |
| Email Ingestion       | ✅ Complete (webhook, Gmail OAuth, Outlook OAuth, IMAP, threading, dedup)                 |
| Agent Dashboard       | ✅ Complete (pending actions, metrics, charts, onboarding, action detail)                  |
| Agent Config          | ✅ Complete (execution mode, notifications, test email, insurer domains)                   |
| Data Import           | ✅ Complete (CSV/Applied Epic/Acturis + mapping + fuzzy dedup)                             |
| Renewal Dashboard     | ✅ Complete (charts, activity feed, countdown, compliance score)                           |
| Checklist Engine      | ✅ Complete (8 items, sign-off, evidence, state machine)                                   |
| Document Generator    | ✅ Complete (renewal letter, suitability, commission, inspection pack)                     |
| Audit Trail           | ✅ Complete (15+ events, paginated, CSV export, PII redaction)                             |
| Auth & RBAC           | ✅ Complete (JWT, 4 roles, CSRF, Redis rate limit, password reset, session revocation)    |
| GDPR                  | ✅ Complete (export, erasure, retention purge, Art 17(3)(b))                               |
| Background Worker     | ✅ Complete (BullMQ, retry, catch-up, metrics aggregation)                                 |
| Unit Tests            | ✅ 518 tests, 55 test files                                                               |
| Security Audit        | ✅ Complete (XSS, path traversal, TOCTOU, race conditions, PII leak fixes)                 |

## Design Documents

Full design documentation in `docs/`:

- `PRD-AI-AGENT-v2.md` — Product Requirements (AI Agent)
- `ADR-AI-AGENT.md` — Architecture Decision Records
- `ENG-DESIGN-AI-AGENT-v2.md` — Engineering Design
- `PHASE-2-PLAN.md` — Phase 2 Development Plan
- `DEVELOPMENT-PLAN-AI-AGENT.md` — Development Plan
- `email-setup.md` — Email connection setup guide
