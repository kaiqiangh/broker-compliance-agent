export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { RenewalService } from '@/services/renewal-service';

const renewalService = new RenewalService();

export const GET = withAuth('view_all', async (user, request) => {
  const url = new URL(request.url);
  const status = url.searchParams.get('status') || undefined;
  const policyType = url.searchParams.get('type') || undefined;
  const daysAhead = parseInt(url.searchParams.get('days') || '90', 10);

  const renewals = await renewalService.getTimeline(user.firmId, {
    status,
    policyType,
    daysAhead,
  });

  return NextResponse.json({ data: renewals });
});
