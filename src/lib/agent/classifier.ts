import { callLLMJson } from './llm';

// Pre-built Irish insurer domains
const INSURER_DOMAINS = new Set([
  'aviva.ie', 'allianz.ie', 'axa.ie', 'zurich.ie', 'fbd.ie',
  'libertyinsurance.ie', 'rsai.ie', 'irishlife.ie', 'newireland.ie',
  'brokersireland.ie', 'kennco.ie', 'prestigeunderwriting.com',
  'arachas.ie', 'campion.ie', 'quotedevil.ie', 'insuremyvan.ie',
  'aa.ie', 'chill.ie', 'anpostinsurance.ie', 'revolut.com',
]);

export interface Classification {
  isInsurance: boolean;
  category: 'policy_renewal' | 'new_policy' | 'claim' | 'cancellation' | 'amendment' | 'endorsement' | 'general' | 'not_insurance';
  priority: 'urgent' | 'normal' | 'low';
  confidence: number;
}

interface ClassifyInput {
  subject: string;
  from: string;
  bodyText: string;
}

const CLASSIFICATION_PROMPT = `You are an email classifier for an Irish insurance broker.
Classify this email. Respond in JSON.

Rules:
- isInsurance: true if related to insurance business (policies, claims, renewals, cancellations, endorsements)
- category: one of [policy_renewal, new_policy, claim, cancellation, amendment, endorsement, general]
- priority: "urgent" for claims/cancellations/deadlines, "normal" for standard renewals, "low" for info-only
- confidence: 0-1 how confident you are

Email subject: {subject}
Email from: {from}
Email body (first 500 chars): {body}

Respond as: {"isInsurance": boolean, "category": "string", "priority": "string", "confidence": number}`;

export async function classifyEmail(input: ClassifyInput): Promise<Classification> {
  // Fast path: known insurer domain
  const fromDomain = input.from.split('@')[1]?.toLowerCase();
  if (fromDomain && INSURER_DOMAINS.has(fromDomain)) {
    // Still classify the type, but mark as insurance with high confidence
    try {
      const result = await callLLMJson<Classification>(
        CLASSIFICATION_PROMPT
          .replace('{subject}', input.subject)
          .replace('{from}', input.from)
          .replace('{body}', input.bodyText.slice(0, 500)),
        { maxTokens: 150 }
      );
      return {
        ...result,
        isInsurance: true, // Force true for known insurer domains
        confidence: Math.max(result.confidence, 0.9),
      };
    } catch {
      // LLM failed, but domain is known insurer
      return {
        isInsurance: true,
        category: 'general',
        priority: 'normal',
        confidence: 0.9,
      };
    }
  }

  // Full LLM classification for unknown domains
  try {
    const result = await callLLMJson<Classification>(
      CLASSIFICATION_PROMPT
        .replace('{subject}', input.subject)
        .replace('{from}', input.from)
        .replace('{body}', input.bodyText.slice(0, 500)),
      { maxTokens: 150 }
    );
    return result;
  } catch {
    // Fallback: keyword matching
    return fallbackClassification(input);
  }
}

function fallbackClassification(input: ClassifyInput): Classification {
  const text = `${input.subject} ${input.bodyText}`.toLowerCase();

  const insuranceKeywords = ['policy', 'premium', 'renewal', 'claim', 'insur', 'cover', 'excess', 'deductible', 'underwriting'];
  const hasInsuranceKeyword = insuranceKeywords.some(k => text.includes(k));

  if (!hasInsuranceKeyword) {
    return { isInsurance: false, category: 'not_insurance', priority: 'low', confidence: 0.5 };
  }

  let category: Classification['category'] = 'general';
  if (text.includes('renewal') || text.includes('expire')) category = 'policy_renewal';
  else if (text.includes('claim')) category = 'claim';
  else if (text.includes('cancel')) category = 'cancellation';

  let priority: Classification['priority'] = 'normal';
  if (category === 'claim' || category === 'cancellation') priority = 'urgent';

  return { isInsurance: true, category, priority, confidence: 0.6 };
}
