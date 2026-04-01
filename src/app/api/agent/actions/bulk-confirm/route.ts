import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { auditLog } from '@/lib/audit';
import { executeAction } from '@/lib/agent/action-executor';
import { checkRateLimit } from '@/lib/rate-limit';

export const POST = withAuth('agent:bulk_confirm', async (user, request) => {
  const rl = await checkRateLimit(`api:actions:bulk-confirm:${user.id}`, 60, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded', retryAfter: rl.retryAfter }, { status: 429 });
  }

  let actionIds: string[] = [];
  try {
    const body = await request.json();
    actionIds = body.actionIds || [];
  } catch {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } },
      { status: 400 }
    );
  }

  if (!Array.isArray(actionIds) || actionIds.length === 0) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'actionIds must be a non-empty array' } },
      { status: 400 }
    );
  }

  if (actionIds.length > 50) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Maximum 50 actions per batch' } },
      { status: 400 }
    );
  }

  // Fetch all actions
  const actions = await prisma.agentAction.findMany({
    where: {
      id: { in: actionIds },
      firmId: user.firmId,
      status: 'pending',
    },
  });

  const confirmed: string[] = [];
  const errors: { id: string; error: string }[] = [];

  for (const action of actions) {
    try {
      // Execute action (handles ALL action types)
      const executionResult = await executeAction({
        ...action,
        changes: (action.changes || {}) as Record<string, { old: any; new: any }>,
      });

      // Mark as executed
      await prisma.agentAction.update({
        where: { id: action.id },
        data: {
          status: 'executed',
          confirmedBy: user.id,
          confirmedAt: new Date(),
          executedAt: new Date(),
          entityType: executionResult.entityType ?? action.entityType,
          entityId: executionResult.entityId ?? action.entityId,
        },
      });

      await auditLog(user.firmId, 'agent.action_confirmed', 'agent_action', action.id, {
        actionType: action.actionType,
        confirmedBy: user.id,
        bulkOperation: true,
      });

      confirmed.push(action.id);
    } catch (err) {
      errors.push({
        id: action.id,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return NextResponse.json({
    data: {
      confirmed: confirmed.length,
      errors: errors.length,
      details: errors.length > 0 ? errors : undefined,
    },
  });
});
