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
});
