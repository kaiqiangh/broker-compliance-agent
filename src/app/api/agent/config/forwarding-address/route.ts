export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { checkRateLimit } from '@/lib/rate-limit';

export const GET = withAuth(null, async (user, _request) => {
  const rl = await checkRateLimit(`api:config:forwarding:${user.id}`, 5, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded', retryAfter: rl.retryAfter }, { status: 429 });
  }

  let config = await prisma.emailIngressConfig.findUnique({
    where: { firmId: user.firmId },
  });

  // Generate forwarding address if not exists
  if (!config || !config.forwardingAddress) {
    const forwardingAddress = `agent-${user.firmId}@ingest.${process.env.INGEST_DOMAIN || 'yourproduct.com'}`;

    config = await prisma.emailIngressConfig.upsert({
      where: { firmId: user.firmId },
      update: { forwardingAddress },
      create: {
        firmId: user.firmId,
        forwardingAddress,
        executionMode: 'suggestion',
        status: 'active',
      },
    });
  }

  return NextResponse.json({
    data: {
      address: config.forwardingAddress,
      status: config.status,
    },
  });
});
