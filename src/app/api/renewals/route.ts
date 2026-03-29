export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { hasPermission } from '@/lib/rbac';
import { RenewalService } from '@/services/renewal-service';

const renewalService = new RenewalService();

export const GET = withAuth(null, async (user, request) => {
  if (!hasPermission(user.role, 'view_all') && !hasPermission(user.role, 'view_own')) {
    return Response.json({ error: { code: 'FORBIDDEN', message: 'Requires permission: view_all or view_own' } }, { status: 403 });
  }

  const url = new URL(request.url);
  const status = url.searchParams.get('status') || undefined;
  const policyType = url.searchParams.get('type') || undefined;
  const daysAhead = Math.min(Math.max(parseInt(url.searchParams.get('days') || '90', 10) || 90, 1), 365);

  const isAdviser = hasPermission(user.role, 'view_own') && !hasPermission(user.role, 'view_all');

  const renewals = await renewalService.getTimeline(user.firmId, {
    status,
    policyType,
    daysAhead,
    ...(isAdviser ? { adviserId: user.id } : {}),
  });

  return NextResponse.json({ data: renewals });
});
