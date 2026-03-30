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

  let modifications: Record<string, any> = {};
  try {
    const body = await request.json();
    modifications = body.modifications || {};
  } catch {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } },
      { status: 400 }
    );
  }

  // Apply modifications to changes
  const originalChanges = action.changes as Record<string, { old: any; new: any }>;
  const updatedChanges = { ...originalChanges };

  for (const [field, newValue] of Object.entries(modifications)) {
    if (updatedChanges[field]) {
      updatedChanges[field] = { old: updatedChanges[field].old, new: newValue };
    }
  }

  // Record each modification for learning
  for (const [field, newValue] of Object.entries(modifications)) {
    const originalValue = originalChanges[field]?.new;
    if (originalValue !== newValue) {
      await prisma.agentActionModification.create({
        data: {
          actionId,
          firmId: user.firmId,
          fieldName: field,
          originalValue: String(originalValue),
          correctedValue: String(newValue),
          modifiedBy: user.id,
        },
      });
    }
  }

  // Execute with modified values
  if (action.actionType === 'update_policy' && action.entityId) {
    const updateData: Record<string, any> = {};
    for (const [field, diff] of Object.entries(updatedChanges)) {
      if (field === 'premium') updateData.premium = diff.new;
      else if (field === 'expiry_date') updateData.expiryDate = new Date(diff.new);
      else if (field === 'ncb') updateData.ncb = diff.new;
    }
    if (Object.keys(updateData).length > 0) {
      await prisma.policy.update({ where: { id: action.entityId }, data: updateData });
    }
  }

  // Update action
  await prisma.agentAction.update({
    where: { id: actionId },
    data: {
      status: 'modified',
      changes: updatedChanges,
      modifiedFields: modifications,
      confirmedBy: user.id,
      confirmedAt: new Date(),
      executedAt: new Date(),
    },
  });

  await auditLog(user.firmId, 'agent.action_modified', 'agent_action', actionId, {
    actionType: action.actionType,
    modifications,
    modifiedBy: user.id,
  });

  return NextResponse.json({ data: { id: actionId, status: 'modified' } });
});
