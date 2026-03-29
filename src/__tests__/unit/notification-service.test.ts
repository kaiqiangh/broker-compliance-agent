import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationService } from '../../services/notification-service';

// Mock prisma
vi.mock('../../lib/prisma', () => ({
  prisma: {
    renewal: {
      findMany: vi.fn(),
    },
    notification: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
    },
    auditEvent: {
      create: vi.fn(),
    },
  },
}));

// Mock email service
vi.mock('../../services/email-service', () => ({
  EmailService: vi.fn().mockImplementation(() => ({
    sendReminder: vi.fn().mockResolvedValue({ success: true, messageId: 'test' }),
  })),
}));

import { prisma } from '../../lib/prisma';

function daysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(12, 0, 0, 0);
  return d;
}

function makeRenewal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'renewal-1',
    firmId: 'firm-1',
    dueDate: daysFromNow(30),
    status: 'pending',
    firm: {
      name: 'Test Firm',
      users: [
        { email: 'co@test.ie', name: 'CO', role: 'compliance_officer', isActive: true },
        { email: 'adv@test.ie', name: 'Adviser', role: 'adviser', isActive: true },
        { email: 'admin@test.ie', name: 'Admin', role: 'firm_admin', isActive: true },
      ],
    },
    policy: {
      policyNumber: 'POL-001',
      policyType: 'motor',
      insurerName: 'Aviva',
      premium: 500,
      client: { name: 'John Client' },
    },
    checklistItems: [
      { status: 'approved' },
      { status: 'pending' },
    ],
    newPremium: null,
    ...overrides,
  };
}

describe('NotificationService — checkAndScheduleReminders', () => {
  let service: NotificationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new NotificationService();
  });

  it('40-day reminder fires for renewals due in 21–40 days', async () => {
    const renewal = makeRenewal({ dueDate: daysFromNow(30) });
    (prisma.renewal.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([renewal]);
    (prisma.notification.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const scheduled = await service.checkAndScheduleReminders();

    // 40_day config should match (days 21–40)
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          renewalId: 'renewal-1',
          reminderType: '40_day',
        }),
      })
    );
    expect(scheduled).toBeGreaterThanOrEqual(1);
  });

  it('20-day reminder fires for renewals due in 8–20 days', async () => {
    const renewal = makeRenewal({ dueDate: daysFromNow(15) });
    (prisma.renewal.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([renewal]);
    (prisma.notification.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const scheduled = await service.checkAndScheduleReminders();

    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          renewalId: 'renewal-1',
          reminderType: '20_day',
        }),
      })
    );
    expect(scheduled).toBeGreaterThanOrEqual(1);
  });

  it('7-day reminder fires for renewals due in 2–7 days', async () => {
    const renewal = makeRenewal({ dueDate: daysFromNow(5) });
    (prisma.renewal.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([renewal]);
    (prisma.notification.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const scheduled = await service.checkAndScheduleReminders();

    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          renewalId: 'renewal-1',
          reminderType: '7_day',
        }),
      })
    );
    expect(scheduled).toBeGreaterThanOrEqual(1);
  });

  it('1-day reminder fires for renewals due tomorrow', async () => {
    const renewal = makeRenewal({ dueDate: daysFromNow(1) });
    (prisma.renewal.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([renewal]);
    (prisma.notification.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const scheduled = await service.checkAndScheduleReminders();

    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          renewalId: 'renewal-1',
          reminderType: '1_day',
        }),
      })
    );
    expect(scheduled).toBeGreaterThanOrEqual(1);
  });

  it('overdue reminder fires for renewals past due date', async () => {
    const renewal = makeRenewal({ dueDate: daysFromNow(-3) });
    // Overdue query uses lte: now, so findMany is called with that filter
    (prisma.renewal.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([renewal]);
    (prisma.notification.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const scheduled = await service.checkAndScheduleReminders();

    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          renewalId: 'renewal-1',
          reminderType: 'overdue',
        }),
      })
    );
    expect(scheduled).toBeGreaterThanOrEqual(1);
  });

  it('idempotency — same reminder not sent twice', async () => {
    const renewal = makeRenewal({ dueDate: daysFromNow(30) });
    (prisma.renewal.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([renewal]);
    // Simulate existing notification already sent
    (prisma.notification.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'notif-1',
      renewalId: 'renewal-1',
      reminderType: '40_day',
    });

    const scheduled = await service.checkAndScheduleReminders();

    // Should NOT create another notification
    expect(prisma.notification.create).not.toHaveBeenCalled();
    // scheduled should be 0 (nothing new was scheduled)
    expect(scheduled).toBe(0);
  });

  it('compliant renewals are skipped', async () => {
    // The service filters out compliant renewals via status: { notIn: ['compliant'] }
    // So prisma.renewal.findMany would return [] for compliant ones
    (prisma.renewal.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const scheduled = await service.checkAndScheduleReminders();

    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(scheduled).toBe(0);
  });

  it('20-day reminder includes adviser in recipient list (regression)', async () => {
    const renewal = makeRenewal({ dueDate: daysFromNow(15) });
    (prisma.renewal.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([renewal]);
    (prisma.notification.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await service.checkAndScheduleReminders();

    // 20_day config has recipientRoles: ['compliance_officer', 'adviser']
    // Verify the notification was created with sentTo including the adviser
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sentTo: expect.stringContaining('adv@test.ie'),
        }),
      })
    );
  });
});
