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
 * Hashes the input token and atomically claims it.
 * Marks it as used to prevent reuse (race-condition safe via updateMany).
 * Returns the userId if valid, null otherwise.
 */
export async function consumeResetToken(token: string): Promise<string | null> {
  const tokenHash = hashToken(token);

  // Atomic claim: only mark as used if not already used and not expired.
  // Two concurrent requests: only one gets count=1, the other sees count=0.
  const claimed = await prisma.passwordResetToken.updateMany({
    where: {
      token: tokenHash,
      used: false,
      expiresAt: {
        gt: new Date(),
      },
    },
    data: { used: true },
  });

  if (claimed.count === 0) return null;

  // Now fetch to get the userId
  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { token: tokenHash },
  });

  return resetToken?.userId ?? null;
}
