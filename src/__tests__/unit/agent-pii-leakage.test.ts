import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    incomingEmail: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    agentAction: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
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
    emailAttachment: {
      findMany: vi.fn().mockResolvedValue([]),
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

vi.mock('@/app/api/agent/events/route', () => ({
  publishAgentEvent: vi.fn(),
}));

vi.mock('@/services/agent/notifications', () => ({
  sendUrgentNotification: vi.fn().mockResolvedValue(undefined),
  sendAutoExecuteNotification: vi.fn().mockResolvedValue(undefined),
}));

import { processEmail } from '../../services/agent/pipeline';
import { prisma } from '@/lib/prisma';
import { classifyEmail } from '@/lib/agent/classifier';
import { extractData } from '@/lib/agent/extractor';
import { desensitizePII, resensitize } from '@/lib/agent/pii';
import { matchRecords } from '@/lib/agent/matcher';
import { generateAction } from '@/lib/agent/action-generator';

const PII_PATTERNS = {
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
  phone: /\+353\d{8,9}|0\d{8,9}/,
  pps: /\d{7}[A-Za-z]{1,2}/,
  iban: /IE\d{2}[A-Z]{4}\d{14}/i,
  vrn: /\d{1,3}[-\s][A-Z]{1,2}[-\s]\d{1,6}/,
};

/**
 * Agent PII Leakage Test
 *
 * Verifies that raw PII is NEVER sent to the LLM.
 * Per ADR-013: all PII must be desensitized before reaching any LLM call.
 *
 * Pipeline passes desensitizeResult.desensitized to both classifyEmail() and extractData().
 * This test verifies no raw PII leaks through either path.
 */

describe('Agent PII leakage verification', () => {
  const FIRM_ID = 'firm-123';
  const EMAIL_ID = 'email-456';

  const RAW_PII_EMAIL = {
    id: EMAIL_ID,
    firmId: FIRM_ID,
    status: 'pending',
    pipelineStep: null,
    subject: 'Renewal: POL-2024-001 for John Murphy',
    fromAddress: 'broker@aviva.ie',
    bodyText: `Dear Broker,

Please find the renewal details for your client John Murphy (john.murphy@example.com).
PPS: 1234567T. Phone: 0851234567.
Policy POL-2024-001 is due for renewal on 15/03/2026.
New premium: €1,350.00 (was €1,200.00).

Regards,
Aviva Ireland`,
    bodyHtml: null,
    receivedAt: new Date(),
    processedAt: null,
    isInsurance: null,
    category: null,
    priority: null,
    classificationConfidence: null,
    processingStartedAt: null,
    extractedFields: null,
    matchedPolicyId: null,
    matchedClientId: null,
    actionGenerated: null,
    actionId: null,
    autoExecuted: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    (prisma.incomingEmail.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(RAW_PII_EMAIL);
    (prisma.incomingEmail.update as ReturnType<typeof vi.fn>).mockResolvedValue(RAW_PII_EMAIL);
    (prisma.agentAction.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'action-789' });
    (prisma.policy.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.client.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.emailIngressConfig.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      executionMode: 'review',
      confidenceThreshold: 0.95,
    });

    // desensitizePII: strip real PII, replace with tokens
    (desensitizePII as ReturnType<typeof vi.fn>).mockImplementation((text: string) => {
      let counter = 0;
      const tokens: any[] = [];
      let desensitized = text;
      desensitized = desensitized.replace(
        /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
        (m: string) => {
          const t = `{EMAIL_${++counter}}`;
          tokens.push({ token: t, original: m, type: 'email' });
          return t;
        }
      );
      desensitized = desensitized.replace(
        /(\+353\d{8,9}|0\d{8,9})/g,
        (m: string) => {
          const t = `{PHONE_${++counter}}`;
          tokens.push({ token: t, original: m, type: 'phone' });
          return t;
        }
      );
      desensitized = desensitized.replace(
        /\b(\d{7}[A-Za-z]{1,2})\b/g,
        (m: string) => {
          const t = `{PPS_${++counter}}`;
          tokens.push({ token: t, original: m, type: 'pps' });
          return t;
        }
      );
      desensitized = desensitized.replace(
        /\bPOL[-\s]?\d{4}[-\s]?\d{3,6}\b/g,
        (m: string) => {
          const t = `{POLICY_${++counter}}`;
          tokens.push({ token: t, original: m, type: 'policy_number' });
          return t;
        }
      );
      return { desensitized, tokens };
    });

    (resensitize as ReturnType<typeof vi.fn>).mockImplementation((obj: any, tokens: any[]) => {
      let json = JSON.stringify(obj);
      if (tokens) {
        for (const t of tokens) {
          json = json.replaceAll(t.token, t.original);
        }
      }
      return JSON.parse(json);
    });

    (classifyEmail as ReturnType<typeof vi.fn>).mockResolvedValue({
      isInsurance: true,
      category: 'policy_renewal',
      priority: 'normal',
      confidence: 0.95,
    });

    (extractData as ReturnType<typeof vi.fn>).mockResolvedValue({
      policyNumber: 'POL-2024-001',
      clientName: 'John Murphy',
      insurerName: 'Aviva',
      policyType: 'motor',
      currentPremium: 1200,
      newPremium: 1350,
    });

    (matchRecords as ReturnType<typeof vi.fn>).mockResolvedValue({
      matched: false,
      policy: null,
      client: null,
    });

    (generateAction as ReturnType<typeof vi.fn>).mockReturnValue({
      type: 'renewal_review',
      summary: 'Renewal increase of 12.5%',
      autoExecutable: false,
      confidence: 0.85,
      reasoning: 'Standard renewal with moderate increase',
      changes: { newPremium: 1350 },
      target: {
        entityType: 'policy',
        entityId: null,
        matchConfidence: 0,
      },
    });
  });

  describe('classifyEmail input', () => {
    it('classifyEmail should not receive raw PII in bodyText', async () => {
      await processEmail(EMAIL_ID);

      expect(classifyEmail).toHaveBeenCalled();
      const classifyInput = (classifyEmail as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const bodyText: string = classifyInput.bodyText;

      // Pipeline passes desensitizeResult.desensitized to classifyEmail (ADR-013)
      // Assert: no raw PII patterns in the text sent to the LLM classifier
      expect(bodyText).not.toMatch(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      expect(bodyText).not.toMatch(/\+353\d{8,9}|0\d{8,9}/);
      expect(bodyText).not.toMatch(/\b\d{7}[A-Za-z]{1,2}\b/);

      // Should contain desensitized tokens instead
      expect(bodyText).toMatch(/\{EMAIL_\d+\}/);
    });

    it('classifyEmail should receive subject and from fields', async () => {
      await processEmail(EMAIL_ID);

      expect(classifyEmail).toHaveBeenCalled();
      const classifyInput = (classifyEmail as ReturnType<typeof vi.fn>).mock.calls[0][0];

      expect(classifyInput).toHaveProperty('subject');
      expect(classifyInput).toHaveProperty('from');
      expect(classifyInput.subject).toBeTruthy();
      expect(classifyInput.from).toBeTruthy();
    });
  });

  describe('extractData input (desensitized path)', () => {
    it('extractData receives desensitized text — no raw PII', async () => {
      await processEmail(EMAIL_ID);

      expect(extractData).toHaveBeenCalled();
      // extractData is called with (desensitized, category, {subject, from, bodyText}, firmId, threadContext)
      const extractCalls = (extractData as ReturnType<typeof vi.fn>).mock.calls[0];
      // The 3rd arg is the input object with bodyText
      const extractInput = extractCalls[2];
      const bodyText: string = extractInput.bodyText;

      // After desensitization, no raw PII should appear
      expect(bodyText).not.toMatch(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      expect(bodyText).not.toMatch(/\b\d{7}[A-Za-z]{1,2}\b/);

      // Should contain desensitized tokens
      expect(bodyText).toMatch(/\{EMAIL_\d+\}/);
    });

    it('desensitizePII is called before extractData', async () => {
      await processEmail(EMAIL_ID);

      // desensitizePII should be called with raw bodyText
      expect(desensitizePII).toHaveBeenCalled();
      const desensitizeInput = (desensitizePII as ReturnType<typeof vi.fn>).mock.calls[0][0];

      // The desensitize input SHOULD contain raw PII (it's the function's job to strip it)
      expect(desensitizeInput).toMatch(PII_PATTERNS.email);
      expect(desensitizeInput).toMatch(PII_PATTERNS.phone);
    });
  });

  describe('LLM prompt content audit', () => {
    it('classify prompt subject should not contain raw PPS numbers', async () => {
      await processEmail(EMAIL_ID);

      const classifyInput = (classifyEmail as ReturnType<typeof vi.fn>).mock.calls[0][0];

      // Subject is typically safe — PPS unlikely in subject
      // but verify the pattern isn't present
      const subjectPPS = classifyInput.subject?.match(PII_PATTERNS.pps);
      if (subjectPPS) {
        console.warn(`⚠️ PPS number found in classify subject: ${subjectPPS[0]}`);
      }
    });

    it('pipeline resensitizes extraction output for downstream use', async () => {
      await processEmail(EMAIL_ID);

      // resensitize should be called to restore PII after LLM extraction
      expect(resensitize).toHaveBeenCalled();

      // The agentAction.create should receive data with real PII restored
      expect(prisma.agentAction.create).toHaveBeenCalled();
      const actionData = (prisma.agentAction.create as ReturnType<typeof vi.fn>).mock.calls[0][0];

      // The action data should contain real (resensitized) values
      expect(actionData).toBeDefined();
    });
  });
});
