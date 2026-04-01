import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    agentAction: {
      findMany: vi.fn(),
    },
    incomingEmail: {
      findMany: vi.fn(),
    },
  },
  runWithFirmContext: (_id: string, fn: () => any) => fn(),
}));

vi.mock('@/lib/auth', () => ({
  withAuth: (_perm: any, handler: any) => handler,
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { checkRateLimit } from '@/lib/rate-limit';

describe('GET /api/agent/actions/export', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns CSV with correct headers', async () => {
    (checkRateLimit as any).mockResolvedValue({ allowed: true });
    (prisma.agentAction.findMany as any).mockResolvedValue([
      {
        id: 'a1',
        actionType: 'update_policy',
        entityType: 'policy',
        entityId: 'p1',
        confidence: 0.95,
        matchConfidence: 0.88,
        status: 'pending',
        reasoning: 'Renewal detected',
        changes: { premium: { old: 1000, new: 1200 } },
        createdAt: new Date('2024-01-15T10:00:00Z'),
        confirmedAt: null,
        executedAt: null,
        isReversed: false,
        email: {
          subject: 'Policy Renewal ABC',
          fromAddress: 'insurer@example.com',
          receivedAt: new Date('2024-01-15T09:00:00Z'),
        },
      },
    ]);

    const { GET } = await import('@/app/api/agent/actions/export/route');
    const res = await GET(
      { firmId: 'f1', role: 'firm_admin', id: 'u1' } as any,
      new Request('http://localhost/api/agent/actions/export?format=csv')
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('Content-Disposition')).toMatch(/attachment; filename="actions.*\.csv"/);

    const csv = await res.text();
    const lines = csv.split('\n');
    expect(lines[0]).toBe('ID,Action Type,Entity Type,Entity ID,Confidence,Match Confidence,Status,Reasoning,Changes,Email Subject,Email From,Email Received At,Created At,Confirmed At,Executed At,Is Reversed');
    expect(lines[1]).toContain('a1');
    expect(lines[1]).toContain('update_policy');
    expect(lines[1]).toContain('0.95');
  });

  it('filters by date range', async () => {
    (checkRateLimit as any).mockResolvedValue({ allowed: true });
    (prisma.agentAction.findMany as any).mockResolvedValue([]);

    const { GET } = await import('@/app/api/agent/actions/export/route');
    await GET(
      { firmId: 'f1', role: 'firm_admin', id: 'u1' } as any,
      new Request('http://localhost/api/agent/actions/export?format=csv&from=2024-01-01&to=2024-01-31')
    );

    expect(prisma.agentAction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: {
            gte: new Date('2024-01-01'),
            lte: new Date('2024-01-31'),
          },
        }),
      })
    );
  });

  it('returns 429 when rate limited', async () => {
    (checkRateLimit as any).mockResolvedValue({ allowed: false, retryAfter: 30 });

    const { GET } = await import('@/app/api/agent/actions/export/route');
    const res = await GET(
      { firmId: 'f1', role: 'firm_admin', id: 'u1' } as any,
      new Request('http://localhost/api/agent/actions/export?format=csv')
    );

    expect(res.status).toBe(429);
  });

  it('rate limits at 5/min', async () => {
    (checkRateLimit as any).mockResolvedValue({ allowed: true });
    (prisma.agentAction.findMany as any).mockResolvedValue([]);

    const { GET } = await import('@/app/api/agent/actions/export/route');
    await GET(
      { firmId: 'f1', role: 'firm_admin', id: 'u1' } as any,
      new Request('http://localhost/api/agent/actions/export?format=csv')
    );

    expect(checkRateLimit).toHaveBeenCalledWith(expect.stringContaining('u1'), 5, 60_000);
  });
});

describe('GET /api/agent/emails/export', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns CSV with correct headers', async () => {
    (checkRateLimit as any).mockResolvedValue({ allowed: true });
    (prisma.incomingEmail.findMany as any).mockResolvedValue([
      {
        id: 'e1',
        messageId: '<msg-1@example.com>',
        fromAddress: 'insurer@example.com',
        subject: 'Policy Renewal',
        receivedAt: new Date('2024-01-15T09:00:00Z'),
        isInsurance: true,
        category: 'policy_renewal',
        priority: 'normal',
        status: 'processed',
        processedAt: new Date('2024-01-15T09:05:00Z'),
        threadId: 'thread-1',
        createdAt: new Date('2024-01-15T09:00:00Z'),
        _count: { actions: 2, attachments: 1 },
      },
    ]);

    const { GET } = await import('@/app/api/agent/emails/export/route');
    const res = await GET(
      { firmId: 'f1', id: 'u1' } as any,
      new Request('http://localhost/api/agent/emails/export?format=csv')
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('Content-Disposition')).toMatch(/attachment; filename="emails.*\.csv"/);

    const csv = await res.text();
    const lines = csv.split('\n');
    expect(lines[0]).toBe('ID,Message ID,From,Subject,Received At,Is Insurance,Category,Priority,Status,Processed At,Thread ID,Actions Count,Attachments Count,Created At');
    expect(lines[1]).toContain('e1');
    expect(lines[1]).toContain('insurer@example.com');
    expect(lines[1]).toContain('Policy Renewal');
  });

  it('filters by date range', async () => {
    (checkRateLimit as any).mockResolvedValue({ allowed: true });
    (prisma.incomingEmail.findMany as any).mockResolvedValue([]);

    const { GET } = await import('@/app/api/agent/emails/export/route');
    await GET(
      { firmId: 'f1', id: 'u1' } as any,
      new Request('http://localhost/api/agent/emails/export?format=csv&from=2024-01-01&to=2024-01-31')
    );

    expect(prisma.incomingEmail.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          receivedAt: {
            gte: new Date('2024-01-01'),
            lte: new Date('2024-01-31'),
          },
        }),
      })
    );
  });

  it('returns 429 when rate limited', async () => {
    (checkRateLimit as any).mockResolvedValue({ allowed: false, retryAfter: 30 });

    const { GET } = await import('@/app/api/agent/emails/export/route');
    const res = await GET(
      { firmId: 'f1', id: 'u1' } as any,
      new Request('http://localhost/api/agent/emails/export?format=csv')
    );

    expect(res.status).toBe(429);
  });

  it('rate limits at 5/min', async () => {
    (checkRateLimit as any).mockResolvedValue({ allowed: true });
    (prisma.incomingEmail.findMany as any).mockResolvedValue([]);

    const { GET } = await import('@/app/api/agent/emails/export/route');
    await GET(
      { firmId: 'f1', id: 'u1' } as any,
      new Request('http://localhost/api/agent/emails/export?format=csv')
    );

    expect(checkRateLimit).toHaveBeenCalledWith(expect.stringContaining('u1'), 5, 60_000);
  });
});
