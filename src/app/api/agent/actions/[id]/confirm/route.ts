import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { auditLog } from '@/lib/audit';
import { executeAction } from '@/lib/agent/action-executor';
import { publishAgentEvent } from '@/app/api/agent/events/route';

export const PUT = withAuth(null, async (user, request) => {
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
    const action = await prisma.agentAction.findUnique({
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

  // Execute the action (handles ALL action types)
  await executeAction({
    ...action,
    changes: (action.changes || {}) as Record<string, { old: any; new: any }>,
  });

  // Mark as executed
  await prisma.agentAction.update({
    where: { id: actionId },
    data: { executedAt: new Date() },
  });

  await auditLog(user.firmId, 'agent.action_confirmed', 'agent_action', actionId, {
    actionType: action.actionType,
    entityType: action.entityType,
    entityId: action.entityId,
    confirmedBy: user.id,
  });

  // SSE: notify frontend
  publishAgentEvent(user.firmId, {
    type: 'action_confirmed',
    data: { id: actionId, actionType: action.actionType },
  });

  return NextResponse.json({ data: { id: actionId, status: 'confirmed' } });
});
