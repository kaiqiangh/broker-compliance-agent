import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';

// ─── Redis connection ───────────────────────────────────────
let connection: Redis | null = null;

function getRedisConnection(): Redis | null {
  if (connection) return connection;
  const url = process.env.REDIS_URL;
  if (!url) return null;

  connection = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
    retryStrategy(times) {
      if (times > 3) return null;
      return Math.min(times * 200, 2000);
    },
  });

  connection.on('error', (err) => {
    console.error('[BullMQ Redis] Error:', err.message);
  });

  connection.connect().catch(() => {
    console.warn('[BullMQ Redis] Failed to connect');
    connection = null;
  });

  return connection;
}

// ─── Queues ─────────────────────────────────────────────────
let emailQueue: Queue | null = null;
let metricsQueue: Queue | null = null;
let digestQueue: Queue | null = null;

function getEmailQueue(): Queue | null {
  const conn = getRedisConnection();
  if (!conn) return null;
  if (!emailQueue) {
    emailQueue = new Queue('agent:emails', {
      connection: conn,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    });
  }
  return emailQueue;
}

function getMetricsQueue(): Queue | null {
  const conn = getRedisConnection();
  if (!conn) return null;
  if (!metricsQueue) {
    metricsQueue = new Queue('agent:metrics', { connection: conn });
  }
  return metricsQueue;
}

function getDigestQueue(): Queue | null {
  const conn = getRedisConnection();
  if (!conn) return null;
  if (!digestQueue) {
    digestQueue = new Queue('agent:digest', { connection: conn });
  }
  return digestQueue;
}

// ─── Workers (only start if Redis available) ─────────────────
let workersStarted = false;

function startWorkers() {
  if (workersStarted) return;
  const conn = getRedisConnection();
  if (!conn) return;

  workersStarted = true;

  // Email processing worker — 10 concurrent jobs per PRD §10
  const emailWorker = new Worker(
    'agent:emails',
    async (job) => {
      if (job.name === 'process_email') {
        const { processEmail } = await import('@/services/agent/pipeline');
        await processEmail(job.data.emailId);
      }
    },
    {
      connection: conn,
      concurrency: parseInt(process.env.AGENT_BATCH_SIZE || '10', 10),
      limiter: { max: 100, duration: 60000 },
    }
  );

  emailWorker.on('failed', (job, err) => {
    console.error(`[BullMQ] Email job ${job?.id} failed (attempt ${job?.attemptsMade}/${job?.opts.attempts}):`, err.message);
  });

  // Metrics worker
  const metricsWorker = new Worker(
    'agent:metrics',
    async () => {
      const { aggregateDailyMetrics } = await import('@/worker/agent-runtime');
      await aggregateDailyMetrics();
    },
    { connection: conn }
  );

  // Digest worker
  const digestWorker = new Worker(
    'agent:digest',
    async (job) => {
      const { sendDailyDigest } = await import('@/services/agent/notifications');
      await sendDailyDigest(job.data.firmId);
    },
    { connection: conn }
  );

  console.log('[BullMQ] Workers started');
}

// Auto-start workers when module loads (if Redis available)
startWorkers();

// ─── Schedule daily metrics aggregation ─────────────────────
async function scheduleDailyMetrics() {
  const q = getMetricsQueue();
  if (!q) return;

  // Remove any existing repeatable jobs
  const repeatables = await q.getRepeatableJobs();
  for (const job of repeatables) {
    await q.removeRepeatableByKey(job.key);
  }

  // Add daily job at 00:05 UTC
  await q.add('aggregate_metrics', {}, {
    repeat: { pattern: '5 0 * * *' }, // cron: 5 minutes past midnight
    removeOnComplete: 5,
    removeOnFail: 10,
  });

  console.log('[BullMQ] Scheduled daily metrics aggregation at 00:05 UTC');
}

scheduleDailyMetrics().catch(err => {
  console.error('[BullMQ] Failed to schedule metrics:', err.message);
});

// ─── Startup metrics run (in-memory fallback) ───────────────
if (!getRedisConnection()) {
  import('@/worker/agent-runtime').then(({ aggregateDailyMetrics }) => {
    aggregateDailyMetrics().catch(() => {});
  });
}

// ─── Compatibility API ──────────────────────────────────────
export interface QueueJob {
  type: 'process_email' | 'aggregate_metrics' | 'send_digest';
  data: Record<string, any>;
}

// In-memory fallback (original implementation)
const memoryQueue: QueueJob[] = [];
let memoryProcessing = false;

async function processMemoryJob() {
  if (memoryProcessing || memoryQueue.length === 0) return;
  memoryProcessing = true;

  const job = memoryQueue.shift()!;
  try {
    switch (job.type) {
      case 'process_email': {
        const { processEmail } = await import('@/services/agent/pipeline');
        await processEmail(job.data.emailId);
        break;
      }
      case 'aggregate_metrics': {
        const { aggregateDailyMetrics } = await import('@/worker/agent-runtime');
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
    memoryProcessing = false;
    if (memoryQueue.length > 0) {
      processMemoryJob();
    }
  }
}

export async function enqueueJob(job: QueueJob): Promise<void> {
  // Try BullMQ first, fall back to in-memory
  let queue: Queue | null = null;

  switch (job.type) {
    case 'process_email':
      queue = getEmailQueue();
      break;
    case 'aggregate_metrics':
      queue = getMetricsQueue();
      break;
    case 'send_digest':
      queue = getDigestQueue();
      break;
  }

  if (queue) {
    await queue.add(job.type, job.data);
    return;
  }

  // In-memory fallback
  memoryQueue.push(job);
  processMemoryJob();
}

export async function getQueueStatus() {
  const q = getEmailQueue();
  if (q) {
    return q.getJobCounts('waiting', 'active', 'completed', 'failed');
  }
  return { pending: memoryQueue.length, processing: memoryProcessing };
}
