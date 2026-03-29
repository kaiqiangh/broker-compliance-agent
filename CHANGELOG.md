# Changelog

All notable changes to the Broker Compliance platform.

## [Unreleased]

## [0.1.0] - 2026-03-29

### Round 32 (2026-03-29)
- Password reset flow: forgot-password + reset-password pages + API routes with email token (15-min TTL)
- Invite email via Resend: sendInviteEmail() template, API no longer returns temp password
- Clients list page: searchable table, click-to-detail, policy count
- Clients detail page: client info + linked policies list
- Settings real data: /api/auth/me + /api/users endpoints, removed mock data
- Policies + Renewals adviser view_own filtering (advisers see only their assigned data)
- Nav updated with Clients link

### Round 31 (2026-03-29)
- Dashboard pie chart (pure CSS conic-gradient donut chart)
- Activity feed (last 10 audit events with relative timestamps)
- 40-day countdown bar per renewal (CP158 color-coded progress)
- Quarterly compliance score
- Interactive CSV mapping UI (column-to-field dropdowns)
- Jaro-Winkler fuzzy match dedup (Tier 3, >85% similarity threshold)
- Three-tier dedup: exact hash → normalized → fuzzy → needs_review
- Evidence file upload UI on checklist items
- Commission disclosure document template
- Worker document generation (actual Puppeteer PDF, not placeholder)
- Inspection pack filtering (dateFrom, dateTo, policyType, adviserId)
- premium_disclosure auto-complete on renewal creation

### Round 30 (2026-03-29)
- CSRF double-submit cookie protection
- CORS explicit headers configuration
- Registration rate limiting (3 attempts/min/IP)
- Login per-account rate limiting (10 attempts/10min/email)
- IP spoofing mitigation (x-real-ip priority over x-forwarded-for)
- Password max length 128 (bcrypt DoS prevention)
- Checklist input length limits (notes 5000, reason 2000)
- CSV formula injection: extended to `|` and `!` trigger chars
- File upload magic bytes validation (PDF/PNG/JPEG/GIF)
- Path traversal protection (path.basename + reject `..`)
- RLS production enforcement (throw instead of warn)
- Worker double-reminder dedup fix
- Production logging cleanup (PII redacted)

### Round 29 (2026-03-29)
- JWT secret enforcement: removed hardcoded fallback, throws if NEXTAUTH_SECRET missing
- JWT token revocation blocklist (invalidated on password change)
- Worker auth timing-safe comparison (crypto.timingSafeEqual)
- Import confirm body size limit (413 if oversized)
- File serving security (Content-Disposition: attachment, nosniff, filename encoding)
- AsyncLocalStorage replaces global currentFirmId (per-request RLS isolation)
- Worker firm context auto-cleanup via runWithFirmContext
- Dynamic params await (Next.js 14 compatibility)
- Checklist API route created (/api/checklist/[id] complete/approve/reject)
- Checklist state machine: pending → completed transition fixed
- CSV parse: replaced naive split(',') with csv-parse/sync
- DocumentService: throws on unknown documentType

### Round 28 (2026-03-28)
- Renewals list pagination + search
- Nav link active highlighting
- Clickable renewal rows
- UX polish across all pages

### Round 27 (2026-03-28)
- GDPR retention purge (6-year automated cleanup)
- evidenceUrl redaction in audit events
- All audit trail gaps closed

### Round 26 (2026-03-28)
- Checklist race condition fix (optimistic locking)
- GDPR erasure redaction improvements
- CP158 timeline support
- Import mapping backend

### Round 25 (2026-03-28)
- Second security audit: 10 additional fixes
- XSS hardening on all HTML outputs
- Error message sanitization

### Round 24 (2026-03-28)
- CBI Inspection Pack (ZIP generator)
- CSV Mapping API endpoints
- Integration test suite

### Round 23 (2026-03-28)
- PostgreSQL RLS migration (Row-Level Security)
- Settings page (initial)
- Worker job processing loop

### Round 22 (2026-03-28)
- Clients detail API
- Policies detail API

### Round 21 (2026-03-28)
- PDF generation with Puppeteer (ADR-006 aligned)
- HTML template system

### Round 20 (2026-03-28)
- JWT sessions replace in-memory store (ADR-007 aligned)
- Cookie-based session management

### Round 19 (2026-03-28)
- Authenticated file serving
- Suitability assessment template
- PII redaction in audit logs
- Firm isolation middleware

### Round 18 (2026-03-28)
- Security hardening from full audit
- Bug fixes across all services

### Round 17 (2026-03-28)
- Clean Next.js build
- force-dynamic on all API routes

### Round 16 (2026-03-28)
- Security headers
- .gitignore hardening

### Round 15 (2026-03-28)
- Notification date logic fix
- Error format standardization

### Round 14 (2026-03-28)
- Critical fix: import pipeline now actually persists data
- Import confirm flow wired correctly

### Round 13 (2026-03-28)
- Final TODO eliminated
- Commission rate field added

### Round 12 (2026-03-28)
- All TypeScript errors fixed (0 tsc errors)

### Round 11 (2026-03-28)
- Frontend review: 5 bugs + UX improvements

### Round 10 (2026-03-28)
- 3 bugs fixed from code review

### Round 9 (2026-03-28)
- All 7 remaining features implemented (TDD approach)

### Round 8 (2026-03-28)
- Final cleanup, 3 bugs fixed

### Round 7 (2026-03-28)
- Import wizard UI
- Checklist UI page
- Notification service
- Missing API endpoints

### Round 6 (2026-03-28)
- API wiring + security fixes
- Missing route handlers

### Round 5 (2026-03-28)
- Auth system + RBAC (4 roles, 9 permissions)
- Protected API routes
- Login + register pages

### Round 4 (2026-03-28)
- Deep code review: 5 bugs + 2 security issues fixed

### Round 3 (2026-03-28)
- Code review fixes

### Round 2 (2026-03-28)
- Initial scaffold + core services + tests

### Round 1 (2026-03-28)
- Project initialization
- Next.js + Prisma + PostgreSQL setup
- Docker Compose configuration
