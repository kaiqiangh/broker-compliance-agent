import { prisma } from '../lib/prisma';
import { daysBetween } from '../lib/dates';

export type ReminderType = '40_day' | '20_day' | '7_day' | '1_day' | 'overdue';

interface ReminderConfig {
  type: ReminderType;
  daysBeforeExpiry: number;
  recipientRoles: string[];
}

const REMINDER_CONFIGS: ReminderConfig[] = [
  { type: '40_day', daysBeforeExpiry: 40, recipientRoles: ['compliance_officer'] },
  { type: '20_day', daysBeforeExpiry: 20, recipientRoles: ['compliance_officer', 'firm_admin'] },
  { type: '7_day', daysBeforeExpiry: 7, recipientRoles: ['firm_admin', 'compliance_officer', 'adviser'] },
  { type: '1_day', daysBeforeExpiry: 1, recipientRoles: ['firm_admin'] },
  { type: 'overdue', daysBeforeExpiry: 0, recipientRoles: ['firm_admin', 'compliance_officer'] },
];

export class NotificationService {
  /**
   * Check all renewals and schedule reminders that are due.
   * Called by the worker on each processing cycle.
   */
  async checkAndScheduleReminders(): Promise<number> {
    const now = new Date();
    let scheduled = 0;

    for (const config of REMINDER_CONFIGS) {
      // Find renewals that should receive this reminder type.
      // Use a day RANGE, not an exact day, so reminders aren't missed if worker doesn't run precisely.
      const minDays = config.type === 'overdue' ? -999 : config.daysBeforeExpiry;
      const maxDays = config.type === '40_day' ? 999 :
                       config.type === '20_day' ? 40 :
                       config.type === '7_day' ? 20 :
                       config.type === '1_day' ? 7 : 1;

      const minDate = new Date(now);
      minDate.setDate(minDate.getDate() - maxDays);
      const maxDate = new Date(now);
      maxDate.setDate(maxDate.getDate() - minDays);

      // For overdue: find renewals past due date
      const dateFilter = config.type === 'overdue'
        ? { dueDate: { lt: now } }
        : { dueDate: { gt: minDate, lte: maxDate } };

      const renewals = await prisma.renewal.findMany({
        where: {
          ...dateFilter,
          status: { notIn: ['compliant'] },
        },
        include: {
          policy: { include: { client: true } },
          firm: { include: { users: { where: { isActive: true } } } },
          checklistItems: true,
        },
      });

      for (const renewal of renewals) {
        // Check idempotency
        const existing = await prisma.notification.findFirst({
          where: { renewalId: renewal.id, reminderType: config.type },
        });
        if (existing) continue;

        // Resolve recipients
        const recipients = renewal.firm.users.filter(
          u => config.recipientRoles.includes(u.role)
        );

        if (recipients.length === 0) continue;

        // Record notification (in production: send email here)
        const sentTo = recipients.map(r => r.email).join(',');
        await prisma.notification.create({
          data: {
            firmId: renewal.firmId,
            renewalId: renewal.id,
            reminderType: config.type,
            sentTo,
          },
        });

        // Log audit
        await prisma.auditEvent.create({
          data: {
            firmId: renewal.firmId,
            action: 'notification.scheduled',
            entityType: 'renewal',
            entityId: renewal.id,
            metadata: {
              reminderType: config.type,
              recipients: recipients.map(r => r.email),
              clientName: renewal.policy.client.name,
              policyNumber: renewal.policy.policyNumber,
              dueDate: renewal.dueDate,
            },
          },
        });

        scheduled++;
      }
    }

    return scheduled;
  }

  /**
   * Get pending notifications for a firm (for dashboard alerts).
   */
  async getPendingAlerts(firmId: string) {
    const notifications = await prisma.notification.findMany({
      where: { firmId },
      orderBy: { sentAt: 'desc' },
      take: 20,
      include: {
        renewal: {
          include: {
            policy: { include: { client: true } },
          },
        },
      },
    });

    return notifications.map(n => ({
      id: n.id,
      type: n.reminderType,
      clientName: n.renewal?.policy.client.name ?? 'Unknown',
      policyNumber: n.renewal?.policy.policyNumber ?? 'Unknown',
      dueDate: n.renewal?.dueDate,
      sentAt: n.sentAt,
      sentTo: n.sentTo,
    }));
  }
}
