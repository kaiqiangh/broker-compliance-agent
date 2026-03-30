import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { auditLog } from '@/lib/audit';

export const PUT = withAuth(null, async (user, request) => {
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
      { error: { code: 'BAD_REQUEST', message: `Action is already ${action.status}` } },
      { status: 400 }
    );
  }

  let reason = '';
  try {
    const body = await request.json();
    reason = body.reason || '';
  } catch {}

  await prisma.agentAction.update({
    where: { id: actionId },
    data: { status: 'rejected', rejectedReason: reason },
  });

  await auditLog(user.firmId, 'agent.action_rejected', 'agent_action', actionId, {
    actionType: action.actionType,
    reason,
    rejectedBy: user.id,
  });

  return NextResponse.json({ data: { id: actionId, status: 'rejected' } });
});
