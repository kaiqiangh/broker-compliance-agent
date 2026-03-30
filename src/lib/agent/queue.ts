/**
 * Simple async job queue.
 * In-memory with serial processing. For production, replace with BullMQ + Redis.
 */

interface QueueJob {
  type: 'process_email' | 'aggregate_metrics' | 'send_digest';
  data: Record<string, any>;
}

const queue: QueueJob[] = [];
let processing = false;

export async function enqueueJob(job: QueueJob): Promise<void> {
  queue.push(job);
  processNextJob();
}

async function processNextJob(): Promise<void> {
  if (processing || queue.length === 0) return;
  processing = true;

  const job = queue.shift()!;
  try {
    switch (job.type) {
      case 'process_email': {
        const { processEmail } = await import('@/services/agent/pipeline');
        await processEmail(job.data.emailId);
        break;
      }
      case 'aggregate_metrics': {
        const { aggregateDailyMetrics } = await import('@/worker/agent-worker');
        await aggregateDailyMetrics();
        break;
      }
      case 'send_digest': {
        const { sendDailyDigest } = await import('@/services/agent/notifications');
        await sendDailyDigest(job.data.firmId);
        break;
      }
    }
  } catch (err) {
    console.error(`[Queue] Job ${job.type} failed:`, err);
  } finally {
    processing = false;
    if (queue.length > 0) {
      processNextJob();
    }
  }
}

export function getQueueStatus() {
  return { pending: queue.length, processing };
}
