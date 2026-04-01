import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shared spy — wired into EmailService mock at construction time
const mockSend = vi.fn().mockResolvedValue({ success: true, messageId: 'test-id' });

vi.mock('@/lib/prisma', () => ({
  prisma: {
    incomingEmail: { count: vi.fn() },
    agentAction: { count: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    user: { findMany: vi.fn() },
    firm: { findUnique: vi.fn() },
    emailIngressConfig: { findUnique: vi.fn() },
  },
}));

vi.mock('@/services/email-service', () => ({
  EmailService: vi.fn().mockImplementation(() => ({
    send: (...args: any[]) => mockSend(...args),
  })),
}));

import { prisma } from '@/lib/prisma';
import { sendDailyDigest, sendUrgentNotification } from '@/services/agent/notifications';

const adminUser = { email: 'admin@test.ie', name: 'Admin' };
const firmData = { name: 'Test Firm' };

describe('sendDailyDigest', () => {
  beforeEach(() => {
    mockSend.mockClear();
    mockSend.mockResolvedValue({ success: true, messageId: 'test-id' });
  });

  function setupDefaults(overrides: Record<string, any> = {}) {
    (prisma.emailIngressConfig.findUnique as any).mockResolvedValue(
      overrides.emailIngressConfig ?? { digestEnabled: true, digestTime: '08:00' }
    );
    (prisma.incomingEmail.count as any).mockResolvedValue(overrides.emailsProcessed ?? 5);
    (prisma.agentAction.count as any)
      .mockResolvedValueOnce(overrides.pendingActions ?? 3)
      .mockResolvedValueOnce(overrides.confirmed ?? 2)
      .mockResolvedValueOnce(overrides.rejected ?? 1)
      .mockResolvedValueOnce(overrides.modified ?? 0);
    (prisma.agentAction.findMany as any).mockResolvedValue(
      overrides.actions ?? [{ confidence: 0.85 }, { confidence: 0.90 }]
    );
    (prisma.user.findMany as any).mockResolvedValue(overrides.users ?? [adminUser]);
    (prisma.firm.findUnique as any).mockResolvedValue(overrides.firm ?? firmData);
  }

  it('exports sendDailyDigest function', () => {
    expect(typeof sendDailyDigest).toBe('function');
  });

  it('sends digest email to firm admins and compliance officers', async () => {
    setupDefaults();
    await sendDailyDigest('firm-1');

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'admin@test.ie',
        subject: expect.stringContaining('Agent Daily Digest'),
      })
    );
  });

  it('includes processed email count in digest', async () => {
    setupDefaults({ emailsProcessed: 10 });
    await sendDailyDigest('firm-1');

    const html = mockSend.mock.calls[0][0].html;
    expect(html).toContain('10');
  });

  it('includes pending actions count in digest', async () => {
    setupDefaults({ pendingActions: 7 });
    await sendDailyDigest('firm-1');

    const html = mockSend.mock.calls[0][0].html;
    expect(html).toContain('7');
  });

  it('includes confirmed, rejected, and modified counts', async () => {
    setupDefaults({ confirmed: 5, rejected: 2, modified: 1 });
    await sendDailyDigest('firm-1');

    const html = mockSend.mock.calls[0][0].html;
    expect(html).toContain('Confirmed');
    expect(html).toContain('Rejected');
    expect(html).toContain('Modified');
  });

  it('calculates accuracy as (confirmed + modified) / decided * 100', async () => {
    // confirmed=4, rejected=1, modified=1 -> accuracy = 5/6 = 83%
    setupDefaults({ confirmed: 4, rejected: 1, modified: 1 });
    await sendDailyDigest('firm-1');

    const html = mockSend.mock.calls[0][0].html;
    expect(html).toContain('83%');
  });

  it('includes average confidence percentage', async () => {
    setupDefaults({ actions: [{ confidence: 0.9 }, { confidence: 0.8 }] });
    await sendDailyDigest('firm-1');

    const html = mockSend.mock.calls[0][0].html;
    expect(html).toContain('85%');
  });

  it('skips sending when no emails processed and no pending actions', async () => {
    setupDefaults({ emailsProcessed: 0, pendingActions: 0 });
    await sendDailyDigest('firm-1');

    expect(mockSend).not.toHaveBeenCalled();
  });

  it('sends to multiple recipients', async () => {
    setupDefaults({
      users: [
        { email: 'admin@test.ie', name: 'Admin' },
        { email: 'co@test.ie', name: 'CO' },
      ],
    });
    await sendDailyDigest('firm-1');

    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('handles email send failure gracefully', async () => {
    setupDefaults();
    mockSend.mockRejectedValueOnce(new Error('Send failed'));

    await expect(sendDailyDigest('firm-1')).resolves.not.toThrow();
  });
});

describe('sendUrgentNotification', () => {
  beforeEach(() => {
    mockSend.mockClear();
    mockSend.mockResolvedValue({ success: true, messageId: 'test-id' });
  });

  function setupAction(overrides: Record<string, any> = {}) {
    (prisma.emailIngressConfig.findUnique as any).mockResolvedValue(
      overrides.emailIngressConfig ?? { urgentNotifications: true }
    );
    (prisma.agentAction.findUnique as any).mockResolvedValue({
      id: 'action-1',
      actionType: overrides.actionType ?? 'update_claim',
      confidence: overrides.confidence ?? 0.9,
      email: { subject: 'Test email', fromAddress: 'sender@test.ie' },
    });
    (prisma.user.findMany as any).mockResolvedValue(overrides.users ?? [adminUser]);
    (prisma.firm.findUnique as any).mockResolvedValue(overrides.firm ?? firmData);
  }

  it('exports sendUrgentNotification function', () => {
    expect(typeof sendUrgentNotification).toBe('function');
  });

  it('sends notification for claim actions', async () => {
    setupAction({ actionType: 'update_claim' });
    await sendUrgentNotification('firm-1', 'action-1');

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining('Claim update'),
      })
    );
  });

  it('sends notification for cancellation actions', async () => {
    setupAction({ actionType: 'cancel_policy' });
    await sendUrgentNotification('firm-1', 'action-1');

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining('Cancellation'),
      })
    );
  });

  it('sends notification for low confidence (< 0.5)', async () => {
    setupAction({ actionType: 'update_policy', confidence: 0.3 });
    await sendUrgentNotification('firm-1', 'action-1');

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining('Low confidence'),
      })
    );
  });

  it('does NOT send for non-urgent action types with high confidence', async () => {
    setupAction({ actionType: 'update_policy', confidence: 0.95 });
    await sendUrgentNotification('firm-1', 'action-1');

    expect(mockSend).not.toHaveBeenCalled();
  });

  it('does NOT send for no_action type with high confidence', async () => {
    setupAction({ actionType: 'no_action', confidence: 0.9 });
    await sendUrgentNotification('firm-1', 'action-1');

    expect(mockSend).not.toHaveBeenCalled();
  });

  it('includes action details in the email body', async () => {
    setupAction({ actionType: 'cancel_policy', confidence: 0.8 });
    await sendUrgentNotification('firm-1', 'action-1');

    const html = mockSend.mock.calls[0][0].html;
    expect(html).toContain('cancel_policy');
    expect(html).toContain('80%');
    expect(html).toContain('Test email');
  });

  it('handles missing action gracefully', async () => {
    (prisma.emailIngressConfig.findUnique as any).mockResolvedValue({ urgentNotifications: true });
    (prisma.agentAction.findUnique as any).mockResolvedValue(null);

    await expect(sendUrgentNotification('firm-1', 'missing')).resolves.not.toThrow();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('handles email send failure gracefully', async () => {
    setupAction({ actionType: 'update_claim' });
    mockSend.mockRejectedValueOnce(new Error('Send failed'));

    await expect(sendUrgentNotification('firm-1', 'action-1')).resolves.not.toThrow();
  });
});
