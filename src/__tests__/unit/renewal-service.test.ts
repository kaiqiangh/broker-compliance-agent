import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RenewalService } from '../../services/renewal-service';

// Mock prisma
vi.mock('../../lib/prisma', () => ({
  prisma: {
    renewal: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    policy: {
      findMany: vi.fn(),
    },
    checklistItem: {
      createMany: vi.fn(),
    },
    auditEvent: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { prisma } from '../../lib/prisma';

function daysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(12, 0, 0, 0);
  return d;
}

function makeTimelineRenewal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'renewal-1',
    firmId: 'firm-1',
    dueDate: daysFromNow(30),
    status: 'pending',
    newPremium: null,
    policy: {
      policyNumber: 'POL-001',
      policyType: 'motor',
      insurerName: 'Aviva',
      premium: 500,
      adviserId: 'adv-1',
      client: { name: 'John Client' },
    },
    checklistItems: [
      { status: 'pending' },
      { status: 'pending' },
    ],
    ...overrides,
  };
}

describe('RenewalService — getTimeline', () => {
  let service: RenewalService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new RenewalService();
  });

  it('getTimeline returns filtered renewals by status', async () => {
    const pending = makeTimelineRenewal({ id: 'r1', status: 'pending' });
    const compliant = makeTimelineRenewal({ id: 'r2', status: 'compliant' });

    // Mock: first call returns all, then filter by status
    (prisma.renewal.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([pending]);

    const result = await service.getTimeline('firm-1', { status: 'pending' });

    // Verify the prisma query included the status filter
    expect(prisma.renewal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          firmId: 'firm-1',
          status: 'pending',
        }),
      })
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('r1');
  });
});

describe('RenewalService — getDashboardStats', () => {
  let service: RenewalService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new RenewalService();
  });

  function mockRenewalsForTimeline(renewals: Record<string, unknown>[]) {
    (prisma.renewal.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(renewals);
  }

  it('status counts are correct', async () => {
    const now = new Date();
    const futureDate = new Date(now);
    futureDate.setDate(futureDate.getDate() + 100); // well within 90-day window... actually need to think about this

    mockRenewalsForTimeline([
      makeTimelineRenewal({ id: 'r1', dueDate: daysFromNow(30), checklistItems: [{ status: 'pending' }, { status: 'pending' }] }),
      makeTimelineRenewal({ id: 'r2', dueDate: daysFromNow(30), checklistItems: [{ status: 'approved' }, { status: 'pending' }] }),
      makeTimelineRenewal({ id: 'r3', dueDate: daysFromNow(30), checklistItems: [{ status: 'approved' }, { status: 'approved' }] }),
      makeTimelineRenewal({ id: 'r4', dueDate: daysFromNow(-5), checklistItems: [{ status: 'pending' }, { status: 'pending' }] }),
      makeTimelineRenewal({ id: 'r5', dueDate: daysFromNow(3), checklistItems: [{ status: 'pending' }, { status: 'pending' }] }),
    ]);

    const stats = await service.getDashboardStats('firm-1');

    // r1: 0 approved, 30 days → pending
    // r2: 1 approved, 30 days → in_progress
    // r3: 2 approved, 30 days → compliant
    // r4: 0 approved, -5 days → overdue
    // r5: 0 approved, 3 days → at_risk (<=7 days, incomplete)
    expect(stats.byStatus.pending).toBe(1);
    expect(stats.byStatus.in_progress).toBe(1);
    expect(stats.byStatus.compliant).toBe(1);
    expect(stats.byStatus.overdue).toBe(1);
    expect(stats.byStatus.at_risk).toBe(1);
    expect(stats.totalRenewals).toBe(5);
  });

  it('compliance rate calculation', async () => {
    mockRenewalsForTimeline([
      makeTimelineRenewal({
        id: 'r1',
        dueDate: daysFromNow(30),
        checklistItems: [{ status: 'approved' }, { status: 'approved' }],
      }),
      makeTimelineRenewal({
        id: 'r2',
        dueDate: daysFromNow(30),
        checklistItems: [{ status: 'pending' }, { status: 'pending' }],
      }),
      makeTimelineRenewal({
        id: 'r3',
        dueDate: daysFromNow(30),
        checklistItems: [{ status: 'approved' }, { status: 'pending' }],
      }),
    ]);

    const stats = await service.getDashboardStats('firm-1');

    // If quarterly filter applies and all are in current quarter:
    // 1 compliant out of 3 = 33%
    // If quarterly filter doesn't match (depends on current date), falls back to overall
    // overall: 1 compliant out of 3 = 33%
    expect(stats.complianceRate).toBe(33);
  });

  it('upcoming deadlines — only renewals within 30 days', async () => {
    mockRenewalsForTimeline([
      makeTimelineRenewal({ id: 'r1', dueDate: daysFromNow(10), checklistItems: [{ status: 'pending' }] }),
      makeTimelineRenewal({ id: 'r2', dueDate: daysFromNow(25), checklistItems: [{ status: 'pending' }] }),
      makeTimelineRenewal({ id: 'r3', dueDate: daysFromNow(45), checklistItems: [{ status: 'pending' }] }),
    ]);

    const stats = await service.getDashboardStats('firm-1');

    // Only r1 (10 days) and r2 (25 days) are within 30 days
    expect(stats.upcomingDeadlines).toHaveLength(2);
    expect(stats.upcomingDeadlines.map((d: any) => d.id)).toEqual(
      expect.arrayContaining(['r1', 'r2'])
    );
    // Should be sorted by daysUntilDue ascending
    expect(stats.upcomingDeadlines[0].daysUntilDue).toBeLessThanOrEqual(
      stats.upcomingDeadlines[1].daysUntilDue
    );
  });

  it('overdue items — only renewals past due date', async () => {
    mockRenewalsForTimeline([
      makeTimelineRenewal({
        id: 'r1',
        dueDate: daysFromNow(-5),
        checklistItems: [{ status: 'pending' }],
      }),
      makeTimelineRenewal({
        id: 'r2',
        dueDate: daysFromNow(-10),
        checklistItems: [{ status: 'pending' }],
      }),
      makeTimelineRenewal({
        id: 'r3',
        dueDate: daysFromNow(30),
        checklistItems: [{ status: 'pending' }],
      }),
    ]);

    const stats = await service.getDashboardStats('firm-1');

    // Only r1 and r2 are overdue
    expect(stats.overdueItems).toHaveLength(2);
    expect(stats.overdueItems.map((d: any) => d.id)).toEqual(
      expect.arrayContaining(['r1', 'r2'])
    );
    // r3 should not appear
    expect(stats.overdueItems.map((d: any) => d.id)).not.toContain('r3');
  });
});
