export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// GET /api/users — list users in the current user's firm
export const GET = withAuth('view_all', async (user) => {
  const users = await prisma.user.findMany({
    where: { firmId: user.firmId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
    },
    orderBy: { name: 'asc' },
  });

  return NextResponse.json({ data: users });
});
