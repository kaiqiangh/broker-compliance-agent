import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { auditLog } from '@/lib/audit';

export const PUT = withAuth(null, async (user, request) => {
  // Extract action ID from URL path
  const url = new URL(request.url);
  const pathParts = url.pathname.split('/');
  const actionId = pathParts[pathParts.length - 2]; // .../actions/[id]/confirm → [id]

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

  // Execute the action
  await executeAction(action);

  // Update action status
  await prisma.agentAction.update({
    where: { id: actionId },
    data: {
      status: 'confirmed',
      confirmedBy: user.id,
      confirmedAt: new Date(),
      executedAt: new Date(),
    },
  });

  await auditLog(user.firmId, 'agent.action_confirmed', 'agent_action', actionId, {
    actionType: action.actionType,
    entityType: action.entityType,
    entityId: action.entityId,
    confirmedBy: user.id,
  });

  return NextResponse.json({ data: { id: actionId, status: 'confirmed' } });
});

async function executeAction(action: any) {
  const changes = action.changes as Record<string, { old: any; new: any }>;

  switch (action.actionType) {
    case 'update_policy': {
      const updateData: Record<string, any> = {};
      for (const [field, diff] of Object.entries(changes)) {
        if (field === 'premium') updateData.premium = diff.new;
        else if (field === 'expiry_date') updateData.expiryDate = new Date(diff.new);
        else if (field === 'ncb') updateData.ncb = diff.new;
      }
      if (Object.keys(updateData).length > 0 && action.entityId) {
        await prisma.policy.update({
          where: { id: action.entityId },
          data: updateData,
        });
      }
      break;
    }
  }
}
