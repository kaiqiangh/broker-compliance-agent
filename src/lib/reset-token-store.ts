import { prisma } from './prisma';
import { randomBytes } from 'crypto';

const RESET_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Create a password reset token and store it in the database.
 * Returns the plaintext token to be sent in the email.
 */
export async function createResetToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  await prisma.passwordResetToken.create({
    data: { token, userId, expiresAt },
  });

  return token;
}

/**
 * Consume a password reset token.
 * Marks it as used to prevent reuse (race-condition safe via find + update).
 * Returns the userId if valid, null otherwise.
 */
export async function consumeResetToken(token: string): Promise<string | null> {
  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { token },
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
