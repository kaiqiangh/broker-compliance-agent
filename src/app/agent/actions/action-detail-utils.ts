const REVERSIBLE_STATUSES = new Set(['confirmed', 'executed']);
const REVERSAL_WINDOW_MS = 24 * 60 * 60 * 1000;

export function canReverseAction(
  status: string,
  isReversed: boolean,
  executedAt?: string | Date | null,
  confirmedAt?: string | Date | null
): boolean {
  if (isReversed || !REVERSIBLE_STATUSES.has(status)) {
    return false;
  }

  const effectiveTimestamp = executedAt ?? confirmedAt;
  if (!effectiveTimestamp) {
    return true;
  }

  const effectiveAt = new Date(effectiveTimestamp);
  if (Number.isNaN(effectiveAt.getTime())) {
    return false;
  }

  return Date.now() - effectiveAt.getTime() <= REVERSAL_WINDOW_MS;
}
