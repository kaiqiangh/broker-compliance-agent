import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock OpenAI
const mockCreate = vi.fn();
vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: mockCreate,
      },
    };
  },
}));

describe('callLLMJson retry behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module to clear singleton client
    vi.resetModules();
  });

  it('retries on 429 and succeeds on second attempt', async () => {
    // First call throws 429
    mockCreate
      .mockRejectedValueOnce(new Error('429 Rate limit'))
      .mockResolvedValueOnce({
        choices: [{ message: { content: '{"result": "success"}' } }],
      });

    const { callLLMJson } = await import('@/lib/agent/llm');
    const result = await callLLMJson('test prompt');

    expect(result).toEqual({ result: 'success' });
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('retries on 503 and succeeds', async () => {
    mockCreate
      .mockRejectedValueOnce(new Error('503 Service unavailable'))
      .mockResolvedValueOnce({
        choices: [{ message: { content: '{"ok": true}' } }],
      });

    const { callLLMJson } = await import('@/lib/agent/llm');
    const result = await callLLMJson('test prompt');

    expect(result).toEqual({ ok: true });
  });

  it('throws after max retries exhausted', async () => {
    mockCreate.mockRejectedValue(new Error('503 Service unavailable'));

    const { callLLMJson } = await import('@/lib/agent/llm');

    await expect(callLLMJson('test prompt')).rejects.toThrow(/503/);
    // Initial + 2 retries = 3 calls
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });

  it('does not retry on non-retryable errors (400)', async () => {
    mockCreate.mockRejectedValue(new Error('400 Bad request'));

    const { callLLMJson } = await import('@/lib/agent/llm');

    await expect(callLLMJson('test prompt')).rejects.toThrow(/400/);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});
