import { describe, it, expect } from 'vitest';
import { generateAction } from '@/lib/agent/action-generator';

describe('generateAction premium tolerance', () => {
  const baseInput = {
    firmId: 'firm-1',
    emailSubject: 'Renewal',
    emailFrom: 'test@aviva.ie',
    classification: { category: 'policy_renewal', confidence: 0.95 },
    matching: { policy: { id: 'pol-1', confidence: 1.0 } },
    existingPolicy: {
      id: 'pol-1',
      premium: 1234.50,
      expiryDate: new Date('2026-04-15'),
      ncb: null,
      clientId: 'cli-1',
    },
  };

  it('ignores premium differences within €0.01 tolerance', () => {
    const action = generateAction({
      ...baseInput,
      extraction: { policyNumber: 'POL-123', newPremium: 1234.501, newExpiry: '2027-04-15' },
    });
    // Premium diff of 0.001 should NOT be flagged
    expect(action.changes.premium).toBeUndefined();
  });

  it('detects premium differences above €0.01 tolerance', () => {
    const action = generateAction({
      ...baseInput,
      extraction: { policyNumber: 'POL-123', newPremium: 1250.00, newExpiry: '2027-04-15' },
    });
    // Premium diff of 15.50 should be flagged
    expect(action.changes.premium).toEqual({ old: 1234.50, new: 1250.0 });
  });

  it('ignores premium difference of exactly €0.01', () => {
    const action = generateAction({
      ...baseInput,
      extraction: { policyNumber: 'POL-123', newPremium: 1234.51, newExpiry: '2027-04-15' },
    });
    // Exactly 0.01 should NOT be flagged (using > not >=)
    expect(action.changes.premium).toBeUndefined();
  });

  it('detects premium difference of €0.02', () => {
    const action = generateAction({
      ...baseInput,
      extraction: { policyNumber: 'POL-123', newPremium: 1234.52, newExpiry: '2027-04-15' },
    });
    expect(action.changes.premium).toBeDefined();
  });
});
