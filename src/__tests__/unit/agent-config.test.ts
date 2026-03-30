import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    emailIngressConfig: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    firm: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('@/lib/auth', () => ({
  withAuth: (_perm: any, handler: any) => handler,
}));

import { prisma } from '@/lib/prisma';

describe('GET /api/agent/config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns existing config', async () => {
    (prisma.emailIngressConfig.findUnique as any).mockResolvedValue({
      id: 'config-1',
      firmId: 'firm-123',
      forwardingAddress: 'agent-firm-123@ingest.yourproduct.com',
      provider: null,
      executionMode: 'suggestion',
      confidenceThreshold: 0.95,
      processAttachments: true,
      status: 'active',
    });

    const { GET } = await import('@/app/api/agent/config/route');
    const req = new Request('http://localhost/api/agent/config');
    const user = { firmId: 'firm-123', role: 'firm_admin' };
    const res = await GET(user, req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.forwardingAddress).toBe('agent-firm-123@ingest.yourproduct.com');
    expect(body.data.executionMode).toBe('suggestion');
  });

  it('returns null config when not configured yet', async () => {
    (prisma.emailIngressConfig.findUnique as any).mockResolvedValue(null);

    const { GET } = await import('@/app/api/agent/config/route');
    const req = new Request('http://localhost/api/agent/config');
    const user = { firmId: 'firm-123', role: 'firm_admin' };
    const res = await GET(user, req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeNull();
  });
});

describe('PUT /api/agent/config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates new config with forwarding address', async () => {
    (prisma.emailIngressConfig.upsert as any).mockResolvedValue({
      id: 'config-1',
      firmId: 'firm-123',
      forwardingAddress: 'agent-firm-123@ingest.yourproduct.com',
      executionMode: 'suggestion',
      status: 'active',
    });

    const { PUT } = await import('@/app/api/agent/config/route');
    const req = new Request('http://localhost/api/agent/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ executionMode: 'suggestion' }),
    });
    const user = { firmId: 'firm-123', role: 'firm_admin' };
    const res = await PUT(user, req);

    expect(res.status).toBe(200);
    expect(prisma.emailIngressConfig.upsert).toHaveBeenCalled();
  });

  it('validates execution mode', async () => {
    const { PUT } = await import('@/app/api/agent/config/route');
    const req = new Request('http://localhost/api/agent/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ executionMode: 'invalid_mode' }),
    });
    const user = { firmId: 'firm-123', role: 'firm_admin' };
    const res = await PUT(user, req);

    expect(res.status).toBe(400);
  });

  it('validates confidence threshold range', async () => {
    const { PUT } = await import('@/app/api/agent/config/route');
    const req = new Request('http://localhost/api/agent/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confidenceThreshold: 1.5 }),
    });
    const user = { firmId: 'firm-123', role: 'firm_admin' };
    const res = await PUT(user, req);

    expect(res.status).toBe(400);
  });
});

describe('GET /api/agent/config/forwarding-address', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns existing forwarding address', async () => {
    (prisma.emailIngressConfig.findUnique as any).mockResolvedValue({
      firmId: 'firm-123',
      forwardingAddress: 'agent-firm-123@ingest.yourproduct.com',
    });

    const { GET } = await import('@/app/api/agent/config/forwarding-address/route');
    const req = new Request('http://localhost/api/agent/config/forwarding-address');
    const user = { firmId: 'firm-123', role: 'firm_admin' };
    const res = await GET(user, req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.address).toBe('agent-firm-123@ingest.yourproduct.com');
  });

  it('generates new forwarding address when none exists', async () => {
    (prisma.emailIngressConfig.findUnique as any).mockResolvedValue(null);
    (prisma.emailIngressConfig.upsert as any).mockResolvedValue({
      firmId: 'firm-456',
      forwardingAddress: 'agent-firm-456@ingest.yourproduct.com',
    });

    const { GET } = await import('@/app/api/agent/config/forwarding-address/route');
    const req = new Request('http://localhost/api/agent/config/forwarding-address');
    const user = { firmId: 'firm-456', role: 'firm_admin' };
    const res = await GET(user, req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.address).toContain('agent-firm-456@ingest.yourproduct.com');
  });
});
