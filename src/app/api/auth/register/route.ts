export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { registerFirm, createSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

const RegisterSchema = z.object({
  firmName: z.string().min(1).max(255),
  email: z.string().email(),
  password: z.string().min(10).regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
    'Password must contain at least one lowercase letter, one uppercase letter, and one digit'
  ),
  name: z.string().min(1).max(255),
});

export async function POST(request: Request) {
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

    const token = createSession(user);

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

    return response;
  } catch (err) {
    if (err instanceof z.ZodError) {
      console.error('Register validation error:', err.errors);
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
    }
    console.error('Register error:', err);
    return NextResponse.json({ error: { code: 'ERROR', message: 'Internal server error' } }, { status: 500 });
  }
}
