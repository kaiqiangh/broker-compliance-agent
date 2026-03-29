import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSession, withAuth } from '../../lib/auth';

// ─── Mock prisma (for getSession's sessionsRevokedAt lookup) ──
vi.mock('../../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn().mockResolvedValue({ sessionsRevokedAt: null }),
    },
  },
  runWithFirmContext: vi.fn((_firmId: string, fn: () => unknown) => fn()),
}));

// ─── Helpers ──────────────────────────────────────────────────

const mockUser = {
  id: 'user-1',
  email: 'admin@example.ie',
  name: 'Admin User',
  role: 'firm_admin' as const,
  firmId: 'firm-1',
};

const adviserUser = {
  id: 'user-2',
  email: 'adviser@example.ie',
  name: 'Adviser User',
  role: 'adviser' as const,
  firmId: 'firm-1',
};

function buildRequest(cookie?: string): Request {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  return new Request('http://localhost/api/test', { headers });
}

async function handler(_user: unknown, _req: Request): Promise<Response> {
  return Response.json({ ok: true }, { status: 200 });
}

// ─── Tests ────────────────────────────────────────────────────

describe('withAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. No session cookie → 401
  it('returns 401 when no session cookie is present', async () => {
    const route = withAuth(null, handler);
    const res = await route(buildRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  // 2. Invalid/expired token → 401
  it('returns 401 for an invalid token', async () => {
    const route = withAuth(null, handler);
    const res = await route(buildRequest('session=not.a.valid.jwt'));
    expect(res.status).toBe(401);
  });

  // 3. Valid token, no permission → 403
  it('returns 403 when user lacks required permission', async () => {
    const token = await createSession(adviserUser);
    const route = withAuth('admin', handler);
    const res = await route(buildRequest(`session=${token}`));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
  });

  // 4. Valid token, has permission → calls handler
  it('calls handler when user has required permission', async () => {
    const token = await createSession(mockUser);
    const route = withAuth('admin', handler);
    const res = await route(buildRequest(`session=${token}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  // 5. Null permission → skips permission check
  it('skips permission check when permission is null', async () => {
    const token = await createSession(adviserUser);
    const route = withAuth(null, handler);
    const res = await route(buildRequest(`session=${token}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  // 6. Handler throws UnauthorizedError → 401
  it('returns 401 when handler throws UnauthorizedError', async () => {
    const { UnauthorizedError } = await import('../../lib/rbac');
    const throwingHandler = vi.fn(() => {
      throw new UnauthorizedError('Token revoked');
    });
    const token = await createSession(mockUser);
    const route = withAuth(null, throwingHandler);
    const res = await route(buildRequest(`session=${token}`));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  // 7. Handler throws ForbiddenError → 403
  it('returns 403 when handler throws ForbiddenError', async () => {
    const { ForbiddenError } = await import('../../lib/rbac');
    const throwingHandler = vi.fn(() => {
      throw new ForbiddenError('Not allowed');
    });
    const token = await createSession(mockUser);
    const route = withAuth(null, throwingHandler);
    const res = await route(buildRequest(`session=${token}`));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
  });

  // 8. Handler throws generic Error → 500, no details leaked
  it('returns 500 for generic error without leaking details', async () => {
    const throwingHandler = vi.fn(() => {
      throw new Error('SELECT * FROM passwords — secret data');
    });
    const token = await createSession(mockUser);
    const route = withAuth(null, throwingHandler);
    const res = await route(buildRequest(`session=${token}`));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('INTERNAL');
    expect(body.error.message).toBe('Internal server error');
    // Ensure no secret data leaked
    const text = JSON.stringify(body);
    expect(text).not.toContain('passwords');
    expect(text).not.toContain('secret data');
  });
});
