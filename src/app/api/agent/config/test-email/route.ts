import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { checkRateLimit } from '@/lib/rate-limit';

export const POST = withAuth('agent:configure', async (user, _request) => {
  const rl = await checkRateLimit(`api:config:test-email:${user.id}`, 5, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded', retryAfter: rl.retryAfter }, { status: 429 });
  }

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
