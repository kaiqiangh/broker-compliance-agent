import { prisma } from '@/lib/prisma';
import { EmailService } from '@/services/email-service';

const emailService = new EmailService();

const URGENT_ACTION_TYPES = ['update_claim', 'cancel_policy'];

/**
 * Send daily digest to compliance officers / firm admins.
 * Includes: processed email count, pending actions, confirmed/rejected counts, accuracy %.
 */
export async function sendDailyDigest(firmId: string): Promise<void> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    emailsProcessed,
    pendingActions,
    confirmed,
    rejected,
    modified,
    actions,
  ] = await Promise.all([
    prisma.incomingEmail.count({
      where: { firmId, status: 'processed', processedAt: { gte: today } },
    }),
    prisma.agentAction.count({
      where: { firmId, status: 'pending' },
    }),
    prisma.agentAction.count({
      where: { firmId, status: 'confirmed', confirmedAt: { gte: today } },
    }),
    prisma.agentAction.count({
      where: { firmId, status: 'rejected', createdAt: { gte: today } },
    }),
    prisma.agentAction.count({
      where: { firmId, status: 'modified', confirmedAt: { gte: today } },
    }),
    prisma.agentAction.findMany({
      where: { firmId, createdAt: { gte: today } },
      select: { confidence: true },
    }),
  ]);

  // Accuracy: confirmed + modified as % of total decided actions
  const decided = confirmed + rejected + modified;
  const accuracyPct = decided > 0 ? Math.round(((confirmed + modified) / decided) * 100) : null;

  const avgConfidence =
    actions.length > 0
      ? Math.round(
          (actions.reduce((sum, a) => sum + Number(a.confidence), 0) / actions.length) * 100
        )
      : null;

  // Skip if nothing happened today
  if (emailsProcessed === 0 && pendingActions === 0) return;

  const users = await prisma.user.findMany({
    where: {
      firmId,
      isActive: true,
      role: { in: ['firm_admin', 'compliance_officer'] },
    },
    select: { email: true, name: true },
  });

  if (users.length === 0) return;

  const firm = await prisma.firm.findUnique({
    where: { id: firmId },
    select: { name: true },
  });

  const appUrl = process.env.APP_URL || 'https://app.brokercomply.ie';

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #2563eb;">Agent Daily Digest — ${firm?.name ?? 'Your Firm'}</h2>
  <p>Here's your agent activity summary for today:</p>
  <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
    <tr><td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>Emails Processed</strong></td><td style="padding: 8px; border: 1px solid #e5e7eb;">${emailsProcessed}</td></tr>
    <tr><td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>Pending Actions</strong></td><td style="padding: 8px; border: 1px solid #e5e7eb;">${pendingActions}</td></tr>
    <tr><td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>Confirmed Today</strong></td><td style="padding: 8px; border: 1px solid #e5e7eb;">${confirmed}</td></tr>
    <tr><td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>Rejected Today</strong></td><td style="padding: 8px; border: 1px solid #e5e7eb;">${rejected}</td></tr>
    <tr><td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>Modified Today</strong></td><td style="padding: 8px; border: 1px solid #e5e7eb;">${modified}</td></tr>
    ${accuracyPct !== null ? `<tr><td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>Accuracy</strong></td><td style="padding: 8px; border: 1px solid #e5e7eb;">${accuracyPct}%</td></tr>` : ''}
    ${avgConfidence !== null ? `<tr><td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>Avg Confidence</strong></td><td style="padding: 8px; border: 1px solid #e5e7eb;">${avgConfidence}%</td></tr>` : ''}
  </table>
  ${pendingActions > 0 ? `<p><a href="${appUrl}/agent" style="display: inline-block; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px;">Review ${pendingActions} Pending Action${pendingActions > 1 ? 's' : ''}</a></p>` : '<p>All caught up — no pending actions.</p>'}
  <p style="color: #6b7280; font-size: 12px;">This is an automated daily digest from BrokerComply Agent.</p>
</body>
</html>`;

  for (const user of users) {
    try {
      await emailService.send({
        to: user.email,
        subject: `Agent Daily Digest: ${pendingActions} pending action${pendingActions !== 1 ? 's' : ''} | ${emailsProcessed} emails processed`,
        html,
      });
    } catch (err) {
      console.error(`Failed to send digest to ${user.email}:`, err);
    }
  }
}

/**
 * Send urgent notification for high-priority actions.
 * Triggers on: claims, cancellations, confidence < 0.5.
 */
export async function sendUrgentNotification(firmId: string, actionId: string): Promise<void> {
  const action = await prisma.agentAction.findUnique({
    where: { id: actionId },
    include: {
      email: { select: { subject: true, fromAddress: true } },
    },
  });

  if (!action) {
    console.error(`Urgent notification: action ${actionId} not found`);
    return;
  }

  const confidence = Number(action.confidence);
  const isUrgent =
    URGENT_ACTION_TYPES.includes(action.actionType) || confidence < 0.5;

  if (!isUrgent) return;

  const users = await prisma.user.findMany({
    where: {
      firmId,
      isActive: true,
      role: { in: ['firm_admin', 'compliance_officer'] },
    },
    select: { email: true, name: true },
  });

  if (users.length === 0) return;

  const firm = await prisma.firm.findUnique({
    where: { id: firmId },
    select: { name: true },
  });

  const appUrl = process.env.APP_URL || 'https://app.brokercomply.ie';

  const reason = confidence < 0.5
    ? `Low confidence (${Math.round(confidence * 100)}%)`
    : action.actionType === 'update_claim'
      ? 'Claim update detected'
      : 'Cancellation detected';

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #dc2626;">⚠️ Urgent: Agent Action Requires Review</h2>
  <p>${reason} — immediate review recommended.</p>
  <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
    <tr><td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>Firm</strong></td><td style="padding: 8px; border: 1px solid #e5e7eb;">${firm?.name ?? 'Unknown'}</td></tr>
    <tr><td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>Action Type</strong></td><td style="padding: 8px; border: 1px solid #e5e7eb;">${action.actionType}</td></tr>
    <tr><td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>Confidence</strong></td><td style="padding: 8px; border: 1px solid #e5e7eb;">${Math.round(confidence * 100)}%</td></tr>
    <tr><td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>Email Subject</strong></td><td style="padding: 8px; border: 1px solid #e5e7eb;">${action.email?.subject ?? 'N/A'}</td></tr>
    <tr><td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>From</strong></td><td style="padding: 8px; border: 1px solid #e5e7eb;">${action.email?.fromAddress ?? 'N/A'}</td></tr>
  </table>
  <p><a href="${appUrl}/agent/actions/${action.id}" style="display: inline-block; padding: 12px 24px; background: #dc2626; color: white; text-decoration: none; border-radius: 6px;">Review Action Now</a></p>
  <p style="color: #6b7280; font-size: 12px;">This is an automated urgent alert from BrokerComply Agent.</p>
</body>
</html>`;

  for (const user of users) {
    try {
      await emailService.send({
        to: user.email,
        subject: `URGENT: ${reason} — action needs review`,
        html,
      });
    } catch (err) {
      console.error(`Failed to send urgent notification to ${user.email}:`, err);
    }
  }
}
