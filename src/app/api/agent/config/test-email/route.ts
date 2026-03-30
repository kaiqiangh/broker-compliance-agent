import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const POST = withAuth('agent:configure', async (user, _request) => {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

  const recentEmail = await prisma.incomingEmail.findFirst({
    where: {
      firmId: user.firmId,
      createdAt: { gte: tenMinutesAgo },
      status: { in: ['processed', 'pending_processing', 'processing'] },
    },
    include: {
      actions: {
        select: { actionType: true, confidence: true },
        take: 1,
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!recentEmail) {
    return NextResponse.json({
      success: false,
      error: 'No email received in the last 10 minutes.',
    });
  }

  const action = recentEmail.actions[0];
  return NextResponse.json({
    success: true,
    subject: recentEmail.subject,
    category: recentEmail.category,
    isInsurance: recentEmail.isInsurance,
    actionType: action?.actionType,
  });
});
