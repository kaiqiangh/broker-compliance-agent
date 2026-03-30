export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { getLearningInsights, getAccuracyReport } from '@/lib/agent/learning';

export const GET = withAuth(null, async (user, _request) => {
  const [insights, accuracy] = await Promise.all([
    getLearningInsights(user.firmId),
    getAccuracyReport(user.firmId),
  ]);

  return NextResponse.json({ data: { insights, accuracy } });
});
