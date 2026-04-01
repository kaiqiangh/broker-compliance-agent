export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { prisma, runWithFirmContext } from '@/lib/prisma';
import { NotificationService } from '@/services/notification-service';
import { RenewalService } from '@/services/renewal-service';

const notificationService = new NotificationService();
const renewalService = new RenewalService();

/**
 * Worker job processor endpoint.
 *
 * Processes pending jobs from the scheduled_jobs table.
 * Requires WORKER_SECRET for authentication.
 *
 * Can be triggered by:
 * - Cron job (external scheduler)
 * - Manual trigger via POST
 * - Health check via GET
 *
 * Jobs are processed in order of scheduled_for time.
 * Failed jobs are retried up to max_attempts.
 */

function requireWorkerAuth(request: Request): Response | null {
  const workerSecret = process.env.WORKER_SECRET;
  if (!workerSecret) {
    return NextResponse.json({ error: 'Worker not configured' }, { status: 503 });
  }
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const token = authHeader.slice(7);

  // Timing-safe comparison to prevent timing attacks
  const expected = Buffer.from(workerSecret, 'utf-8');
  const received = Buffer.from(token, 'utf-8');

  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}

export async function POST(request: Request) {
  const authError = requireWorkerAuth(request);
  if (authError) return authError;

  const results: Array<{ jobId: string; type: string; status: string; error?: string }> = [];

  // 1. Process pending scheduled jobs
  const pendingJobs = await prisma.scheduledJob.findMany({
    where: {
      status: 'pending',
      scheduledFor: { lte: new Date() },
    },
    orderBy: { scheduledFor: 'asc' },
    take: 10,
  });

  for (const job of pendingJobs) {
    try {
      await prisma.scheduledJob.update({
        where: { id: job.id },
        data: { status: 'running', startedAt: new Date(), attempts: { increment: 1 } },
      });

      switch (job.jobType) {
        case 'check_reminders': {
          const scheduled = await notificationService.checkAndScheduleReminders();
          results.push({ jobId: job.id, type: job.jobType, status: 'completed' });
          break;
        }
        case 'generate_renewals': {
          // Generate renewals for all firms
          const firms = await prisma.firm.findMany({ select: { id: true } });
          let total = 0;
          for (const firm of firms) {
            const count = await runWithFirmContext(firm.id, () => renewalService.generateRenewals(firm.id));
            total += count;
          }
          results.push({ jobId: job.id, type: job.jobType, status: 'completed' });
          break;
        }
        case 'retention_purge': {
          // Purge audit events older than 6 years for all firms
          const cutoff = new Date();
          cutoff.setFullYear(cutoff.getFullYear() - 6);
          let totalDeleted = 0;
          const allFirms = await prisma.firm.findMany({ select: { id: true } });
          for (const firm of allFirms) {
            const batch = await runWithFirmContext(firm.id, () =>
              prisma.auditEvent.deleteMany({
                where: { firmId: firm.id, timestamp: { lt: cutoff } },
              })
            );
            totalDeleted += batch.count;
          }
          results.push({ jobId: job.id, type: job.jobType, status: 'completed' });
          break;
        }
        default:
          results.push({ jobId: job.id, type: job.jobType, status: 'skipped', error: `Unknown job type: ${job.jobType}` });
      }

      await prisma.scheduledJob.update({
        where: { id: job.id },
        data: { status: 'completed', completedAt: new Date() },
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      const shouldRetry = job.attempts + 1 < job.maxAttempts;

      await prisma.scheduledJob.update({
        where: { id: job.id },
        data: {
          status: shouldRetry ? 'pending' : 'failed',
          lastError: error,
          scheduledFor: shouldRetry
            ? new Date(Date.now() + Math.pow(2, job.attempts) * 60000) // exponential backoff
            : job.scheduledFor,
        },
      });

      results.push({ jobId: job.id, type: job.jobType, status: shouldRetry ? 'retrying' : 'failed', error });
    }
  }

  return NextResponse.json({
    processed: results.length,
    results,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Health check / status for worker.
 */
export async function GET(request: Request) {
  const authError = requireWorkerAuth(request);
  if (authError) return authError;
  const [pendingJobs, failedJobs, lastRun] = await Promise.all([
    prisma.scheduledJob.count({ where: { status: 'pending' } }),
    prisma.scheduledJob.count({ where: { status: 'failed' } }),
    prisma.scheduledJob.findFirst({
      where: { status: 'completed' },
      orderBy: { completedAt: 'desc' },
      select: { completedAt: true, jobType: true },
    }),
  ]);

  return NextResponse.json({
    pendingJobs,
    failedJobs,
    lastRun: lastRun?.completedAt ?? null,
    lastRunType: lastRun?.jobType ?? null,
  });
}
