import { prisma } from '@/lib/prisma';

/**
 * Execute an agent action — create/update/cancel the target entity.
 * Must handle ALL action types, not just update_policy.
 */
export async function executeAction(action: {
  id: string;
  actionType: string;
  entityId: string | null;
  firmId: string;
  changes: Record<string, { old: any; new: any }>;
}): Promise<void> {
  const changes = action.changes || {};

  switch (action.actionType) {
    case 'update_policy': {
      if (!action.entityId) break;
      const updateData = extractPolicyChanges(changes);
      if (Object.keys(updateData).length > 0) {
        await prisma.policy.update({
          where: { id: action.entityId },
          data: updateData,
        });

        // Update linked renewal
        await updateLinkedRenewal(action.entityId, changes);
      }
      break;
    }

    case 'create_client': {
      await prisma.client.create({
        data: {
          firmId: action.firmId,
          name: changes.name?.new || 'Unknown',
          email: changes.email?.new || null,
          phone: changes.phone?.new || null,
        },
      });
      break;
    }

    case 'create_policy': {
      // entityId is the client ID for create_policy
      if (!action.entityId) break;
      await prisma.policy.create({
        data: {
          firmId: action.firmId,
          clientId: action.entityId,
          policyNumber: changes.policy_number?.new || `AUTO-${Date.now()}`,
          policyNumberNormalized: (changes.policy_number?.new || '').toUpperCase().replace(/[^A-Z0-9]/g, ''),
          insurerName: changes.insurer_name?.new || 'Unknown',
          policyType: changes.policy_type?.new || 'general',
          premium: changes.premium?.new || 0,
          inceptionDate: changes.inception_date?.new
            ? new Date(changes.inception_date.new)
            : new Date(),
          expiryDate: changes.expiry_date?.new
            ? new Date(changes.expiry_date.new)
            : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          policyStatus: 'active',
        },
      });
      break;
    }

    case 'cancel_policy': {
      if (!action.entityId) break;
      await prisma.policy.update({
        where: { id: action.entityId },
        data: { policyStatus: 'cancelled' },
      });
      break;
    }

    case 'update_claim': {
      // Claims table not yet implemented — log for now
      console.warn(`[executeAction] update_claim not yet implemented for action ${action.id}`);
      break;
    }

    case 'flag_for_review':
    case 'no_action': {
      // No DB mutation needed
      break;
    }

    default:
      console.warn(`[executeAction] Unknown action type: ${action.actionType}`);
  }
}

/**
 * Extract policy update fields from changes object.
 */
function extractPolicyChanges(changes: Record<string, { old: any; new: any }>): Record<string, any> {
  const updateData: Record<string, any> = {};

  if (changes.premium) updateData.premium = changes.premium.new;
  if (changes.expiry_date) updateData.expiryDate = new Date(changes.expiry_date.new);
  if (changes.ncb) updateData.ncb = changes.ncb.new;
  if (changes.insurer_name) updateData.insurerName = changes.insurer_name.new;
  if (changes.policy_type) updateData.policyType = changes.policy_type.new;

  return updateData;
}

/**
 * Update renewal linked to a policy if expiry date changed.
 */
async function updateLinkedRenewal(
  policyId: string,
  changes: Record<string, { old: any; new: any }>
): Promise<void> {
  if (!changes.expiry_date) return;

  const renewal = await prisma.renewal.findFirst({
    where: { policyId, status: { not: 'compliant' } },
  });

  if (renewal) {
    await prisma.renewal.update({
      where: { id: renewal.id },
      data: {
        dueDate: new Date(changes.expiry_date.new),
        ...(changes.premium && { newPremium: changes.premium.new }),
      },
    });
  }
}
