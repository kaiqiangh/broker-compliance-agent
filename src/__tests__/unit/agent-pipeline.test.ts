import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    incomingEmail: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    agentAction: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    policy: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    client: {
      findMany: vi.fn(),
    },
    emailIngressConfig: {
      findUnique: vi.fn(),
    },
  },
  runWithFirmContext: (_id: string, fn: () => any) => fn(),
}));

vi.mock('@/lib/agent/classifier', () => ({
  classifyEmail: vi.fn(),
}));

vi.mock('@/lib/agent/extractor', () => ({
  extractData: vi.fn(),
}));

vi.mock('@/lib/agent/pii', () => ({
  desensitizePII: vi.fn(),
  resensitize: vi.fn(),
}));

vi.mock('@/lib/agent/matcher', () => ({
  matchRecords: vi.fn(),
}));

vi.mock('@/lib/agent/action-generator', () => ({
  generateAction: vi.fn(),
}));

vi.mock('@/lib/audit', () => ({
  auditLog: vi.fn(),
}));

import { processEmail } from '../../services/agent/pipeline';
import { prisma } from '@/lib/prisma';
import { classifyEmail } from '@/lib/agent/classifier';
import { extractData } from '@/lib/agent/extractor';
import { desensitizePII, resensitize } from '@/lib/agent/pii';
import { matchRecords } from '@/lib/agent/matcher';
import { generateAction } from '@/lib/agent/action-generator';

describe('processEmail pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('processes insurance renewal email end-to-end', async () => {
    // Setup mocks
    (prisma.incomingEmail.findUnique as any).mockResolvedValue({
      id: 'email-1',
      firmId: 'firm-123',
      bodyText: 'Policy POL-001 renewal. New premium €1,350.',
      subject: 'Renewal',
      fromAddress: 'insurer@aviva.ie',
      status: 'pending_processing',
    });

    (classifyEmail as any).mockResolvedValue({
      isInsurance: true,
      category: 'policy_renewal',
      priority: 'normal',
      confidence: 0.95,
    });

    (desensitizePII as any).mockReturnValue({
      desensitized: 'Policy {POLICY_1} renewal. New premium €1,350.',
      tokens: [{ token: '{POLICY_1}', original: 'POL-001', type: 'policy_number' }],
    });

    (extractData as any).mockResolvedValue({
      policyNumber: '{POLICY_1}',
      newPremium: 1350,
      newExpiry: '2027-03-15',
    });

    (resensitize as any).mockReturnValue({
      policyNumber: 'POL-001',
      newPremium: 1350,
      newExpiry: '2027-03-15',
    });

    (matchRecords as any).mockResolvedValue({
      policy: { id: 'policy-1', confidence: 1.0 },
      client: { id: 'client-1', confidence: 1.0 },
    });

    (prisma.policy.findFirst as any).mockResolvedValue({
      id: 'policy-1',
      premium: 1245,
      expiryDate: new Date('2026-03-15'),
      ncb: 5,
      clientId: 'client-1',
    });

    (generateAction as any).mockReturnValue({
      type: 'update_policy',
      target: { entityType: 'policy', entityId: 'policy-1', matchConfidence: 1.0 },
      changes: { premium: { old: 1245, new: 1350 } },
      confidence: 0.95,
      reasoning: 'Premium updated.',
    });

    (prisma.agentAction.create as any).mockResolvedValue({ id: 'action-1' });
    (prisma.incomingEmail.update as any).mockResolvedValue({});

    // Execute
    const result = await processEmail('email-1');

    // Verify pipeline executed
    expect(classifyEmail).toHaveBeenCalled();
    expect(desensitizePII).toHaveBeenCalled();
    expect(extractData).toHaveBeenCalled();
    expect(resensitize).toHaveBeenCalled();
    expect(matchRecords).toHaveBeenCalled();
    expect(generateAction).toHaveBeenCalled();
    expect(prisma.agentAction.create).toHaveBeenCalled();

    // Verify action was created with correct data
    expect(prisma.agentAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          firmId: 'firm-123',
          emailId: 'email-1',
          actionType: 'update_policy',
          status: 'pending',
        }),
      })
    );
  });

  it('skips non-insurance emails', async () => {
    (prisma.incomingEmail.findUnique as any).mockResolvedValue({
      id: 'email-2',
      firmId: 'firm-123',
      bodyText: 'Team lunch Friday!',
      subject: 'Lunch',
      fromAddress: 'colleague@company.com',
      status: 'pending_processing',
    });

    (classifyEmail as any).mockResolvedValue({
      isInsurance: false,
      category: 'not_insurance',
      priority: 'low',
      confidence: 0.98,
    });

    (prisma.incomingEmail.update as any).mockResolvedValue({});

    const result = await processEmail('email-2');

    // Should NOT call extract, match, or generate
    expect(extractData).not.toHaveBeenCalled();
    expect(matchRecords).not.toHaveBeenCalled();
    expect(prisma.agentAction.create).not.toHaveBeenCalled();

    // Should update email status to not_insurance
    expect(prisma.incomingEmail.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'not_insurance' }),
      })
    );
  });

  it('handles email already processed (idempotent)', async () => {
    (prisma.incomingEmail.findUnique as any).mockResolvedValue({
      id: 'email-3',
      firmId: 'firm-123',
      status: 'processed',
    });

    const result = await processEmail('email-3');

    // Should not call any pipeline steps
    expect(classifyEmail).not.toHaveBeenCalled();
  });

  it('handles email not found', async () => {
    (prisma.incomingEmail.findUnique as any).mockResolvedValue(null);

    await expect(processEmail('nonexistent')).rejects.toThrow('Email not found');
  });

  it('marks email as error on pipeline failure', async () => {
    (prisma.incomingEmail.findUnique as any).mockResolvedValue({
      id: 'email-4',
      firmId: 'firm-123',
      bodyText: 'test',
      subject: 'test',
      fromAddress: 'test@test.ie',
      status: 'pending_processing',
    });

    (classifyEmail as any).mockRejectedValue(new Error('LLM timeout'));
    (prisma.incomingEmail.update as any).mockResolvedValue({});

    await expect(processEmail('email-4')).rejects.toThrow('LLM timeout');

    // Should mark email as error
    expect(prisma.incomingEmail.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'error',
          errorMessage: 'LLM timeout',
        }),
      })
    );
  });

  it('auto-executes when config is auto_execute and confidence is high', async () => {
    (prisma.incomingEmail.findUnique as any).mockResolvedValue({
      id: 'email-5',
      firmId: 'firm-123',
      bodyText: 'Policy update',
      subject: 'Update',
      fromAddress: 'insurer@aviva.ie',
      status: 'pending_processing',
    });

    (classifyEmail as any).mockResolvedValue({ isInsurance: true, category: 'policy_renewal', priority: 'normal', confidence: 0.95 });
    (desensitizePII as any).mockReturnValue({ desensitized: 'test', tokens: [] });
    (extractData as any).mockResolvedValue({ policyNumber: 'POL-001', newPremium: 1500 });
    (resensitize as any).mockReturnValue({ policyNumber: 'POL-001', newPremium: 1500 });
    (matchRecords as any).mockResolvedValue({ policy: { id: 'p1', confidence: 1.0 }, client: { id: 'c1', confidence: 1.0 } });
    (prisma.policy.findFirst as any).mockResolvedValue({ id: 'p1', premium: 1200, expiryDate: new Date('2027-01-01'), ncb: null, clientId: 'c1' });

    (generateAction as any).mockReturnValue({
      type: 'update_policy',
      target: { entityType: 'policy', entityId: 'p1', matchConfidence: 1.0 },
      changes: { premium: { old: 1200, new: 1500 } },
      confidence: 0.98, // High confidence
      reasoning: 'Updated.',
    });

    (prisma.emailIngressConfig.findUnique as any).mockResolvedValue({
      executionMode: 'auto_execute',
      confidenceThreshold: 0.95,
    });

    (prisma.agentAction.create as any).mockResolvedValue({ id: 'action-auto' });
    (prisma.incomingEmail.update as any).mockResolvedValue({});

    const result = await processEmail('email-5');

    // Action should be created with status 'executed' and mode 'auto'
    expect(prisma.agentAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'executed',
          mode: 'auto',
        }),
      })
    );
  });
});
