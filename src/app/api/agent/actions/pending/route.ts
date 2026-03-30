export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const GET = withAuth('agent:view_own', async (user, _request) => {
  const isRestricted = user.role === 'adviser' || user.role === 'read_only';

  const actions = await prisma.agentAction.findMany({
    where: {
      firmId: user.firmId,
      status: 'pending',
      ...(isRestricted && {
        OR: [
          { confirmedBy: user.id },
          { status: 'pending' },
        ],
      }),
    },
    orderBy: [
      { confidence: 'desc' }, // High confidence first
      { createdAt: 'asc' },   // Oldest first within same confidence
    ],
    include: {
      email: {
        select: {
          id: true,
          subject: true,
          fromAddress: true,
          receivedAt: true,
          bodyText: true,
        },
      },
    },
  });

  return NextResponse.json({
    data: actions.map(a => ({
      id: a.id,
      actionType: a.actionType,
      entityType: a.entityType,
      entityId: a.entityId,
      matchConfidence: a.matchConfidence ? Number(a.matchConfidence) : null,
      changes: a.changes,
      confidence: Number(a.confidence),
      reasoning: a.reasoning,
      createdAt: a.createdAt,
      email: a.email,
    })),
    meta: { total: actions.length },
  });
});
