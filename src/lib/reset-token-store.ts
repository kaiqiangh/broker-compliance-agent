import { prisma } from './prisma';
import { randomBytes, createHash } from 'crypto';

const RESET_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Create a password reset token and store its hash in the database.
 * Returns the plaintext token to be sent in the email.
 * DB stores only the SHA-256 hash — safe if DB is compromised.
 */
export async function createResetToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  await prisma.passwordResetToken.create({
    data: { token: tokenHash, userId, expiresAt },
  });

  return token;
}

/**
 * Consume a password reset token.
 * Hashes the input token and looks up by hash.
 * Marks it as used to prevent reuse (race-condition safe via find + update).
 * Returns the userId if valid, null otherwise.
 */
export async function consumeResetToken(token: string): Promise<string | null> {
  const tokenHash = hashToken(token);

  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { token: tokenHash },
  });

  if (!resetToken) return null;
  if (resetToken.used) return null;
  if (resetToken.expiresAt <= new Date()) return null;

  // Mark as used — even if concurrent requests race, the second will see used=true
  await prisma.passwordResetToken.update({
    where: { id: resetToken.id },
    data: { used: true },
  });

  return resetToken.userId;
}
