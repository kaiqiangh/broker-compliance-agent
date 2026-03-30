import OpenAI from 'openai';

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
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

  return response.choices[0]?.message?.content || '';
}

export async function callLLMJson<T = any>(prompt: string, options: LLMOptions = {}): Promise<T> {
  const content = await callLLM(prompt, {
    ...options,
    responseFormat: { type: 'json_object' },
  });
  return JSON.parse(content);
}
