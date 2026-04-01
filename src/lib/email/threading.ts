interface ResolveThreadIdInput {
  messageId: string;
  inReplyTo?: string | null;
  references?: string[] | null;
}

function normalizeHeaderValue(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().replace(/^<|>$/g, '');
  return normalized.length > 0 ? normalized : null;
}

export function resolveThreadId(input: ResolveThreadIdInput): string {
  const rootReference = input.references
    ?.map(normalizeHeaderValue)
    .find((reference): reference is string => Boolean(reference));

  return (
    rootReference ||
    normalizeHeaderValue(input.inReplyTo) ||
    normalizeHeaderValue(input.messageId) ||
    input.messageId
  );
}
