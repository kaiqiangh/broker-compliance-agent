export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { checkRateLimit } from '@/lib/rate-limit';

export const GET = withAuth(null, async (user, request) => {
  const rl = await checkRateLimit(`api:emails:get:${user.id}`, 60, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded', retryAfter: rl.retryAfter }, { status: 429 });
  }

  const url = new URL(request.url);
  const emailId = url.pathname.split('/').filter(Boolean).pop();

  const email = await prisma.incomingEmail.findUnique({
    where: { id: emailId, firmId: user.firmId },
    include: {
      attachments: {
        select: {
          id: true,
          filename: true,
          contentType: true,
          sizeBytes: true,
        },
      },
      actions: {
        select: {
          id: true,
          actionType: true,
          status: true,
          confidence: true,
          reasoning: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!email) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Email not found' } },
      { status: 404 }
    );
  }

  return NextResponse.json({
    data: {
      ...email,
      classificationConfidence: email.classificationConfidence
        ? Number(email.classificationConfidence)
        : null,
      actions: email.actions.map(a => ({
        ...a,
        confidence: Number(a.confidence),
      })),
    },
  });
});
