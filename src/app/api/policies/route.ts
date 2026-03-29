export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { hasPermission } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';

export const GET = withAuth(null, async (user, request) => {
  if (!hasPermission(user.role, 'view_all') && !hasPermission(user.role, 'view_own')) {
    return Response.json({ error: { code: 'FORBIDDEN', message: 'Requires permission: view_all or view_own' } }, { status: 403 });
  }

  const url = new URL(request.url);
  const clientId = url.searchParams.get('clientId') || undefined;
  const policyType = url.searchParams.get('type') || undefined;

  const isAdviser = hasPermission(user.role, 'view_own') && !hasPermission(user.role, 'view_all');

  const policies = await prisma.policy.findMany({
    where: {
      firmId: user.firmId,
      ...(clientId ? { clientId } : {}),
      ...(policyType ? { policyType } : {}),
      ...(isAdviser ? { adviserId: user.id } : {}),
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
