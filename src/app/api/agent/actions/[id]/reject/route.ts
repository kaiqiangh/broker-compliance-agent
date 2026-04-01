import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { auditLog } from '@/lib/audit';
import { checkRateLimit } from '@/lib/rate-limit';

export const PUT = withAuth('agent:reject_action', async (user, request) => {
  const rl = await checkRateLimit(`api:actions:reject:${user.id}`, 60, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded', retryAfter: rl.retryAfter }, { status: 429 });
  }

  const url = new URL(request.url);
  const pathParts = url.pathname.split('/');
  const actionId = pathParts[pathParts.length - 2];

  let reason = '';
  try {
    const body = await request.json();
    reason = body.reason || '';
  } catch {}

  // Atomic: reject only if still pending (prevents race with confirm/modify)
  const result = await prisma.agentAction.updateMany({
    where: {
      id: actionId,
      firmId: user.firmId,
      status: 'pending',
    },
    data: {
      status: 'rejected',
      rejectedReason: reason,
    },
  });

  if (result.count === 0) {
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

  const action = await prisma.agentAction.findUniqueOrThrow({
    where: { id: actionId },
  });

  await auditLog(user.firmId, 'agent.action_rejected', 'agent_action', actionId, {
    actionType: action.actionType,
    reason,
    rejectedBy: user.id,
  });

  return NextResponse.json({ data: { id: actionId, status: 'rejected' } });
});
