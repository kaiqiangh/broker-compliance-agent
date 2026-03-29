import { prisma } from '../lib/prisma';
import { NotificationService } from '../services/notification-service';
import { DocumentService } from '../services/document-service';
import { htmlToPdf } from '../lib/pdf';
import { promises as fs } from 'fs';
import path from 'path';

const POLL_INTERVAL_MS = 30_000; // 30 seconds
const RETRY_BACKOFF_MS = 5 * 60 * 1000; // 5 minutes base
const MAX_ATTEMPTS = 3;

let isShuttingDown = false;

async function main() {
  console.log('[Worker] Starting...');

  // Catch up on missed reminders from downtime
  const notificationService = new NotificationService();
  const catchUpCount = await notificationService.checkAndScheduleReminders();
  if (catchUpCount > 0) console.log(`[Worker] Catch-up: scheduled ${catchUpCount} missed reminders`);

  // Main loop
  while (!isShuttingDown) {
    try {
      const processed = await processJobs();
      if (processed > 0) console.log(`[Worker] Processed ${processed} jobs`);
    } catch (err) {
      console.error('[Worker] Job processing failed:', err);
    }

    await sleep(POLL_INTERVAL_MS);
  }

  console.log('[Worker] Shut down gracefully');
  process.exit(0);
}

async function processJobs(): Promise<number> {
  const now = new Date();

  // Claim jobs atomically
  const jobs = await prisma.$queryRawUnsafe<Array<{
    id: string;
    job_type: string;
    payload: any;
    attempts: number;
    max_attempts: number;
  }>>(
    `UPDATE scheduled_jobs
     SET status = 'running', started_at = NOW(), attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM scheduled_jobs
       WHERE status = 'pending' AND scheduled_for <= $1
       ORDER BY scheduled_for
       LIMIT 10
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, job_type, payload, attempts, max_attempts`,
    now
  );

  let processed = 0;

  for (const job of jobs) {
    try {
      await executeJob(job.job_type, job.payload);

      await prisma.scheduledJob.update({
        where: { id: job.id },
        data: { status: 'completed', completedAt: new Date() },
      });
      processed++;
    } catch (err) {
      const errorMessage = (err as Error).message;

      if (job.attempts >= job.max_attempts) {
        await prisma.scheduledJob.update({
          where: { id: job.id },
          data: { status: 'failed', lastError: errorMessage },
        });
        console.error(`[Worker] Job ${job.id} permanently failed: ${errorMessage}`);
      } else {
        // Retry with exponential backoff
        const retryDelay = RETRY_BACKOFF_MS * Math.pow(2, job.attempts - 1);
        const retryAt = new Date(Date.now() + retryDelay);

        await prisma.scheduledJob.update({
          where: { id: job.id },
          data: {
            status: 'pending',
            scheduledFor: retryAt,
            lastError: errorMessage,
          },
        });
        console.log(`[Worker] Job ${job.id} retry ${job.attempts}/${job.max_attempts} at ${retryAt.toISOString()}`);
      }
    }
  }

  return processed;
}

async function executeJob(jobType: string, payload: any) {
  switch (jobType) {
    case 'send_renewal_reminder': {
      const notificationService = new NotificationService();
      await notificationService.checkAndScheduleReminders();
      break;
    }
    case 'generate_document': {
      const { firmId, renewalId, documentType, generatedBy } = payload;
      if (!firmId || !renewalId || !documentType || !generatedBy) {
        throw new Error('generate_document requires firmId, renewalId, documentType, generatedBy');
      }

      const docService = new DocumentService();

      // Generate HTML
      const result = await docService.generate(
        firmId,
        renewalId,
        documentType,
        generatedBy
      );

      // Convert to PDF
      const pdfBuffer = await htmlToPdf(result.html);

      // Store PDF locally
      const uploadDir = path.join(process.cwd(), 'uploads', firmId, renewalId);
      await fs.mkdir(uploadDir, { recursive: true });
      const fileName = `${documentType}.pdf`;
      const filePath = path.join(uploadDir, fileName);
      await fs.writeFile(filePath, pdfBuffer);

      const fileUrl = `/api/files/${firmId}/${renewalId}/${fileName}`;

      // Update document record
      await prisma.document.update({
        where: { id: result.id },
        data: {
          status: 'completed',
          fileUrl,
        },
      });

      console.log(`[Worker] Document generated: ${documentType} for renewal ${renewalId} → ${fileUrl}`);
      break;
    }
    case 'gdpr_erasure': {
      // GDPR erasure placeholder
      console.log(`[Worker] GDPR erasure: ${JSON.stringify(payload)}`);
      break;
    }
    default:
      console.warn(`[Worker] Unknown job type: ${jobType}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Graceful shutdown
process.on('SIGTERM', () => { isShuttingDown = true; });
process.on('SIGINT', () => { isShuttingDown = true; });

main().catch(err => {
  console.error('[Worker] Fatal error:', err);
  process.exit(1);
});
