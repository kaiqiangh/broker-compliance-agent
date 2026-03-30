import OpenAI from 'openai';

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    client = new OpenAI({
      apiKey,
      timeout: 30_000, // 30 second timeout
    });
  }
  return client;
}

interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: { type: 'json_object' };
}

export async function callLLM(prompt: string, options: LLMOptions = {}): Promise<string> {
  const openai = getClient();
  const model = options.model || 'gpt-4o-mini';

  const response = await openai.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: options.temperature ?? 0,
    max_tokens: options.maxTokens ?? 500,
    ...(options.responseFormat && { response_format: options.responseFormat }),
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('LLM returned empty response');
  }
  return content;
}

export async function callLLMJson<T = Record<string, any>>(
  prompt: string,
  options: LLMOptions = {}
): Promise<T> {
  return callLLMWithRetry(async () => {
    const content = await callLLM(prompt, {
      ...options,
      responseFormat: { type: 'json_object' },
    });

    try {
      const parsed = JSON.parse(content);
      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('LLM response is not an object');
      }
      return parsed as T;
    } catch (err) {
      throw new Error(`LLM returned invalid JSON: ${content.slice(0, 200)}`);
    }
  });
}

/**
 * Retry wrapper for transient LLM failures (429, 500, 503, timeout).
 */
export async function callLLMWithRetry<T = string>(
  fn: () => Promise<T>,
  maxRetries = 2
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRetryable =
        err instanceof Error &&
        (err.message.includes('429') ||
          err.message.includes('500') ||
          err.message.includes('503') ||
          err.message.includes('timeout') ||
          err.message.includes('ECONNRESET'));

      if (!isRetryable || attempt === maxRetries) {
        throw err;
      }

      // Exponential backoff: 1s, 2s, 4s
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Unreachable');
}
