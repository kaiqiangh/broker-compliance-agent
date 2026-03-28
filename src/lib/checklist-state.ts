/**
 * Checklist item state machine.
 * Defines valid state transitions for compliance checklist items.
 */

export type ChecklistStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'pending_review'
  | 'approved'
  | 'rejected';

const VALID_TRANSITIONS: Record<ChecklistStatus, ChecklistStatus[]> = {
  pending: ['in_progress'],
  in_progress: ['completed'],
  completed: ['pending_review'],
  pending_review: ['approved', 'rejected'],
  approved: [], // terminal
  rejected: ['in_progress'], // can retry
};

export function canTransition(from: ChecklistStatus, to: ChecklistStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function transitionChecklistItem(
  currentStatus: ChecklistStatus,
  targetStatus: ChecklistStatus
): { success: true } | { success: false; error: string } {
  if (canTransition(currentStatus, targetStatus)) {
    return { success: true };
  }
  return {
    success: false,
    error: `Invalid transition: ${currentStatus} → ${targetStatus}. Valid transitions: ${VALID_TRANSITIONS[currentStatus].join(', ') || 'none (terminal)'}`,
  };
}

/**
 * CPC checklist item types
 */
export const CHECKLIST_ITEM_TYPES = [
  'renewal_notification',
  'suitability_assessment',
  'market_comparison',
  'premium_disclosure',
  'commission_disclosure',
  'client_communication',
  'policy_terms_review',
  'final_sign_off',
] as const;

export type ChecklistItemType = typeof CHECKLIST_ITEM_TYPES[number];

/**
 * Which checklist items require compliance officer sign-off
 */
export const ITEMS_REQUIRING_SIGN_OFF: ChecklistItemType[] = [
  'suitability_assessment',
  'final_sign_off',
];

/**
 * CPC checklist item definitions
 */
export interface ChecklistItemDef {
  type: ChecklistItemType;
  label: string;
  description: string;
  requiresSignOff: boolean;
  evidenceRequired: boolean;
}

export const CHECKLIST_DEFINITIONS: ChecklistItemDef[] = [
  {
    type: 'renewal_notification',
    label: 'Renewal notification sent',
    description: 'Written renewal notification sent to client (20 days before expiry, 40 days for CP158)',
    requiresSignOff: false,
    evidenceRequired: true,
  },
  {
    type: 'suitability_assessment',
    label: 'Suitability assessment completed',
    description: 'Needs, demands, and circumstances reviewed for continuing suitability',
    requiresSignOff: true,
    evidenceRequired: true,
  },
  {
    type: 'market_comparison',
    label: 'Market comparison documented',
    description: 'Evidence of market analysis or fair analysis of available products',
    requiresSignOff: false,
    evidenceRequired: true,
  },
  {
    type: 'premium_disclosure',
    label: 'Premium disclosure (new + old)',
    description: 'New premium and previous year premium disclosed to client',
    requiresSignOff: false,
    evidenceRequired: false, // auto-populated from policy data
  },
  {
    type: 'commission_disclosure',
    label: 'Commission disclosure',
    description: 'Commission nature/basis disclosed to client',
    requiresSignOff: false,
    evidenceRequired: true,
  },
  {
    type: 'client_communication',
    label: 'Client communication recorded',
    description: 'Record of renewal discussion (email, letter, or phone note)',
    requiresSignOff: false,
    evidenceRequired: true,
  },
  {
    type: 'policy_terms_review',
    label: 'Policy terms changes noted',
    description: 'Any changes to terms and conditions documented',
    requiresSignOff: false,
    evidenceRequired: false,
  },
  {
    type: 'final_sign_off',
    label: 'Final sign-off',
    description: 'All items verified and approved by compliance officer',
    requiresSignOff: true,
    evidenceRequired: false,
  },
];
