import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    emailIngressConfig: {
      findUnique: vi.fn(),
    },
    incomingEmail: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}));

// Mock R2 storage
vi.mock('@/lib/storage', () => ({
  uploadToR2: vi.fn().mockResolvedValue('emails/firm-123/test-msg.eml'),
}));

import { prisma } from '@/lib/prisma';

// Helper to create a valid webhook request
function createWebhookRequest(
  rawEmail: string,
  firmId: string,
  secret: string
): Request {
  const { createHmac } = require('crypto');
  const signature = createHmac('sha256', secret)
    .update(rawEmail)
    .digest('hex');

  const toAddress = `agent-${firmId}@ingest.yourproduct.com`;

  return new Request('http://localhost/api/agent/ingest', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-webhook-signature': signature,
    },
    body: JSON.stringify({
      from: 'insurer@aviva.ie',
      to: toAddress,
      raw: Buffer.from(rawEmail).toString('base64'),
    }),
  });
}

const SAMPLE_EMAIL =
  `From: insurer@aviva.ie\r\n` +
  `To: agent-firm-123@ingest.yourproduct.com\r\n` +
  `Subject: Motor Policy Renewal - POL-2024-001\r\n` +
  `Date: Mon, 30 Mar 2026 10:00:00 +0000\r\n` +
  `Message-ID: <test-msg-001@aviva.ie>\r\n` +
  `Content-Type: text/plain\r\n` +
  `\r\n` +
  `Policy POL-2024-001 renewal. New premium €1,350.00.\r\n`;

describe('POST /api/agent/ingest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WEBHOOK_SECRET = 'test-secret-123';
  });

  it('accepts valid webhook and stores email', async () => {
    // Mock: firm exists with matching forwarding address
    (prisma.emailIngressConfig.findUnique as any).mockResolvedValue({
      id: 'config-1',
      firmId: 'firm-123',
      forwardingAddress: 'agent-firm-123@ingest.yourproduct.com',
      status: 'active',
    });

    // Mock: no duplicate
    (prisma.incomingEmail.findFirst as any).mockResolvedValue(null);

    // Mock: create email
    (prisma.incomingEmail.create as any).mockResolvedValue({
      id: 'email-1',
      firmId: 'firm-123',
      messageId: 'test-msg-001@aviva.ie',
    });

    const { POST } = await import('@/app/api/agent/ingest/route');
    const req = createWebhookRequest(SAMPLE_EMAIL, 'firm-123', 'test-secret-123');
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('queued');
  });

  it('rejects invalid webhook signature', async () => {
    const { POST } = await import('@/app/api/agent/ingest/route');

    const req = new Request('http://localhost/api/agent/ingest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-signature': 'invalid-signature',
      },
      body: JSON.stringify({
        from: 'insurer@aviva.ie',
        to: 'agent-firm-123@ingest.yourproduct.com',
        raw: Buffer.from(SAMPLE_EMAIL).toString('base64'),
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('rejects missing signature header', async () => {
    const { POST } = await import('@/app/api/agent/ingest/route');

    const req = new Request('http://localhost/api/agent/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'insurer@aviva.ie',
        to: 'agent-firm-123@ingest.yourproduct.com',
        raw: Buffer.from(SAMPLE_EMAIL).toString('base64'),
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown firm', async () => {
    (prisma.emailIngressConfig.findUnique as any).mockResolvedValue(null);

    const { POST } = await import('@/app/api/agent/ingest/route');
    const req = createWebhookRequest(SAMPLE_EMAIL, 'unknown-firm', 'test-secret-123');
    const res = await POST(req);

    expect(res.status).toBe(404);
  });

  it('deduplicates on Message-ID', async () => {
    (prisma.emailIngressConfig.findUnique as any).mockResolvedValue({
      id: 'config-1',
      firmId: 'firm-123',
      forwardingAddress: 'agent-firm-123@ingest.yourproduct.com',
      status: 'active',
    });

    // Mock: duplicate exists
    (prisma.incomingEmail.findFirst as any).mockResolvedValue({
      id: 'existing-email',
      messageId: 'test-msg-001@aviva.ie',
    });

    const { POST } = await import('@/app/api/agent/ingest/route');
    const req = createWebhookRequest(SAMPLE_EMAIL, 'firm-123', 'test-secret-123');
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('duplicate');
    // Should NOT create new email record
    expect(prisma.incomingEmail.create).not.toHaveBeenCalled();
  });

  it('extracts firm ID from recipient address', async () => {
    (prisma.emailIngressConfig.findUnique as any).mockResolvedValue({
      id: 'config-1',
      firmId: 'abc-def-123',
      forwardingAddress: 'agent-abc-def-123@ingest.yourproduct.com',
      status: 'active',
    });
    (prisma.incomingEmail.findFirst as any).mockResolvedValue(null);
    (prisma.incomingEmail.create as any).mockResolvedValue({ id: 'email-1' });

    const { POST } = await import('@/app/api/agent/ingest/route');

    const emailWithDifferentTo =
      `From: insurer@aviva.ie\r\n` +
      `To: agent-abc-def-123@ingest.yourproduct.com\r\n` +
      `Subject: Test\r\n` +
      `Message-ID: <extract-test@aviva.ie>\r\n` +
      `\r\n` +
      `Test body`;

    const req = createWebhookRequest(emailWithDifferentTo, 'abc-def-123', 'test-secret-123');
    const res = await POST(req);

    expect(res.status).toBe(200);
    // Verify the create was called with the correct firmId
    expect(prisma.incomingEmail.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          firmId: 'abc-def-123',
        }),
      })
    );
  });

  it('rejects inactive firm config', async () => {
    (prisma.emailIngressConfig.findUnique as any).mockResolvedValue({
      id: 'config-1',
      firmId: 'firm-123',
      status: 'paused',
    });

    const { POST } = await import('@/app/api/agent/ingest/route');
    const req = createWebhookRequest(SAMPLE_EMAIL, 'firm-123', 'test-secret-123');
    const res = await POST(req);

    expect(res.status).toBe(403);
  });

  it('handles missing WEBHOOK_SECRET env var', async () => {
    delete process.env.WEBHOOK_SECRET;

    const { POST } = await import('@/app/api/agent/ingest/route');
    const req = createWebhookRequest(SAMPLE_EMAIL, 'firm-123', 'test-secret-123');
    const res = await POST(req);

    expect(res.status).toBe(500);
  });
});
