import { describe, it, expect, vi, beforeAll } from 'vitest';

// Set env before modules load
beforeAll(() => {
  process.env.APP_URL = 'http://localhost:3000';
});

// Mock prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    emailIngressConfig: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

// Mock crypto
vi.mock('@/lib/email/oauth/crypto', () => ({
  encryptToken: (t: string) => `enc:${t}`,
}));

describe('OAuth CSRF protection', () => {
  it('rejects gmail callback with missing nonce cookie', async () => {
    const state = Buffer.from(JSON.stringify({ firmId: 'firm-1', nonce: 'random-nonce-123' })).toString('base64url');
    const url = new URL(`http://localhost/api/agent/oauth/gmail/callback?code=test-code&state=${state}`);
    const request = new Request(url.toString());
    // No oauth_nonce cookie in request

    const { GET } = await import('@/app/api/agent/oauth/gmail/callback/route');
    const response = await GET(request);

    // Should redirect with error
    expect(response.status).toBe(307);
    const location = response.headers.get('location');
    expect(location).toContain('error=invalid_state');
  });

  it('rejects gmail callback with mismatched nonce', async () => {
    const state = Buffer.from(JSON.stringify({ firmId: 'firm-1', nonce: 'nonce-a' })).toString('base64url');
    const url = new URL(`http://localhost/api/agent/oauth/gmail/callback?code=test-code&state=${state}`);
    const request = new Request(url.toString(), {
      headers: { cookie: 'oauth_nonce=nonce-b' },
    });

    const { GET } = await import('@/app/api/agent/oauth/gmail/callback/route');
    const response = await GET(request);

    expect(response.status).toBe(307);
    const location = response.headers.get('location');
    expect(location).toContain('error=invalid_state');
  });

  it('rejects outlook callback with missing nonce', async () => {
    const state = Buffer.from(JSON.stringify({ firmId: 'firm-1', nonce: 'random-nonce-456' })).toString('base64url');
    const url = new URL(`http://localhost/api/agent/oauth/outlook/callback?code=test-code&state=${state}`);
    const request = new Request(url.toString());

    const { GET } = await import('@/app/api/agent/oauth/outlook/callback/route');
    const response = await GET(request);

    expect(response.status).toBe(307);
    const location = response.headers.get('location');
    expect(location).toContain('error=invalid_state');
  });
});
