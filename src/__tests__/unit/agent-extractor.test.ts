import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/agent/llm', () => ({
  callLLMJson: vi.fn(),
}));

import { extractData } from '../../lib/agent/extractor';
import { callLLMJson } from '@/lib/agent/llm';

describe('extractData — renewal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extracts renewal fields from desensitized email', async () => {
    (callLLMJson as any).mockResolvedValue({
      policyNumber: '{POLICY_1}',
      clientName: '{CLIENT_1}',
      insurerName: 'Aviva Ireland',
      policyType: 'motor',
      currentPremium: 1245,
      newPremium: 1350,
      currentExpiry: '2026-03-15',
      newExpiry: '2027-03-15',
      changesNoted: null,
      commissionRate: 12.5,
      ncb: 6,
    });

    const result = await extractData(
      'Policy {POLICY_1} renewal for {CLIENT_1}. New premium €1,350.00.',
      'policy_renewal',
      { subject: 'Renewal', from: 'insurer@aviva.ie', bodyText: '' }
    );

    expect(result.newPremium).toBe(1350);
    expect(result.newExpiry).toBe('2027-03-15');
    expect(result.policyNumber).toBe('{POLICY_1}');
  });

  it('handles missing fields gracefully', async () => {
    (callLLMJson as any).mockResolvedValue({
      policyNumber: 'POL-001',
      clientName: 'Unknown',
      insurerName: 'Unknown',
      policyType: 'motor',
      newPremium: null,
      newExpiry: null,
    });

    const result = await extractData('Some email text', 'policy_renewal', {
      subject: 'Policy',
      from: 'test@test.ie',
      bodyText: '',
    });

    expect(result.policyNumber).toBe('POL-001');
    expect(result.newPremium).toBeNull();
  });

  it('handles LLM failure', async () => {
    (callLLMJson as any).mockRejectedValue(new Error('timeout'));

    await expect(
      extractData('text', 'policy_renewal', {
        subject: 'test',
        from: 'test@test.ie',
        bodyText: '',
      })
    ).rejects.toThrow('timeout');
  });
});

describe('extractData — claim', () => {
  it('extracts claim fields', async () => {
    (callLLMJson as any).mockResolvedValue({
      claimNumber: 'CLM-2024-055',
      policyNumber: 'POL-2024-001',
      clientName: 'John Doe',
      claimAmount: 5000,
      status: 'settled',
      settlementAmount: 4500,
    });

    const result = await extractData('Claim settled for €4,500', 'claim', {
      subject: 'Claim update',
      from: 'claims@allianz.ie',
      bodyText: '',
    });

    expect(result.status).toBe('settled');
    expect(result.settlementAmount).toBe(4500);
  });
});

describe('normalizePolicyNumber', () => {
  it('normalizes various formats', async () => {
    // Test the exported function
    const { normalizePolicyNumber } = await import('../../lib/agent/matcher');
    expect(normalizePolicyNumber('POL-2024-001')).toBe('POL2024001');
    expect(normalizePolicyNumber('pol/2024/001')).toBe('POL2024001');
    expect(normalizePolicyNumber('POL 2024 001')).toBe('POL2024001');
    expect(normalizePolicyNumber('POL2024001')).toBe('POL2024001');
  });
});
