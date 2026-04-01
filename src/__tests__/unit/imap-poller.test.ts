import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before importing
vi.mock('../../lib/prisma', () => ({
  prisma: {
    emailIngressConfig: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    incomingEmail: {
      create: vi.fn(),
    },
  },
}));

vi.mock('../../lib/email/oauth/crypto', () => ({
  decryptToken: vi.fn((ciphertext: string) => `decrypted-${ciphertext}`),
  encryptToken: vi.fn((plaintext: string) => `encrypted-${plaintext}`),
}));

vi.mock('../../lib/email/imap/connector', () => ({
  connectIMAP: vi.fn(),
}));

vi.mock('../../lib/agent/queue', () => ({
  enqueueJob: vi.fn(),
}));

vi.mock('mailparser', () => ({
  simpleParser: vi.fn(),
}));

import { prisma } from '../../lib/prisma';
import { decryptToken } from '../../lib/email/oauth/crypto';
import { connectIMAP } from '../../lib/email/imap/connector';
import { enqueueJob } from '../../lib/agent/queue';
import { simpleParser } from 'mailparser';
import { pollIMAPConnections } from '../../lib/email/imap/poller';

describe('IMAP Poller — pollIMAPConnections()', () => {
  const mockClient = {
    connect: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    getMailboxLock: vi.fn(),
  };

  const mockLock = {
    release: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    mockClient.getMailboxLock.mockResolvedValue(mockLock);
    (connectIMAP as any).mockResolvedValue(mockClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 0 when no IMAP configs exist', async () => {
    (prisma.emailIngressConfig.findMany as any).mockResolvedValue([]);

    const count = await pollIMAPConnections();

    expect(count).toBe(0);
    expect(prisma.emailIngressConfig.findMany).toHaveBeenCalledWith({
      where: {
        provider: 'imap',
        status: 'active',
        imapHost: { not: null },
        imapUsername: { not: null },
        imapPasswordEncrypted: { not: null },
      },
    });
  });

  it('fetches unseen messages and creates IncomingEmail records', async () => {
    const config = {
      id: 'config-1',
      firmId: 'firm-1',
      provider: 'imap',
      imapHost: 'imap.gmail.com',
      imapPort: 993,
      imapUsername: 'test@gmail.com',
      imapPasswordEncrypted: 'enc-password',
      lastPolledAt: null,
      errorCount: 0,
    };

    (prisma.emailIngressConfig.findMany as any).mockResolvedValue([config]);

    const mockMessages = [
      { uid: 101, source: Buffer.from('raw-email-1') },
      { uid: 102, source: Buffer.from('raw-email-2') },
    ];

    // Make the client fetch return async iterable
    mockClient.getMailboxLock.mockResolvedValue(mockLock);
    (connectIMAP as any).mockImplementation(() => ({
      ...mockClient,
      async *[Symbol.asyncIterator]() {
        for (const msg of mockMessages) yield msg;
      },
      fetch() {
        return this;
      },
    }));

    (simpleParser as any)
      .mockResolvedValueOnce({
        messageId: '<msg-1@example.com>',
        from: { value: [{ address: 'sender@example.com' }] },
        to: { value: [{ address: 'test@gmail.com' }] },
        subject: 'Test Email 1',
        date: new Date('2025-01-01'),
        text: 'Hello',
        html: '<p>Hello</p>',
      })
      .mockResolvedValueOnce({
        messageId: '<msg-2@example.com>',
        from: { value: [{ address: 'other@example.com' }] },
        to: { value: [{ address: 'test@gmail.com' }] },
        subject: 'Test Email 2',
        date: new Date('2025-01-02'),
        text: 'World',
        html: '<p>World</p>',
      });

    (prisma.incomingEmail.create as any)
      .mockResolvedValueOnce({ id: 'email-1' })
      .mockResolvedValueOnce({ id: 'email-2' });

    const count = await pollIMAPConnections();

    expect(count).toBe(2);
    expect(prisma.incomingEmail.create).toHaveBeenCalledTimes(2);
    expect(prisma.incomingEmail.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        firmId: 'firm-1',
        messageId: 'msg-1@example.com',
        fromAddress: 'sender@example.com',
        subject: 'Test Email 1',
        status: 'pending_processing',
      }),
    });
    expect(enqueueJob).toHaveBeenCalledTimes(2);
  });

  it('updates lastPolledAt on success', async () => {
    const config = {
      id: 'config-1',
      firmId: 'firm-1',
      provider: 'imap',
      imapHost: 'imap.gmail.com',
      imapPort: 993,
      imapUsername: 'test@gmail.com',
      imapPasswordEncrypted: 'enc-password',
      lastPolledAt: null,
      errorCount: 0,
    };

    (prisma.emailIngressConfig.findMany as any).mockResolvedValue([config]);

    // Mock fetch to return empty async iterable
    (connectIMAP as any).mockImplementation(() => ({
      ...mockClient,
      async *[Symbol.asyncIterator]() {},
      fetch() { return this; },
    }));

    const count = await pollIMAPConnections();

    expect(count).toBe(0);
    expect(prisma.emailIngressConfig.update).toHaveBeenCalledWith({
      where: { id: 'config-1' },
      data: expect.objectContaining({
        lastPolledAt: expect.any(Date),
        lastError: null,
        errorCount: 0,
      }),
    });
  });

  it('increments errorCount on connection failure', async () => {
    const config = {
      id: 'config-1',
      firmId: 'firm-1',
      provider: 'imap',
      imapHost: 'imap.gmail.com',
      imapPort: 993,
      imapUsername: 'test@gmail.com',
      imapPasswordEncrypted: 'enc-password',
      lastPolledAt: null,
      errorCount: 3,
    };

    (prisma.emailIngressConfig.findMany as any).mockResolvedValue([config]);
    (connectIMAP as any).mockRejectedValue(new Error('Connection refused'));

    const count = await pollIMAPConnections();

    expect(count).toBe(0);
    expect(prisma.emailIngressConfig.update).toHaveBeenCalledWith({
      where: { id: 'config-1' },
      data: expect.objectContaining({
        lastError: 'Connection refused',
        errorCount: { increment: 1 },
      }),
    });
    // Should NOT set status=error yet (errorCount is 3, needs to reach 10)
    const updateCall = (prisma.emailIngressConfig.update as any).mock.calls[0][0];
    expect(updateCall.data.status).toBeUndefined();
  });

  it('sets status=error when errorCount reaches 10', async () => {
    const config = {
      id: 'config-1',
      firmId: 'firm-1',
      provider: 'imap',
      imapHost: 'imap.gmail.com',
      imapPort: 993,
      imapUsername: 'test@gmail.com',
      imapPasswordEncrypted: 'enc-password',
      lastPolledAt: null,
      errorCount: 9,
    };

    (prisma.emailIngressConfig.findMany as any).mockResolvedValue([config]);
    (connectIMAP as any).mockRejectedValue(new Error('Auth failed'));

    const count = await pollIMAPConnections();

    expect(count).toBe(0);
    expect(prisma.emailIngressConfig.update).toHaveBeenCalledWith({
      where: { id: 'config-1' },
      data: expect.objectContaining({
        lastError: 'Auth failed',
        errorCount: { increment: 1 },
        status: 'error',
      }),
    });
  });

  it('skips duplicate emails (P2002)', async () => {
    const config = {
      id: 'config-1',
      firmId: 'firm-1',
      provider: 'imap',
      imapHost: 'imap.gmail.com',
      imapPort: 993,
      imapUsername: 'test@gmail.com',
      imapPasswordEncrypted: 'enc-password',
      lastPolledAt: null,
      errorCount: 0,
    };

    (prisma.emailIngressConfig.findMany as any).mockResolvedValue([config]);

    (connectIMAP as any).mockImplementation(() => ({
      ...mockClient,
      async *[Symbol.asyncIterator]() {
        yield { uid: 101, source: Buffer.from('raw') };
      },
      fetch() { return this; },
    }));

    (simpleParser as any).mockResolvedValue({
      messageId: '<dup@example.com>',
      from: { value: [{ address: 'sender@example.com' }] },
      to: { value: [] },
      subject: 'Dup',
      date: new Date(),
      text: '',
      html: '',
    });

    const duplicateError: any = new Error('Unique constraint');
    duplicateError.code = 'P2002';
    (prisma.incomingEmail.create as any).mockRejectedValue(duplicateError);

    const count = await pollIMAPConnections();

    expect(count).toBe(0);
    // Should not log error for P2002
    expect(console.error).not.toHaveBeenCalled();
  });

  it('decrypts the IMAP password before connecting', async () => {
    const config = {
      id: 'config-1',
      firmId: 'firm-1',
      provider: 'imap',
      imapHost: 'imap.gmail.com',
      imapPort: 993,
      imapUsername: 'test@gmail.com',
      imapPasswordEncrypted: 'my-encrypted-pw',
      lastPolledAt: null,
      errorCount: 0,
    };

    (prisma.emailIngressConfig.findMany as any).mockResolvedValue([config]);

    (connectIMAP as any).mockImplementation(() => ({
      ...mockClient,
      async *[Symbol.asyncIterator]() {},
      fetch() { return this; },
    }));

    await pollIMAPConnections();

    expect(decryptToken).toHaveBeenCalledWith('my-encrypted-pw');
    expect(connectIMAP).toHaveBeenCalledWith('imap.gmail.com', 993, 'test@gmail.com', 'decrypted-my-encrypted-pw');
  });
});
