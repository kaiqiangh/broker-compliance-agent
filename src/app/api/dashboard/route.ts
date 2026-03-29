export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { RenewalService } from '@/services/renewal-service';

const renewalService = new RenewalService();

export const GET = withAuth(null, async (user) => {
  // Advisers only see their own renewals, everyone else sees all firm renewals
  const adviserId = user.role === 'adviser' ? user.id : undefined;
  const stats = await renewalService.getDashboardStats(user.firmId, adviserId);
  return NextResponse.json({ data: stats });
});
