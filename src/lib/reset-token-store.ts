// In-memory reset token store (shared between forgot-password and reset-password routes)
// In production, replace with Redis or database-backed store.

export const resetTokens = new Map<string, { userId: string; expires: number }>();

const RESET_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

// Periodic cleanup of expired tokens
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of resetTokens) {
    if (entry.expires <= now) resetTokens.delete(token);
  }
}, CLEANUP_INTERVAL_MS).unref();

export function createResetToken(userId: string): string {
  const crypto = require('crypto');
  const token = crypto.randomBytes(32).toString('hex');
  resetTokens.set(token, {
    userId,
    expires: Date.now() + RESET_TOKEN_TTL_MS,
  });
  return token;
}

export function consumeResetToken(token: string): string | null {
  const entry = resetTokens.get(token);
  if (!entry) return null;
  if (entry.expires <= Date.now()) {
    resetTokens.delete(token);
    return null;
  }
  resetTokens.delete(token);
  return entry.userId;
}
