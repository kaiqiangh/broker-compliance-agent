export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// GET /api/auth/me — return current session user info
export const GET = withAuth(null, async (user) => {
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      lastLoginAt: true,
      firmId: true,
      firm: {
        select: {
          id: true,
          name: true,
          cbiRegistration: true,
          subscriptionTier: true,
          subscriptionStatus: true,
        },
      },
    },
  });

  if (!dbUser) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'User not found' } }, { status: 404 });
  }

  return NextResponse.json({ data: dbUser });
});
