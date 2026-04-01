export interface LearningInsight {
  field: string;
  commonMistake: string;
  suggestedFix: string;
  occurrences: number;
}

interface LearningResponse {
  insights?: LearningInsight[];
  data?: {
    insights?: LearningInsight[];
  };
}

export function extractLearningInsights(payload: LearningResponse | null | undefined): LearningInsight[] {
  const insights = payload?.data?.insights;
  return Array.isArray(insights) ? insights : [];
}
