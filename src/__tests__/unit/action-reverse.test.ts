import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    agentAction: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    policy: {
      findFirst: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    client: {
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
    renewal: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('@/lib/auth', () => ({
  withAuth: (_perm: any, handler: any) => handler,
}));

vi.mock('@/lib/audit', () => ({
  auditLog: vi.fn(),
}));

describe('Action reversal — all types', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const recentExecDate = new Date(Date.now() - 1000 * 60 * 60); // 1 hour ago
  const testUser = { id: 'user-1', firmId: 'firm-1', role: 'firm_admin' };

  it('reverses cancel_policy by restoring active status', async () => {
    (prisma.agentAction.findFirst as any).mockResolvedValue({
      id: 'action-1',
      firmId: 'firm-1',
      actionType: 'cancel_policy',
      entityId: 'policy-1',
      status: 'executed',
      isReversed: false,
      executedAt: recentExecDate,
      changes: {},
    });
    (prisma.policy.findFirst as any).mockResolvedValue({ id: 'policy-1', firmId: 'firm-1' });
    (prisma.policy.update as any).mockResolvedValue({});
    (prisma.agentAction.update as any).mockResolvedValue({});

    const { PUT } = await import('@/app/api/agent/actions/[id]/reverse/route');
    const request = new Request('http://localhost/api/agent/actions/action-1/reverse', {
      method: 'PUT',
      body: JSON.stringify({ reason: 'test' }),
    });

    const response = await PUT(testUser as any, request);
    const body = await response.json();

    expect(body.data.reversed).toBe(true);
    // Should restore policy to active
    expect(prisma.policy.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ policyStatus: 'active' }),
      })
    );
  });

  it('reverses create_policy by setting policyStatus to reversed', async () => {
    (prisma.agentAction.findFirst as any).mockResolvedValue({
      id: 'action-2',
      firmId: 'firm-1',
      actionType: 'create_policy',
      entityId: 'policy-new',
      status: 'executed',
      isReversed: false,
      executedAt: recentExecDate,
      changes: {},
    });
    (prisma.policy.findFirst as any).mockResolvedValue({ id: 'policy-new', firmId: 'firm-1' });
    (prisma.policy.update as any).mockResolvedValue({});
    (prisma.agentAction.update as any).mockResolvedValue({});

    const { PUT } = await import('@/app/api/agent/actions/[id]/reverse/route');
    const request = new Request('http://localhost/api/agent/actions/action-2/reverse', {
      method: 'PUT',
      body: JSON.stringify({ reason: 'test' }),
    });

    const response = await PUT(testUser as any, request);
    const body = await response.json();

    expect(body.data.reversed).toBe(true);
    expect(prisma.policy.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ policyStatus: 'reversed' }),
      })
    );
  });

  it('prevents create_client reversal when client has policies', async () => {
    (prisma.agentAction.findFirst as any).mockResolvedValue({
      id: 'action-3',
      firmId: 'firm-1',
      actionType: 'create_client',
      entityId: 'client-1',
      status: 'executed',
      isReversed: false,
      executedAt: recentExecDate,
      changes: { name: { old: null, new: 'John Murphy' } },
    });
    (prisma.client.findFirst as any).mockResolvedValue({ id: 'client-1', name: 'John Murphy' });
    (prisma.policy.count as any).mockResolvedValue(1);

    const { PUT } = await import('@/app/api/agent/actions/[id]/reverse/route');
    const request = new Request('http://localhost/api/agent/actions/action-3/reverse', {
      method: 'PUT',
      body: JSON.stringify({ reason: 'test' }),
    });

    const response = await PUT(testUser as any, request);
    expect(response.status).toBe(409); // Conflict
  });

  it('reverses create_client by deleting the created client id directly', async () => {
    (prisma.agentAction.findFirst as any).mockResolvedValue({
      id: 'action-3b',
      firmId: 'firm-1',
      actionType: 'create_client',
      entityId: 'client-2',
      status: 'executed',
      isReversed: false,
      executedAt: recentExecDate,
      changes: { name: { old: null, new: 'Jane Murphy' } },
    });
    (prisma.client.findFirst as any).mockResolvedValue({ id: 'client-2', name: 'Jane Murphy' });
    (prisma.policy.count as any).mockResolvedValue(0);
    (prisma.client.delete as any).mockResolvedValue({});
    (prisma.agentAction.update as any).mockResolvedValue({});

    const { PUT } = await import('@/app/api/agent/actions/[id]/reverse/route');
    const request = new Request('http://localhost/api/agent/actions/action-3b/reverse', {
      method: 'PUT',
      body: JSON.stringify({ reason: 'test' }),
    });

    const response = await PUT(testUser as any, request);
    const body = await response.json();

    expect(body.data.reversed).toBe(true);
    expect(prisma.client.delete).toHaveBeenCalledWith({ where: { id: 'client-2' } });
  });

  it('returns error for unknown action types', async () => {
    (prisma.agentAction.findFirst as any).mockResolvedValue({
      id: 'action-4',
      firmId: 'firm-1',
      actionType: 'unknown_type',
      entityId: null,
      status: 'executed',
      isReversed: false,
      executedAt: recentExecDate,
      changes: {},
    });

    const { PUT } = await import('@/app/api/agent/actions/[id]/reverse/route');
    const request = new Request('http://localhost/api/agent/actions/action-4/reverse', {
      method: 'PUT',
      body: JSON.stringify({ reason: 'test' }),
    });

    const response = await PUT(testUser as any, request);
    expect(response.status).toBe(400);
  });
});
