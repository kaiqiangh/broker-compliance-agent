import { prisma } from '@/lib/prisma';
import { EmailService } from '@/services/email-service';

const emailService = new EmailService();

const URGENT_ACTION_TYPES = ['update_claim', 'cancel_policy'];

/**
 * Send daily digest to compliance officers / firm admins.
 * Includes: processed email count, pending actions, confirmed/rejected counts, accuracy %.
 */
export async function sendDailyDigest(firmId: string): Promise<void> {
  // Check if digest is enabled
  const config = await prisma.emailIngressConfig.findUnique({
    where: { firmId },
    select: { digestEnabled: true, digestTime: true },
  });

  if (config && config.digestEnabled === false) return;

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
 * Send notification when an action is auto-executed.
 * Includes an undo link for the 24h reversal window.
 */
export async function sendAutoExecuteNotification(firmId: string, actionId: string): Promise<void> {
  const action = await prisma.agentAction.findUnique({
    where: { id: actionId },
    include: {
      email: { select: { subject: true, fromAddress: true } },
    },
  });

  if (!action) {
    console.error(`Auto-execute notification: action ${actionId} not found`);
    return;
  }

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
  <h2 style="color: #2563eb;">Agent Auto-Executed Action</h2>
  <p>An action was executed automatically based on your configuration.</p>
  <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
    <tr><td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>Firm</strong></td><td style="padding: 8px; border: 1px solid #e5e7eb;">${firm?.name ?? 'Unknown'}</td></tr>
    <tr><td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>Action Type</strong></td><td style="padding: 8px; border: 1px solid #e5e7eb;">${action.actionType}</td></tr>
    <tr><td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>Confidence</strong></td><td style="padding: 8px; border: 1px solid #e5e7eb;">${Math.round(Number(action.confidence) * 100)}%</td></tr>
    <tr><td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>Email Subject</strong></td><td style="padding: 8px; border: 1px solid #e5e7eb;">${action.email?.subject ?? 'N/A'}</td></tr>
    <tr><td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>From</strong></td><td style="padding: 8px; border: 1px solid #e5e7eb;">${action.email?.fromAddress ?? 'N/A'}</td></tr>
  </table>
  <p><a href="${appUrl}/agent/actions/${action.id}" style="display: inline-block; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px;">Review &amp; Undo if Needed</a></p>
  <p style="color: #6b7280; font-size: 12px;">You can undo this action within 24 hours. This is an automated notification from BrokerComply Agent.</p>
</body>
</html>`;

  for (const user of users) {
    try {
      await emailService.send({
        to: user.email,
        subject: `Auto-executed: ${action.actionType} — review within 24h`,
        html,
      });
    } catch (err) {
      console.error(`Failed to send auto-execute notification to ${user.email}:`, err);
    }
  }
}

/**
 * Send urgent notification for high-priority actions.
 * Triggers on: claims, cancellations, confidence < 0.5.
 */
export async function sendUrgentNotification(firmId: string, actionId: string): Promise<void> {
  // Check if urgent notifications are enabled
  const notifConfig = await prisma.emailIngressConfig.findUnique({
    where: { firmId },
    select: { urgentNotifications: true },
  });

  if (notifConfig && notifConfig.urgentNotifications === false) return;

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

/**
 * Check accuracy trend for a firm. If accuracy has declined for 3 consecutive days,
 * send an alert email to compliance officers.
 */
export async function checkAccuracyTrend(firmId: string): Promise<void> {
  const config = await prisma.emailIngressConfig.findUnique({
    where: { firmId },
    select: { urgentNotifications: true },
  });

  if (config && config.urgentNotifications === false) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Get last 5 days of metrics (today + 4 past days — today may be partial)
  const metrics = await prisma.agentMetricsDaily.findMany({
    where: { firmId },
    orderBy: { date: 'desc' },
    take: 5,
    select: {
      date: true,
      actionsConfirmed: true,
      actionsRejected: true,
      actionsModified: true,
    },
  });

  // Need at least 4 days (3 past + today) to detect trend
  if (metrics.length < 4) return;

  // Calculate accuracy for each day: (confirmed + modified) / (confirmed + rejected + modified)
  const accuracies = metrics.map((m) => {
    const decided = m.actionsConfirmed + m.actionsRejected + m.actionsModified;
    return decided > 0 ? (m.actionsConfirmed + m.actionsModified) / decided : null;
  });

  // Check for 3 consecutive days of declining accuracy
  // Skip index 0 (today — partial data), compare past completed days
  let consecutiveDeclines = 0;
  for (let i = 1; i < accuracies.length - 1; i++) {
    if (accuracies[i] !== null && accuracies[i + 1] !== null) {
      if (accuracies[i]! < accuracies[i + 1]!) {
        consecutiveDeclines++;
      } else {
        consecutiveDeclines = 0;
      }
    }
  }

  if (consecutiveDeclines < 3) return;

  // Send alert
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
  <h2 style="color: #dc2626;">⚠️ Agent Accuracy Declining — ${firm?.name ?? 'Your Firm'}</h2>
  <p>Agent accuracy has declined for 3 consecutive days. This may indicate model drift or changing insurer patterns.</p>
  <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
    ${metrics.map((m, i) => {
      const decided = m.actionsConfirmed + m.actionsRejected + m.actionsModified;
      const acc = decided > 0 ? Math.round(((m.actionsConfirmed + m.actionsModified) / decided) * 100) : 'N/A';
      return `<tr><td style="padding: 8px; border: 1px solid #e5e7eb;">${m.date.toISOString().split('T')[0]}</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${acc === 'N/A' ? 'N/A' : acc + '%'}</td></tr>`;
    }).join('\n    ')}
  </table>
  <p><a href="${appUrl}/agent" style="display: inline-block; padding: 12px 24px; background: #dc2626; color: white; text-decoration: none; border-radius: 6px;">Review Agent Performance</a></p>
  <p style="color: #6b7280; font-size: 12px;">This is an automated accuracy trend alert from BrokerComply Agent.</p>
</body>
</html>`;

  for (const user of users) {
    try {
      await emailService.send({
        to: user.email,
        subject: `⚠️ Agent accuracy declining for 3 days — ${firm?.name ?? 'Your Firm'}`,
        html,
      });
    } catch (err) {
      console.error(`Failed to send accuracy trend alert to ${user.email}:`, err);
    }
  }
}
