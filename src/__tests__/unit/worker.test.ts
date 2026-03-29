import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock all external dependencies before importing the worker
vi.mock('../../lib/prisma', () => ({
  prisma: {
    $queryRawUnsafe: vi.fn(),
    scheduledJob: {
      update: vi.fn(),
    },
    auditEvent: {
      create: vi.fn(),
    },
    client: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    policy: {
      findMany: vi.fn(),
    },
    renewal: {
      findMany: vi.fn(),
    },
    checklistItem: {
      updateMany: vi.fn(),
    },
    $executeRaw: vi.fn(),
  },
}));

vi.mock('../../services/notification-service', () => ({
  NotificationService: vi.fn().mockImplementation(() => ({
    checkAndScheduleReminders: vi.fn().mockResolvedValue(0),
  })),
}));

vi.mock('../../services/document-service', () => ({
  DocumentService: vi.fn().mockImplementation(() => ({
    generate: vi.fn(),
  })),
}));

vi.mock('../../lib/pdf', () => ({
  htmlToPdf: vi.fn(),
}));

vi.mock('fs', () => ({
  promises: {
    mkdir: vi.fn(),
    writeFile: vi.fn(),
  },
}));

import { prisma } from '../../lib/prisma';
import { NotificationService } from '../../services/notification-service';
import { DocumentService } from '../../services/document-service';
import {
  processJobs,
  RETRY_BACKOFF_MS,
  MAX_ATTEMPTS,
  setShuttingDown,
  getIsShuttingDown,
} from '../../worker/index';

// Worker tests — job claiming + retry logic

describe('Worker — processJobs()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setShuttingDown(false);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Re-configure NotificationService mock after clearAllMocks
    (NotificationService as any).mockImplementation(() => ({
      checkAndScheduleReminders: vi.fn().mockResolvedValue(0),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 1. Job claiming — pending job with scheduledFor <= now → claimed and processed
  it('claims and processes pending jobs with scheduledFor <= now', async () => {
    const pendingJob = {
      id: 'job-1',
      job_type: 'send_renewal_reminder',
      payload: {},
      attempts: 1,
      max_attempts: 3,
    };

    (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue([pendingJob]);
    (prisma.scheduledJob.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const processed = await processJobs();

    expect(processed).toBe(1);
    // Should have claimed jobs via queryRawUnsafe
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    // Should have marked job as completed
    expect(prisma.scheduledJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { status: 'completed', completedAt: expect.any(Date) },
    });
  });

  it('processes multiple jobs in one batch', async () => {
    const jobs = [
      { id: 'job-1', job_type: 'send_renewal_reminder', payload: {}, attempts: 1, max_attempts: 3 },
      { id: 'job-2', job_type: 'send_renewal_reminder', payload: {}, attempts: 1, max_attempts: 3 },
    ];

    (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue(jobs);
    (prisma.scheduledJob.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const processed = await processJobs();

    expect(processed).toBe(2);
    expect(prisma.scheduledJob.update).toHaveBeenCalledTimes(2);
  });

  it('returns 0 when no pending jobs exist', async () => {
    (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const processed = await processJobs();

    expect(processed).toBe(0);
    expect(prisma.scheduledJob.update).not.toHaveBeenCalled();
  });

  // 2. Completed jobs are not re-processed (they're filtered by the SQL query)
  it('only claims jobs with status=pending (SQL filter)', async () => {
    (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await processJobs();

    // Verify the SQL query filters on status='pending'
    const sqlQuery = (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sqlQuery).toContain("status = 'pending'");
    expect(sqlQuery).toContain('scheduled_for <= $1');
  });

  // 3. Failed job transitions to failed after max attempts
  it('marks job as failed when attempts >= maxAttempts', async () => {
    const failedJob = {
      id: 'job-fail',
      job_type: 'generate_document',
      payload: { firmId: 'f1', renewalId: 'r1', documentType: 'suitability', generatedBy: 'u1' },
      attempts: 3,
      max_attempts: 3,
    };

    (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue([failedJob]);
    (DocumentService as any).mockImplementation(() => ({
      generate: vi.fn().mockRejectedValue(new Error('Generation failed')),
    }));

    await processJobs();

    expect(prisma.scheduledJob.update).toHaveBeenCalledWith({
      where: { id: 'job-fail' },
      data: {
        status: 'failed',
        lastError: 'Generation failed',
      },
    });
  });

  // 4. Retry with backoff — failed job with remaining attempts → status=pending, scheduledFor updated
  it('retries failed job with exponential backoff when attempts < maxAttempts', async () => {
    const retryableJob = {
      id: 'job-retry',
      job_type: 'generate_document',
      payload: { firmId: 'f1', renewalId: 'r1', documentType: 'suitability', generatedBy: 'u1' },
      attempts: 1,
      max_attempts: 3,
    };

    (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue([retryableJob]);
    (DocumentService as any).mockImplementation(() => ({
      generate: vi.fn().mockRejectedValue(new Error('Temporary failure')),
    }));

    const beforeTime = Date.now();
    await processJobs();
    const afterTime = Date.now();

    expect(prisma.scheduledJob.update).toHaveBeenCalledWith({
      where: { id: 'job-retry' },
      data: expect.objectContaining({
        status: 'pending',
        lastError: 'Temporary failure',
      }),
    });

    // Verify the scheduledFor is set with backoff
    const updateCall = (prisma.scheduledJob.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const scheduledFor = updateCall.data.scheduledFor as Date;
    const expectedDelay = RETRY_BACKOFF_MS * Math.pow(2, 1 - 1); // attempt=1
    expect(scheduledFor.getTime()).toBeGreaterThanOrEqual(beforeTime + expectedDelay);
    expect(scheduledFor.getTime()).toBeLessThanOrEqual(afterTime + expectedDelay);
  });

  it('increases backoff delay for later attempts', async () => {
    const retryableJob = {
      id: 'job-retry-2',
      job_type: 'generate_document',
      payload: { firmId: 'f1', renewalId: 'r1', documentType: 'suitability', generatedBy: 'u1' },
      attempts: 2,
      max_attempts: 3,
    };

    (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue([retryableJob]);
    (DocumentService as any).mockImplementation(() => ({
      generate: vi.fn().mockRejectedValue(new Error('Still failing')),
    }));

    const beforeTime = Date.now();
    await processJobs();

    const updateCall = (prisma.scheduledJob.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const scheduledFor = updateCall.data.scheduledFor as Date;
    // attempt=2: backoff = 5min * 2^(2-1) = 10min
    const expectedDelay = RETRY_BACKOFF_MS * Math.pow(2, 2 - 1);
    expect(scheduledFor.getTime()).toBeGreaterThanOrEqual(beforeTime + expectedDelay);
  });

  // 5. Graceful shutdown — SIGTERM sets isShuttingDown flag
  it('getIsShuttingDown returns false initially', () => {
    expect(getIsShuttingDown()).toBe(false);
  });

  it('setShuttingDown toggles the shutdown flag', () => {
    setShuttingDown(true);
    expect(getIsShuttingDown()).toBe(true);

    setShuttingDown(false);
    expect(getIsShuttingDown()).toBe(false);
  });

  it('processJobs still works when not shutting down', async () => {
    setShuttingDown(false);
    (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const processed = await processJobs();
    expect(processed).toBe(0);
  });
});

describe('Worker — backoff constants', () => {
  it('RETRY_BACKOFF_MS is 5 minutes', () => {
    expect(RETRY_BACKOFF_MS).toBe(5 * 60 * 1000);
  });

  it('MAX_ATTEMPTS is 3', () => {
    expect(MAX_ATTEMPTS).toBe(3);
  });
});
