export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const GET = withAuth(null, async (user, request) => {
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const category = url.searchParams.get('category');
  const threadId = url.searchParams.get('threadId');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
  const offset = parseInt(url.searchParams.get('offset') || '0');

  const where: any = { firmId: user.firmId };
  if (status) where.status = status;
  if (category) where.category = category;
  if (threadId) where.threadId = threadId;

  const [emails, total] = await Promise.all([
    prisma.incomingEmail.findMany({
      where,
      orderBy: { receivedAt: 'desc' },
      take: limit,
      skip: offset,
      select: {
        id: true,
        messageId: true,
        fromAddress: true,
        subject: true,
        receivedAt: true,
        isInsurance: true,
        category: true,
        priority: true,
        status: true,
        processedAt: true,
        threadId: true,
        createdAt: true,
        _count: {
          select: { actions: true, attachments: true },
        },
      },
    }),
    prisma.incomingEmail.count({ where }),
  ]);

  return NextResponse.json({
    data: emails,
    meta: { total, limit, offset },
  });
});
