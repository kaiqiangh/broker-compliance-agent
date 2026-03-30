import { prisma } from '@/lib/prisma';
import { EmailService } from '@/services/email-service';

const emailService = new EmailService();

export async function sendDailyDigest(firmId: string): Promise<void> {
  const pending = await prisma.agentAction.count({
    where: { firmId, status: 'pending' },
  });

  if (pending === 0) return;

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const processed = await prisma.incomingEmail.count({
    where: { firmId, status: 'processed', processedAt: { gte: yesterday } },
  });

  const users = await prisma.user.findMany({
    where: {
      firmId,
      isActive: true,
      role: { in: ['firm_admin', 'compliance_officer'] },
    },
    select: { email: true, name: true },
  });

  const appUrl = process.env.APP_URL || 'https://app.brokercomply.ie';

  for (const user of users) {
    try {
      await emailService.send({
        to: user.email,
        subject: `Agent Daily Digest: ${pending} action${pending > 1 ? 's' : ''} need${pending === 1 ? 's' : ''} review`,
        html: `
          <h2>Good morning, ${user.name}</h2>
          <p>Yesterday, your agent processed <strong>${processed} email${processed !== 1 ? 's' : ''}</strong>.</p>
          <p><strong>${pending} action${pending > 1 ? 's' : ''}</strong> ${pending > 1 ? 'are' : 'is'} waiting for your review.</p>
          <p><a href="${appUrl}/agent">Review pending actions →</a></p>
        `,
      });
    } catch (err) {
      console.error(`Failed to send digest to ${user.email}:`, err);
    }
  }
}
