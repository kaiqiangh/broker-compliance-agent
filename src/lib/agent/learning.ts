import { prisma } from '@/lib/prisma';

interface LearningInsight {
  field: string;
  commonMistake: string;
  suggestedFix: string;
  occurrences: number;
}

export async function getLearningInsights(firmId: string): Promise<LearningInsight[]> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const modifications = await prisma.agentActionModification.findMany({
    where: { firmId, modifiedAt: { gte: thirtyDaysAgo } },
    select: { fieldName: true, originalValue: true, correctedValue: true },
  });

  const fieldErrors = new Map<string, { original: string; corrected: string; count: number }>();

  for (const mod of modifications) {
    const key = `${mod.fieldName}:${mod.originalValue}`;
    const existing = fieldErrors.get(key);
    if (existing) {
      existing.count++;
    } else {
      fieldErrors.set(key, {
        original: mod.originalValue || '',
        corrected: mod.correctedValue || '',
        count: 1,
      });
    }
  }

  return Array.from(fieldErrors.entries())
    .filter(([_, v]) => v.count >= 2)
    .map(([key, v]) => {
      const [field] = key.split(':');
      return {
        field,
        commonMistake: v.original,
        suggestedFix: v.corrected,
        occurrences: v.count,
      };
    })
    .sort((a, b) => b.occurrences - a.occurrences);
}

export async function getAccuracyReport(firmId: string) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [total, confirmed, modified, rejected] = await Promise.all([
    prisma.agentAction.count({ where: { firmId, createdAt: { gte: thirtyDaysAgo } } }),
    prisma.agentAction.count({ where: { firmId, status: 'confirmed', confirmedAt: { gte: thirtyDaysAgo } } }),
    prisma.agentAction.count({ where: { firmId, status: 'modified', confirmedAt: { gte: thirtyDaysAgo } } }),
    prisma.agentAction.count({ where: { firmId, status: 'rejected', createdAt: { gte: thirtyDaysAgo } } }),
  ]);

  const decided = confirmed + modified + rejected;
  const accuracyRate = decided > 0 ? Math.round((confirmed / decided) * 100) : 0;

  return { totalActions: total, confirmed, modified, rejected, accuracyRate };
}
