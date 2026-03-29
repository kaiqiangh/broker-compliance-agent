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

/**
 * Jaro-Winkler similarity between two strings.
 * Returns a value between 0 (no match) and 1 (exact match).
 */
export function jaroWinklerSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  if (s1.length === 0 || s2.length === 0) return 0.0;

  const matchWindow = Math.max(1, Math.floor(Math.max(s1.length, s2.length) / 2) - 1);

  const s1Matches = new Array(s1.length).fill(false);
  const s2Matches = new Array(s2.length).fill(false);

  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, s2.length);

    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0.0;

  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  const jaro = (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3;

  // Winkler modification: boost for common prefix (up to 4 chars)
  let prefix = 0;
  for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}

export interface FuzzyMatchResult {
  matched: boolean;
  similarity: number;
  confidence: number;
  matchTier: 'exact' | 'normalized' | 'fuzzy' | 'none';
}

/**
 * Tier 3 fuzzy match: compare two normalized policy numbers.
 * Returns match result with confidence score 0.70-0.90 if similarity > 0.85.
 */
export function fuzzyMatchPolicy(
  incomingNormalized: string,
  existingNormalized: string
): FuzzyMatchResult {
  const similarity = jaroWinklerSimilarity(incomingNormalized, existingNormalized);

  if (similarity > 0.85) {
    // Map similarity (0.85-1.0) to confidence (0.70-0.90)
    const confidence = 0.70 + ((similarity - 0.85) / 0.15) * 0.20;
    return {
      matched: true,
      similarity,
      confidence: Math.round(confidence * 100) / 100,
      matchTier: 'fuzzy',
    };
  }

  return { matched: false, similarity, confidence: 0, matchTier: 'none' };
}
