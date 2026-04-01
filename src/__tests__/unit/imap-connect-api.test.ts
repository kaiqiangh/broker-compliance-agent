import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock all external dependencies before importing
vi.mock('@/lib/auth', () => ({
  withAuth: (_config: any, handler: any) => {
    return async (request: Request) => {
      const user = {
        id: 'user-1',
        firmId: 'firm-1',
        email: 'test@example.com',
        role: 'admin',
      };
      return handler(user, request);
    };
  },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    emailIngressConfig: {
      upsert: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('@/lib/email/oauth/crypto', () => ({
  encryptToken: vi.fn((p: string) => `enc:${p}`),
}));

vi.mock('@/lib/email/imap/connector', () => ({
  connectIMAP: vi.fn(),
}));

vi.mock('@/lib/audit', () => ({
  auditLog: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

import { prisma } from '@/lib/prisma';
import { connectIMAP } from '@/lib/email/imap/connector';
import { auditLog } from '@/lib/audit';
import { checkRateLimit } from '@/lib/rate-limit';

// Import the route handler
import { POST } from '../../app/api/agent/oauth/imap/connect/route';

describe('POST /api/agent/oauth/imap/connect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Re-configure mock after clearAllMocks
    (checkRateLimit as any).mockResolvedValue({ allowed: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeRequest(body: any): Request {
    return new Request('http://localhost/api/agent/oauth/imap/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('rejects missing username/password', async () => {
    const res = await POST(makeRequest({ host: 'imap.gmail.com' }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error.code).toBe('BAD_REQUEST');
    expect(data.error.message).toContain('username and password');
  });

  it('rejects missing host when no preset used', async () => {
    const res = await POST(makeRequest({ username: 'test', password: 'pass' }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error.code).toBe('BAD_REQUEST');
  });

  it('connects with gmail preset', async () => {
    const mockClient = {
      logout: vi.fn().mockResolvedValue(undefined),
    };
    (connectIMAP as any).mockResolvedValue(mockClient);
    (prisma.emailIngressConfig.upsert as any).mockResolvedValue({});

    const res = await POST(makeRequest({
      host: 'gmail',
      username: 'test@gmail.com',
      password: 'app-password',
    }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.data.connected).toBe(true);
    expect(connectIMAP).toHaveBeenCalledWith('imap.gmail.com', 993, 'test@gmail.com', 'app-password');
    expect(mockClient.logout).toHaveBeenCalled();
  });

  it('connects with outlook preset', async () => {
    const mockClient = {
      logout: vi.fn().mockResolvedValue(undefined),
    };
    (connectIMAP as any).mockResolvedValue(mockClient);
    (prisma.emailIngressConfig.upsert as any).mockResolvedValue({});

    const res = await POST(makeRequest({
      host: 'outlook',
      username: 'test@outlook.com',
      password: 'password',
    }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.data.connected).toBe(true);
    expect(connectIMAP).toHaveBeenCalledWith('outlook.office365.com', 993, 'test@outlook.com', 'password');
  });

  it('connects with custom host and port', async () => {
    const mockClient = {
      logout: vi.fn().mockResolvedValue(undefined),
    };
    (connectIMAP as any).mockResolvedValue(mockClient);
    (prisma.emailIngressConfig.upsert as any).mockResolvedValue({});

    const res = await POST(makeRequest({
      host: 'mail.example.com',
      port: 143,
      username: 'user@example.com',
      password: 'secret',
    }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(connectIMAP).toHaveBeenCalledWith('mail.example.com', 143, 'user@example.com', 'secret');
  });

  it('returns 400 when IMAP connection fails', async () => {
    (prisma.emailIngressConfig.upsert as any).mockResolvedValue({ id: 'config-3' });
    (prisma.emailIngressConfig.update as any).mockResolvedValue({});
    (connectIMAP as any).mockRejectedValue(new Error('AUTHENTICATIONFAILED'));

    const res = await POST(makeRequest({
      host: 'imap.gmail.com',
      username: 'test@gmail.com',
      password: 'wrong',
    }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error.code).toBe('CONNECTION_FAILED');
    expect(data.error.message).toContain('AUTHENTICATIONFAILED');
    // Route upserts credentials with status='testing' first, then updates to 'error' on failure
    expect(prisma.emailIngressConfig.upsert).toHaveBeenCalled();
    expect(prisma.emailIngressConfig.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'error' }),
      })
    );
  });

  it('encrypts password and saves config on success', async () => {
    const mockClient = {
      logout: vi.fn().mockResolvedValue(undefined),
    };
    (connectIMAP as any).mockResolvedValue(mockClient);
    (prisma.emailIngressConfig.upsert as any).mockResolvedValue({ id: 'config-1' });
    (prisma.emailIngressConfig.update as any).mockResolvedValue({});

    await POST(makeRequest({
      host: 'imap.gmail.com',
      username: 'test@gmail.com',
      password: 'my-app-password',
    }));

    // Route first upserts with status 'testing', then updates to 'active' after successful connection
    expect(prisma.emailIngressConfig.upsert).toHaveBeenCalledWith({
      where: { firmId: 'firm-1' },
      update: expect.objectContaining({
        provider: 'imap',
        imapHost: 'imap.gmail.com',
        imapPort: 993,
        imapUsername: 'test@gmail.com',
        imapPasswordEncrypted: 'enc:my-app-password',
        status: 'testing',
      }),
      create: expect.objectContaining({
        firmId: 'firm-1',
        provider: 'imap',
        imapHost: 'imap.gmail.com',
        imapPort: 993,
        imapUsername: 'test@gmail.com',
        imapPasswordEncrypted: 'enc:my-app-password',
        status: 'testing',
      }),
    });

    // After successful connection, route updates to 'active'
    expect(prisma.emailIngressConfig.update).toHaveBeenCalledWith({
      where: { id: 'config-1' },
      data: { status: 'active', lastError: null, errorCount: 0 },
    });
  });

  it('audits the connection', async () => {
    const mockClient = {
      logout: vi.fn().mockResolvedValue(undefined),
    };
    (connectIMAP as any).mockResolvedValue(mockClient);
    (prisma.emailIngressConfig.upsert as any).mockResolvedValue({ id: 'config-2' });
    (prisma.emailIngressConfig.update as any).mockResolvedValue({});

    await POST(makeRequest({
      host: 'imap.gmail.com',
      username: 'test@gmail.com',
      password: 'app-password',
    }));

    expect(auditLog).toHaveBeenCalledWith(
      'firm-1',
      'agent.email_connected',
      'email_ingress_config',
      'firm-1',
      { provider: 'imap', host: 'imap.gmail.com' }
    );
  });
});
