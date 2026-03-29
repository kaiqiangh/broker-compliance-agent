import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Prisma mock — use vi.hoisted so refs are available in the factory ──
const { mockCreate, mockFindUnique, mockUpdate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock('../../lib/prisma', () => ({
  prisma: {
    passwordResetToken: {
      create: mockCreate,
      findUnique: mockFindUnique,
      update: mockUpdate,
    },
  },
}));

import { createResetToken, consumeResetToken } from '../../lib/reset-token-store';

describe('createResetToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a non-empty hex token', async () => {
    mockCreate.mockResolvedValue({
      id: 'prt-1',
      token: 'ignored',
      userId: 'user-1',
      used: false,
      expiresAt: new Date(),
    });

    const token = await createResetToken('user-1');
    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');
    expect(token.length).toBe(64); // 32 bytes → 64 hex chars
  });

  it('calls prisma.passwordResetToken.create with correct data', async () => {
    mockCreate.mockResolvedValue({
      id: 'prt-1',
      token: 'ignored',
      userId: 'user-1',
      used: false,
      expiresAt: new Date(),
    });

    await createResetToken('user-1');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArg = mockCreate.mock.calls[0][0];
    expect(callArg.data.userId).toBe('user-1');
    expect(callArg.data.expiresAt).toBeInstanceOf(Date);
  });
});

describe('consumeResetToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns userId for a valid token', async () => {
    const futureDate = new Date(Date.now() + 15 * 60 * 1000);
    mockFindUnique.mockResolvedValue({
      id: 'prt-1',
      token: 'valid-token',
      userId: 'user-42',
      used: false,
      expiresAt: futureDate,
    });
    mockUpdate.mockResolvedValue({});

    const userId = await consumeResetToken('valid-token');
    expect(userId).toBe('user-42');
  });

  it('returns null for an expired token', async () => {
    const pastDate = new Date(Date.now() - 60_000);
    mockFindUnique.mockResolvedValue({
      id: 'prt-2',
      token: 'expired-token',
      userId: 'user-1',
      used: false,
      expiresAt: pastDate,
    });

    const userId = await consumeResetToken('expired-token');
    expect(userId).toBeNull();
  });

  it('returns null for an already-consumed token', async () => {
    const futureDate = new Date(Date.now() + 15 * 60 * 1000);
    mockFindUnique.mockResolvedValue({
      id: 'prt-3',
      token: 'used-token',
      userId: 'user-1',
      used: true,
      expiresAt: futureDate,
    });

    const userId = await consumeResetToken('used-token');
    expect(userId).toBeNull();
  });

  it('returns null on second consume (single-use)', async () => {
    const futureDate = new Date(Date.now() + 15 * 60 * 1000);
    const tokenRecord = {
      id: 'prt-4',
      token: 'single-use-token',
      userId: 'user-99',
      used: false,
      expiresAt: futureDate,
    };

    // First call: token is fresh
    mockFindUnique.mockResolvedValueOnce(tokenRecord);
    mockUpdate.mockResolvedValue({});

    const firstResult = await consumeResetToken('single-use-token');
    expect(firstResult).toBe('user-99');

    // Simulate the token now being marked as used
    mockFindUnique.mockResolvedValueOnce({ ...tokenRecord, used: true });

    const secondResult = await consumeResetToken('single-use-token');
    expect(secondResult).toBeNull();
  });

  it('returns null for a non-existent token', async () => {
    mockFindUnique.mockResolvedValue(null);

    const userId = await consumeResetToken('does-not-exist');
    expect(userId).toBeNull();
  });
});
