import { describe, expect, it } from 'vitest';
import { extractLearningInsights } from '@/app/agent/metrics/learning-response';

describe('extractLearningInsights', () => {
  it('reads nested insights from the learning API response shape', () => {
    expect(
      extractLearningInsights({
        data: {
          insights: [
            {
              field: 'policyNumber',
              commonMistake: 'POL-12',
              suggestedFix: 'POL-123',
              occurrences: 3,
            },
          ],
        },
      })
    ).toEqual([
      {
        field: 'policyNumber',
        commonMistake: 'POL-12',
        suggestedFix: 'POL-123',
        occurrences: 3,
      },
    ]);
  });

  it('returns an empty list for malformed payloads', () => {
    expect(extractLearningInsights({ insights: [] })).toEqual([]);
  });
});
