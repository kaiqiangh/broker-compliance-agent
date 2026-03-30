import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeAction } from '@/lib/agent/action-executor';

// Use vi.hoisted so the mock is available when vi.mock is hoisted
const { mockPrisma } = vi.hoisted(() => {
  return {
    mockPrisma: {
      policy: {
        findFirst: vi.fn(),
        update: vi.fn(),
        create: vi.fn(),
      },
      client: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
      renewal: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
    },
  };
});

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

describe('executeAction firm isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects update_policy for entity in different firm', async () => {
    // Policy exists but belongs to different firm
    mockPrisma.policy.findFirst.mockResolvedValue(null); // No match with firmId filter

    await expect(
      executeAction({
        id: 'action-1',
        actionType: 'update_policy',
        entityId: 'policy-in-other-firm',
        firmId: 'firm-b',
        changes: { premium: { old: 100, new: 200 } },
      })
    ).rejects.toThrow(/not found in firm/i);

    // Should NOT have called update
    expect(mockPrisma.policy.update).not.toHaveBeenCalled();
  });

  it('allows update_policy for entity in same firm', async () => {
    mockPrisma.policy.findFirst.mockResolvedValue({
      id: 'policy-1',
      firmId: 'firm-a',
      premium: 100,
    });
    mockPrisma.policy.update.mockResolvedValue({});
    mockPrisma.renewal.findFirst.mockResolvedValue(null);

    await executeAction({
      id: 'action-1',
      actionType: 'update_policy',
      entityId: 'policy-1',
      firmId: 'firm-a',
      changes: { premium: { old: 100, new: 200 } },
    });

    expect(mockPrisma.policy.update).toHaveBeenCalled();
  });

  it('rejects create_policy with client from different firm', async () => {
    mockPrisma.client.findFirst.mockResolvedValue(null);

    await expect(
      executeAction({
        id: 'action-2',
        actionType: 'create_policy',
        entityId: 'client-in-other-firm',
        firmId: 'firm-b',
        changes: {
          policy_number: { old: null, new: 'POL-123' },
          premium: { old: null, new: 500 },
        },
      })
    ).rejects.toThrow(/not found in firm/i);
  });

  it('rejects cancel_policy for entity in different firm', async () => {
    mockPrisma.policy.findFirst.mockResolvedValue(null);

    await expect(
      executeAction({
        id: 'action-3',
        actionType: 'cancel_policy',
        entityId: 'policy-in-other-firm',
        firmId: 'firm-b',
        changes: {},
      })
    ).rejects.toThrow(/not found in firm/i);
  });
});
