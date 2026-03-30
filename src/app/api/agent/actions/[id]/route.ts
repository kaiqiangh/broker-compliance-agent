export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const GET = withAuth(null, async (user, request) => {
  const url = new URL(request.url);
  const actionId = url.pathname.split('/').filter(Boolean).pop();

  const action = await prisma.agentAction.findUnique({
    where: { id: actionId, firmId: user.firmId },
    include: {
      email: {
        select: {
          id: true,
          messageId: true,
          subject: true,
          fromAddress: true,
          toAddresses: true,
          receivedAt: true,
          bodyText: true,
          threadId: true,
        },
      },
      modifications: {
        orderBy: { modifiedAt: 'desc' },
        take: 10,
      },
    },
  });

  if (!action) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Action not found' } },
      { status: 404 }
    );
  }

  let threadEmails: any[] = [];
  if (action.email?.threadId) {
    threadEmails = await prisma.incomingEmail.findMany({
      where: {
        firmId: user.firmId,
        threadId: action.email.threadId,
      },
      select: {
        id: true,
        subject: true,
        fromAddress: true,
        receivedAt: true,
        status: true,
      },
      orderBy: { receivedAt: 'asc' },
    });
  }

  return NextResponse.json({
    data: {
      ...action,
      confidence: Number(action.confidence),
      matchConfidence: action.matchConfidence ? Number(action.matchConfidence) : null,
      threadEmails,
    },
  });
});
