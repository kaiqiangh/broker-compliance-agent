export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { checkRateLimit } from '@/lib/rate-limit';

export const GET = withAuth(null, async (user, request) => {
  const rl = await checkRateLimit(`api:metrics:${user.id}`, 30, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded', retryAfter: rl.retryAfter }, { status: 429 });
  }

  const url = new URL(request.url);

  // Support both ?range=7d|14d|30d and legacy ?days=N
  const rangeParam = url.searchParams.get('range');
  let days: number;
  if (rangeParam === '7d' || rangeParam === '14d' || rangeParam === '30d') {
    days = parseInt(rangeParam);
  } else {
    days = Math.min(parseInt(url.searchParams.get('days') || '30'), 90);
  }

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // Get daily metrics
  const metrics = await prisma.agentMetricsDaily.findMany({
    where: {
      firmId: user.firmId,
      date: { gte: startDate },
    },
    orderBy: { date: 'asc' },
  });

  // Get current aggregate stats — 2 DB round-trips instead of 8
  const [totalEmails, statusGroups, autoExecutedCount] = await Promise.all([
    prisma.incomingEmail.count({ where: { firmId: user.firmId } }),
    prisma.agentAction.groupBy({
      by: ['status'],
      where: { firmId: user.firmId },
      _count: { _all: true },
    }),
    prisma.agentAction.count({ where: { firmId: user.firmId, mode: 'auto', status: 'executed' } }),
  ]);

  const statusMap = Object.fromEntries(statusGroups.map(g => [g.status, g._count._all]));
  const totalActions = statusGroups.reduce((sum, g) => sum + g._count._all, 0);
  const pendingActions = statusMap['pending'] || 0;
  const confirmedActions = statusMap['confirmed'] || 0;
  const modifiedActions = statusMap['modified'] || 0;
  const rejectedActions = statusMap['rejected'] || 0;
  const autoExecutedActions = autoExecutedCount;

  const totalDecided = confirmedActions + modifiedActions + rejectedActions;
  // "Useful rate" — agent was on the right track (confirmed or modified = useful)
  const accuracyRate = totalDecided > 0
    ? Math.round(((confirmedActions + modifiedActions) / totalDecided) * 100)
    : 0;
  // "Perfect rate" — no modifications needed
  const strictAccuracy = totalDecided > 0
    ? Math.round((confirmedActions / totalDecided) * 100)
    : 0;

  // Estimate time saved (3 min per email processed)
  const timeSavedMinutes = totalEmails * 3;

  return NextResponse.json({
    data: {
      summary: {
        totalEmails,
        totalActions,
        pendingActions,
        confirmedActions,
        modifiedActions,
        rejectedActions,
        autoExecutedActions,
        accuracyRate,
        strictAccuracy,
        timeSavedMinutes,
        timeSavedHours: Math.round(timeSavedMinutes / 60 * 10) / 10,
      },
      daily: metrics.map(m => {
        const dailyDecided = m.actionsConfirmed + m.actionsModified + m.actionsRejected;
        return {
          date: m.date,
          emailsReceived: m.emailsReceived,
          emailsProcessed: m.emailsProcessed,
          actionsCreated: m.actionsCreated,
          actionsConfirmed: m.actionsConfirmed,
          actionsModified: m.actionsModified,
          actionsRejected: m.actionsRejected,
          avgConfidence: m.avgConfidence ? Number(m.avgConfidence) : null,
          accuracyRate: dailyDecided > 0
            ? Math.round(((m.actionsConfirmed + m.actionsModified) / dailyDecided) * 100)
            : null,
          strictAccuracy: dailyDecided > 0
            ? Math.round((m.actionsConfirmed / dailyDecided) * 100)
            : null,
        };
      }),
    },
  });
});
