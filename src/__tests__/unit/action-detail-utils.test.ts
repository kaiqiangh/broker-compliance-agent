import { describe, expect, it } from 'vitest';
import { canReverseAction } from '@/app/agent/actions/action-detail-utils';

describe('canReverseAction', () => {
  it('allows reversing confirmed actions that are not already reversed', () => {
    expect(canReverseAction('confirmed', false)).toBe(true);
  });

  it('allows reversing executed actions that are not already reversed', () => {
    expect(canReverseAction('executed', false)).toBe(true);
  });

  it('disallows reversing already-reversed actions', () => {
    expect(canReverseAction('executed', true)).toBe(false);
  });

  it('disallows reversing pending actions', () => {
    expect(canReverseAction('pending', false)).toBe(false);
  });

  it('allows reversing within 24h window', () => {
    const recentTime = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString();
    expect(canReverseAction('executed', false, recentTime)).toBe(true);
  });

  it('disallows reversing after 24h window expires', () => {
    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    expect(canReverseAction('executed', false, oldTime)).toBe(false);
  });

  it('uses confirmedAt fallback when executedAt is null', () => {
    const recentTime = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    expect(canReverseAction('confirmed', false, null, recentTime)).toBe(true);
  });

  it('returns true when no timestamps provided (backward compat)', () => {
    expect(canReverseAction('executed', false, null, null)).toBe(true);
  });
});
