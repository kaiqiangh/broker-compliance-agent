export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth, getUserFromRequest, revokeToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hash, compare } from 'bcryptjs';
import { z } from 'zod';

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10).max(128).regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
    'Password must contain at least one lowercase letter, one uppercase letter, and one digit'
  ),
});

export const POST = withAuth(null, async (user, request) => {
  try {
    const body = await request.json();
    const { currentPassword, newPassword } = ChangePasswordSchema.parse(body);

    // Verify current password
    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    if (!dbUser) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'User not found' } }, { status: 404 });
    }

    const isValid = await compare(currentPassword, dbUser.passwordHash);
    if (!isValid) {
      return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Current password is incorrect' } }, { status: 401 });
    }

    // Update password
    const passwordHash = await hash(newPassword, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    // Audit
    await prisma.auditEvent.create({
      data: {
        firmId: user.firmId,
        actorId: user.id,
        action: 'user.password_changed',
        entityType: 'user',
        entityId: user.id,
      },
    });

    // Revoke the current session token so old JWT is invalidated immediately
    try {
      const cookieHeader = request.headers.get('cookie');
      if (cookieHeader) {
        const cookies = cookieHeader.split(';').reduce((acc, part) => {
          const [key, ...valueParts] = part.trim().split('=');
          if (key) acc[key.trim()] = decodeURIComponent(valueParts.join('='));
          return acc;
        }, {} as Record<string, string>);
        const token = cookies['session'];
        if (token) {
          const { jwtVerify } = await import('jose');
          const JWT_SECRET_RAW = process.env.NEXTAUTH_SECRET!;
          const JWT_SECRET = new TextEncoder().encode(JWT_SECRET_RAW);
          const { payload } = await jwtVerify(token, JWT_SECRET, { issuer: 'broker-comply' });
          const exp = (payload.exp ?? 0) * 1000;
          const jti = payload.jti ?? (payload.sub as string) + ':' + String(payload.iat);
          revokeToken(jti, exp);
        }
      }
    } catch {
      // Best-effort revocation — don't block password change on decode failure
    }

    return NextResponse.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input' } }, { status: 400 });
    }
    console.warn('Password change error [redacted]:', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: { code: 'INTERNAL', message: 'Internal server error' } }, { status: 500 });
  }
});
