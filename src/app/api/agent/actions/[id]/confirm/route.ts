import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { auditLog } from '@/lib/audit';
import { executeAction } from '@/lib/agent/action-executor';
import { publishAgentEvent } from '@/app/api/agent/events/route';
import { checkRateLimit } from '@/lib/rate-limit';

export const PUT = withAuth('agent:confirm_action', async (user, request) => {
  const rl = await checkRateLimit(`api:actions:confirm:${user.id}`, 60, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded', retryAfter: rl.retryAfter }, { status: 429 });
  }

  const url = new URL(request.url);
  const pathParts = url.pathname.split('/');
  const actionId = pathParts[pathParts.length - 2];

  // Atomic: update status only if currently 'pending' (prevents race condition)
  const result = await prisma.agentAction.updateMany({
    where: {
      id: actionId,
      firmId: user.firmId,
      status: 'pending', // Atomic check — only update if still pending
    },
    data: {
      status: 'confirmed',
      confirmedBy: user.id,
      confirmedAt: new Date(),
    },
  });

  if (result.count === 0) {
    // Either not found or already confirmed/modified/rejected
    const action = await prisma.agentAction.findFirst({
      where: { id: actionId, firmId: user.firmId },
    });
    if (!action) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Action not found' } },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: `Action is already ${action.status}` } },
      { status: 400 }
    );
  }

  // Fetch the full action for execution
  const action = await prisma.agentAction.findUniqueOrThrow({
    where: { id: actionId },
  });

  // Execute the action — with rollback on failure
  let executionResult;
  try {
    executionResult = await executeAction({
      ...action,
      changes: (action.changes || {}) as Record<string, { old: any; new: any }>,
    });
  } catch (error) {
    // ROLLBACK: revert status to pending so user can retry
    await prisma.agentAction.update({
      where: { id: actionId },
      data: {
        status: 'pending',
        confirmedBy: null,
        confirmedAt: null,
      },
    });

    await auditLog(user.firmId, 'agent.action_confirm_failed', 'agent_action', actionId, {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return NextResponse.json(
      { error: { code: 'EXECUTION_FAILED', message: 'Action execution failed. Status reverted to pending. Please retry.' } },
      { status: 500 }
    );
  }

  // Mark as executed
  await prisma.agentAction.update({
    where: { id: actionId },
    data: {
      status: 'executed',
      executedAt: new Date(),
      entityType: executionResult.entityType ?? action.entityType,
      entityId: executionResult.entityId ?? action.entityId,
    },
  });

  await auditLog(user.firmId, 'agent.action_confirmed', 'agent_action', actionId, {
    actionType: action.actionType,
    entityType: executionResult.entityType ?? action.entityType,
    entityId: executionResult.entityId ?? action.entityId,
    confirmedBy: user.id,
  });

  // SSE: notify frontend
  publishAgentEvent(user.firmId, {
    type: 'action_confirmed',
    data: { id: actionId, actionType: action.actionType },
  });

  return NextResponse.json({ data: { id: actionId, status: 'confirmed' } });
});
