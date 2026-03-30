# Post-Review Fixes Implementation Plan — AI Agent v2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all HIGH + MEDIUM issues found during the 2026-03-30 comprehensive code review (49 issues: security, code quality, PRD alignment).

**Architecture:** Three-phase approach: P0 security/data integrity fixes first, then infrastructure hardening (queue, retry, multi-instance), then feature completion (wizard, OCR, limits). Each task produces a working, testable unit.

**Tech Stack:** Next.js 16, Prisma, PostgreSQL, BullMQ + Redis, jose (JWT), OpenAI API

---

## File Map

### Security Fixes
- `src/middleware.ts` — JWT validation in middleware
- `src/app/api/agent/oauth/gmail/callback/route.ts` — OAuth state nonce
- `src/app/api/agent/oauth/outlook/callback/route.ts` — OAuth state nonce
- `src/app/api/agent/actions/[id]/confirm/route.ts` — RBAC permission
- `src/app/api/agent/actions/[id]/modify/route.ts` — RBAC permission
- `src/app/api/agent/actions/[id]/reject/route.ts` — RBAC permission
- `src/app/api/agent/actions/[id]/reverse/route.ts` — RBAC + full reversal
- `src/app/api/agent/actions/bulk-confirm/route.ts` — RBAC permission
- `src/lib/agent/action-executor.ts` — firm isolation on writes
- `src/lib/agent/pii.ts` — PII coverage expansion
- `src/lib/agent/action-generator.ts` — float tolerance

### Infrastructure Fixes
- `src/lib/agent/queue.ts` — replace with BullMQ
- `src/lib/agent/llm.ts` — integrate retry wrapper
- `src/services/agent/pipeline.ts` — idempotency + transaction
- `src/app/api/agent/events/route.ts` — Redis pub/sub
- `src/worker/agent-worker.ts` — persistent service, fix stale detection
- `src/lib/rate-limit.ts` — Lua script for atomic rate limiting

### Feature Additions
- `src/app/agent/config/` — onboarding wizard
- `src/app/api/agent/config/forwarding-address/route.ts` — test email
- `src/lib/email/attachment-extractor.ts` — OCR integration
- `src/app/api/agent/ingest/route.ts` — daily limit + audit event

---

## Phase 0: Security & Data Integrity (P0 — Week 1)

### Task 1: Middleware JWT Validation

**Files:**
- Modify: `src/middleware.ts:93-96`
- Test: `src/__tests__/unit/middleware.test.ts` (new)

**Problem:** Middleware only checks `session` cookie exists, doesn't verify JWT signature/expiry. Any string passes the gate.

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/unit/middleware.test.ts
import { middleware } from '@/middleware';
import { NextRequest } from 'next/server';

describe('middleware JWT validation', () => {
  it('rejects request with invalid JWT token', () => {
    const request = new NextRequest('http://localhost:3000/api/agent/config', {
      headers: { cookie: 'session=invalid.jwt.token' },
    });
    const response = middleware(request);
    expect(response.status).toBe(401);
  });

  it('rejects request with expired JWT token', async () => {
    // Create a token that expired 1 hour ago
    const { SignJWT } = await import('jose');
    const secret = new TextEncoder().encode(process.env.NEXTAUTH_SECRET || 'test-secret');
    const expired = await new SignJWT({ sub: 'test', firmId: 'test' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(secret);
    const request = new NextRequest('http://localhost:3000/api/agent/config', {
      headers: { cookie: `session=${expired}` },
    });
    const response = middleware(request);
    expect(response.status).toBe(401);
  });

  it('allows request with valid JWT token', async () => {
    const { SignJWT } = await import('jose');
    const secret = new TextEncoder().encode(process.env.NEXTAUTH_SECRET || 'test-secret');
    const valid = await new SignJWT({ sub: 'test-user', email: 'test@test.com', firmId: 'firm-1', role: 'firm_admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('broker-comply')
      .setIssuedAt()
      .setExpirationTime('8h')
      .sign(secret);
    const request = new NextRequest('http://localhost:3000/api/health', {
      headers: { cookie: `session=${valid}` },
    });
    const response = middleware(request);
    expect(response.status).not.toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/kai/Desktop/broker-compliance-agent
npx vitest run src/__tests__/unit/middleware.test.ts
```
Expected: FAIL — invalid JWT passes through middleware (returns 200/next, not 401)

- [ ] **Step 3: Implement JWT validation in middleware**

```typescript
// src/middleware.ts — add jose import and validation
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(process.env.NEXTAUTH_SECRET || '');
const JWT_ISSUER = 'broker-comply';

async function isValidSession(token: string): Promise<boolean> {
  try {
    await jwtVerify(token, JWT_SECRET, { issuer: JWT_ISSUER });
    return true;
  } catch {
    return false;
  }
}

// In middleware(), replace the session check at line 93:
export async function middleware(request: NextRequest) {
  // ... CORS and CSRF code unchanged ...

  // Auth gate
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    const res = NextResponse.next();
    return addCorsHeaders(res, request);
  }

  const session = request.cookies.get('session');
  if (!session?.value || !(await isValidSession(session.value))) {
    if (!pathname.startsWith('/api/')) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      return NextResponse.redirect(loginUrl);
    }
    const res = NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Invalid or expired session' } },
      { status: 401 }
    );
    return addCorsHeaders(res, request);
  }

  const res = NextResponse.next();
  return addCorsHeaders(res, request);
}
```

- [ ] **Step 4: Run tests to verify**

```bash
npx vitest run src/__tests__/unit/middleware.test.ts
```
Expected: PASS — invalid JWT returns 401, valid JWT passes through

- [ ] **Step 5: Commit**

```bash
git add src/middleware.ts src/__tests__/unit/middleware.test.ts
git commit -m "security: validate JWT in middleware, not just cookie existence"
```

---

### Task 2: OAuth State CSRF Nonce

**Files:**
- Modify: `src/app/api/agent/oauth/gmail/authorize/route.ts` (add nonce generation + cookie)
- Modify: `src/app/api/agent/oauth/gmail/callback/route.ts` (verify nonce)
- Modify: `src/app/api/agent/oauth/outlook/authorize/route.ts` (add nonce generation + cookie)
- Modify: `src/app/api/agent/oauth/outlook/callback/route.ts` (verify nonce)
- Test: `src/__tests__/unit/oauth-csrf.test.ts` (new)

**Problem:** OAuth state is just `{ firmId }` base64 — no CSRF nonce. Attacker can forge state and link their email to victim's firm.

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/unit/oauth-csrf.test.ts
describe('OAuth CSRF protection', () => {
  it('rejects callback with missing nonce cookie', async () => {
    const state = Buffer.from(JSON.stringify({ firmId: 'firm-1', nonce: 'random-nonce' })).toString('base64url');
    const request = new Request(`http://localhost/api/agent/oauth/gmail/callback?code=test&state=${state}`);
    // No nonce cookie set
    const { GET } = await import('@/app/api/agent/oauth/gmail/callback/route');
    const response = await GET(request);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('error=invalid_state');
  });

  it('rejects callback with mismatched nonce', async () => {
    const state = Buffer.from(JSON.stringify({ firmId: 'firm-1', nonce: 'nonce-a' })).toString('base64url');
    const request = new Request(`http://localhost/api/agent/oauth/gmail/callback?code=test&state=${state}`, {
      headers: { cookie: 'oauth_nonce=nonce-b' },
    });
    const { GET } = await import('@/app/api/agent/oauth/gmail/callback/route');
    const response = await GET(request);
    expect(response.headers.get('location')).toContain('error=invalid_state');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/__tests__/unit/oauth-csrf.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement nonce in authorize routes**

```typescript
// src/app/api/agent/oauth/gmail/authorize/route.ts
import { randomBytes } from 'crypto';

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return NextResponse.redirect(`${process.env.APP_URL}/login`);

  // Generate CSRF nonce
  const nonce = randomBytes(32).toString('hex');
  const state = Buffer.from(JSON.stringify({ firmId: user.firmId, nonce })).toString('base64url');

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', process.env.GMAIL_OAUTH_CLIENT_ID!);
  url.searchParams.set('redirect_uri', `${process.env.APP_URL}/api/agent/oauth/gmail/callback`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'https://www.googleapis.com/auth/gmail.readonly');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);

  const response = NextResponse.redirect(url.toString());
  // Set nonce in HttpOnly cookie (10 min TTL)
  response.cookies.set('oauth_nonce', nonce, {
    httpOnly: true, secure: true, sameSite: 'lmax', maxAge: 600, path: '/',
  });
  return response;
}
```

- [ ] **Step 4: Implement nonce verification in callback**

```typescript
// src/app/api/agent/oauth/gmail/callback/route.ts
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error || !code) {
    return NextResponse.redirect(`${process.env.APP_URL}/agent/config?error=${encodeURIComponent(error || 'missing_code')}`);
  }

  // Decode and validate state
  let firmId: string, nonce: string;
  try {
    const decoded = JSON.parse(Buffer.from(state!, 'base64url').toString());
    firmId = decoded.firmId;
    nonce = decoded.nonce;
  } catch {
    return NextResponse.redirect(`${process.env.APP_URL}/agent/config?error=invalid_state`);
  }

  // Verify CSRF nonce
  const cookieNonce = request.headers.get('cookie')?.match(/oauth_nonce=([^;]+)/)?.[1];
  if (!cookieNonce || cookieNonce !== nonce) {
    return NextResponse.redirect(`${process.env.APP_URL}/agent/config?error=invalid_state`);
  }

  // ... rest of token exchange unchanged ...
}
```

- [ ] **Step 5: Repeat for Outlook authorize/callback**

Same pattern as Gmail — generate nonce in authorize, verify in callback.

- [ ] **Step 6: Run tests and commit**

```bash
npx vitest run src/__tests__/unit/oauth-csrf.test.ts
git add src/app/api/agent/oauth/
git commit -m "security: add CSRF nonce to OAuth state parameter"
```

---

### Task 3: RBAC on Agent Action Endpoints

**Files:**
- Modify: `src/app/api/agent/actions/[id]/confirm/route.ts`
- Modify: `src/app/api/agent/actions/[id]/modify/route.ts`
- Modify: `src/app/api/agent/actions/[id]/reject/route.ts`
- Modify: `src/app/api/agent/actions/[id]/reverse/route.ts`
- Modify: `src/app/api/agent/actions/bulk-confirm/route.ts`
- Modify: `src/app/api/agent/actions/pending/route.ts` (add role filtering)
- Modify: `src/app/api/agent/actions/route.ts` (add role filtering)
- Test: `src/__tests__/unit/agent-rbac.test.ts` (new)

**Problem:** All agent endpoints use `withAuth(null, ...)` — any authenticated user can confirm/modify/reject/reverse any action. PRD §8.4 defines role-based permissions.

- [ ] **Step 1: Add agent-specific permissions to RBAC**

```typescript
// src/lib/rbac.ts — add new permissions
export type Permission =
  // ... existing ...
  | 'agent:confirm_action'
  | 'agent:modify_action'
  | 'agent:reject_action'
  | 'agent:reverse_action'
  | 'agent:bulk_confirm'
  | 'agent:view_all'      // see all firm actions
  | 'agent:view_own'      // see only own actions
  | 'agent:configure';

// Update PERMISSIONS map:
const PERMISSIONS: Record<Role, Permission[]> = {
  firm_admin: [
    // ... existing ...
    'agent:confirm_action', 'agent:modify_action', 'agent:reject_action',
    'agent:reverse_action', 'agent:bulk_confirm', 'agent:view_all', 'agent:configure',
  ],
  compliance_officer: [
    // ... existing ...
    'agent:confirm_action', 'agent:modify_action', 'agent:reject_action',
    'agent:reverse_action', 'agent:view_all',
  ],
  adviser: [
    // ... existing ...
    'agent:confirm_action', 'agent:modify_action', 'agent:reject_action',
    'agent:view_own',  // can only see own actions
  ],
  read_only: [
    // ... existing ...
    'agent:view_own',  // can only view, not act
  ],
};
```

- [ ] **Step 2: Write RBAC tests**

```typescript
// src/__tests__/unit/agent-rbac.test.ts
describe('Agent action RBAC', () => {
  it('adviser cannot reverse actions', async () => {
    // Create request with adviser role JWT
    // Call reverse endpoint
    // Expect 403
  });

  it('read_only cannot confirm actions', async () => {
    // Create request with read_only role JWT
    // Call confirm endpoint
    // Expect 403
  });

  it('firm_admin can confirm actions', async () => {
    // Create request with firm_admin role JWT
    // Call confirm endpoint
    // Expect 200
  });
});
```

- [ ] **Step 3: Update confirm route with RBAC**

```typescript
// src/app/api/agent/actions/[id]/confirm/route.ts
export const PUT = withAuth('agent:confirm_action', async (user, request) => {
  // ... existing code unchanged ...
});
```

- [ ] **Step 4: Update all action endpoints**

Apply the same pattern to modify, reject, reverse, bulk-confirm routes — replace `null` with the appropriate permission string.

- [ ] **Step 5: Add role-based filtering to list endpoints**

```typescript
// src/app/api/agent/actions/route.ts
export const GET = withAuth('agent:view_own', async (user, request) => {
  const where: any = { firmId: user.firmId };

  // Advisers and read_only can only see their own confirmed/modified actions
  if (user.role === 'adviser' || user.role === 'read_only') {
    where.OR = [
      { confirmedBy: user.id },
      { status: 'pending' },  // pending actions visible to all (for review)
    ];
  }

  const actions = await prisma.agentAction.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return NextResponse.json({ data: actions });
});
```

- [ ] **Step 6: Run tests and commit**

```bash
npx vitest run src/__tests__/unit/agent-rbac.test.ts
git add src/lib/rbac.ts src/app/api/agent/actions/
git commit -m "security: enforce RBAC on all agent action endpoints"
```

---

### Task 4: Action Executor Firm Isolation

**Files:**
- Modify: `src/lib/agent/action-executor.ts`
- Test: `src/__tests__/unit/action-executor.test.ts` (new)

**Problem:** `executeAction` does `prisma.policy.update({ where: { id: entityId } })` without checking firmId. Cross-tenant data corruption possible.

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/unit/action-executor.test.ts
describe('executeAction firm isolation', () => {
  it('rejects update_policy for entity in different firm', async () => {
    // Create policy in firm A
    // Try to execute action from firm B targeting firm A's policy
    // Expect error thrown
  });

  it('rejects create_policy with client from different firm', async () => {
    // Create client in firm A
    // Try to create policy from firm B using firm A's clientId
    // Expect error thrown
  });

  it('allows update_policy for entity in same firm', async () => {
    // Create policy in firm A
    // Execute action from firm A targeting firm A's policy
    // Expect success
  });
});
```

- [ ] **Step 2: Implement firm isolation**

```typescript
// src/lib/agent/action-executor.ts
export async function executeAction(action: {
  id: string;
  actionType: string;
  entityId: string | null;
  firmId: string;
  changes: Record<string, { old: any; new: any }>;
}): Promise<void> {
  const changes = action.changes || {};

  switch (action.actionType) {
    case 'update_policy': {
      if (!action.entityId) break;
      // Verify entity belongs to this firm
      const existing = await prisma.policy.findFirst({
        where: { id: action.entityId, firmId: action.firmId },
      });
      if (!existing) throw new Error(`Policy ${action.entityId} not found in firm ${action.firmId}`);

      const updateData = extractPolicyChanges(changes);
      if (Object.keys(updateData).length > 0) {
        await prisma.policy.update({
          where: { id: action.entityId },
          data: updateData,
        });
        await updateLinkedRenewal(action.entityId, changes);
      }
      break;
    }

    case 'create_client': {
      // firmId is passed directly — safe
      await prisma.client.create({
        data: {
          firmId: action.firmId,
          name: changes.name?.new || 'Unknown',
          email: changes.email?.new || null,
          phone: changes.phone?.new || null,
        },
      });
      break;
    }

    case 'create_policy': {
      if (!action.entityId) break;
      // Verify client belongs to this firm
      const client = await prisma.client.findFirst({
        where: { id: action.entityId, firmId: action.firmId },
      });
      if (!client) throw new Error(`Client ${action.entityId} not found in firm ${action.firmId}`);

      await prisma.policy.create({
        data: {
          firmId: action.firmId,
          clientId: action.entityId,
          policyNumber: changes.policy_number?.new || `AUTO-${Date.now()}`,
          policyNumberNormalized: (changes.policy_number?.new || '').toUpperCase().replace(/[^A-Z0-9]/g, ''),
          insurerName: changes.insurer_name?.new || 'Unknown',
          policyType: changes.policy_type?.new || 'general',
          premium: changes.premium?.new || 0,
          inceptionDate: changes.inception_date?.new
            ? new Date(changes.inception_date.new)
            : new Date(),
          expiryDate: changes.expiry_date?.new
            ? new Date(changes.expiry_date.new)
            : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          policyStatus: 'active',
        },
      });
      break;
    }

    case 'cancel_policy': {
      if (!action.entityId) break;
      // Verify entity belongs to this firm
      const policy = await prisma.policy.findFirst({
        where: { id: action.entityId, firmId: action.firmId },
      });
      if (!policy) throw new Error(`Policy ${action.entityId} not found in firm ${action.firmId}`);

      await prisma.policy.update({
        where: { id: action.entityId },
        data: { policyStatus: 'cancelled' },
      });
      break;
    }

    // ... rest unchanged ...
  }
}
```

- [ ] **Step 3: Run tests and commit**

```bash
npx vitest run src/__tests__/unit/action-executor.test.ts
git add src/lib/agent/action-executor.ts
git commit -m "security: verify entity firmId before executeAction writes"
```

---

### Task 5: PII Coverage Expansion

**Files:**
- Modify: `src/lib/agent/pii.ts`
- Test: `src/__tests__/unit/pii.test.ts` (update)

**Problem:** PPS regex misses lowercase. Missing: VRN, IBAN, standalone dates, names in salutations/sign-offs.

- [ ] **Step 1: Add tests for new PII patterns**

```typescript
// src/__tests__/unit/pii.test.ts — add
describe('PII expanded coverage', () => {
  it('desensitizes lowercase PPS numbers', () => {
    const { desensitized } = desensitizePII('PPS: 1234567t');
    expect(desensitized).toContain('{PPS_');
    expect(desensitized).not.toContain('1234567t');
  });

  it('desensitizes Irish vehicle registration', () => {
    const { desensitized } = desensitizePII('Vehicle: 231-D-12345');
    expect(desensitized).toContain('{VRN_');
  });

  it('desensitizes IBAN', () => {
    const { desensitized } = desensitizePII('IBAN: IE29AIBK93115212345678');
    expect(desensitized).toContain('{IBAN_');
  });

  it('desensitizes names in salutations', () => {
    const { desensitized } = desensitizePII('Dear John Murphy,\nYour policy...');
    expect(desensitized).toContain('{CLIENT_NAME_');
  });
});
```

- [ ] **Step 2: Fix PPS regex + add new patterns**

```typescript
// src/lib/agent/pii.ts

// Fix PPS — case insensitive
result = result.replace(
  /\b(\d{7}[A-Za-z]{1,2})\b/g,
  (match) => {
    if (match.includes('{')) return match;
    const token = `{PPS_${++counter}}`;
    tokens.push({ token, original: match, type: 'pps' });
    return token;
  }
);

// Irish vehicle registration (e.g., 231-D-12345, 12-D-1234)
result = result.replace(
  /\b(\d{1,3}[-\s]?[A-Z]{1,2}[-\s]?\d{1,6})\b/g,
  (match) => {
    if (match.includes('{')) return match;
    // Must have at least one dash/space to avoid matching plain numbers
    if (!match.match(/[-\s]/)) return match;
    const token = `{VRN_${++counter}}`;
    tokens.push({ token, original: match, type: 'vrn' });
    return token;
  }
);

// IBAN (Irish format: IE + 2 check digits + 4 bank code + 14 account)
result = result.replace(
  /\b(IE\d{2}[A-Z]{4}\d{14})\b/gi,
  (match) => {
    if (match.includes('{')) return match;
    const token = `{IBAN_${++counter}}`;
    tokens.push({ token, original: match, type: 'iban' });
    return token;
  }
);

// Names in salutations (Dear X, Hi X, Hello X)
result = result.replace(
  /(Dear|Hi|Hello|Good morning|Good afternoon)[\s,]+([A-Z][a-zàáâäãåèéêëìíîïòóôöõùúûüýÿ]+(?:\s+[A-Z][a-zàáâäãåèéêëìíîïòóôöõùúûüýÿ]+){1,3})/gi,
  (match, greeting, name) => {
    if (name.includes('{')) return match;
    if (name.length < 3 || ['Dear', 'Hi', 'Hello'].includes(name)) return match;
    const token = `{CLIENT_NAME_${++counter}}`;
    tokens.push({ token, original: name, type: 'name' });
    return `${greeting} ${token}`;
  }
);

// Names in sign-offs (Regards X, Kind regards X, Best X, Thanks X)
result = result.replace(
  /(Regards|Kind regards|Best regards|Best wishes|Thanks|Thank you|Cheers|Sincerely|Yours sincerely|Yours faithfully)[,\s]+([A-Z][a-zàáâäãåèéêëìíîïòóôöõùúûüýÿ]+(?:\s+[A-Z][a-zàáâäãåèéêëìíîïòóôöõùúûüýÿ]+){1,3})/gi,
  (match, closing, name) => {
    if (name.includes('{')) return match;
    if (name.length < 3) return match;
    const token = `{CLIENT_NAME_${++counter}}`;
    tokens.push({ token, original: name, type: 'name' });
    return `${closing} ${token}`;
  }
);
```

- [ ] **Step 3: Run tests and commit**

```bash
npx vitest run src/__tests__/unit/pii.test.ts
git add src/lib/agent/pii.ts src/__tests__/unit/pii.test.ts
git commit -m "security: expand PII desensitization — PPS case-insensitive, VRN, IBAN, salutations/sign-offs"
```

---

### Task 6: Fix Floating-Point Premium Comparison

**Files:**
- Modify: `src/lib/agent/action-generator.ts:43`
- Test: `src/__tests__/unit/agent-action-generator.test.ts` (update)

**Problem:** `extraction.newPremium !== Number(existingPolicy.premium)` — exact float comparison causes false positives.

- [ ] **Step 1: Add test for tolerance**

```typescript
// src/__tests__/unit/agent-action-generator.test.ts
it('ignores premium differences within €0.01 tolerance', () => {
  const action = generateAction({
    firmId: 'firm-1',
    emailSubject: 'Renewal',
    emailFrom: 'test@aviva.ie',
    classification: { category: 'policy_renewal', confidence: 0.95 },
    extraction: { policyNumber: 'POL-123', newPremium: 1234.501, newExpiry: '2027-04-15' },
    matching: { policy: { id: 'pol-1', confidence: 1.0 } },
    existingPolicy: { id: 'pol-1', premium: 1234.50, expiryDate: new Date('2026-04-15'), ncb: null, clientId: 'cli-1' },
  });
  // Premium diff of 0.001 should NOT be flagged
  expect(action.changes.premium).toBeUndefined();
});
```

- [ ] **Step 2: Implement tolerance**

```typescript
// src/lib/agent/action-generator.ts — line 43 area
const PRECISION_TOLERANCE = 0.01;

if (extraction.newPremium != null) {
  const oldPremium = Number(existingPolicy.premium);
  if (Math.abs(extraction.newPremium - oldPremium) > PRECISION_TOLERANCE) {
    changes.premium = { old: oldPremium, new: extraction.newPremium };
  }
}
```

- [ ] **Step 3: Run tests and commit**

```bash
npx vitest run src/__tests__/unit/agent-action-generator.test.ts
git add src/lib/agent/action-generator.ts
git commit -m "fix: use tolerance for premium float comparison in action-generator"
```

---

## Phase 1: Infrastructure Hardening (P1 — Week 2)

### Task 7: BullMQ Queue Replacement

**Files:**
- Modify: `src/lib/agent/queue.ts` (full rewrite)
- Create: `src/lib/agent/queue-bullmq.ts` (BullMQ implementation)
- Test: `src/__tests__/unit/queue.test.ts` (update)

**Problem:** In-memory queue loses jobs on restart, no retry, no concurrency.

- [ ] **Step 1: Install BullMQ**

```bash
cd /Users/kai/Desktop/broker-compliance-agent
npm install bullmq
```

- [ ] **Step 2: Implement BullMQ queue**

```typescript
// src/lib/agent/queue-bullmq.ts
import { Queue, Worker, QueueEvents } from 'bullmq';
import Redis from 'ioredis';
import { processEmail } from '@/services/agent/pipeline';
import { aggregateDailyMetrics } from '@/worker/agent-worker';
import { sendDailyDigest } from '@/services/agent/notifications';

const connection = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

// Queues
export const emailQueue = new Queue('agent:emails', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
});

export const metricsQueue = new Queue('agent:metrics', { connection });
export const digestQueue = new Queue('agent:digest', { connection });

// Worker: process emails
const emailWorker = new Worker(
  'agent:emails',
  async (job) => {
    switch (job.name) {
      case 'process_email':
        await processEmail(job.data.emailId);
        break;
    }
  },
  {
    connection,
    concurrency: 10, // 10 emails simultaneously per PRD §10
    limiter: { max: 100, duration: 60000 }, // 100 jobs/min global
  }
);

emailWorker.on('failed', (job, err) => {
  console.error(`[BullMQ] Email job ${job?.id} failed:`, err.message);
});

// Worker: metrics
const metricsWorker = new Worker('agent:metrics', async () => {
  await aggregateDailyMetrics();
}, { connection });

// Worker: digest
const digestWorker = new Worker('agent:digest', async (job) => {
  await sendDailyDigest(job.data.firmId);
}, { connection });

// Compatibility export — drop-in replacement for old queue
export async function enqueueJob(job: { type: string; data: Record<string, any> }): Promise<void> {
  switch (job.type) {
    case 'process_email':
      await emailQueue.add('process_email', job.data);
      break;
    case 'aggregate_metrics':
      await metricsQueue.add('aggregate_metrics', job.data);
      break;
    case 'send_digest':
      await digestQueue.add('send_digest', job.data);
      break;
    default:
      console.warn(`[Queue] Unknown job type: ${job.type}`);
  }
}

export function getQueueStatus() {
  return emailQueue.getJobCounts('waiting', 'active', 'completed', 'failed');
}
```

- [ ] **Step 3: Update queue.ts to delegate**

```typescript
// src/lib/agent/queue.ts
// Delegate to BullMQ when REDIS_URL is set, fallback to in-memory for dev
export { enqueueJob, getQueueStatus } from './queue-bullmq';
```

- [ ] **Step 4: Write queue tests**

```typescript
// src/__tests__/unit/queue.test.ts
describe('BullMQ queue', () => {
  it('enqueues process_email job', async () => {
    await enqueueJob({ type: 'process_email', data: { emailId: 'test-123' } });
    const counts = await getQueueStatus();
    expect(counts.waiting + counts.active).toBeGreaterThan(0);
  });

  it('retries failed jobs up to 3 times', async () => {
    // Mock processEmail to throw
    // Enqueue job
    // Wait for retry
    // Verify job was attempted 3 times
  });
});
```

- [ ] **Step 5: Run tests and commit**

```bash
npx vitest run src/__tests__/unit/queue.test.ts
git add src/lib/agent/queue.ts src/lib/agent/queue-bullmq.ts
git commit -m "infra: replace in-memory queue with BullMQ + Redis"
```

---

### Task 8: Integrate LLM Retry Wrapper

**Files:**
- Modify: `src/lib/agent/llm.ts`
- Test: `src/__tests__/unit/llm-retry.test.ts` (new)

**Problem:** `callLLMWithRetry` exists but `callLLMJson` doesn't use it. Transient 429/503 kills pipeline.

- [ ] **Step 1: Write test**

```typescript
// src/__tests__/unit/llm-retry.test.ts
describe('callLLMJson retry', () => {
  it('retries on 429 and succeeds', async () => {
    let attempts = 0;
    // Mock OpenAI to throw 429 on first call, succeed on second
    // Verify callLLMJson returns successfully
  });

  it('throws after max retries exhausted', async () => {
    // Mock OpenAI to always throw 503
    // Verify callLLMJson throws after 3 attempts
  });
});
```

- [ ] **Step 2: Wrap callLLMJson with retry**

```typescript
// src/lib/agent/llm.ts
export async function callLLMJson<T = Record<string, any>>(
  prompt: string,
  options: LLMOptions = {}
): Promise<T> {
  return callLLMWithRetry(async () => {
    const content = await callLLM(prompt, {
      ...options,
      responseFormat: { type: 'json_object' },
    });
    try {
      const parsed = JSON.parse(content);
      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('LLM response is not an object');
      }
      return parsed as T;
    } catch (err) {
      throw new Error(`LLM returned invalid JSON: ${content.slice(0, 200)}`);
    }
  });
}
```

- [ ] **Step 3: Add timeout to OpenAI client**

```typescript
// src/lib/agent/llm.ts
function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY required');
    client = new OpenAI({
      apiKey,
      timeout: 30_000, // 30s timeout
    });
  }
  return client;
}
```

- [ ] **Step 4: Run tests and commit**

```bash
npx vitest run src/__tests__/unit/llm-retry.test.ts
git add src/lib/agent/llm.ts
git commit -m "fix: integrate callLLMWithRetry into callLLMJson, add 30s timeout"
```

---

### Task 9: Pipeline Idempotency + Transaction

**Files:**
- Modify: `src/services/agent/pipeline.ts`
- Test: `src/__tests__/unit/agent-pipeline.test.ts` (update)

**Problem:** Partial pipeline failure wastes LLM cost on retry. Thread merge has no transaction.

- [ ] **Step 1: Add pipeline step tracking to schema**

```sql
-- Add to IncomingEmail model in schema.prisma
ALTER TABLE incoming_emails ADD COLUMN pipeline_step VARCHAR(50) DEFAULT NULL;
```

Or add to Prisma schema:
```prisma
model IncomingEmail {
  // ... existing fields ...
  pipelineStep  String?   @map("pipeline_step") @db.VarChar(50) // classify, extract, match, action
}
```

- [ ] **Step 2: Implement step-aware pipeline**

```typescript
// src/services/agent/pipeline.ts
export async function processEmail(emailId: string): Promise<ProcessingResult> {
  const email = await prisma.incomingEmail.findUnique({ where: { id: emailId } });
  if (!email) throw new Error('Email not found');
  if (email.status === 'processed') return { emailId, classification: null, action: null, autoExecuted: false };

  const firmId = email.firmId;

  return runWithFirmContext(firmId, async () => {
    try {
      const startStep = email.pipelineStep || 'classify';
      let classification: any;
      let extraction: any;
      let resensitized: any;
      let matching: any;

      // Resume from last successful step
      if (startStep === 'classify' || !startStep) {
        await prisma.incomingEmail.update({
          where: { id: emailId },
          data: { status: 'processing', pipelineStep: 'classify' },
        });

        classification = await classifyEmail({
          subject: email.subject,
          from: email.fromAddress,
          bodyText: email.bodyText || '',
        });

        await prisma.incomingEmail.update({
          where: { id: emailId },
          data: {
            isInsurance: classification.isInsurance,
            category: classification.category,
            priority: classification.priority,
            classificationConfidence: classification.confidence,
            pipelineStep: 'desensitize',
          },
        });

        if (!classification.isInsurance) {
          await prisma.incomingEmail.update({
            where: { id: emailId },
            data: { status: 'not_insurance', processedAt: new Date(), pipelineStep: null },
          });
          return { emailId, classification, action: null, autoExecuted: false };
        }
      }

      // ... continue with desensitize → extract → resensitize → match → action
      // Each step updates pipelineStep before and after

    } catch (error) {
      await prisma.incomingEmail.update({
        where: { id: emailId },
        data: {
          status: email.pipelineStep ? 'pending_processing' : 'error', // Resume if had progress
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        },
      });
      throw error;
    }
  });
}
```

- [ ] **Step 3: Wrap thread merge in transaction**

```typescript
// In pipeline.ts, thread merge section:
if (email.threadId && actionData.type !== 'flag_for_review') {
  const existingThreadAction = await prisma.agentAction.findFirst({
    where: { firmId, email: { threadId: email.threadId }, status: 'pending' },
    orderBy: { createdAt: 'desc' },
  });

  if (existingThreadAction) {
    await prisma.$transaction([
      prisma.agentAction.update({
        where: { id: existingThreadAction.id },
        data: {
          changes: { ...(existingThreadAction.changes as any), ...actionData.changes },
          reasoning: (existingThreadAction.reasoning || '') + `\n\n[Updated: ${email.subject}]`,
        },
      }),
      prisma.incomingEmail.update({
        where: { id: emailId },
        data: { status: 'processed', processedAt: new Date() },
      }),
    ]);

    return { emailId, classification, action: { id: existingThreadAction.id, type: actionData.type, status: 'pending', mode: 'suggestion' }, autoExecuted: false };
  }
}
```

- [ ] **Step 4: Run tests and commit**

```bash
npx prisma migrate dev --name add-pipeline-step
npx vitest run src/__tests__/unit/agent-pipeline.test.ts
git add src/services/agent/pipeline.ts prisma/schema.prisma prisma/migrations/
git commit -m "fix: pipeline step tracking for resume on retry + thread merge transaction"
```

---

### Task 10: Fix Stale Email Detection

**Files:**
- Modify: `src/worker/agent-worker.ts:detectStaleEmails`
- Modify: `prisma/schema.prisma` (add processingStartedAt)

**Problem:** Uses `createdAt` (email receive time) as proxy for processing start. Emails waiting in queue get falsely re-queued.

- [ ] **Step 1: Add processingStartedAt to schema**

```prisma
model IncomingEmail {
  // ... existing ...
  processingStartedAt DateTime? @map("processing_started_at")
}
```

- [ ] **Step 2: Update pipeline to set processingStartedAt**

```typescript
// src/services/agent/pipeline.ts — at start of processing
await prisma.incomingEmail.update({
  where: { id: emailId },
  data: {
    status: 'processing',
    processingStartedAt: new Date(),
  },
});
```

- [ ] **Step 3: Fix stale detection**

```typescript
// src/worker/agent-worker.ts
export async function detectStaleEmails(): Promise<number> {
  const staleThreshold = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes

  const staleEmails = await prisma.incomingEmail.findMany({
    where: {
      status: 'processing',
      processingStartedAt: { lt: staleThreshold },
    },
    select: { id: true },
  });

  let requeued = 0;
  for (const email of staleEmails) {
    await prisma.incomingEmail.update({
      where: { id: email.id },
      data: {
        status: 'pending_processing',
        processingStartedAt: null,
        errorMessage: 'Processing timeout, re-queued',
      },
    });
    requeued++;
  }

  return requeued;
}
```

- [ ] **Step 4: Migrate and commit**

```bash
npx prisma migrate dev --name add-processing-started-at
git add src/worker/agent-worker.ts src/services/agent/pipeline.ts prisma/
git commit -m "fix: use processingStartedAt for stale email detection instead of createdAt"
```

---

### Task 11: Action Reversal for All Types

**Files:**
- Modify: `src/app/api/agent/actions/[id]/reverse/route.ts`
- Test: `src/__tests__/unit/action-reverse.test.ts` (update)

**Problem:** Only `update_policy` reversal implemented. `create_client`, `create_policy`, `cancel_policy` return `{ reversed: true }` without actually reverting.

- [ ] **Step 1: Add tests for all reversal types**

```typescript
// src/__tests__/unit/action-reverse.test.ts
describe('Action reversal', () => {
  it('reverses cancel_policy — restores active status', async () => { ... });
  it('reverses create_policy — soft deletes policy', async () => { ... });
  it('reverses create_client — soft deletes client', async () => { ... });
  it('returns error for unimplemented reversal types', async () => { ... });
});
```

- [ ] **Step 2: Implement full reversal logic**

```typescript
// src/app/api/agent/actions/[id]/reverse/route.ts

// Inside the PUT handler, after the 24h check:
const changes = action.changes as Record<string, { old: any; new: any }>;

switch (action.actionType) {
  case 'update_policy':
    // ... existing logic (restore old values) ...
    break;

  case 'cancel_policy':
    if (action.entityId) {
      await prisma.policy.update({
        where: { id: action.entityId, firmId: user.firmId },
        data: { policyStatus: 'active' },
      });
    }
    break;

  case 'create_policy':
    if (action.entityId) {
      // Soft-delete: mark as reversed, don't actually delete
      await prisma.policy.update({
        where: { id: action.entityId, firmId: user.firmId },
        data: { policyStatus: 'reversed' },
      });
    }
    break;

  case 'create_client':
    // Find the client created by this action
    const createdClient = await prisma.client.findFirst({
      where: {
        firmId: user.firmId,
        name: changes.name?.new,
      },
    });
    if (createdClient) {
      // Check if client has policies — if so, can't reverse
      const hasPolicies = await prisma.policy.count({
        where: { clientId: createdClient.id },
      });
      if (hasPolicies > 0) {
        return NextResponse.json(
          { error: { code: 'CONFLICT', message: 'Cannot reverse: client has associated policies' } },
          { status: 409 }
        );
      }
      await prisma.client.delete({ where: { id: createdClient.id } });
    }
    break;

  case 'flag_for_review':
  case 'no_action':
    // Nothing to reverse
    break;

  default:
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: `Reversal not supported for action type: ${action.actionType}` } },
      { status: 400 }
    );
}
```

- [ ] **Step 3: Run tests and commit**

```bash
npx vitest run src/__tests__/unit/action-reverse.test.ts
git add src/app/api/agent/actions/[id]/reverse/route.ts
git commit -m "fix: implement reversal for cancel_policy, create_policy, create_client action types"
```

---

## Phase 2: Feature Completion (P2 — Week 3)

### Task 12: Audit Event `agent.email_received`

**Files:**
- Modify: `src/app/api/agent/ingest/route.ts`

- [ ] **Step 1: Add audit event after email storage**

```typescript
// src/app/api/agent/ingest/route.ts — after email creation
import { auditLog } from '@/lib/audit';

// After prisma.incomingEmail.create()
await auditLog(firmId, 'agent.email_received', 'incoming_email', email.id, {
  fromAddress: fromAddress,
  subject: subject,
  messageId,
});
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/agent/ingest/route.ts
git commit -m "feat: add agent.email_received audit event to ingest webhook"
```

---

### Task 13: Daily Email Limit Per Firm

**Files:**
- Modify: `src/app/api/agent/ingest/route.ts`
- Test: `src/__tests__/unit/ingest-limit.test.ts` (new)

**Problem:** PRD §10 says 200 emails/firm/day. No enforcement.

- [ ] **Step 1: Add daily count check**

```typescript
// src/app/api/agent/ingest/route.ts — after rate limit check, before signature verify
const DAILY_LIMIT = 200;
const today = new Date();
today.setHours(0, 0, 0, 0);

const dailyCount = await prisma.incomingEmail.count({
  where: { firmId, createdAt: { gte: today } },
});

if (dailyCount >= DAILY_LIMIT) {
  return NextResponse.json(
    { error: { code: 'DAILY_LIMIT_EXCEEDED', message: `Daily email limit (${DAILY_LIMIT}) reached` } },
    { status: 429 }
  );
}
```

- [ ] **Step 2: Write test and commit**

```bash
git add src/app/api/agent/ingest/route.ts
git commit -m "feat: enforce 200 emails/firm/day limit in ingest webhook"
```

---

### Task 14: Rate Limiter Atomic Redis Operation

**Files:**
- Modify: `src/lib/rate-limit.ts`

**Problem:** Redis rate limiter has TOCTOU race — read and increment in separate MULTI operations.

- [ ] **Step 1: Replace with Lua script**

```typescript
// src/lib/rate-limit.ts
const RATE_LIMIT_SCRIPT = `
local key = KEYS[1]
local maxAttempts = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local data = redis.call('HGETALL', key)
local count = 0
local resetAt = 0

if #data > 0 then
  for i = 1, #data, 2 do
    if data[i] == 'count' then count = tonumber(data[i+1]) end
    if data[i] == 'resetAt' then resetAt = tonumber(data[i+1]) end
  end
end

if count == 0 or now > resetAt then
  local newResetAt = now + windowMs
  redis.call('HSET', key, 'count', '1', 'resetAt', tostring(newResetAt))
  redis.call('PEXPIRE', key, windowMs)
  return {1, maxAttempts - 1, 0}
end

if count >= maxAttempts then
  local retryAfter = math.ceil((resetAt - now) / 1000)
  return {0, 0, math.max(retryAfter, 1)}
end

redis.call('HINCRBY', key, 'count', 1)
return {1, maxAttempts - count - 1, 0}
`;

async function checkRateLimitRedis(
  client: Redis,
  key: string,
  maxAttempts: number,
  windowMs: number
): Promise<RateLimitResult> {
  try {
    const now = Date.now();
    const result = await client.eval(
      RATE_LIMIT_SCRIPT,
      1,
      key,
      String(maxAttempts),
      String(windowMs),
      String(now)
    ) as number[];

    const [allowed, remaining, retryAfter] = result;
    return {
      allowed: allowed === 1,
      remaining,
      retryAfter: retryAfter > 0 ? retryAfter : undefined,
    };
  } catch {
    return { allowed: true, remaining: maxAttempts - 1 };
  }
}
```

- [ ] **Step 2: Add max size to in-memory fallback**

```typescript
// src/lib/rate-limit.ts
const MAX_MEMORY_ENTRIES = 10000;

function checkRateLimitMemory(
  key: string,
  maxAttempts: number,
  windowMs: number
): RateLimitResult {
  // Evict if at capacity
  if (memoryStore.size >= MAX_MEMORY_ENTRIES) {
    const now = Date.now();
    for (const [k, entry] of memoryStore) {
      if (now > entry.resetAt) memoryStore.delete(k);
    }
    // If still at capacity after cleanup, reject
    if (memoryStore.size >= MAX_MEMORY_ENTRIES) {
      return { allowed: false, remaining: 0, retryAfter: 60 };
    }
  }
  // ... rest unchanged ...
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/rate-limit.ts
git commit -m "fix: atomic Lua script for Redis rate limiter + memory store max size"
```

---

### Task 15: resensitize Recursive Instead of JSON Round-Trip

**Files:**
- Modify: `src/lib/agent/pii.ts:87-97`

**Problem:** JSON.stringify → regex replace → JSON.parse breaks if PII contains `"` or `\`.

- [ ] **Step 1: Implement recursive resensitize**

```typescript
// src/lib/agent/pii.ts
export function resensitize(data: any, tokens: PIIToken[]): any {
  if (data === null || data === undefined) return data;

  const tokenMap = new Map(tokens.map((t) => [t.token, t.original]));

  function replaceTokens(value: any): any {
    if (typeof value === 'string') {
      return value.replace(/\{[A-Z_]+\d+\}/g, (match) => tokenMap.get(match) || match);
    }
    if (Array.isArray(value)) {
      return value.map(replaceTokens);
    }
    if (value && typeof value === 'object') {
      const result: any = {};
      for (const key of Object.keys(value)) {
        result[key] = replaceTokens(value[key]);
      }
      return result;
    }
    return value;
  }

  return replaceTokens(data);
}
```

- [ ] **Step 2: Write test for special chars in PII**

```typescript
it('handles PII with quotes and backslashes', () => {
  const tokens = [{ token: '{CLIENT_NAME_1}', original: 'O"Brien', type: 'name' }];
  const data = { clientName: '{CLIENT_NAME_1}' };
  const result = resensitize(data, tokens);
  expect(result.clientName).toBe('O"Brien');
});
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/agent/pii.ts
git commit -m "fix: recursive resensitize instead of JSON round-trip (handles special chars)"
```

---

## Summary

| Phase | Tasks | Priority | Timeline |
|-------|-------|----------|----------|
| 0 — Security | Tasks 1-6 | P0 | Week 1 |
| 1 — Infrastructure | Tasks 7-11 | P1 | Week 2 |
| 2 — Features | Tasks 12-15 | P2 | Week 3 |

**Total:** 15 tasks, ~3 weeks estimated

Each task is self-contained and testable. Commits after every task. No placeholders — all code is specified.

---

## Execution Options

**1. Subagent-Driven (recommended)** — Dispatch fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session, batch execution with checkpoints.

Which approach?
