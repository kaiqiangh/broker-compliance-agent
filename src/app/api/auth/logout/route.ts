export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { revokeToken } from '@/lib/auth';

const JWT_SECRET = new TextEncoder().encode(process.env.NEXTAUTH_SECRET || '');
const JWT_ISSUER = 'broker-comply';
const SESSION_TTL_SECONDS = 8 * 60 * 60;

export async function POST(request: Request) {
  // Revoke the JWT token (add to blocklist for remaining TTL)
  const cookieHeader = request.headers.get('cookie') || '';
  const sessionMatch = cookieHeader.match(/(?:^|;\s*)session=([^;]+)/);
  const token = sessionMatch?.[1];

  if (token) {
    try {
      const { payload } = await jwtVerify(token, JWT_SECRET, { issuer: JWT_ISSUER });
      const jti = payload.jti ?? `${payload.sub}:${payload.iat}`;
      // TTL: remaining time until natural expiry (max 8h)
      const remainingSec = payload.exp
        ? Math.max(1, payload.exp - Math.floor(Date.now() / 1000))
        : SESSION_TTL_SECONDS;
      await revokeToken(jti, remainingSec);
    } catch {
      // Token already invalid — just clear cookie
    }
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set('session', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 0,
    path: '/',
  });
  // Also clear CSRF token cookie
  response.cookies.set('csrf_token', '', {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 0,
    path: '/',
  });
  return response;
}
