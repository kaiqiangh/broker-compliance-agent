import { describe, it, expect } from 'vitest';
import {
  canTransition,
  transitionChecklistItem,
  CHECKLIST_DEFINITIONS,
  ITEMS_REQUIRING_SIGN_OFF,
  type ChecklistStatus,
} from '../../lib/checklist-state';

describe('canTransition', () => {
  it('allows pending → in_progress', () => {
    expect(canTransition('pending', 'in_progress')).toBe(true);
  });

  it('allows in_progress → completed', () => {
    expect(canTransition('in_progress', 'completed')).toBe(true);
  });

  it('allows completed → pending_review', () => {
    expect(canTransition('completed', 'pending_review')).toBe(true);
  });

  it('allows pending_review → approved', () => {
    expect(canTransition('pending_review', 'approved')).toBe(true);
  });

  it('allows pending_review → rejected', () => {
    expect(canTransition('pending_review', 'rejected')).toBe(true);
  });

  it('allows rejected → in_progress (retry)', () => {
    expect(canTransition('rejected', 'in_progress')).toBe(true);
  });

  it('rejects pending → completed (must go through in_progress)', () => {
    expect(canTransition('pending', 'completed')).toBe(false);
  });

  it('rejects approved → anything (terminal)', () => {
    expect(canTransition('approved', 'pending')).toBe(false);
    expect(canTransition('approved', 'in_progress')).toBe(false);
    expect(canTransition('approved', 'rejected')).toBe(false);
  });

  it('rejects skipping pending_review', () => {
    expect(canTransition('completed', 'approved')).toBe(false);
    expect(canTransition('completed', 'rejected')).toBe(false);
  });

  it('rejects rejected → approved (must retry through in_progress)', () => {
    expect(canTransition('rejected', 'approved')).toBe(false);
  });
});

describe('transitionChecklistItem', () => {
  it('returns success for valid transition', () => {
    const result = transitionChecklistItem('pending', 'in_progress');
    expect(result.success).toBe(true);
  });

  it('returns error for invalid transition', () => {
    const result = transitionChecklistItem('pending', 'approved');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Invalid transition');
      expect(result.error).toContain('pending');
      expect(result.error).toContain('approved');
    }
  });

  it('returns error with valid transitions listed', () => {
    const result = transitionChecklistItem('approved', 'pending');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('none (terminal)');
    }
  });

  it('handles full lifecycle', () => {
    const states: ChecklistStatus[] = ['pending', 'in_progress', 'completed', 'pending_review', 'approved'];
    for (let i = 0; i < states.length - 1; i++) {
      const result = transitionChecklistItem(states[i], states[i + 1]);
      expect(result.success).toBe(true);
    }
  });

  it('handles rejection and retry lifecycle', () => {
    // Normal flow to rejection
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
});

describe('CHECKLIST_DEFINITIONS', () => {
  it('has exactly 8 items', () => {
    expect(CHECKLIST_DEFINITIONS).toHaveLength(8);
  });

  it('covers all CPC renewal requirements', () => {
    const types = CHECKLIST_DEFINITIONS.map(d => d.type);
    expect(types).toContain('renewal_notification');
    expect(types).toContain('suitability_assessment');
    expect(types).toContain('market_comparison');
    expect(types).toContain('premium_disclosure');
    expect(types).toContain('commission_disclosure');
    expect(types).toContain('client_communication');
  });

  it('marks suitability_assessment as requiring sign-off', () => {
    const suitability = CHECKLIST_DEFINITIONS.find(d => d.type === 'suitability_assessment');
    expect(suitability?.requiresSignOff).toBe(true);
  });

  it('marks final_sign_off as requiring sign-off', () => {
    const final = CHECKLIST_DEFINITIONS.find(d => d.type === 'final_sign_off');
    expect(final?.requiresSignOff).toBe(true);
  });

  it('premium_disclosure does not require evidence (auto-populated)', () => {
    const premium = CHECKLIST_DEFINITIONS.find(d => d.type === 'premium_disclosure');
    expect(premium?.evidenceRequired).toBe(false);
  });
});

describe('ITEMS_REQUIRING_SIGN_OFF', () => {
  it('includes suitability_assessment', () => {
    expect(ITEMS_REQUIRING_SIGN_OFF).toContain('suitability_assessment');
  });

  it('includes final_sign_off', () => {
    expect(ITEMS_REQUIRING_SIGN_OFF).toContain('final_sign_off');
  });

  it('does not include renewal_notification', () => {
    expect(ITEMS_REQUIRING_SIGN_OFF).not.toContain('renewal_notification');
  });
});
