import { callLLMJson } from './llm';

interface ExtractInput {
  subject: string;
  from: string;
  bodyText: string;
}

const RENEWAL_PROMPT = `Extract structured data from this Irish insurance renewal email. Use null for unknown fields.

Email subject: {subject}
Email from: {from}
Email body:
{body}

Respond in JSON:
{
  "policyNumber": "string",
  "clientName": "string",
  "insurerName": "string",
  "policyType": "motor|home|commercial|life|health",
  "currentPremium": number,
  "newPremium": number,
  "currentExpiry": "YYYY-MM-DD",
  "newExpiry": "YYYY-MM-DD",
  "changesNoted": "string or null",
  "commissionRate": number,
  "ncb": number
}`;

const CLAIM_PROMPT = `Extract structured data from this Irish insurance claim email. Use null for unknown fields.

Email subject: {subject}
Email from: {from}
Email body:
{body}

Respond in JSON:
{
  "claimNumber": "string",
  "policyNumber": "string",
  "clientName": "string",
  "claimAmount": number,
  "status": "received|in_progress|settled|declined",
  "statusUpdate": "string or null",
  "settlementAmount": number
}`;

const CANCELLATION_PROMPT = `Extract structured data from this Irish insurance cancellation email. Use null for unknown fields.

Email subject: {subject}
Email from: {from}
Email body:
{body}

Respond in JSON:
{
  "policyNumber": "string",
  "clientName": "string",
  "cancellationDate": "YYYY-MM-DD",
  "reason": "string or null",
  "refundAmount": number
}`;

const NEW_POLICY_PROMPT = `Extract structured data from this Irish new policy email. Use null for unknown fields.

Email subject: {subject}
Email from: {from}
Email body:
{body}

Respond in JSON:
{
  "clientName": "string",
  "clientEmail": "string",
  "clientPhone": "string",
  "insurerName": "string",
  "policyNumber": "string",
  "policyType": "motor|home|commercial|life|health",
  "inceptionDate": "YYYY-MM-DD",
  "expiryDate": "YYYY-MM-DD",
  "premium": number,
  "coverDetails": "string or null"
}`;

function getPrompt(category: string): string {
  switch (category) {
    case 'policy_renewal': return RENEWAL_PROMPT;
    case 'claim': return CLAIM_PROMPT;
    case 'cancellation': return CANCELLATION_PROMPT;
    case 'new_policy': return NEW_POLICY_PROMPT;
    default: return RENEWAL_PROMPT;
  }
}

export async function extractData(
  desensitizedBody: string,
  category: string,
  email: ExtractInput
): Promise<Record<string, any>> {
  const prompt = getPrompt(category)
    .replace('{subject}', email.subject)
    .replace('{from}', email.from)
    .replace('{body}', desensitizedBody.slice(0, 3000));

  return callLLMJson(prompt, { maxTokens: 500 });
}
