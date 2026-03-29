export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { authenticateUser, createSession, generateCsrfToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

const MAX_ACCOUNT_ATTEMPTS = 10;
const ACCOUNT_WINDOW_MS = 10 * 60 * 1000;

function getClientIp(request: Request): string {
  return request.headers.get('x-real-ip') || 'unknown';
}

export async function POST(request: Request) {
  // Rate limiting by IP
  const ip = getClientIp(request);
  const ipCheck = await checkRateLimit(`login:ip:${ip}`, MAX_LOGIN_ATTEMPTS, LOGIN_WINDOW_MS);
  if (!ipCheck.allowed) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Try again later.' } },
      { status: 429, headers: { 'Retry-After': String(ipCheck.retryAfter) } }
    );
  }

  try {
    const body = await request.json();
    const { email, password } = LoginSchema.parse(body);

    // Per-account rate limiting
    const accountCheck = await checkRateLimit(`login:email:${email.toLowerCase()}`, MAX_ACCOUNT_ATTEMPTS, ACCOUNT_WINDOW_MS);
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

    // Log login audit event
    await prisma.auditEvent.create({
      data: {
        firmId: user.firmId,
        actorId: user.id,
        action: 'user.login',
        entityType: 'user',
        entityId: user.id,
        metadata: { email: user.email, ipAddress: ip },
      },
    });

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
