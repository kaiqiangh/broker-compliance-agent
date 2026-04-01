export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * GDPR retention purge endpoint.
 *
 * Deletes audit events older than the retention period (default 6 years).
 * Only firm_admin can trigger. Logs the purge as an audit event.
 *
 * Art 17(3)(b) exempts compliance records from erasure, but after the
 * retention period expires, they can be safely deleted.
 *
 * Query params:
 *   years=6 (default retention period)
 *   dryRun=true (preview only, don't delete)
 */
export const POST = withAuth('admin', async (user, request) => {
  const url = new URL(request.url);
  const years = parseInt(url.searchParams.get('years') || '6', 10);
  const dryRun = url.searchParams.get('dryRun') === 'true';

  if (years < 1 || years > 20) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'years must be 1-20' } }, { status: 400 });
  }

  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - years);

  // Count events eligible for purge
  const count = await prisma.auditEvent.count({
    where: {
      firmId: user.firmId,
      timestamp: { lt: cutoff },
    },
  });

  if (dryRun) {
    return NextResponse.json({
      data: {
        eligibleForPurge: count,
        cutoffDate: cutoff.toISOString(),
        retentionYears: years,
        dryRun: true,
      },
    });
  }

  // Delete old events (bounded loop to prevent runaway from concurrent inserts)
  let deleted = 0;
  const MAX_ITERATIONS = 100;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const batch = await prisma.auditEvent.deleteMany({
      where: {
        firmId: user.firmId,
        timestamp: { lt: cutoff },
      },
    });
    deleted += batch.count;
    if (batch.count === 0) break;
  }

  // Also purge old notifications
  const notifDeleted = await prisma.notification.deleteMany({
    where: {
      firmId: user.firmId,
      sentAt: { lt: cutoff },
    },
  });

  // Audit the purge
  await prisma.auditEvent.create({
    data: {
      firmId: user.firmId,
      actorId: user.id,
      action: 'gdpr.retention_purge',
      entityType: 'system',
      metadata: {
        cutoffDate: cutoff.toISOString(),
        retentionYears: years,
        auditEventsDeleted: deleted,
        notificationsDeleted: notifDeleted.count,
      },
    },
  });

  return NextResponse.json({
    data: {
      auditEventsDeleted: deleted,
      notificationsDeleted: notifDeleted.count,
      cutoffDate: cutoff.toISOString(),
      retentionYears: years,
    },
  });
});
