import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { auditLog } from '@/lib/audit';
import { checkRateLimit } from '@/lib/rate-limit';

export const PUT = withAuth('agent:reverse_action', async (user, request) => {
  const rl = await checkRateLimit(`api:actions:reverse:${user.id}`, 60, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded', retryAfter: rl.retryAfter }, { status: 429 });
  }

  const url = new URL(request.url);
  const pathParts = url.pathname.split('/');
  const actionId = pathParts[pathParts.length - 2];

  const action = await prisma.agentAction.findFirst({
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

  switch (action.actionType) {
    case 'update_policy': {
      if (action.entityId) {
        const restoreData: Record<string, any> = {};
        for (const [field, diff] of Object.entries(changes)) {
          if (field === 'premium') restoreData.premium = diff.old;
          else if (field === 'expiry_date') restoreData.expiryDate = diff.old ? new Date(diff.old) : null;
          else if (field === 'ncb') restoreData.ncb = diff.old;
        }
        if (Object.keys(restoreData).length > 0) {
          await prisma.policy.update({
            where: { id: action.entityId, firmId: user.firmId },
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
      break;
    }

    case 'cancel_policy': {
      if (action.entityId) {
        const policy = await prisma.policy.findFirst({
          where: { id: action.entityId, firmId: user.firmId },
        });
        if (policy) {
          await prisma.policy.update({
            where: { id: action.entityId },
            data: { policyStatus: 'active' },
          });
        }
      }
      break;
    }

    case 'create_policy': {
      if (action.entityId) {
        const policy = await prisma.policy.findFirst({
          where: { id: action.entityId, firmId: user.firmId },
        });
        if (policy) {
          await prisma.policy.update({
            where: { id: action.entityId },
            data: { policyStatus: 'reversed' },
          });
        }
      }
      break;
    }

    case 'create_client': {
      const client = action.entityId
        ? await prisma.client.findFirst({
            where: { id: action.entityId, firmId: user.firmId },
          })
        : changes.name?.new
          ? await prisma.client.findFirst({
              where: { firmId: user.firmId, name: changes.name.new },
            })
          : null;

      if (client) {
        const policyCount = await prisma.policy.count({
          where: { clientId: client.id, firmId: user.firmId },
        });
        if (policyCount > 0) {
          return NextResponse.json(
            { error: { code: 'CONFLICT', message: 'Cannot reverse: client has associated policies' } },
            { status: 409 }
          );
        }
        await prisma.client.delete({ where: { id: client.id } });
      }
      break;
    }

    case 'flag_for_review':
    case 'no_action': {
      // Nothing to reverse — these don't mutate DB
      break;
    }

    default:
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: `Reversal not supported for action type: ${action.actionType}` } },
        { status: 400 }
      );
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

  const auditAction = action.mode === 'auto' ? 'agent.action_auto_undone' : 'agent.action_reversed';
  await auditLog(user.firmId, auditAction, 'agent_action', actionId, {
    actionType: action.actionType,
    reason,
    reversedBy: user.id,
    wasAutoExecuted: action.mode === 'auto',
  });

  return NextResponse.json({ data: { id: actionId, reversed: true } });
});
