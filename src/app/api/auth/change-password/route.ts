export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hash, compare } from 'bcryptjs';
import { z } from 'zod';

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10).regex(
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

    return NextResponse.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input' } }, { status: 400 });
    }
    console.error('Password change error:', err);
    return NextResponse.json({ error: { code: 'INTERNAL', message: 'Internal server error' } }, { status: 500 });
  }
});
