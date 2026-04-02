export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createResetToken } from '@/lib/reset-token-store';
import { checkRateLimit } from '@/lib/rate-limit';
import { EmailService } from '@/services/email-service';
import { z } from 'zod';

const ForgotPasswordSchema = z.object({
  email: z.string().email(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email } = ForgotPasswordSchema.parse(body);

    // Rate limit by IP: 3 requests per minute
    const forwarded = request.headers.get('x-forwarded-for');
    const ip = forwarded?.split(',')[0]?.trim() || 'unknown';
    const ipLimit = await checkRateLimit(`forgot-password:ip:${ip}`, 3, 60_000);
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' } },
        { status: 429, headers: { 'Retry-After': String(ipLimit.retryAfter || 60) } }
      );
    }

    // Rate limit by email: 3 requests per hour
    const emailLimit = await checkRateLimit(`forgot-password:email:${email.toLowerCase()}`, 3, 3_600_000);
    if (!emailLimit.allowed) {
      return NextResponse.json(
        { error: { code: 'RATE_LIMITED', message: 'Too many requests for this email. Try again later.' } },
        { status: 429, headers: { 'Retry-After': String(emailLimit.retryAfter || 3600) } }
      );
    }

    // Always return success to prevent user enumeration
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (user) {
      const token = await createResetToken(user.id);
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
  <p>Hi ${(user.name || '').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#x27;'}[c]||c))},</p>
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
