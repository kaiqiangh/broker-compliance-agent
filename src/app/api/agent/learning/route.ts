export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { getLearningInsights, getAccuracyReport } from '@/lib/agent/learning';
import { checkRateLimit } from '@/lib/rate-limit';

export const GET = withAuth(null, async (user, _request) => {
  const rl = await checkRateLimit(`api:learning:${user.id}`, 30, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded', retryAfter: rl.retryAfter }, { status: 429 });
  }

  const [insights, accuracy] = await Promise.all([
    getLearningInsights(user.firmId),
    getAccuracyReport(user.firmId),
  ]);

  return NextResponse.json({ data: { insights, accuracy } });
});
