# Architecture

## System Overview

```
┌──────────────┐     HTTPS      ┌───────────────────┐      SQL       ┌────────────┐
│   Browser    │ ──────────────▶│  Next.js (API)    │ ─────────────▶ │ PostgreSQL │
│  (9 pages)   │                │  28 API routes    │               │    (RLS)   │
└──────────────┘                │  8 services       │               └────────────┘
                                │  JWT auth         │
                                │  CSRF + CORS      │                    ▲
                                └────────┬──────────┘                    │
                                         │                               │
                                         │ 30s poll                      │
                                ┌────────▼──────────┐               ┌────┴───────┐
                                │  Worker           │               │  Local FS  │
                                │  - Reminders      │               │  (uploads) │
                                │  - Doc gen (PDF)  │               └────────────┘
                                │  - GDPR purge     │
                                └───────────────────┘
                                         │
                                         ▼
                                ┌───────────────────┐
                                │  Resend API       │
                                │  (email delivery) │
                                └───────────────────┘
```

## Data Flow

```
CSV Upload ──▶ Parse ──▶ Detect Format ──▶ Map Fields ──▶ Validate ──▶ Preview
                                                                         │
                                                                         ▼
                                                                     Confirm
                                                                         │
                                                                         ▼
                                                              Import to Database
                                                              (clients + policies)
                                                                         │
                                                                         ▼
                                                              Generate Renewals
                                                              (for expiring policies)
                                                                         │
                                                                         ▼
                                                              Materialize Checklist
                                                              (8 items per renewal)
                                                                         │
                                                   ┌─────────────────────┤
                                                   ▼                     ▼
                                          Complete Items          Auto-populate
                                          (adviser uploads        (premium_disclosure
                                           evidence)              auto-completed)
                                                   │
                                                   ▼
                                          Sign-off Review
                                          (CO approves/rejects)
                                                   │
                                                   ▼
                                          Generate Documents
                                          (HTML → PDF via Puppeteer)
                                                   │
                                                   ▼
                                          CBI Inspection Pack
                                          (ZIP of all docs + audit trail)
```

## Authentication Flow

```
Browser                    API Route                  Database
  │                           │                          │
  │ POST /api/auth/login      │                          │
  │ { email, password }       │                          │
  │──────────────────────────▶│                          │
  │                           │ SELECT user WHERE email  │
  │                           │─────────────────────────▶│
  │                           │◀──────── user record ────│
  │                           │                          │
  │                           │ bcrypt.compare()         │
  │                           │                          │
  │                           │ jwt.sign({ userId,       │
  │                           │   firmId, role })        │
  │                           │                          │
  │◀── Set-Cookie: session    │                          │
  │     csrf_token            │                          │
  │                           │                          │
  │ GET /api/renewals         │                          │
  │ Cookie: session=...       │                          │
  │ X-CSRF-Token: ...         │                          │
  │──────────────────────────▶│                          │
  │                           │ withAuth() middleware:   │
  │                           │  1. Verify JWT           │
  │                           │  2. Check blocklist      │
  │                           │  3. Check CSRF           │
  │                           │  4. Check permissions    │
  │                           │  5. runWithFirmContext()  │
  │                           │                          │
  │                           │ Prisma query (RLS):      │
  │                           │  firm_id = context       │
  │                           │─────────────────────────▶│
  │◀──────────────────────────│◀───────── results ──────│
```

## Multi-Tenancy (RLS Isolation)

```
┌──────────────────────────────────────────────────┐
│                 Request A (firm-A)                │
│  AsyncLocalStorage: firmId = "firm-A"            │
│                                                  │
│  Prisma middleware reads firmContext.getStore()   │
│  ──▶ All queries scoped to firm-A                │
│  ──▶ PostgreSQL RLS: firm_id = 'firm-A'          │
└──────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────┐
│                 Request B (firm-B)                │
│  AsyncLocalStorage: firmId = "firm-B"            │
│                                                  │
│  Prisma middleware reads firmContext.getStore()   │
│  ──▶ All queries scoped to firm-B                │
│  ──▶ PostgreSQL RLS: firm_id = 'firm-B'          │
└──────────────────────────────────────────────────┘

Key: Each request gets its OWN AsyncLocalStorage context.
No shared mutable state. No race conditions.
```

## Worker Job Queue

```
┌──────────────────────────────────────────────────────────┐
│                    Worker Process                         │
│                                                          │
│  Loop (every 30s):                                       │
│    1. SELECT FROM scheduled_jobs                         │
│       WHERE status = 'pending'                           │
│       AND scheduled_for <= now()                         │
│       FOR UPDATE SKIP LOCKED                             │
│       LIMIT 5                                            │
│                                                          │
│    2. For each job:                                      │
│       - SET status = 'processing', attempts++            │
│       - Execute job (check_reminders / generate_doc /    │
│         gdpr_erasure)                                    │
│       - On success: SET status = 'completed'             │
│       - On failure: SET status = 'pending',              │
│         scheduled_for = now() + backoff                  │
│         (5min * 2^attempts, max 3 retries)               │
│                                                          │
│  Startup catch-up:                                       │
│    - Scan for reminders that should have fired           │
│    - Create missed notification jobs                     │
└──────────────────────────────────────────────────────────┘

Job types:
  check_reminders  →  scan renewals, schedule email notifications
  generate_document →  HTML template → Puppeteer PDF → save to storage
  gdpr_erasure     →  anonymize client PII, log audit event
```

## Document Generation Pipeline

```
User clicks "Generate Document"
         │
         ▼
  POST /api/documents
  { renewalId, documentType }
         │
         ▼
  DocumentService.generate()
  ├─ Select HTML template (renewal_notification / suitability / commission)
  ├─ Fetch policy + client + checklist data
  ├─ Render Handlebars template with data
  ├─ escapeHtml() all user content
  └─ Create document record (status: 'completed', html stored)
         │
         ▼
  For PDF (async via worker):
  ├─ Worker picks up generate_document job
  ├─ htmlToPdf(html) via Puppeteer
  ├─ Write PDF to local storage
  └─ Update document record (fileUrl: '/api/files/...')
         │
         ▼
  For Inspection Pack (batch):
  ├─ POST /api/documents { type: 'inspection_pack', filters }
  ├─ Fetch all renewals matching filters
  ├─ Generate PDF for each renewal (renewal notification + suitability)
  ├─ Create ZIP archive with all PDFs + audit trail CSV
  └─ Return ZIP to user
```

## Security Architecture

```
┌─────────────────────────────────────────────┐
│              Browser                         │
│  Cookie: session (httpOnly, sameSite:strict) │
│  Cookie: csrf_token (readable by JS)         │
│  Header: X-CSRF-Token (from csrf_token)      │
└─────────────────────┬───────────────────────┘
                      │
┌─────────────────────▼───────────────────────┐
│           Next.js Middleware                 │
│  1. Skip auth for /api/auth/login|register   │
│  2. Verify JWT (check blocklist)             │
│  3. Validate CSRF (double-submit cookie)     │
│  4. Check role permissions for route         │
│  5. Set CORS headers                         │
└─────────────────────┬───────────────────────┘
                      │
┌─────────────────────▼───────────────────────┐
│           API Route Handler                  │
│  1. withAuth() → runWithFirmContext()        │
│  2. Zod input validation                     │
│  3. Business logic (service layer)           │
│  4. Prisma query (RLS enforced by PG)        │
│  5. Audit event log                          │
│  6. Response (data + meta or error)          │
└─────────────────────────────────────────────┘
```

## Database Schema (Key Tables)

```
firms ──┬── users (4 roles: firm_admin, compliance_officer, adviser, read_only)
        │
        ├── clients ── policies ── renewals ── checklist_items (8 per renewal)
        │                    │                    │
        │                    │                    ├── documents
        │                    │                    └── audit_events
        │                    │
        │                    └── imports
        │
        ├── audit_events (append-only, 6-year retention)
        ├── notifications (idempotent: UNIQUE renewal_id + reminder_type)
        ├── scheduled_jobs (DB-backed job queue)
        └── documents (generated PDFs)
```

Every table has `firm_id` column. PostgreSQL RLS policies enforce:
- `firm_id = current_setting('app.current_firm_id')::UUID`
- Audit events: no UPDATE, no DELETE (append-only)
