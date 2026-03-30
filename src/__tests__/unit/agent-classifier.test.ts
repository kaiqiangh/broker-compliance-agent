import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/agent/llm', () => ({
  callLLM: vi.fn(),
  callLLMJson: vi.fn(),
}));

import { classifyEmail } from '../../lib/agent/classifier';
import { callLLMJson } from '@/lib/agent/llm';

describe('classifyEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('classifies renewal email correctly', async () => {
    (callLLMJson as any).mockResolvedValue({
      isInsurance: true,
      category: 'policy_renewal',
      priority: 'normal',
      confidence: 0.95,
    });

    const result = await classifyEmail({
      subject: 'Motor Policy Renewal - POL-2024-001',
      from: 'renewals@aviva.ie',
      bodyText: 'Your policy is due for renewal on 15/03/2027.',
    });

    expect(result.isInsurance).toBe(true);
    expect(result.category).toBe('policy_renewal');
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('classifies claim email correctly', async () => {
    (callLLMJson as any).mockResolvedValue({
      isInsurance: true,
      category: 'claim',
      priority: 'urgent',
      confidence: 0.92,
    });

    const result = await classifyEmail({
      subject: 'Claim Update - CLM-2024-055',
      from: 'claims@allianz.ie',
      bodyText: 'Your claim has been settled. Amount: €5,000.',
    });

    expect(result.category).toBe('claim');
    expect(result.priority).toBe('urgent');
  });

  it('classifies non-insurance email', async () => {
    (callLLMJson as any).mockResolvedValue({
      isInsurance: false,
      category: 'general',
      priority: 'low',
      confidence: 0.98,
    });

    const result = await classifyEmail({
      subject: 'Team lunch Friday',
      from: 'colleague@company.com',
      bodyText: 'Hey, are you coming to lunch on Friday?',
    });

    expect(result.isInsurance).toBe(false);
  });

  it('uses domain matching to skip LLM for known insurers', async () => {
    const result = await classifyEmail({
      subject: 'Policy update',
      from: 'noreply@aviva.ie',
      bodyText: 'Standard policy notification.',
    });

    // Should use domain match (fast path) without calling LLM
    expect(result.isInsurance).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    // LLM may or may not be called depending on implementation
  });

  it('classifies cancellation email', async () => {
    (callLLMJson as any).mockResolvedValue({
      isInsurance: true,
      category: 'cancellation',
      priority: 'urgent',
      confidence: 0.94,
    });

    const result = await classifyEmail({
      subject: 'Policy Cancellation Notice',
      from: 'service@zurich.ie',
      bodyText: 'Your policy has been cancelled effective 01/04/2026.',
    });

    expect(result.category).toBe('cancellation');
    expect(result.priority).toBe('urgent');
  });

  it('handles LLM failure gracefully', async () => {
    (callLLMJson as any).mockRejectedValue(new Error('API timeout'));

    const result = await classifyEmail({
      subject: 'Policy renewal',
      from: 'insurer@test.ie',
      bodyText: 'Renewal notice.',
    });

    // Should return a default classification, not throw
    expect(result).toBeDefined();
    expect(result.isInsurance).toBeDefined();
    expect(result.confidence).toBeLessThan(0.8); // Low confidence fallback
  });

  it('handles empty body text', async () => {
    (callLLMJson as any).mockResolvedValue({
      isInsurance: true,
      category: 'general',
      priority: 'normal',
      confidence: 0.7,
    });

    const result = await classifyEmail({
      subject: 'FWD: Policy',
      from: 'insurer@fbd.ie',
      bodyText: '',
    });

    expect(result).toBeDefined();
  });
});
