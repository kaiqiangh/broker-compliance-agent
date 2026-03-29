export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

/**
 * Logout — clear the session cookie.
 * JWT tokens are stateless so there's no server-side session to delete.
 * The token will expire naturally within 8 hours.
 * For immediate invalidation in production, implement a token blocklist.
 */
export async function POST(_request: Request) {
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
