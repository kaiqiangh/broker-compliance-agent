export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { EmailService } from '@/services/email-service';
import { z } from 'zod';
import crypto from 'crypto';

const ForgotPasswordSchema = z.object({
  email: z.string().email(),
});

// In-memory reset token store: token → { userId, expires }
const resetTokens = new Map<string, { userId: string; expires: number }>();
const RESET_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

// Periodic cleanup of expired tokens
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of resetTokens) {
    if (entry.expires <= now) resetTokens.delete(token);
  }
}, CLEANUP_INTERVAL_MS).unref();

export { resetTokens };

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email } = ForgotPasswordSchema.parse(body);

    // Always return success to prevent user enumeration
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      resetTokens.set(token, {
        userId: user.id,
        expires: Date.now() + RESET_TOKEN_TTL_MS,
      });

      const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
      const resetUrl = `${baseUrl}/reset-password?token=${token}`;

      const emailService = new EmailService();
      await emailService.send({
        to: user.email,
        subject: 'BrokerComply — Reset your password',
        html: `
<!DOCTYPE html>
<html>
<body style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #2563eb;">Reset your password</h2>
  <p>Hi ${user.name},</p>
  <p>We received a request to reset your BrokerComply password. Click the button below to set a new password. This link expires in 15 minutes.</p>
  <p><a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px;">Reset Password</a></p>
  <p>If you didn't request a password reset, you can safely ignore this email. Your password will not change.</p>
  <p style="color: #6b7280; font-size: 12px;">This is an automated message from BrokerComply.</p>
</body>
</html>`,
      });
    }

    return NextResponse.json({
      message: 'If an account with that email exists, a password reset link has been sent.',
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid input' } },
        { status: 400 }
      );
    }
    console.warn('Forgot-password error [redacted]:', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json(
      { error: { code: 'ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
