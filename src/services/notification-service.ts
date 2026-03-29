import { prisma } from '../lib/prisma';
import { daysBetween } from '../lib/dates';
import { EmailService } from './email-service';

export type ReminderType = '40_day' | '20_day' | '7_day' | '1_day' | 'overdue';

interface ReminderConfig {
  type: ReminderType;
  daysBeforeExpiry: number;
  recipientRoles: string[];
}

const REMINDER_CONFIGS: ReminderConfig[] = [
  { type: '40_day', daysBeforeExpiry: 40, recipientRoles: ['compliance_officer'] },
  { type: '20_day', daysBeforeExpiry: 20, recipientRoles: ['compliance_officer', 'adviser'] },
  { type: '7_day', daysBeforeExpiry: 7, recipientRoles: ['firm_admin', 'compliance_officer', 'adviser'] },
  { type: '1_day', daysBeforeExpiry: 1, recipientRoles: ['firm_admin'] },
  { type: 'overdue', daysBeforeExpiry: 0, recipientRoles: ['firm_admin', 'compliance_officer'] },
];

export class NotificationService {
  private emailService: EmailService;

  constructor() {
    this.emailService = new EmailService();
  }
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
      //
      // 40_day: renewals due 21-40 days from now
      // 20_day: renewals due 8-20 days from now
      // 7_day: renewals due 2-7 days from now
      // 1_day: renewals due tomorrow
      // overdue: renewals past due date
      const minDays = config.type === '40_day' ? 21 :
                      config.type === '20_day' ? 8 :
                      config.type === '7_day' ? 2 :
                      config.type === '1_day' ? 1 : 0;
      const maxDays = config.daysBeforeExpiry;

      // Date range: renewals due between (now + minDays) and (now + maxDays)
      const minDate = new Date(now);
      minDate.setDate(minDate.getDate() + minDays);
      minDate.setHours(0, 0, 0, 0);

      const maxDate = new Date(now);
      maxDate.setDate(maxDate.getDate() + maxDays);
      maxDate.setHours(23, 59, 59, 999);

      // For overdue: find renewals past due date (including today)
      const dateFilter = config.type === 'overdue'
        ? { dueDate: { lte: now } }
        : { dueDate: { gte: minDate, lte: maxDate } };

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

        // Record notification
        const sentTo = recipients.map(r => r.email).join(',');
        await prisma.notification.create({
          data: {
            firmId: renewal.firmId,
            renewalId: renewal.id,
            reminderType: config.type,
            sentTo,
          },
        });

        // Send emails to each recipient
        const daysUntil = daysBetween(now, renewal.dueDate);
        for (const recipient of recipients) {
          await this.emailService.sendReminder(
            recipient.email,
            recipient.name,
            config.type,
            {
              clientName: renewal.policy.client.name,
              policyNumber: renewal.policy.policyNumber,
              policyType: renewal.policy.policyType,
              insurerName: renewal.policy.insurerName,
              expiryDate: renewal.dueDate,
              premium: Number(renewal.newPremium || renewal.policy.premium),
              checklistProgress: `${renewal.checklistItems.filter(i => i.status === 'approved' || i.status === 'completed').length}/${renewal.checklistItems.length}`,
              daysUntilDue: daysUntil,
              renewalUrl: `${process.env.APP_URL || 'http://localhost:3000'}/renewals/${renewal.id}`,
              firmName: renewal.firm.name,
            }
          );
        }

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
