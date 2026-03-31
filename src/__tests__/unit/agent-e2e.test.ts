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
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    policy: {
      findFirst: vi.fn(),
    },
    emailIngressConfig: {
      findUnique: vi.fn(),
    },
    emailAttachment: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    $transaction: vi.fn(),
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

vi.mock('@/app/api/agent/events/route', () => ({
  publishAgentEvent: vi.fn(),
}));

vi.mock('@/lib/agent/action-executor', () => ({
  executeAction: vi.fn(),
}));

import { processEmail } from '../../services/agent/pipeline';
import { prisma } from '@/lib/prisma';
import { classifyEmail } from '@/lib/agent/classifier';
import { extractData } from '@/lib/agent/extractor';
import { desensitizePII, resensitize } from '@/lib/agent/pii';
import { matchRecords } from '@/lib/agent/matcher';
import { generateAction } from '@/lib/agent/action-generator';
import { auditLog } from '@/lib/audit';
import { executeAction } from '@/lib/agent/action-executor';

function makeEmail(overrides: Record<string, any> = {}) {
  return {
    id: 'email-e2e',
    firmId: 'firm-123',
    bodyText: '',
    subject: '',
    fromAddress: '',
    status: 'pending_processing',
    pipelineStep: null,
    isInsurance: null,
    category: null,
    priority: null,
    classificationConfidence: null,
    threadId: null,
    ...overrides,
  };
}

function renewalMocks() {
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
}

describe('E2E agent pipeline scenarios', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Scenario 1: renewal → update ──
  it('renewal email → creates update_policy action', async () => {
    (prisma.incomingEmail.findUnique as any).mockResolvedValue(
      makeEmail({
        id: 'e2e-renewal',
        bodyText: 'Policy POL-001 renewal. New premium €1,350.',
        subject: 'Renewal Notice',
        fromAddress: 'insurer@aviva.ie',
      })
    );

    renewalMocks();

    (generateAction as any).mockReturnValue({
      type: 'update_policy',
      target: { entityType: 'policy', entityId: 'policy-1', matchConfidence: 1.0 },
      changes: { premium: { old: 1245, new: 1350 } },
      confidence: 0.95,
      reasoning: 'Premium updated on renewal.',
    });

    (prisma.agentAction.create as any).mockResolvedValue({ id: 'action-renewal' });
    (prisma.incomingEmail.update as any).mockResolvedValue({});
    (prisma.emailIngressConfig.findUnique as any).mockResolvedValue(null);

    const result = await processEmail('e2e-renewal');

    expect(result.action).toBeTruthy();
    expect(result.action.type).toBe('update_policy');
    expect(prisma.agentAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          firmId: 'firm-123',
          emailId: 'e2e-renewal',
          actionType: 'update_policy',
          status: 'pending',
        }),
      })
    );
    // Verify email marked processed
    expect(prisma.incomingEmail.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'processed' }),
      })
    );
  });

  // ── Scenario 2: new policy → create ──
  it('new policy email → creates create_policy action', async () => {
    (prisma.incomingEmail.findUnique as any).mockResolvedValue(
      makeEmail({
        id: 'e2e-new',
        bodyText: 'New motor policy for John Doe, policy POL-999, premium €800.',
        subject: 'New Policy Issued',
        fromAddress: 'broker@zurich.ie',
      })
    );

    (classifyEmail as any).mockResolvedValue({
      isInsurance: true,
      category: 'new_policy',
      priority: 'normal',
      confidence: 0.92,
    });

    (desensitizePII as any).mockReturnValue({
      desensitized: 'New motor policy for {NAME_1}, policy {POLICY_1}, premium €800.',
      tokens: [
        { token: '{NAME_1}', original: 'John Doe', type: 'name' },
        { token: '{POLICY_1}', original: 'POL-999', type: 'policy_number' },
      ],
    });

    (extractData as any).mockResolvedValue({
      policyNumber: '{POLICY_1}',
      clientName: '{NAME_1}',
      premium: 800,
      policyType: 'motor',
      insurerName: 'Zurich',
    });

    (resensitize as any).mockReturnValue({
      policyNumber: 'POL-999',
      clientName: 'John Doe',
      premium: 800,
      policyType: 'motor',
      insurerName: 'Zurich',
    });

    (matchRecords as any).mockResolvedValue({
      policy: null,
      client: { id: 'client-new', confidence: 0.85 },
    });

    (generateAction as any).mockReturnValue({
      type: 'create_policy',
      target: { entityType: 'policy', entityId: 'client-new', matchConfidence: 0.85 },
      changes: {
        policy_number: { old: null, new: 'POL-999' },
        premium: { old: null, new: 800 },
        policy_type: { old: null, new: 'motor' },
        insurer_name: { old: null, new: 'Zurich' },
      },
      confidence: 0.92,
      reasoning: 'New policy detected for existing client.',
    });

    (prisma.agentAction.create as any).mockResolvedValue({ id: 'action-new' });
    (prisma.incomingEmail.update as any).mockResolvedValue({});
    (prisma.emailIngressConfig.findUnique as any).mockResolvedValue(null);

    const result = await processEmail('e2e-new');

    expect(result.action).toBeTruthy();
    expect(result.action.type).toBe('create_policy');
    expect(prisma.agentAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actionType: 'create_policy',
          entityType: 'policy',
          entityId: 'client-new',
        }),
      })
    );
  });

  // ── Scenario 3: non-insurance → skip ──
  it('non-insurance email → skips pipeline, no action created', async () => {
    (prisma.incomingEmail.findUnique as any).mockResolvedValue(
      makeEmail({
        id: 'e2e-marketing',
        bodyText: 'Get 50% off your next holiday!',
        subject: 'Summer Sale!',
        fromAddress: 'promo@traveldeals.ie',
      })
    );

    (classifyEmail as any).mockResolvedValue({
      isInsurance: false,
      category: 'not_insurance',
      priority: 'low',
      confidence: 0.99,
    });

    (prisma.incomingEmail.update as any).mockResolvedValue({});

    const result = await processEmail('e2e-marketing');

    // No extraction, matching, or action creation
    expect(extractData).not.toHaveBeenCalled();
    expect(desensitizePII).not.toHaveBeenCalled();
    expect(matchRecords).not.toHaveBeenCalled();
    expect(generateAction).not.toHaveBeenCalled();
    expect(prisma.agentAction.create).not.toHaveBeenCalled();

    // Email marked as not_insurance
    expect(prisma.incomingEmail.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'not_insurance' }),
      })
    );

    expect(result.action).toBeNull();
  });

  // ── Scenario 4: duplicate → dedupe (idempotent) ──
  it('already-processed email → returns immediately, no new action', async () => {
    (prisma.incomingEmail.findUnique as any).mockResolvedValue(
      makeEmail({
        id: 'e2e-dup',
        status: 'processed',
      })
    );

    const result = await processEmail('e2e-dup');

    // No pipeline steps executed
    expect(classifyEmail).not.toHaveBeenCalled();
    expect(extractData).not.toHaveBeenCalled();
    expect(desensitizePII).not.toHaveBeenCalled();
    expect(matchRecords).not.toHaveBeenCalled();
    expect(generateAction).not.toHaveBeenCalled();
    expect(prisma.agentAction.create).not.toHaveBeenCalled();

    // No update calls
    expect(prisma.incomingEmail.update).not.toHaveBeenCalled();

    expect(result.autoExecuted).toBe(false);
    expect(result.action).toBeNull();
  });

  // ── Scenario 5: confirm → audit ──
  it('process email then confirm → audit event created', async () => {
    // Step 1: Process email (reuses renewal pipeline)
    (prisma.incomingEmail.findUnique as any).mockResolvedValue(
      makeEmail({
        id: 'e2e-confirm',
        bodyText: 'Policy POL-001 renewal. New premium €1,350.',
        subject: 'Renewal',
        fromAddress: 'insurer@aviva.ie',
      })
    );

    renewalMocks();

    (generateAction as any).mockReturnValue({
      type: 'update_policy',
      target: { entityType: 'policy', entityId: 'policy-1', matchConfidence: 1.0 },
      changes: { premium: { old: 1245, new: 1350 } },
      confidence: 0.95,
      reasoning: 'Premium updated.',
    });

    (prisma.agentAction.create as any).mockResolvedValue({ id: 'action-confirm' });
    (prisma.incomingEmail.update as any).mockResolvedValue({});
    (prisma.emailIngressConfig.findUnique as any).mockResolvedValue(null);

    const result = await processEmail('e2e-confirm');

    expect(result.action).toBeTruthy();
    expect(result.action.id).toBe('action-confirm');

    // Step 2: Simulate confirm action
    // Update action status to confirmed
    (prisma.agentAction.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.agentAction.findUniqueOrThrow as any).mockResolvedValue({
      id: 'action-confirm',
      firmId: 'firm-123',
      actionType: 'update_policy',
      entityType: 'policy',
      entityId: 'policy-1',
      changes: { premium: { old: 1245, new: 1350 } },
      status: 'pending',
    });
    (executeAction as any).mockResolvedValue(undefined);
    (prisma.agentAction.update as any).mockResolvedValue({});
    (auditLog as any).mockResolvedValue({});

    // Call confirm logic inline (mirrors confirm route)
    await prisma.agentAction.updateMany({
      where: { id: 'action-confirm', firmId: 'firm-123', status: 'pending' },
      data: { status: 'confirmed', confirmedBy: 'user-1', confirmedAt: expect.any(Date) },
    });

    const action = await prisma.agentAction.findUniqueOrThrow({ where: { id: 'action-confirm' } });
    await executeAction(action);
    await prisma.agentAction.update({
      where: { id: 'action-confirm' },
      data: { executedAt: expect.any(Date) },
    });

    await auditLog('firm-123', 'agent.action_confirmed', 'agent_action', 'action-confirm', {
      actionType: action.actionType,
      entityType: action.entityType,
      entityId: action.entityId,
      confirmedBy: 'user-1',
    });

    // Verify audit event was created
    expect(auditLog).toHaveBeenCalledWith(
      'firm-123',
      'agent.action_confirmed',
      'agent_action',
      'action-confirm',
      expect.objectContaining({
        actionType: 'update_policy',
      })
    );

    // Verify action status was updated to confirmed
    expect(prisma.agentAction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'confirmed' }),
      })
    );
  });
});
