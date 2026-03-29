export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// GET /api/policies/[id]
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  return withAuth('view_all', async (user) => {
    const policy = await prisma.policy.findFirst({
      where: { id: params.id, firmId: user.firmId },
      include: {
        client: true,
        adviser: { select: { id: true, name: true, email: true } },
        renewals: {
          orderBy: { dueDate: 'desc' },
          take: 5,
        },
      },
    });

    if (!policy) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Policy not found' } }, { status: 404 });
    }

    return NextResponse.json({ data: policy });
  })(request);
}
