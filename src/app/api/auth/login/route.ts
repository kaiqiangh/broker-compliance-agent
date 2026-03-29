export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { authenticateUser, createSession, generateCsrfToken } from '@/lib/auth';
import { z } from 'zod';

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Simple in-memory rate limiter: max 5 failed attempts per IP per 15 minutes
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

// Per-account rate limiter: max 10 failed attempts per email per 10 minutes
const accountAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ACCOUNT_ATTEMPTS = 10;
const ACCOUNT_WINDOW_MS = 10 * 60 * 1000;

function getClientIp(request: Request): string {
  return request.headers.get('x-real-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
}

function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = loginAttempts.get(ip);

  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return { allowed: true };
  }

  if (entry.count >= MAX_LOGIN_ATTEMPTS) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, retryAfter };
  }

  entry.count++;
  return { allowed: true };
}

function checkAccountRateLimit(email: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const key = `email:${email.toLowerCase()}`;
  const entry = accountAttempts.get(key);

  if (!entry || now > entry.resetAt) {
    accountAttempts.set(key, { count: 1, resetAt: now + ACCOUNT_WINDOW_MS });
    return { allowed: true };
  }

  if (entry.count >= MAX_ACCOUNT_ATTEMPTS) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, retryAfter };
  }

  entry.count++;
  return { allowed: true };
}

function clearRateLimit(ip: string): void {
  loginAttempts.delete(ip);
}

export async function POST(request: Request) {
  // Rate limiting
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Try again later.' } },
      { status: 429, headers: { 'Retry-After': String(rateCheck.retryAfter) } }
    );
  }

  try {
    const body = await request.json();
    const { email, password } = LoginSchema.parse(body);

    // Per-account rate limiting
    const accountCheck = checkAccountRateLimit(email);
    if (!accountCheck.allowed) {
      return NextResponse.json(
        { error: { code: 'RATE_LIMITED', message: 'Too many login attempts for this account. Try again later.' } },
        { status: 429, headers: { 'Retry-After': String(accountCheck.retryAfter) } }
      );
    }

    const user = await authenticateUser(email, password);
    if (!user) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    // Successful login
    // Note: rate limit is NOT cleared on success to prevent attacker
    // from using a low-value account to reset the counter.
    // The rate limit window naturally expires after 15 minutes.

    const token = await createSession(user);

    const response = NextResponse.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });

    response.cookies.set('session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 8 * 60 * 60, // 8 hours
      path: '/',
    });

    // Set CSRF token cookie (double-submit cookie pattern)
    const csrfToken = generateCsrfToken();
    response.cookies.set('csrf_token', csrfToken, {
      httpOnly: false, // must be readable by frontend JS
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 8 * 60 * 60,
      path: '/',
    });

    return response;
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input' } }, { status: 400 });
    }
    console.warn('Login error [redacted]:', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: { code: 'ERROR', message: 'Internal server error' } }, { status: 500 });
  }
}
