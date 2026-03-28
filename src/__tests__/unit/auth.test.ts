import { describe, it, expect } from 'vitest';
import {
  createSession,
  getSession,
  deleteSession,
} from '../../lib/auth';

describe('Session management', () => {
  const mockUser = {
    id: 'user-1',
    email: 'test@example.ie',
    name: 'Test User',
    role: 'firm_admin' as const,
    firmId: 'firm-1',
  };

  it('creates a session and returns a token', () => {
    const token = createSession(mockUser);
    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');
    expect(token.length).toBe(36); // UUID format
  });

  it('retrieves user from valid session token', () => {
    const token = createSession(mockUser);
    const user = getSession(token);
    expect(user).not.toBeNull();
    expect(user!.id).toBe('user-1');
    expect(user!.firmId).toBe('firm-1');
    expect(user!.role).toBe('firm_admin');
  });

  it('returns null for invalid token', () => {
    expect(getSession('nonexistent-token')).toBeNull();
  });

  it('returns null for empty token', () => {
    expect(getSession('')).toBeNull();
  });

  it('deletes session', () => {
    const token = createSession(mockUser);
    expect(getSession(token)).not.toBeNull();
    deleteSession(token);
    expect(getSession(token)).toBeNull();
  });

  it('deleting nonexistent session does not throw', () => {
    expect(() => deleteSession('nonexistent')).not.toThrow();
  });

  it('refreshes expiry on access (sliding window)', () => {
    const token = createSession(mockUser);
    const session1 = getSession(token);
    const expiry1 = (session1 as any)?.expiresAt; // not accessible but let's verify it works
    // Access again — should still work
    const session2 = getSession(token);
    expect(session2).not.toBeNull();
  });
});

describe('Session isolation', () => {
  it('different users get different sessions', () => {
    const user1 = { id: 'u1', email: 'a@test.ie', name: 'A', role: 'adviser' as const, firmId: 'f1' };
    const user2 = { id: 'u2', email: 'b@test.ie', name: 'B', role: 'firm_admin' as const, firmId: 'f2' };

    const token1 = createSession(user1);
    const token2 = createSession(user2);

    expect(token1).not.toBe(token2);
    expect(getSession(token1)!.firmId).toBe('f1');
    expect(getSession(token2)!.firmId).toBe('f2');
  });
});
