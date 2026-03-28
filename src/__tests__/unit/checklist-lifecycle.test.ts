import { describe, it, expect } from 'vitest';
import { transitionChecklistItem, canTransition } from '../../lib/checklist-state';

describe('ChecklistService — state machine integration', () => {
  it('validates full lifecycle from pending to approved', () => {
    const states = ['pending', 'in_progress', 'completed', 'pending_review', 'approved'] as const;
    for (let i = 0; i < states.length - 1; i++) {
      const result = transitionChecklistItem(states[i], states[i + 1]);
      expect(result.success, `${states[i]} -> ${states[i+1]}`).toBe(true);
    }
  });

  it('validates rejection and retry lifecycle', () => {
    // Get to rejected
    expect(transitionChecklistItem('pending', 'in_progress').success).toBe(true);
    expect(transitionChecklistItem('in_progress', 'completed').success).toBe(true);
    expect(transitionChecklistItem('completed', 'pending_review').success).toBe(true);
    expect(transitionChecklistItem('pending_review', 'rejected').success).toBe(true);

    // Retry
    expect(transitionChecklistItem('rejected', 'in_progress').success).toBe(true);
    expect(transitionChecklistItem('in_progress', 'completed').success).toBe(true);
    expect(transitionChecklistItem('completed', 'pending_review').success).toBe(true);
    expect(transitionChecklistItem('pending_review', 'approved').success).toBe(true);
  });

  it('prevents all invalid transitions', () => {
    const invalidTransitions: Array<[string, string]> = [
      ['pending', 'completed'],
      ['pending', 'approved'],
      ['pending', 'rejected'],
      ['completed', 'approved'],
      ['completed', 'rejected'],
      ['approved', 'pending'],
      ['approved', 'in_progress'],
      ['approved', 'rejected'],
      ['rejected', 'approved'],
      ['rejected', 'completed'],
    ];

    for (const [from, to] of invalidTransitions) {
      expect(
        canTransition(from as any, to as any),
        `${from} -> ${to} should be invalid`
      ).toBe(false);
    }
  });
});
