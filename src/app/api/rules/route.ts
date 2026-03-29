export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { cpcRulesService } from '@/services/cpc-rules-service';
import { z } from 'zod';

const CreateRuleSchema = z.object({
  ruleType: z.string().min(1).max(100),
  ruleId: z.string().min(1).max(100),
  label: z.string().min(1).max(255),
  description: z.string().min(1),
  requiresSignOff: z.boolean().optional(),
  evidenceRequired: z.boolean().optional(),
  policyTypes: z.array(z.string()).optional(),
  sortOrder: z.number().int().optional(),
});

/**
 * GET /api/rules — List active rules for the firm.
 */
export const GET = withAuth(null, async (user) => {
  const rules = await cpcRulesService.getRules(user.firmId);
  return NextResponse.json({ data: rules });
});

/**
 * POST /api/rules — Create a new rule (admin only).
 */
export const POST = withAuth('admin', async (user, request) => {
  try {
    const body = await request.json();
    const data = CreateRuleSchema.parse(body);

    const rule = await cpcRulesService.createRule(user.firmId, data);

    return NextResponse.json({ data: rule }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: err.issues } },
        { status: 400 }
      );
    }
    throw err;
  }
});
