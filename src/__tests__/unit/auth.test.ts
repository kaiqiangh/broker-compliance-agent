import { describe, it, expect, vi } from 'vitest';
import {
  createSession,
  getSession,
} from '../../lib/auth';

// Mock prisma.user.findUnique used by getSession for session-revocation check
vi.mock('../../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn().mockResolvedValue({ sessionsRevokedAt: null }),
    },
  },
  runWithFirmContext: vi.fn(),
}));

describe('Session management', () => {
  const mockUser = {
    id: 'user-1',
    email: 'test@example.ie',
    name: 'Test User',
    role: 'firm_admin' as const,
    firmId: 'firm-1',
  };

  it('creates a session and returns a JWT token', async () => {
    const token = await createSession(mockUser);
    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3); // JWT format: header.payload.signature
  });

  it('retrieves user from valid session token', async () => {
    const token = await createSession(mockUser);
    const user = await getSession(token);
    expect(user).not.toBeNull();
    expect(user!.id).toBe('user-1');
    expect(user!.firmId).toBe('firm-1');
    expect(user!.role).toBe('firm_admin');
    expect(user!.email).toBe('test@example.ie');
    expect(user!.name).toBe('Test User');
  });

  it('returns null for invalid token', async () => {
    expect(await getSession('nonexistent-token')).toBeNull();
  });

  it('returns null for empty token', async () => {
    expect(await getSession('')).toBeNull();
  });

  it('returns null for tampered token', async () => {
    const token = await createSession(mockUser);
    const tampered = token.slice(0, -5) + 'xxxxx';
    expect(await getSession(tampered)).toBeNull();
  });

  it('returns null for token with wrong signature', async () => {
    const token = await createSession(mockUser);
    // Replace the signature part
    const parts = token.split('.');
    const wrongSig = parts[0] + '.' + parts[1] + '.aW52YWxpZHNpZ25hdHVyZQ';
    expect(await getSession(wrongSig)).toBeNull();
  });
});

describe('Session isolation', () => {
  it('different users get different tokens', async () => {
    const user1 = { id: 'u1', email: 'a@test.ie', name: 'A', role: 'adviser' as const, firmId: 'f1' };
    const user2 = { id: 'u2', email: 'b@test.ie', name: 'B', role: 'firm_admin' as const, firmId: 'f2' };

    const token1 = await createSession(user1);
    const token2 = await createSession(user2);

    expect(token1).not.toBe(token2);
    expect((await getSession(token1))!.firmId).toBe('f1');
    expect((await getSession(token2))!.firmId).toBe('f2');
  });

  it('firm data does not leak between sessions', async () => {
    const user1 = { id: 'u1', email: 'a@test.ie', name: 'A', role: 'adviser' as const, firmId: 'firm-alpha' };
    const user2 = { id: 'u2', email: 'b@test.ie', name: 'B', role: 'firm_admin' as const, firmId: 'firm-beta' };

    const token1 = await createSession(user1);
    const token2 = await createSession(user2);

    const session1 = await getSession(token1);
    const session2 = await getSession(token2);

    expect(session1!.firmId).toBe('firm-alpha');
    expect(session2!.firmId).toBe('firm-beta');
    expect(session1!.firmId).not.toBe(session2!.firmId);
  });
});
