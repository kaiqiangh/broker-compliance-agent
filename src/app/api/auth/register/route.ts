export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { registerFirm, createSession, generateCsrfToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

const RegisterSchema = z.object({
  firmName: z.string().min(1).max(255),
  email: z.string().email(),
  password: z.string().min(10).max(128).regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
    'Password must contain at least one lowercase letter, one uppercase letter, and one digit'
  ),
  name: z.string().min(1).max(255),
});

// Simple in-memory rate limiter: max 3 registration attempts per IP per minute
const registerAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_REGISTER_ATTEMPTS = 3;
const REGISTER_WINDOW_MS = 60 * 1000;

function getRegisterClientIp(request: Request): string {
  return request.headers.get('x-real-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
}

function checkRegisterRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = registerAttempts.get(ip);

  if (!entry || now > entry.resetAt) {
    registerAttempts.set(ip, { count: 1, resetAt: now + REGISTER_WINDOW_MS });
    return { allowed: true };
  }

  if (entry.count >= MAX_REGISTER_ATTEMPTS) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, retryAfter };
  }

  entry.count++;
  return { allowed: true };
}

export async function POST(request: Request) {
  // Rate limiting
  const ip = getRegisterClientIp(request);
  const rateCheck = checkRegisterRateLimit(ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Too many registration attempts. Try again later.' } },
      { status: 429, headers: { 'Retry-After': String(rateCheck.retryAfter) } }
    );
  }

  try {
    const body = await request.json();
    const data = RegisterSchema.parse(body);

    // Check if email already exists
    const existing = await prisma.user.findUnique({
      where: { email: data.email.toLowerCase() },
    });
    if (existing) {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 409 }
      );
    }

    const { firmId, user } = await registerFirm({
      firmName: data.firmName,
      adminEmail: data.email,
      adminPassword: data.password,
      adminName: data.name,
    });

    const token = await createSession(user);

    const response = NextResponse.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      firmId,
    });

    response.cookies.set('session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 8 * 60 * 60,
      path: '/',
    });

    // Set CSRF token cookie (double-submit cookie pattern)
    const csrfToken = generateCsrfToken();
    response.cookies.set('csrf_token', csrfToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 8 * 60 * 60,
      path: '/',
    });

    return response;
  } catch (err) {
    if (err instanceof z.ZodError) {
      console.warn('Register validation error [redacted]:', err.errors.length, 'issues');
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
    }
    console.warn('Register error [redacted]:', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: { code: 'ERROR', message: 'Internal server error' } }, { status: 500 });
  }
}
