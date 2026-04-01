import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    agentAction: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    agentActionModification: {
      create: vi.fn(),
    },
    policy: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
  runWithFirmContext: (_id: string, fn: () => any) => fn(),
}));

vi.mock('@/lib/auth', () => ({
  withAuth: (_perm: any, handler: any) => handler,
}));

vi.mock('@/lib/audit', () => ({
  auditLog: vi.fn(),
}));

vi.mock('@/app/api/agent/events/route', () => ({
  publishAgentEvent: vi.fn(),
}));

vi.mock('@/lib/agent/action-executor', () => ({
  executeAction: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

import { prisma } from '@/lib/prisma';
import { auditLog } from '@/lib/audit';
import { executeAction } from '@/lib/agent/action-executor';

describe('GET /api/agent/actions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns actions list', async () => {
    (prisma.agentAction.findMany as any).mockResolvedValue([
      { id: 'a1', actionType: 'update_policy', status: 'pending', confidence: 0.95 },
      { id: 'a2', actionType: 'create_client', status: 'confirmed', confidence: 0.88 },
    ]);
    (prisma.agentAction.count as any).mockResolvedValue(2);

    const { GET } = await import('@/app/api/agent/actions/route');
    const res = await GET({ firmId: 'f1', role: 'adviser' } as any, new Request('http://localhost/api/agent/actions'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(2);
  });

  it('filters by status', async () => {
    (prisma.agentAction.findMany as any).mockResolvedValue([]);
    (prisma.agentAction.count as any).mockResolvedValue(0);

    const { GET } = await import('@/app/api/agent/actions/route');
    await GET({ firmId: 'f1', role: 'adviser' } as any, new Request('http://localhost/api/agent/actions?status=pending'));

    expect(prisma.agentAction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'pending' }),
      })
    );
  });
});

describe('PUT /api/agent/actions/:id/confirm', () => {
  beforeEach(() => vi.clearAllMocks());

  it('confirms and executes action', async () => {
    // Atomic updateMany returns count: 1 (success)
    (prisma.agentAction.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.agentAction.findUniqueOrThrow as any).mockResolvedValue({
      id: 'a1',
      firmId: 'f1',
      actionType: 'update_policy',
      entityType: 'policy',
      entityId: 'p1',
      changes: { premium: { old: 1000, new: 1200 } },
      status: 'confirmed',
    });
    (prisma.policy.findFirst as any).mockResolvedValue({ id: 'p1', firmId: 'f1' });
    (prisma.policy.update as any).mockResolvedValue({});
    (prisma.agentAction.update as any).mockResolvedValue({});
    (executeAction as any).mockResolvedValue({ entityType: 'policy', entityId: 'p1' });

    const { PUT } = await import('@/app/api/agent/actions/[id]/confirm/route');
    const res = await PUT(
      { firmId: 'f1', id: 'u1', role: 'adviser' } as any,
      new Request('http://localhost/api/agent/actions/a1/confirm', { method: 'PUT' })
    );

    expect(res.status).toBe(200);
    expect(prisma.agentAction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'pending' }),
      })
    );
    expect(auditLog).toHaveBeenCalled();
  });

  it('returns 404 for non-existent action', async () => {
    // updateMany returns count: 0 (not found or already processed)
    (prisma.agentAction.updateMany as any).mockResolvedValue({ count: 0 });
    (prisma.agentAction.findFirst as any).mockResolvedValue(null);

    const { PUT } = await import('@/app/api/agent/actions/[id]/confirm/route');
    const res = await PUT(
      { firmId: 'f1', id: 'u1', role: 'adviser' } as any,
      new Request('http://localhost/api/agent/actions/nonexistent/confirm', { method: 'PUT' }),
    );

    expect(res.status).toBe(404);
  });

  it('returns 400 if action already confirmed', async () => {
    // updateMany returns 0 (status not pending)
    (prisma.agentAction.updateMany as any).mockResolvedValue({ count: 0 });
    (prisma.agentAction.findFirst as any).mockResolvedValue({
      id: 'a1',
      status: 'confirmed',
    });

    const { PUT } = await import('@/app/api/agent/actions/[id]/confirm/route');
    const res = await PUT(
      { firmId: 'f1', id: 'u1', role: 'adviser' } as any,
      new Request('http://localhost/api/agent/actions/a1/confirm', { method: 'PUT' }),
    );

    expect(res.status).toBe(400);
  });
});

describe('PUT /api/agent/actions/:id/reject', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects action with reason', async () => {
    (prisma.agentAction.findFirst as any).mockResolvedValue({
      id: 'a1',
      status: 'pending',
    });
    (prisma.agentAction.update as any).mockResolvedValue({});

    const { PUT } = await import('@/app/api/agent/actions/[id]/reject/route');
    const res = await PUT(
      { firmId: 'f1', id: 'u1', role: 'adviser' } as any,
      new Request('http://localhost/api/agent/actions/a1/reject', {
        method: 'PUT',
        body: JSON.stringify({ reason: 'Data was incorrect' }),
      }),
    );

    expect(res.status).toBe(200);
    expect(prisma.agentAction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'rejected',
          rejectedReason: 'Data was incorrect',
        }),
      })
    );
  });
});

describe('PUT /api/agent/actions/:id/modify', () => {
  beforeEach(() => vi.clearAllMocks());

  it('modifies and executes action', async () => {
    (prisma.agentAction.findFirst as any).mockResolvedValue({
      id: 'a1',
      firmId: 'f1',
      actionType: 'update_policy',
      entityType: 'policy',
      entityId: 'p1',
      status: 'pending',
      changes: { premium: { old: 1000, new: 1200 } },
    });
    (prisma.agentActionModification.create as any).mockResolvedValue({});
    (prisma.agentAction.update as any).mockResolvedValue({});
    (executeAction as any).mockResolvedValue({ entityType: 'policy', entityId: 'p1' });

    const { PUT } = await import('@/app/api/agent/actions/[id]/modify/route');
    const res = await PUT(
      { firmId: 'f1', id: 'u1', role: 'adviser' } as any,
      new Request('http://localhost/api/agent/actions/a1/modify', {
        method: 'PUT',
        body: JSON.stringify({ modifications: { premium: 1500 } }),
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('executed');
    expect(prisma.agentActionModification.create).toHaveBeenCalled();
    expect(executeAction).toHaveBeenCalled();
    // Final update should set status to 'executed'
    const lastUpdateCall = (prisma.agentAction.update as any).mock.calls.at(-1)[0];
    expect(lastUpdateCall.data.status).toBe('executed');
  });

  it('rolls back to pending on execution failure', async () => {
    (prisma.agentAction.findFirst as any).mockResolvedValue({
      id: 'a1',
      firmId: 'f1',
      actionType: 'update_policy',
      entityType: 'policy',
      entityId: 'p1',
      status: 'pending',
      changes: { premium: { old: 1000, new: 1200 } },
    });
    (prisma.agentActionModification.create as any).mockResolvedValue({});
    (prisma.agentAction.update as any).mockResolvedValue({});
    (executeAction as any).mockRejectedValue(new Error('DB write failed'));

    const { PUT } = await import('@/app/api/agent/actions/[id]/modify/route');
    const res = await PUT(
      { firmId: 'f1', id: 'u1', role: 'adviser' } as any,
      new Request('http://localhost/api/agent/actions/a1/modify', {
        method: 'PUT',
        body: JSON.stringify({ modifications: { premium: 1500 } }),
      }),
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('EXECUTION_FAILED');
    // Should roll back to pending with original changes restored
    const rollbackCall = (prisma.agentAction.update as any).mock.calls.at(-1)[0];
    expect(rollbackCall.data.status).toBe('pending');
    expect(rollbackCall.data.confirmedBy).toBeNull();
    expect(rollbackCall.data.changes).toEqual({ premium: { old: 1000, new: 1200 } });
    expect(auditLog).toHaveBeenCalledWith(
      'f1',
      'agent.action_modify_failed',
      'agent_action',
      'a1',
      expect.objectContaining({ error: 'DB write failed' }),
    );
  });

  it('returns 400 for non-pending action', async () => {
    (prisma.agentAction.findFirst as any).mockResolvedValue({
      id: 'a1',
      firmId: 'f1',
      status: 'confirmed',
    });

    const { PUT } = await import('@/app/api/agent/actions/[id]/modify/route');
    const res = await PUT(
      { firmId: 'f1', id: 'u1', role: 'adviser' } as any,
      new Request('http://localhost/api/agent/actions/a1/modify', {
        method: 'PUT',
        body: JSON.stringify({ modifications: { premium: 1500 } }),
      }),
    );

    expect(res.status).toBe(400);
  });
});
