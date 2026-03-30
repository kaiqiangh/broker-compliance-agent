import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    agentAction: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
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

import { prisma } from '@/lib/prisma';
import { auditLog } from '@/lib/audit';

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

    const { PUT } = await import('@/app/api/agent/actions/[id]/confirm/route');
    const res = await PUT(
      { firmId: 'f1', id: 'u1', role: 'adviser' } as any,
      new Request('http://localhost', { method: 'PUT' })
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
    (prisma.agentAction.findUnique as any).mockResolvedValue(null);

    const { PUT } = await import('@/app/api/agent/actions/[id]/confirm/route');
    const res = await PUT(
      { firmId: 'f1', id: 'u1', role: 'adviser' } as any,
      new Request('http://localhost', { method: 'PUT' }),
      { params: { id: 'nonexistent' } }
    );

    expect(res.status).toBe(404);
  });

  it('returns 400 if action already confirmed', async () => {
    // updateMany returns 0 (status not pending)
    (prisma.agentAction.updateMany as any).mockResolvedValue({ count: 0 });
    (prisma.agentAction.findUnique as any).mockResolvedValue({
      id: 'a1',
      status: 'confirmed',
    });

    const { PUT } = await import('@/app/api/agent/actions/[id]/confirm/route');
    const res = await PUT(
      { firmId: 'f1', id: 'u1', role: 'adviser' } as any,
      new Request('http://localhost', { method: 'PUT' }),
      { params: { id: 'a1' } }
    );

    expect(res.status).toBe(400);
  });
});

describe('PUT /api/agent/actions/:id/reject', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects action with reason', async () => {
    (prisma.agentAction.findUnique as any).mockResolvedValue({
      id: 'a1',
      status: 'pending',
    });
    (prisma.agentAction.update as any).mockResolvedValue({});

    const { PUT } = await import('@/app/api/agent/actions/[id]/reject/route');
    const res = await PUT(
      { firmId: 'f1', id: 'u1', role: 'adviser' } as any,
      new Request('http://localhost', {
        method: 'PUT',
        body: JSON.stringify({ reason: 'Data was incorrect' }),
      }),
      { params: { id: 'a1' } }
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
