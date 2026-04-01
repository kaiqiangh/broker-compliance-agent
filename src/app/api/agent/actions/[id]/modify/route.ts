import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { auditLog } from '@/lib/audit';
import { executeAction } from '@/lib/agent/action-executor';
import { publishAgentEvent } from '@/app/api/agent/events/route';
import { checkRateLimit } from '@/lib/rate-limit';

export const PUT = withAuth('agent:modify_action', async (user, request) => {
  const rl = await checkRateLimit(`api:actions:modify:${user.id}`, 60, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded', retryAfter: rl.retryAfter }, { status: 429 });
  }

  const url = new URL(request.url);
  const pathParts = url.pathname.split('/');
  const actionId = pathParts[pathParts.length - 2];

  // Parse modifications from request body
  let body: { modifications?: Record<string, any>; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } },
      { status: 400 }
    );
  }

  const modifications = body.modifications || {};

  if (Object.keys(modifications).length === 0) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'No modifications provided' } },
      { status: 400 }
    );
  }

  // Fetch action first (needed to compute modifiedChanges for the atomic update)
  const action = await prisma.agentAction.findFirst({
    where: { id: actionId, firmId: user.firmId },
  });

  if (!action) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Action not found' } },
      { status: 404 }
    );
  }

  if (action.status !== 'pending') {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: `Cannot modify action with status: ${action.status}` } },
      { status: 400 }
    );
  }

  // Apply modifications to the action's changes
  const currentChanges = (action.changes || {}) as Record<string, { old: any; new: any }>;
  const modifiedChanges = { ...currentChanges };

  for (const [field, newValue] of Object.entries(modifications)) {
    if (modifiedChanges[field]) {
      modifiedChanges[field] = { old: modifiedChanges[field].old, new: newValue };
    } else {
      modifiedChanges[field] = { old: null, new: newValue };
    }
  }

  // ATOMIC CLAIM: only update if still pending (prevents race with confirm/reject)
  const claim = await prisma.agentAction.updateMany({
    where: {
      id: actionId,
      firmId: user.firmId,
      status: 'pending',
    },
    data: {
      changes: modifiedChanges,
      status: 'modified',
      confirmedBy: user.id,
      confirmedAt: new Date(),
      modifiedFields: modifications,
    },
  });

  if (claim.count === 0) {
    return NextResponse.json(
      { error: { code: 'CONFLICT', message: 'Action was already confirmed, rejected, or modified by another user' } },
      { status: 409 }
    );
  }

  // Record each modification for learning (non-blocking)
  for (const [field, newValue] of Object.entries(modifications)) {
    await prisma.agentActionModification.create({
      data: {
        actionId,
        firmId: user.firmId,
        fieldName: field,
        originalValue: currentChanges[field]?.new != null ? String(currentChanges[field].new) : null,
        correctedValue: String(newValue),
        modifiedBy: user.id,
      },
    });
  }

  // Execute the action with modified values
  let executionResult;
  try {
    executionResult = await executeAction({
      id: actionId,
      actionType: action.actionType,
      entityType: action.entityType,
      entityId: action.entityId,
      firmId: user.firmId,
      changes: modifiedChanges,
    });
  } catch (error) {
    // ROLLBACK: revert to pre-modification state so user can retry cleanly
    await prisma.agentAction.update({
      where: { id: actionId },
      data: {
        status: 'pending',
        changes: currentChanges,
        confirmedBy: null,
        confirmedAt: null,
        modifiedFields: null,
      },
    });

    await auditLog(user.firmId, 'agent.action_modify_failed', 'agent_action', actionId, {
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

  await auditLog(user.firmId, 'agent.action_modified', 'agent_action', actionId, {
    actionType: action.actionType,
    modifications,
    modifiedBy: user.id,
  });

  publishAgentEvent(user.firmId, {
    type: 'action_modified',
    data: { id: actionId, actionType: action.actionType },
  });

  return NextResponse.json({ data: { id: actionId, status: 'executed' } });
});
