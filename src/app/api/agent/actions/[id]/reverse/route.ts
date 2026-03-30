import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { auditLog } from '@/lib/audit';

export const PUT = withAuth('agent:reverse_action', async (user, request) => {
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

  if (action.status !== 'executed' && action.status !== 'confirmed') {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Only executed actions can be reversed' } },
      { status: 400 }
    );
  }

  if (action.isReversed) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Action already reversed' } },
      { status: 400 }
    );
  }

  // Check 24h window
  const executedAt = action.executedAt || action.confirmedAt;
  if (executedAt) {
    const hoursSince = (Date.now() - executedAt.getTime()) / (1000 * 60 * 60);
    if (hoursSince > 24) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'Reversal window expired (24 hours)' } },
        { status: 400 }
      );
    }
  }

  // Get reason
  let reason = '';
  try {
    const body = await request.json();
    reason = body.reason || '';
  } catch {}

  // Reverse the action
  const changes = action.changes as Record<string, { old: any; new: any }>;

  if (action.actionType === 'update_policy' && action.entityId) {
    // Restore old values
    const restoreData: Record<string, any> = {};
    for (const [field, diff] of Object.entries(changes)) {
      if (field === 'premium') restoreData.premium = diff.old;
      else if (field === 'expiry_date') restoreData.expiryDate = diff.old ? new Date(diff.old) : null;
      else if (field === 'ncb') restoreData.ncb = diff.old;
    }
    if (Object.keys(restoreData).length > 0) {
      await prisma.policy.update({
        where: { id: action.entityId },
        data: restoreData,
      });
    }

    // Revert linked renewal
    if (changes.expiry_date) {
      const renewal = await prisma.renewal.findFirst({
        where: { policyId: action.entityId, status: { not: 'compliant' } },
      });
      if (renewal) {
        await prisma.renewal.update({
          where: { id: renewal.id },
          data: {
            dueDate: changes.expiry_date.old ? new Date(changes.expiry_date.old) : renewal.dueDate,
            ...(changes.premium && { newPremium: changes.premium.old }),
          },
        });
      }
    }
  }

  // Mark as reversed
  await prisma.agentAction.update({
    where: { id: actionId },
    data: {
      isReversed: true,
      reversedBy: user.id,
      reversedAt: new Date(),
      reversalReason: reason,
    },
  });

  await auditLog(user.firmId, 'agent.action_reversed', 'agent_action', actionId, {
    actionType: action.actionType,
    reason,
    reversedBy: user.id,
  });

  return NextResponse.json({ data: { id: actionId, reversed: true } });
});
