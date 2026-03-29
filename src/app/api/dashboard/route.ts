export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { RenewalService } from '@/services/renewal-service';

const renewalService = new RenewalService();

export const GET = withAuth('view_all', async (user) => {
  const stats = await renewalService.getDashboardStats(user.firmId);
  return NextResponse.json({ data: stats });
});
