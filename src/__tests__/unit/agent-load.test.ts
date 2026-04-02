import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    incomingEmail: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([]),
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
      findUnique: vi.fn().mockResolvedValue(null),
    },
    emailAttachment: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    $transaction: vi.fn().mockResolvedValue([]),
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

import { processEmail } from '../../services/agent/pipeline';
import { prisma } from '@/lib/prisma';
import { classifyEmail } from '@/lib/agent/classifier';
import { extractData } from '@/lib/agent/extractor';
import { desensitizePII, resensitize } from '@/lib/agent/pii';
import { matchRecords } from '@/lib/agent/matcher';
import { generateAction } from '@/lib/agent/action-generator';

const CATEGORIES = ['policy_renewal', 'new_policy', 'claim', 'cancellation'] as const;
const NOT_INSURANCE = 'not_insurance';

const SUBJECTS: Record<string, string[]> = {
  policy_renewal: [
    'Renewal of Policy POL-{n}',
    'Your motor insurance is due for renewal',
    'Renewal notice – household policy',
  ],
  new_policy: [
    'New quote request – motor',
    'Household insurance application POL-{n}',
    'Commercial property – new cover requested',
  ],
  claim: [
    'Claim notification POL-{n}',
    'Accident report – policyholder',
    'Storm damage claim for property',
  ],
  cancellation: [
    'Cancellation request POL-{n}',
    'Please cancel my policy',
    'Request to terminate cover',
  ],
  not_insurance: [
    'Team lunch Friday',
    'Office supplies order',
    'Meeting reschedule',
    'Holiday party invite',
  ],
};

const BODIES: Record<string, string[]> = {
  policy_renewal: [
    'Dear broker, policy POL-{n} is due for renewal on 15/06/2026. New premium €{amt}. Please confirm.',
    'We enclose renewal terms for POL-{n}. Premium increased to €{amt}. NCD years: 4.',
    'Your client renewal POL-{n}: premium €{amt}, expiry 01/09/2026.',
  ],
  new_policy: [
    'Please arrange cover for a 2024 Toyota Corolla, value €{amt}. Client: John Murphy.',
    'New business quote: commercial property at 14 Main St. Sum insured €{amt}.',
    'Requesting household insurance quote. Contents €{amt}, buildings €{amt}.',
  ],
  claim: [
    'Our insured POL-{n} had an incident on 10/03/2026. Third-party damage estimated €{amt}.',
    'Claim POL-{n}: water damage to kitchen. Repair estimate €{amt}.',
    'Motor claim POL-{n}: rear-end collision, liability accepted. Reserve €{amt}.',
  ],
  cancellation: [
    'Please cancel POL-{n} effective immediately. Refund requested.',
    'Client wishes to terminate POL-{n}. Mid-term cancellation, return premium €{amt}.',
    'Cancelling policy POL-{n} as client sold vehicle.',
  ],
  not_insurance: [
    'Hi team, lunch at 12:30 on Friday. Let me know if you can make it.',
    'Order placed for printer paper and toner cartridges.',
    'Meeting moved to 3pm Tuesday. Updated invite attached.',
  ],
};

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}

interface MockEmailConfig {
  id: string;
  isInsurance: boolean;
  category: string;
  subject: string;
  bodyText: string;
  fromAddress: string;
  actionType: string;
}

function generateEmailConfigs(count: number): MockEmailConfig[] {
  const rand = seededRandom(42);
  const configs: MockEmailConfig[] = [];

  for (let i = 0; i < count; i++) {
    const id = `load-email-${String(i + 1).padStart(3, '0')}`;
    const r = rand();

    // 80% insurance, 20% not insurance
    if (r < 0.2) {
      const sIdx = Math.floor(rand() * SUBJECTS.not_insurance.length);
      const bIdx = Math.floor(rand() * BODIES.not_insurance.length);
      configs.push({
        id,
        isInsurance: false,
        category: NOT_INSURANCE,
        subject: SUBJECTS.not_insurance[sIdx],
        bodyText: BODIES.not_insurance[bIdx],
        fromAddress: `colleague${i}@company.com`,
        actionType: 'none',
      });
    } else {
      const catIdx = Math.floor(rand() * CATEGORIES.length);
      const category = CATEGORIES[catIdx];
      const sIdx = Math.floor(rand() * SUBJECTS[category].length);
      const bIdx = Math.floor(rand() * BODIES[category].length);
      const amt = Math.floor(rand() * 5000 + 200);
      const polNum = `POL-${String(10000 + i)}`;

      const actionMap: Record<string, string> = {
        policy_renewal: 'update_policy',
        new_policy: 'create_policy',
        claim: 'create_claim',
        cancellation: 'cancel_policy',
      };

      configs.push({
        id,
        isInsurance: true,
        category,
        subject: SUBJECTS[category][sIdx].replace('{n}', String(i)),
        bodyText: BODIES[category][bIdx]
          .replace(/\{n\}/g, polNum)
          .replace(/\{amt\}/g, String(amt)),
        fromAddress: `insurer${i}@aviva.ie`,
        actionType: actionMap[category],
      });
    }
  }
  return configs;
}

describe('processEmail load test', () => {
  const EMAIL_COUNT = 100;
  const configs = generateEmailConfigs(EMAIL_COUNT);

  beforeEach(() => {
    vi.clearAllMocks();

    // Default: mock email not found for any unmatched ID
    (prisma.incomingEmail.findUnique as any).mockResolvedValue(null);
    (prisma.incomingEmail.update as any).mockResolvedValue({});
    (prisma.agentAction.create as any).mockImplementation(({ data }: any) =>
      Promise.resolve({ id: `action-${data.emailId}` })
    );
    (prisma.agentAction.findFirst as any).mockResolvedValue(null);
    (prisma.policy.findFirst as any).mockResolvedValue({
      id: 'policy-1',
      premium: 1200,
      expiryDate: new Date('2026-06-15'),
      ncb: 4,
      clientId: 'client-1',
    });
    (prisma.emailIngressConfig.findUnique as any).mockResolvedValue(null);

    // Setup classifyEmail mock with per-email response via side map
    const classifyMap = new Map(
      configs.map((c) => [
        c.id,
        {
          isInsurance: c.isInsurance,
          category: c.category,
          priority: 'normal' as const,
          confidence: c.isInsurance ? 0.95 : 0.98,
        },
      ])
    );

    (classifyEmail as any).mockImplementation(({ subject }: { subject: string }) => {
      // Find config by matching subject (unique enough for load test)
      const cfg = configs.find((c) => c.subject === subject);
      if (cfg) return Promise.resolve(classifyMap.get(cfg.id));
      return Promise.resolve({ isInsurance: false, category: NOT_INSURANCE, priority: 'low', confidence: 0.9 });
    });

    (desensitizePII as any).mockImplementation((text: string) => ({
      desensitized: text.replace(/POL-\d+/g, '{POLICY_X}'),
      tokens: [{ token: '{POLICY_X}', original: 'POL-00000', type: 'policy_number' }],
    }));

    (extractData as any).mockResolvedValue({
      policyNumber: '{POLICY_X}',
      newPremium: 1350,
      newExpiry: '2027-06-15',
    });

    (resensitize as any).mockImplementation((data: any) => ({
      ...data,
      policyNumber: 'POL-00000',
    }));

    (matchRecords as any).mockResolvedValue({
      policy: { id: 'policy-1', confidence: 1.0 },
      client: { id: 'client-1', confidence: 1.0 },
    });

    (generateAction as any).mockImplementation(({ classification, emailSubject }: any) => {
      const actionTypeMap: Record<string, string> = {
        policy_renewal: 'update_policy',
        new_policy: 'create_policy',
        claim: 'create_claim',
        cancellation: 'cancel_policy',
      };
      const type = actionTypeMap[classification.category] || 'flag_for_review';
      return {
        type,
        target: { entityType: 'policy', entityId: 'policy-1', matchConfidence: 1.0 },
        changes: { premium: { old: 1200, new: 1350 } },
        confidence: 0.95,
        reasoning: `Auto-generated for: ${emailSubject}`,
      };
    });

    // Wire prisma.incomingEmail.findUnique to return email objects
    (prisma.incomingEmail.findUnique as any).mockImplementation(
      ({ where }: { where: { id: string } }) => {
        const cfg = configs.find((c) => c.id === where.id);
        if (!cfg) return Promise.resolve(null);
        return Promise.resolve({
          id: cfg.id,
          firmId: 'firm-load-test',
          bodyText: cfg.bodyText,
          subject: cfg.subject,
          fromAddress: cfg.fromAddress,
          status: 'pending_processing',
          pipelineStep: null,
        });
      }
    );
  });

  it(
    `processes ${EMAIL_COUNT} emails with error rate < 5%`,
    async () => {
      const results: { id: string; ok: boolean; error?: string }[] = [];
      const startTime = performance.now();

      for (const cfg of configs) {
        try {
          await processEmail(cfg.id);
          results.push({ id: cfg.id, ok: true });
        } catch (err: any) {
          results.push({ id: cfg.id, ok: false, error: err.message });
        }
      }

      const endTime = performance.now();
      const totalDurationMs = endTime - startTime;
      const totalDurationSec = totalDurationMs / 1000;
      const successCount = results.filter((r) => r.ok).length;
      const errorCount = results.filter((r) => !r.ok).length;
      const errorRate = (errorCount / EMAIL_COUNT) * 100;
      const emailsPerSec = EMAIL_COUNT / totalDurationSec;

      console.log('\n═══════════════════════════════════════════');
      console.log('  LOAD TEST RESULTS — processEmail × 100');
      console.log('═══════════════════════════════════════════');
      console.log(`  Total emails:     ${EMAIL_COUNT}`);
      console.log(`  Successful:       ${successCount}`);
      console.log(`  Errors:           ${errorCount}`);
      console.log(`  Error rate:       ${errorRate.toFixed(2)}%`);
      console.log(`  Total duration:   ${totalDurationSec.toFixed(3)}s`);
      console.log(`  Throughput:       ${emailsPerSec.toFixed(1)} emails/sec`);
      console.log(`  Avg latency:      ${(totalDurationMs / EMAIL_COUNT).toFixed(2)} ms/email`);
      console.log('═══════════════════════════════════════════\n');

      if (errorCount > 0) {
        console.log('Failed emails:');
        results
          .filter((r) => !r.ok)
          .forEach((r) => console.log(`  ${r.id}: ${r.error}`));
      }

      expect(errorRate).toBeLessThan(5);
      expect(totalDurationSec).toBeLessThan(60);
    },
    120_000 // 120s timeout
  );
});
