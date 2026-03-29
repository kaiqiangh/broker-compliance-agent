import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChecklistService } from '../../services/checklist-service';

// Mock prisma
vi.mock('../../lib/prisma', () => ({
  prisma: {
    checklistItem: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    auditEvent: {
      create: vi.fn(),
    },
    renewal: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from '../../lib/prisma';

describe('ChecklistService — self-approval prevention (M1)', () => {
  let service: ChecklistService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ChecklistService();
  });

  it('should reject approval by the same person who completed the item', async () => {
    (prisma.checklistItem.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'item-1',
      firmId: 'firm-1',
      status: 'pending_review',
      itemType: 'policy_check',
      completedBy: 'user-123',
      renewalId: 'renewal-1',
      notes: 'Done',
    });

    await expect(
      service.approveItem('firm-1', 'item-1', 'user-123', 'Looks good')
    ).rejects.toThrow('Cannot approve your own checklist item. Segregation of duties required.');
  });

  it('should allow approval by a different person', async () => {
    (prisma.checklistItem.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'item-1',
      firmId: 'firm-1',
      status: 'pending_review',
      itemType: 'policy_check',
      completedBy: 'user-123',
      renewalId: 'renewal-1',
      notes: 'Done',
    });

    (prisma.checklistItem.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'item-1',
      status: 'approved',
    });

    (prisma.renewal.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'renewal-1',
      status: 'in_progress',
      dueDate: new Date('2025-12-31'),
      checklistItems: [{ status: 'approved' }],
    });

    const result = await service.approveItem('firm-1', 'item-1', 'user-456', 'Looks good');
    expect(result.status).toBe('approved');
    expect(prisma.checklistItem.update).toHaveBeenCalled();
  });
});
