import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const GET = withAuth('view_all', async (user, request) => {
  const url = new URL(request.url);
  const clientId = url.searchParams.get('clientId') || undefined;
  const policyType = url.searchParams.get('type') || undefined;

  const policies = await prisma.policy.findMany({
    where: {
      firmId: user.firmId,
      ...(clientId ? { clientId } : {}),
      ...(policyType ? { policyType } : {}),
      policyStatus: 'active',
    },
    include: {
      client: { select: { id: true, name: true } },
    },
    orderBy: { expiryDate: 'asc' },
    take: 100,
  });

  return NextResponse.json({ data: policies });
});
