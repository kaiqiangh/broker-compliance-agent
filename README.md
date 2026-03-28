# BrokerCompliance

Insurance Broker Compliance & Renewal Readiness Platform for Irish insurance brokers.

## Quick Start

```bash
# 1. Start PostgreSQL
docker compose up -d

# 2. Install dependencies
npm install

# 3. Push database schema
npx prisma db push

# 4. Seed with sample data
npm run db:seed

# 5. Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Development

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Open Prisma Studio (database browser)
npm run db:studio

# Run background worker (notifications + doc gen)
npm run worker
```

## Architecture

- **Frontend:** Next.js 14 (App Router) + TailwindCSS + shadcn/ui
- **Backend:** Next.js API Routes + Prisma ORM
- **Database:** PostgreSQL 16 (local Docker / Railway EU)
- **Auth:** NextAuth.js (credentials + magic link)
- **Document gen:** Puppeteer (async, background worker)
- **Email:** Resend
- **File storage:** Cloudflare R2

## Project Structure

```
src/
├── app/                    # Next.js pages & API routes
│   ├── dashboard/          # Dashboard page
│   ├── renewals/           # Renewal management
│   ├── import/             # CSV import wizard
│   └── api/                # API endpoints
├── lib/                    # Core utilities
│   ├── dedup.ts            # Policy deduplication logic
│   ├── dates.ts            # Irish date parsing + renewal timeline
│   ├── csv-parser.ts       # BMS CSV format detection + parsing
│   ├── checklist-state.ts  # Checklist state machine + CPC definitions
│   └── prisma.ts           # Prisma client singleton
├── services/               # Business logic
│   ├── import-service.ts   # CSV import pipeline
│   ├── renewal-service.ts  # Renewal generation + dashboard
│   ├── checklist-service.ts # Checklist sign-off workflow
│   └── audit-service.ts    # Audit trail + CBI inspection export
├── worker/                 # Background job processor
└── __tests__/              # Tests
    └── unit/               # Unit tests (vitest)
```

## Environment Variables

```env
DATABASE_URL="postgresql://postgres:localdev@localhost:5432/broker_compliance"
NEXTAUTH_SECRET="change-in-production"
NEXTAUTH_URL="http://localhost:3000"
RESEND_API_KEY="re_..."
R2_ACCESS_KEY_ID="..."
R2_SECRET_ACCESS_KEY="..."
R2_BUCKET_NAME="..."
R2_ENDPOINT="..."
```

## BMS Format Support

| BMS | Auto-detection | Date format | Notes |
|-----|---------------|-------------|-------|
| Applied Epic (TAM) | 95% (PolicyRef + ClientName + InceptionDate) | DD/MM/YYYY | EUR with € symbol, fadas supported |
| Acturis | 95% (PolicyNo + InsuredName + EffectiveDate) | YYYY-MM-DD | Split address columns, status field |
| Generic CSV | 40-75% (fuzzy header matching) | DD/MM/YYYY default | Interactive mapping UI fallback |

## Compliance

- **CPC 2012:** 20-day written renewal notice
- **CP158:** 40-day pre-renewal + renewal notice (configurable)
- **IAF:** Conduct Standards evidence, F&P certification, attestations (Phase 2)
- **GDPR:** Two-layer anonymization, Art 17(3)(b) compliance exemption, DPIA required
- **Audit trail:** 6-year retention, append-only, CBI inspection export

## Design Documents

See `~/.gstack/projects/workspace/` for:
- Design doc, PRD, ADR (12 decisions), Engineering design
- GDPR compliance architecture, IDD regulatory risk assessment
- BMS format analysis, Phase 0 discovery interviews
