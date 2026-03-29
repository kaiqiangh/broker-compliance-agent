export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { cpcRulesService } from '@/services/cpc-rules-service';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

const UpdateRuleSchema = z.object({
  label: z.string().min(1).max(255).optional(),
  description: z.string().min(1).optional(),
  requiresSignOff: z.boolean().optional(),
  evidenceRequired: z.boolean().optional(),
  policyTypes: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

/**
 * PUT /api/rules/[id] — Update a rule (admin only).
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: ruleId } = await params;
  return withAuth('admin', async (user) => {
    try {
      const body = await request.json();
      const data = UpdateRuleSchema.parse(body);

      // Verify rule belongs to the firm
      const existing = await prisma.cpcRule.findFirst({
        where: { ruleId, firmId: user.firmId },
      });
      if (!existing) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Rule not found' } },
          { status: 404 }
        );
      }

      const rule = await cpcRulesService.updateRule(user.firmId, ruleId, data);
      return NextResponse.json({ data: rule });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: err.issues } },
          { status: 400 }
        );
      }
      throw err;
    }
  })(request);
}

/**
 * DELETE /api/rules/[id] — Soft-delete a rule (admin only).
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: ruleId } = await params;
  return withAuth('admin', async (user) => {
    // Verify rule belongs to the firm
    const existing = await prisma.cpcRule.findFirst({
      where: { ruleId, firmId: user.firmId },
    });
    if (!existing) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Rule not found' } },
        { status: 404 }
      );
    }

    await cpcRulesService.deleteRule(user.firmId, ruleId);
    return NextResponse.json({ success: true });
  })(request);
}
