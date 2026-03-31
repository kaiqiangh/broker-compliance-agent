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

  const action = await prisma.agentAction.findUnique({
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

  // Apply modifications to the action's changes
  const currentChanges = (action.changes || {}) as Record<string, { old: any; new: any }>;
  const modifiedChanges = { ...currentChanges };

  for (const [field, newValue] of Object.entries(modifications)) {
    if (modifiedChanges[field]) {
      // Update the 'new' value, keep 'old' as-is
      modifiedChanges[field] = { old: modifiedChanges[field].old, new: newValue };
    } else {
      // New field added by user
      modifiedChanges[field] = { old: null, new: newValue };
    }
  }

  // Record each modification for learning
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

  // Update action with modifications
  await prisma.agentAction.update({
    where: { id: actionId },
    data: {
      changes: modifiedChanges,
      status: 'modified',
      confirmedBy: user.id,
      confirmedAt: new Date(),
      modifiedFields: modifications,
    },
  });

  // Execute the action with modified values
  await executeAction({
    id: actionId,
    actionType: action.actionType,
    entityId: action.entityId,
    firmId: user.firmId,
    changes: modifiedChanges,
  });

  // Mark as executed
  await prisma.agentAction.update({
    where: { id: actionId },
    data: { executedAt: new Date() },
  });

  await auditLog(user.firmId, 'agent.action_modified', 'agent_action', actionId, {
    actionType: action.actionType,
    modifications,
    modifiedBy: user.id,
  });

  // SSE: notify frontend
  publishAgentEvent(user.firmId, {
    type: 'action_modified',
    data: { id: actionId, actionType: action.actionType },
  });

  return NextResponse.json({ data: { id: actionId, status: 'modified' } });
});
