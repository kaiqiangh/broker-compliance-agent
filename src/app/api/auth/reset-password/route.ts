export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { revokeToken } from '@/lib/auth';
import { z } from 'zod';
import { hash } from 'bcryptjs';
import { consumeResetToken } from '@/lib/reset-token-store';

const ResetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(10).max(128).regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
    'Password must contain at least one lowercase letter, one uppercase letter, and one digit'
  ),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { token, newPassword } = ResetPasswordSchema.parse(body);

    const userId = consumeResetToken(token);
    if (!userId) {
      return NextResponse.json(
        { error: { code: 'INVALID_TOKEN', message: 'Invalid or expired reset token' } },
        { status: 400 }
      );
    }

    // Hash new password and update user
    const passwordHash = await hash(newPassword, 12);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    // Revoke all existing sessions for this user by adding their JTI to the blocklist.
    // Since JWTs are stateless and use sub + iat as JTI, we can't enumerate all tokens.
    // Instead, we store a "revoke all tokens issued before this timestamp" marker.
    revokeToken(`user:${userId}:all`, Date.now() + 8 * 60 * 60 * 1000);

    return NextResponse.json({ message: 'Password has been reset successfully.' });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: err.errors[0]?.message || 'Invalid input' } },
        { status: 400 }
      );
    }
    console.warn('Reset-password error [redacted]:', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json(
      { error: { code: 'ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
