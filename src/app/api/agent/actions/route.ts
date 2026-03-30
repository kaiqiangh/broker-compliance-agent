export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const GET = withAuth(null, async (user, request) => {
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
  const offset = parseInt(url.searchParams.get('offset') || '0');

  const where: any = { firmId: user.firmId };
  if (status) where.status = status;

  const [actions, total] = await Promise.all([
    prisma.agentAction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        email: {
          select: { id: true, subject: true, fromAddress: true, receivedAt: true },
        },
      },
    }),
    prisma.agentAction.count({ where }),
  ]);

  return NextResponse.json({
    data: actions.map(a => ({
      ...a,
      confidence: Number(a.confidence),
      matchConfidence: a.matchConfidence ? Number(a.matchConfidence) : null,
    })),
    meta: { total, limit, offset },
  });
});
