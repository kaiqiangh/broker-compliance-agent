import { describe, expect, it } from 'vitest';
import { middleware } from '@/middleware';
import { NextRequest } from 'next/server';

describe('middleware JWT validation', () => {
  it('rejects request with invalid JWT token', async () => {
    const request = new NextRequest('http://localhost:3000/api/agent/config', {
      headers: { cookie: 'session=invalid.jwt.token' },
    });
    const response = await middleware(request);
    expect(response.status).toBe(401);
  });

  it('rejects request with expired JWT token', async () => {
    const { SignJWT } = await import('jose');
    const secret = new TextEncoder().encode(process.env.NEXTAUTH_SECRET || 'test-secret-key-for-testing');
    const expired = await new SignJWT({ sub: 'test', firmId: 'test' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('broker-comply')
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(secret);
    const request = new NextRequest('http://localhost:3000/api/agent/config', {
      headers: { cookie: `session=${expired}` },
    });
    const response = await middleware(request);
    expect(response.status).toBe(401);
  });

  it('allows request with valid JWT token through middleware', async () => {
    const { SignJWT } = await import('jose');
    const secret = new TextEncoder().encode(process.env.NEXTAUTH_SECRET || 'test-secret-key-for-testing');
    const valid = await new SignJWT({ sub: 'test-user', email: 'test@test.com', firmId: 'firm-1', role: 'firm_admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('broker-comply')
      .setIssuedAt()
      .setExpirationTime('8h')
      .sign(secret);
    const request = new NextRequest('http://localhost:3000/api/health', {
      headers: { cookie: `session=${valid}` },
    });
    const response = await middleware(request);
    // Should not be 401 — it might be 200 or redirect, but NOT unauthorized
    expect(response.status).not.toBe(401);
  });
});
