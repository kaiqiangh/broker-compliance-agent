import { prisma } from '../lib/prisma';
import { processEmail } from '../services/agent/pipeline';
import { sendDailyDigest } from '../services/agent/notifications';
import { pollConnectedMailboxes } from '../lib/email/oauth/poller';
import { pollIMAPConnections } from '../lib/email/imap/poller';

/**
 * Agent Worker - Background job processor
 *
 * Jobs:
 * 1. process_pending_emails - Process emails in pending_processing status
 * 2. aggregate_metrics - Calculate daily metrics
 * 3. detect_stale_emails - Find and re-enqueue stuck emails
 */

export async function processPendingEmails(): Promise<number> {
  const batchSize = parseInt(process.env.AGENT_BATCH_SIZE || '10', 10);

  const pendingEmails = await prisma.incomingEmail.findMany({
    where: { status: 'pending_processing' },
    orderBy: { createdAt: 'asc' },
    take: batchSize,
    select: { id: true },
  });

  let processed = 0;
  for (const email of pendingEmails) {
    try {
      await processEmail(email.id);
      processed++;
    } catch (error) {
      console.error(`Failed to process email ${email.id}:`, error);
      // Error is already logged in pipeline
    }
  }

  return processed;
}

export async function aggregateDailyMetrics(): Promise<void> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const firms = await prisma.firm.findMany({
    where: {
      emailIngressConfig: { isNot: null },
    },
    select: { id: true },
  });

  // Process firms with concurrency limit (max 5 parallel)
  const MAX_CONCURRENCY = 5;
  const results: PromiseSettledResult<void>[] = [];

  for (let i = 0; i < firms.length; i += MAX_CONCURRENCY) {
    const batch = firms.slice(i, i + MAX_CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(async (firm) => {
    const [
      emailsReceived,
      emailsProcessed,
      emailsNotInsurance,
      actionsCreated,
      actionsConfirmed,
      actionsModified,
      actionsRejected,
      actionsAutoExecuted,
    ] = await Promise.all([
      prisma.incomingEmail.count({
        where: { firmId: firm.id, createdAt: { gte: today } },
      }),
      prisma.incomingEmail.count({
        where: { firmId: firm.id, status: 'processed', processedAt: { gte: today } },
      }),
      prisma.incomingEmail.count({
        where: { firmId: firm.id, status: 'not_insurance', createdAt: { gte: today } },
      }),
      prisma.agentAction.count({
        where: { firmId: firm.id, createdAt: { gte: today } },
      }),
      prisma.agentAction.count({
        where: { firmId: firm.id, status: 'confirmed', confirmedAt: { gte: today } },
      }),
      prisma.agentAction.count({
        where: { firmId: firm.id, status: 'modified', confirmedAt: { gte: today } },
      }),
      prisma.agentAction.count({
        where: { firmId: firm.id, status: 'rejected', createdAt: { gte: today } },
      }),
      prisma.agentAction.count({
        where: { firmId: firm.id, mode: 'auto', executedAt: { gte: today } },
      }),
    ]);

    // Calculate average confidence
    const actions = await prisma.agentAction.findMany({
      where: { firmId: firm.id, createdAt: { gte: today } },
      select: { confidence: true },
    });
    const avgConfidence = actions.length > 0
      ? actions.reduce((sum, a) => sum + Number(a.confidence), 0) / actions.length
      : null;

    // Upsert daily metrics
    await prisma.agentMetricsDaily.upsert({
      where: { firmId_date: { firmId: firm.id, date: today } },
      update: {
        emailsReceived,
        emailsProcessed,
        emailsNotInsurance,
        actionsCreated,
        actionsConfirmed,
        actionsModified,
        actionsRejected,
        actionsAutoExecuted,
        avgConfidence,
        timeSavedMinutes: emailsProcessed * 3,
      },
      create: {
        firmId: firm.id,
        date: today,
        emailsReceived,
        emailsProcessed,
        emailsNotInsurance,
        actionsCreated,
        actionsConfirmed,
        actionsModified,
        actionsRejected,
        actionsAutoExecuted,
        avgConfidence,
        timeSavedMinutes: emailsProcessed * 3,
      },
    });

    // Send daily digest after metrics aggregation
    try {
      await sendDailyDigest(firm.id);
    } catch (err) {
      console.error(`Failed to send daily digest for firm ${firm.id}:`, err);
    }
      }),
    );
    results.push(...batchResults);
  }

  // Log any failed firm aggregations
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[aggregateDailyMetrics] Firm processing failed:', result.reason);
    }
  }
}

export async function detectStaleEmails(): Promise<number> {
  const staleThreshold = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes

  const staleEmails = await prisma.incomingEmail.findMany({
    where: {
      status: 'processing',
      processingStartedAt: { lt: staleThreshold },
    },
    select: { id: true },
  });

  let requeued = 0;
  for (const email of staleEmails) {
    await prisma.incomingEmail.update({
      where: { id: email.id },
      data: {
        status: 'pending_processing',
        processingStartedAt: null,
        errorMessage: 'Processing timeout, re-queued',
      },
    });
    requeued++;
  }

  if (requeued > 0) {
    console.warn(`Re-queued ${requeued} stale emails`);
  }

  return requeued;
}

// Run as standalone script
if (require.main === module) {
  async function main() {
    const command = process.argv[2];

    switch (command) {
      case 'process':
        const count = await processPendingEmails();
        console.log(`Processed ${count} emails`);
        break;
      case 'metrics':
        await aggregateDailyMetrics();
        console.log('Daily metrics aggregated');
        break;
      case 'stale':
        const requeued = await detectStaleEmails();
        console.log(`Re-queued ${requeued} stale emails`);
        break;
      case 'poll':
        const newEmails = await pollConnectedMailboxes();
        const imapNew = await pollIMAPConnections();
        console.log(`Polled mailboxes: ${newEmails + imapNew} new emails`);
        break;
      case 'all':
        await detectStaleEmails();
        await pollConnectedMailboxes();
        await pollIMAPConnections();
        const processed = await processPendingEmails();
        await aggregateDailyMetrics();
        console.log(`Done: ${processed} emails processed`);
        break;
      default:
        console.log('Usage: tsx src/worker/agent-worker.ts [process|metrics|stale|all]');
    }

    await prisma.$disconnect();
  }

  main().catch(console.error);
}
