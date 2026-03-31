export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { checkRateLimit } from '@/lib/rate-limit';

export const GET = withAuth('agent:view_own', async (user, request) => {
  const rl = await checkRateLimit(`api:actions:list:${user.id}`, 60, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded', retryAfter: rl.retryAfter }, { status: 429 });
  }

  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
  const offset = parseInt(url.searchParams.get('offset') || '0');

  const isRestricted = user.role === 'adviser' || user.role === 'read_only';

  const where: any = { firmId: user.firmId };
  if (status) where.status = status;

  // Role-based filtering: advisers and read_only only see pending actions + their own confirmed ones
  if (isRestricted) {
    where.OR = [
      { confirmedBy: user.id },
      { status: 'pending' },
    ];
  }

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
