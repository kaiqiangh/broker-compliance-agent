import { createHash } from 'crypto';

/**
 * Normalize a policy number for deduplication:
 * 1. TRIM — remove leading/trailing whitespace
 * 2. Remove all non-alphanumeric characters (-, spaces, /, .)
 * 3. UPPERCASE — case-insensitive comparison
 */
export function normalizePolicyNumber(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Normalize insurer name for deduplication
 */
export function normalizeInsurerName(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Compute a composite dedup hash from policy identity fields
 */
export function computeDedupHash(components: {
  firmId: string;
  policyNumber: string;
  policyType: string;
  insurerName: string;
  inceptionDate: string; // YYYY-MM-DD
}): string {
  // Use \x00 (null byte) as separator — cannot appear in any of the component values
  const raw = [
    components.firmId,
    normalizePolicyNumber(components.policyNumber),
    components.policyType.trim().toLowerCase(),
    normalizeInsurerName(components.insurerName),
    components.inceptionDate,
  ].join('\x00');
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Parse a premium string, stripping currency symbols and commas
 * "€1,245.00" → 1245.00
 * "1245.00" → 1245.00
 * "€1245" → 1245.00
 */
export function parsePremium(raw: string): number {
  const cleaned = raw.replace(/[€£$,\s]/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * Format a premium as EUR string
 */
export function formatPremium(value: number): string {
  return `€${value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/**
 * Parse a commission string
 * "12.5%" → 12.5
 * "12.5" → 12.5
 */
export function parseCommission(raw: string): number {
  const cleaned = raw.replace(/%/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}
