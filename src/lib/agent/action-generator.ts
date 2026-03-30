import type { MatchResult } from './matcher';

export type ActionType =
  | 'update_policy'
  | 'create_policy'
  | 'create_client'
  | 'update_claim'
  | 'cancel_policy'
  | 'flag_for_review'
  | 'no_action';

export interface AgentActionData {
  type: ActionType;
  target: {
    entityType: 'policy' | 'client' | 'claim' | 'renewal';
    entityId?: string;
    matchConfidence?: number;
  };
  changes: Record<string, { old: any; new: any }>;
  confidence: number;
  reasoning: string;
}

interface GenerateInput {
  firmId: string;
  emailSubject: string;
  emailFrom: string;
  classification: { category: string; confidence: number };
  extraction: Record<string, any>;
  matching: MatchResult;
  existingPolicy?: {
    id: string;
    premium: number;
    expiryDate: Date;
    ncb: number | null;
    clientId: string;
  } | null;
}

export function generateAction(input: GenerateInput): AgentActionData {
  const { classification, extraction, matching, existingPolicy } = input;

  // Case 1: No match found → create new
  if (!matching.policy && !matching.client) {
    if (extraction.clientName) {
      return {
        type: 'create_client',
        target: { entityType: 'client', matchConfidence: 0 },
        changes: {
          name: { old: null, new: extraction.clientName },
          ...(extraction.clientEmail && { email: { old: null, new: extraction.clientEmail } }),
          ...(extraction.clientPhone && { phone: { old: null, new: extraction.clientPhone } }),
        },
        confidence: 0.7,
        reasoning: `No matching client or policy found. Suggesting new client creation for "${extraction.clientName}".`,
      };
    }

    return {
      type: 'flag_for_review',
      target: { entityType: 'policy', matchConfidence: 0 },
      changes: {},
      confidence: 0.3,
      reasoning: 'Could not extract sufficient data or match to existing records. Manual review required.',
    };
  }

  // Case 2: Policy matched → update
  if (matching.policy && existingPolicy) {
    const changes: Record<string, { old: any; new: any }> = {};

    const PRECISION_TOLERANCE = 0.01;
    if (extraction.newPremium != null) {
      const oldPremium = Number(existingPolicy.premium);
      if (Math.abs(extraction.newPremium - oldPremium) > PRECISION_TOLERANCE) {
        changes.premium = { old: oldPremium, new: extraction.newPremium };
      }
    }
    if (extraction.newExpiry) {
      const newExpiry = new Date(extraction.newExpiry);
      if (newExpiry.toISOString().slice(0, 10) !== existingPolicy.expiryDate.toISOString().slice(0, 10)) {
        changes.expiry_date = { old: existingPolicy.expiryDate.toISOString().slice(0, 10), new: extraction.newExpiry };
      }
    }
    if (extraction.ncb != null && extraction.ncb !== existingPolicy.ncb) {
      changes.ncb = { old: existingPolicy.ncb, new: extraction.ncb };
    }

    if (Object.keys(changes).length === 0) {
      return {
        type: 'no_action',
        target: { entityType: 'policy', entityId: matching.policy.id, matchConfidence: matching.policy.confidence },
        changes: {},
        confidence: 0.9,
        reasoning: `Policy matched but no data changes detected for "${extraction.policyNumber}".`,
      };
    }

    const actionType: ActionType = classification.category === 'cancellation' ? 'cancel_policy' : 'update_policy';

    return {
      type: actionType,
      target: { entityType: 'policy', entityId: matching.policy.id, matchConfidence: matching.policy.confidence },
      changes,
      confidence: matching.policy.confidence * (classification.confidence || 0.9),
      reasoning: buildReasoning(input),
    };
  }

  // Case 3: Client matched but no policy → create policy
  if (matching.client && !matching.policy) {
    return {
      type: 'create_policy',
      target: { entityType: 'client', entityId: matching.client.id, matchConfidence: matching.client.confidence },
      changes: {
        ...(extraction.policyNumber && { policy_number: { old: null, new: extraction.policyNumber } }),
        ...(extraction.insurerName && { insurer_name: { old: null, new: extraction.insurerName } }),
        ...(extraction.policyType && { policy_type: { old: null, new: extraction.policyType } }),
        ...(extraction.newPremium && { premium: { old: null, new: extraction.newPremium } }),
        ...(extraction.newExpiry && { expiry_date: { old: null, new: extraction.newExpiry } }),
      },
      confidence: matching.client.confidence * 0.85,
      reasoning: `Matched client but no existing policy found. Suggesting new policy creation for "${extraction.policyNumber}".`,
    };
  }

  // Case 4: Unclear → flag for review
  return {
    type: 'flag_for_review',
    target: { entityType: 'policy', matchConfidence: matching.policy?.confidence || matching.client?.confidence || 0 },
    changes: {},
    confidence: 0.5,
    reasoning: 'Partial match found but insufficient confidence for automatic action. Manual review required.',
  };
}

function buildReasoning(input: GenerateInput): string {
  const { extraction, matching, classification } = input;
  const parts: string[] = [];

  if (matching.policy) {
    parts.push(`Matched policy ${extraction.policyNumber || 'unknown'} (confidence: ${matching.policy.confidence})`);
  }

  if (classification.category === 'cancellation') {
    parts.push('Cancellation detected');
  } else if (extraction.newPremium) {
    parts.push(`New premium: €${extraction.newPremium}`);
  }

  if (extraction.newExpiry) {
    parts.push(`New expiry: ${extraction.newExpiry}`);
  }

  return parts.join('. ') + '.';
}
