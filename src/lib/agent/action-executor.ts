import { prisma } from '@/lib/prisma';

type ActionChanges = Record<string, { old: any; new: any }>;

export interface ExecutionResult {
  entityType: string | null;
  entityId: string | null;
}

interface ExecutableAction {
  id: string;
  actionType: string;
  entityType?: string | null;
  entityId: string | null;
  firmId: string;
  changes: ActionChanges | null;
}

/**
 * Execute an agent action — create/update/cancel the target entity.
 * Must handle ALL action types, not just update_policy.
 */
export async function executeAction(action: ExecutableAction): Promise<ExecutionResult> {
  const changes = action.changes || {};

  switch (action.actionType) {
    case 'update_policy': {
      if (!action.entityId) break;
      const existing = await prisma.policy.findFirst({
        where: { id: action.entityId, firmId: action.firmId },
      });
      if (!existing) throw new Error(`Policy ${action.entityId} not found in firm ${action.firmId}`);

      const updateData = extractPolicyChanges(changes);
      if (Object.keys(updateData).length > 0) {
        await prisma.policy.update({
          where: { id: action.entityId },
          data: updateData,
        });

        // Update linked renewal
        await updateLinkedRenewal(action.entityId, changes);
      }
      return {
        entityType: 'policy',
        entityId: action.entityId,
      };
    }

    case 'create_client': {
      const client = await prisma.client.create({
        data: {
          firmId: action.firmId,
          name: changes.name?.new || 'Unknown',
          email: changes.email?.new || null,
          phone: changes.phone?.new || null,
        },
      });
      return {
        entityType: 'client',
        entityId: client.id,
      };
    }

    case 'create_policy': {
      // entityId is the client ID for create_policy
      if (!action.entityId) break;
      const client = await prisma.client.findFirst({
        where: { id: action.entityId, firmId: action.firmId },
      });
      if (!client) throw new Error(`Client ${action.entityId} not found in firm ${action.firmId}`);

      const policy = await prisma.policy.create({
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
      return {
        entityType: 'policy',
        entityId: policy.id,
      };
    }

    case 'cancel_policy': {
      if (!action.entityId) break;
      const policy = await prisma.policy.findFirst({
        where: { id: action.entityId, firmId: action.firmId },
      });
      if (!policy) throw new Error(`Policy ${action.entityId} not found in firm ${action.firmId}`);
      await prisma.policy.update({
        where: { id: action.entityId },
        data: { policyStatus: 'cancelled' },
      });
      return {
        entityType: 'policy',
        entityId: action.entityId,
      };
    }

    case 'update_claim': {
      // Claims table not yet implemented — log for now
      console.warn(`[executeAction] update_claim not yet implemented for action ${action.id}`);
      return {
        entityType: action.entityType ?? 'claim',
        entityId: action.entityId,
      };
    }

    case 'flag_for_review':
    case 'no_action': {
      // No DB mutation needed
      return {
        entityType: action.entityType ?? null,
        entityId: action.entityId,
      };
    }

    default:
      console.warn(`[executeAction] Unknown action type: ${action.actionType}`);
      return {
        entityType: action.entityType ?? null,
        entityId: action.entityId,
      };
  }

  return {
    entityType: action.entityType ?? null,
    entityId: action.entityId,
  };
}

/**
 * Extract policy update fields from changes object.
 */
function extractPolicyChanges(changes: ActionChanges): Record<string, any> {
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
  changes: ActionChanges
): Promise<void> {
  if (!changes.expiry_date) return;

  const renewal = await prisma.renewal.findFirst({
    where: { policyId, status: { not: 'compliant' } },
    orderBy: { dueDate: 'desc' },
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
