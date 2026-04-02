import { prisma } from '../lib/prisma';
import { processEmail } from '../services/agent/pipeline';
import { checkAccuracyTrend, sendDailyDigest } from '../services/agent/notifications';
import { pollConnectedMailboxes } from '../lib/email/oauth/poller';
import { pollIMAPConnections } from '../lib/email/imap/poller';

export const MAILBOX_POLL_INTERVAL_MS = 60_000;

export interface AgentMaintenanceState {
  lastMailboxPollAt: number;
  lastMetricsDate: string | null;
}

export interface AgentMaintenanceTickResult {
  requeuedEmails: number;
  processedEmails: number;
  polledEmails: number;
  aggregatedMetrics: boolean;
}

interface AgentMaintenanceDeps {
  detectStaleEmails: typeof detectStaleEmails;
  processPendingEmails: typeof processPendingEmails;
  pollConnectedMailboxes: typeof pollConnectedMailboxes;
  pollIMAPConnections: typeof pollIMAPConnections;
  hasAggregatedMetricsForDate: typeof hasAggregatedMetricsForDate;
  aggregateDailyMetrics: typeof aggregateDailyMetrics;
}

const defaultAgentMaintenanceDeps: AgentMaintenanceDeps = {
  detectStaleEmails,
  processPendingEmails,
  pollConnectedMailboxes,
  pollIMAPConnections,
  hasAggregatedMetricsForDate,
  aggregateDailyMetrics,
};

export function createAgentMaintenanceState(now: Date = new Date()): AgentMaintenanceState {
  return {
    lastMailboxPollAt: now.getTime() - MAILBOX_POLL_INTERVAL_MS,
    lastMetricsDate: null,
  };
}

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
    }
  }

  return processed;
}

export async function aggregateDailyMetrics(): Promise<void> {
  const today = normalizeStartOfDay(new Date());

  const firms = await prisma.firm.findMany({
    where: {
      emailIngressConfig: { isNot: null },
    },
    select: { id: true },
  });

  const maxConcurrency = 5;
  const results: PromiseSettledResult<void>[] = [];

  for (let i = 0; i < firms.length; i += maxConcurrency) {
    const batch = firms.slice(i, i + maxConcurrency);
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

        const actions = await prisma.agentAction.findMany({
          where: { firmId: firm.id, createdAt: { gte: today } },
          select: { confidence: true },
        });

        const avgConfidence =
          actions.length > 0
            ? actions.reduce((sum, action) => sum + Number(action.confidence), 0) / actions.length
            : null;

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
            // Estimate: ~3 min saved per email (avg manual processing time)
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
            // Estimate: ~3 min saved per email (avg manual processing time)
            timeSavedMinutes: emailsProcessed * 3,
          },
        });

        try {
          await checkAccuracyTrend(firm.id);
        } catch (error) {
          console.error(`Failed to check accuracy trend for firm ${firm.id}:`, error);
        }

        try {
          await sendDailyDigest(firm.id);
        } catch (error) {
          console.error(`Failed to send daily digest for firm ${firm.id}:`, error);
        }
      })
    );

    results.push(...batchResults);
  }

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[aggregateDailyMetrics] Firm processing failed:', result.reason);
    }
  }
}

export async function detectStaleEmails(): Promise<number> {
  const staleThreshold = new Date(Date.now() - 5 * 60 * 1000);

  // FIX: Atomic updateMany — no TOCTOU window where a completing email
  // gets reset back to pending_processing after finishing successfully.
  // If the email transitions to 'processed' between our check and update,
  // the WHERE clause won't match and it won't be touched.
  const result = await prisma.incomingEmail.updateMany({
    where: {
      status: 'processing',
      processingStartedAt: { lt: staleThreshold },
    },
    data: {
      status: 'pending_processing',
      processingStartedAt: null,
      errorMessage: 'Processing timeout, re-queued',
    },
  });

  if (result.count > 0) {
    console.warn(`Re-queued ${result.count} stale emails`);
  }

  return result.count;
}

export async function hasAggregatedMetricsForDate(date: Date): Promise<boolean> {
  const count = await prisma.agentMetricsDaily.count({
    where: {
      date: normalizeStartOfDay(date),
    },
  });

  return count > 0;
}

export async function runAgentMaintenanceTick(
  state: AgentMaintenanceState,
  now: Date = new Date(),
  deps: AgentMaintenanceDeps = defaultAgentMaintenanceDeps
): Promise<AgentMaintenanceTickResult> {
  const requeuedEmails = await deps.detectStaleEmails();
  const processedEmails = await deps.processPendingEmails();

  let polledEmails = 0;
  if (now.getTime() - state.lastMailboxPollAt >= MAILBOX_POLL_INTERVAL_MS) {
    const [oauthEmails, imapEmails] = await Promise.all([
      deps.pollConnectedMailboxes(),
      deps.pollIMAPConnections(),
    ]);
    polledEmails = oauthEmails + imapEmails;
    state.lastMailboxPollAt = now.getTime();
  }

  let aggregatedMetrics = false;
  const metricsDateKey = normalizeStartOfDay(now).toISOString().slice(0, 10);
  if (state.lastMetricsDate !== metricsDateKey) {
    const alreadyAggregated = await deps.hasAggregatedMetricsForDate(now);
    if (!alreadyAggregated) {
      await deps.aggregateDailyMetrics();
      aggregatedMetrics = true;
    }
    state.lastMetricsDate = metricsDateKey;
  }

  return {
    requeuedEmails,
    processedEmails,
    polledEmails,
    aggregatedMetrics,
  };
}

// Renamed to avoid confusion with date utility libraries
function normalizeStartOfDay(date: Date): Date {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}
