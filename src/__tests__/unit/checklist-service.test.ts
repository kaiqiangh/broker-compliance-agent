import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChecklistService } from '../../services/checklist-service';

// Mock prisma
vi.mock('../../lib/prisma', () => ({
  prisma: {
    checklistItem: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    renewal: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    auditEvent: {
      create: vi.fn(),
    },
  },
}));

import { prisma } from '../../lib/prisma';

function makeChecklistItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    firmId: 'firm-1',
    renewalId: 'renewal-1',
    itemType: 'market_comparison',
    status: 'pending',
    completedBy: null,
    completedAt: null,
    approvedBy: null,
    approvedAt: null,
    evidenceUrl: null,
    notes: null,
    rejectionReason: null,
    ...overrides,
  };
}

function makeRenewalWithItems(items: Record<string, unknown>[]) {
  return {
    id: 'renewal-1',
    firmId: 'firm-1',
    dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    status: 'pending',
    checklistItems: items,
    policy: { client: { name: 'Test Client' }, policyNumber: 'POL-001' },
  };
}

describe('ChecklistService — complete/approve/reject workflow', () => {
  let service: ChecklistService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ChecklistService();
  });

  it('completeItem — without sign-off → status=completed', async () => {
    const item = makeChecklistItem({ itemType: 'market_comparison', status: 'pending' });
    (prisma.checklistItem.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(item);
    (prisma.checklistItem.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...item,
      status: 'completed',
      completedBy: 'user-1',
      completedAt: new Date(),
    });

    // updateRenewalStatus needs renewal + items
    const renewal = makeRenewalWithItems([{ status: 'completed', itemType: 'market_comparison' }]);
    (prisma.renewal.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(renewal);

    const result = await service.completeItem('firm-1', 'item-1', 'user-1');

    expect(prisma.checklistItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'completed',
          completedBy: 'user-1',
        }),
      })
    );
    expect(result.status).toBe('completed');
  });

  it('completeItem — with sign-off → status=pending_review', async () => {
    // suitability_assessment is in ITEMS_REQUIRING_SIGN_OFF
    const item = makeChecklistItem({ itemType: 'suitability_assessment', status: 'pending' });
    (prisma.checklistItem.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(item);
    (prisma.checklistItem.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...item,
      status: 'pending_review',
      completedBy: 'user-1',
      completedAt: new Date(),
    });

    const renewal = makeRenewalWithItems([{ status: 'pending_review', itemType: 'suitability_assessment' }]);
    (prisma.renewal.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(renewal);

    const result = await service.completeItem('firm-1', 'item-1', 'user-1');

    expect(prisma.checklistItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'pending_review',
        }),
      })
    );
    expect(result.status).toBe('pending_review');
  });

  it('completeItem — invalid transition throws', async () => {
    // Try completing an already-approved item (approved has no valid transitions)
    const item = makeChecklistItem({ itemType: 'market_comparison', status: 'approved' });
    (prisma.checklistItem.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(item);

    await expect(
      service.completeItem('firm-1', 'item-1', 'user-1')
    ).rejects.toThrow();
  });

  it('approveItem — from pending_review → approved', async () => {
    const item = makeChecklistItem({
      itemType: 'suitability_assessment',
      status: 'pending_review',
      completedBy: 'user-1',
      notes: 'Done',
    });
    (prisma.checklistItem.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(item);
    (prisma.checklistItem.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...item,
      status: 'approved',
      approvedBy: 'user-2',
      approvedAt: new Date(),
    });

    const renewal = makeRenewalWithItems([
      { status: 'approved', itemType: 'suitability_assessment' },
      { status: 'approved', itemType: 'market_comparison' },
    ]);
    (prisma.renewal.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(renewal);

    const result = await service.approveItem('firm-1', 'item-1', 'user-2', 'Approved');

    expect(prisma.checklistItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'approved',
          approvedBy: 'user-2',
        }),
      })
    );
    expect(result.status).toBe('approved');
  });

  it('approveItem — from completed throws', async () => {
    // Can't approve a completed item (only pending_review can be approved)
    const item = makeChecklistItem({
      itemType: 'market_comparison',
      status: 'completed',
      completedBy: 'user-1',
    });
    (prisma.checklistItem.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(item);

    await expect(
      service.approveItem('firm-1', 'item-1', 'user-2', 'Approved')
    ).rejects.toThrow();
  });

  it('approveItem — self-approval rejected', async () => {
    const item = makeChecklistItem({
      itemType: 'suitability_assessment',
      status: 'pending_review',
      completedBy: 'user-123',
    });
    (prisma.checklistItem.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(item);

    await expect(
      service.approveItem('firm-1', 'item-1', 'user-123', 'Self approve')
    ).rejects.toThrow('Cannot approve your own checklist item. Segregation of duties required.');
  });

  it('rejectItem — with reason', async () => {
    const item = makeChecklistItem({
      itemType: 'suitability_assessment',
      status: 'pending_review',
      completedBy: 'user-1',
    });
    (prisma.checklistItem.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(item);
    (prisma.checklistItem.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...item,
      status: 'rejected',
      rejectionReason: 'Missing evidence',
    });

    const renewal = makeRenewalWithItems([{ status: 'rejected', itemType: 'suitability_assessment' }]);
    (prisma.renewal.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(renewal);

    const result = await service.rejectItem('firm-1', 'item-1', 'user-2', 'Missing evidence');

    expect(prisma.checklistItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'rejected',
          rejectionReason: 'Missing evidence',
        }),
      })
    );
    expect(result.rejectionReason).toBe('Missing evidence');
  });

  it('getRenewalChecklist — returns items with completion rate', async () => {
    const now = new Date();
    const renewal = {
      id: 'renewal-1',
      firmId: 'firm-1',
      dueDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      status: 'in_progress',
      checklistItems: [
        { itemType: 'market_comparison', status: 'approved', createdAt: now },
        { itemType: 'suitability_assessment', status: 'pending_review', createdAt: now },
        { itemType: 'premium_disclosure', status: 'completed', createdAt: now },
        { itemType: 'client_communication', status: 'pending', createdAt: now },
      ],
      policy: { client: { name: 'Test Client' }, policyNumber: 'POL-001' },
    };
    (prisma.renewal.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(renewal);

    const result = await service.getRenewalChecklist('firm-1', 'renewal-1');

    // completedCount = approved(1) + completed without sign-off(1) = 2
    // suitability_assessment is pending_review, not counted. premium_disclosure is completed and not in sign-off list.
    expect(result.completedCount).toBe(2);
    expect(result.totalCount).toBe(4);
    expect(result.completionRate).toBe(50);
    expect(result.clientName).toBe('Test Client');
  });

  it('updateRenewalStatus — all approved → compliant', async () => {
    // For completeItem test, we need an item to complete, and then
    // updateRenewalStatus runs internally. Let's test via completeItem.
    const item = makeChecklistItem({
      itemType: 'market_comparison',
      status: 'pending',
      renewalId: 'renewal-1',
    });
    (prisma.checklistItem.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(item);
    (prisma.checklistItem.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...item,
      status: 'completed',
      completedBy: 'user-1',
      completedAt: new Date(),
    });

    // Renewal has all items now completed/approved
    const renewal = {
      id: 'renewal-1',
      firmId: 'firm-1',
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      status: 'in_progress',
      checklistItems: [
        { status: 'approved', itemType: 'suitability_assessment' },
        { status: 'completed', itemType: 'market_comparison' },
      ],
    };
    (prisma.renewal.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(renewal);

    await service.completeItem('firm-1', 'item-1', 'user-1');

    // calculateRenewalStatus with all completed should give 'compliant'
    expect(prisma.renewal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'renewal-1' },
        data: expect.objectContaining({
          status: 'compliant',
        }),
      })
    );
  });
});
