import { prisma } from '@/lib/prisma';

export interface MatchResult {
  client?: { id: string; confidence: number };
  policy?: { id: string; confidence: number };
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

export async function matchRecords(
  firmId: string,
  extraction: Record<string, any>
): Promise<MatchResult> {
  const result: MatchResult = {};

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
      return result;
    }

    // Fuzzy match
    const candidates = await prisma.policy.findMany({
      where: { firmId, policyStatus: 'active' },
      take: 50,
    });

    let bestPolicy: typeof candidates[0] | null = null;
    let bestScore = 0;

    for (const candidate of candidates) {
      const score = similarity(normalized, candidate.policyNumberNormalized || '');
      if (score > bestScore && score >= 0.7) {
        bestScore = score;
        bestPolicy = candidate;
      }
    }

    if (bestPolicy) {
      result.policy = { id: bestPolicy.id, confidence: Math.round(bestScore * 100) / 100 };
      result.client = { id: bestPolicy.clientId, confidence: Math.round(bestScore * 100) / 100 };
      return result;
    }
  }

  // Step 2: Match client by name (if no policy match)
  if (extraction.clientName) {
    const clients = await prisma.client.findMany({
      where: { firmId },
      take: 50,
    });

    let bestClient: typeof clients[0] | null = null;
    let bestScore = 0;

    for (const candidate of clients) {
      const score = similarity(extraction.clientName, candidate.name);
      if (score > bestScore && score >= 0.7) {
        bestScore = score;
        bestClient = candidate;
      }
    }

    if (bestClient) {
      result.client = { id: bestClient.id, confidence: Math.round(bestScore * 100) / 100 };
    }
  }

  return result;
}
