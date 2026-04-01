import { prisma } from '@/lib/prisma';

export interface MatchResult {
  client?: { id: string; confidence: number };
  policy?: { id: string; confidence: number };
  matchMethod?: 'exact' | 'fuzzy_policy' | 'multi_field';
}

/**
 * Normalize policy number: remove spaces, dashes, slashes, uppercase.
 */
export function normalizePolicyNumber(num: string): string {
  return num.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Levenshtein distance.
 */
function levenshtein(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= a.length; i++) matrix[i] = [i];
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a.toLowerCase(), b.toLowerCase()) / maxLen;
}

/**
 * Dynamic similarity threshold based on classification confidence.
 * Higher confidence in classification → stricter matching.
 */
function dynamicThreshold(classificationConfidence?: number): number {
  if (classificationConfidence == null) return 0.7;
  if (classificationConfidence >= 0.9) return 0.85;
  if (classificationConfidence >= 0.7) return 0.75;
  return 0.65;
}

export async function matchRecords(
  firmId: string,
  extraction: Record<string, any>,
  classificationConfidence?: number
): Promise<MatchResult> {
  const result: MatchResult = {};
  const threshold = dynamicThreshold(classificationConfidence);

  // Step 1: Match policy by number
  if (extraction.policyNumber) {
    const normalized = normalizePolicyNumber(extraction.policyNumber);

    // Exact match
    const exactMatch = await prisma.policy.findFirst({
      where: {
        firmId,
        policyNumberNormalized: normalized,
        policyStatus: 'active',
      },
    });

    if (exactMatch) {
      result.policy = { id: exactMatch.id, confidence: 1.0 };
      result.client = { id: exactMatch.clientId, confidence: 1.0 };
      result.matchMethod = 'exact';
      return result;
    }

    // Fuzzy match
    const candidates = await prisma.policy.findMany({
      where: { firmId, policyStatus: 'active' },
      take: 500,
      orderBy: { policyNumberNormalized: 'asc' },
    });

    let bestPolicy: typeof candidates[0] | null = null;
    let bestScore = 0;

    for (const candidate of candidates) {
      const score = similarity(normalized, candidate.policyNumberNormalized || '');
      if (score > bestScore && score >= threshold) {
        bestScore = score;
        bestPolicy = candidate;
      }
    }

    if (bestPolicy) {
      result.policy = { id: bestPolicy.id, confidence: Math.round(bestScore * 100) / 100 };
      result.client = { id: bestPolicy.clientId, confidence: Math.round(bestScore * 100) / 100 };
      result.matchMethod = 'fuzzy_policy';
      return result;
    }
  }

  // Step 2: Multi-field fallback (client name + insurer) when policy number fails
  if (extraction.clientName) {
    if (extraction.insurerName) {
      // Multi-field: match by insurer (exact on Policy) + client name (fuzzy on Client)
      const policies = await prisma.policy.findMany({
        where: {
          firmId,
          policyStatus: 'active',
          insurerName: { equals: extraction.insurerName, mode: 'insensitive' },
        },
        take: 500,
        include: { client: { select: { id: true, name: true } } },
      });

      let bestClient: { id: string; name: string } | null = null;
      let bestScore = 0;

      for (const policy of policies) {
        const nameScore = similarity(extraction.clientName, policy.client.name);
        const combinedScore = nameScore * 0.6 + 1.0 * 0.4; // insurer already exact-matched
        if (combinedScore > bestScore && combinedScore >= 0.8) {
          bestScore = combinedScore;
          bestClient = policy.client;
        }
      }

      if (bestClient) {
        result.client = { id: bestClient.id, confidence: Math.round(bestScore * 100) / 100 };
        result.matchMethod = 'multi_field';
      }
    }

    // Name-only fallback (no insurer, or insurer match didn't yield results)
    if (!result.client) {
      const clients = await prisma.client.findMany({
        where: { firmId },
        take: 500,
        orderBy: { name: 'asc' },
      });

      let bestClient: typeof clients[0] | null = null;
      let bestScore = 0;

      for (const candidate of clients) {
        const nameScore = similarity(extraction.clientName, candidate.name);
        if (nameScore > bestScore && nameScore >= threshold) {
          bestScore = nameScore;
          bestClient = candidate;
        }
      }

      if (bestClient) {
        result.client = { id: bestClient.id, confidence: Math.round(bestScore * 100) / 100 };
      }
    }
  }

  return result;
}
