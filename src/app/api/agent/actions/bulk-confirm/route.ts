import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { auditLog } from '@/lib/audit';

export const POST = withAuth(null, async (user, request) => {
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
      // Execute action
      if (action.actionType === 'update_policy' && action.entityId) {
        const changes = action.changes as Record<string, { old: any; new: any }>;
        const updateData: Record<string, any> = {};
        for (const [field, diff] of Object.entries(changes)) {
          if (field === 'premium') updateData.premium = diff.new;
          else if (field === 'expiry_date') updateData.expiryDate = new Date(diff.new);
          else if (field === 'ncb') updateData.ncb = diff.new;
        }
        if (Object.keys(updateData).length > 0) {
          await prisma.policy.update({ where: { id: action.entityId }, data: updateData });
        }
      }

      // Mark confirmed
      await prisma.agentAction.update({
        where: { id: action.id },
        data: {
          status: 'confirmed',
          confirmedBy: user.id,
          confirmedAt: new Date(),
          executedAt: new Date(),
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
