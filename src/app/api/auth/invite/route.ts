export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth, createUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { EmailService } from '@/services/email-service';
import { z } from 'zod';

const InviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(255),
  role: z.enum(['compliance_officer', 'adviser', 'read_only']),
});

export const POST = withAuth('invite_users', async (user, request) => {
  const body = await request.json();
  const { email, name, role } = InviteSchema.parse(body);

  // Check if email already exists
  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) {
    return NextResponse.json({ error: { code: 'CONFLICT', message: 'User with this email already exists' } }, { status: 409 });
  }

  // Generate stronger temporary password (16 chars with mixed case + digits)
  const tempPassword = crypto.randomUUID().replace(/-/g, '').slice(0, 16)
    + String.fromCharCode(65 + Math.floor(Math.random() * 26)); // ensure at least one uppercase

  const newUser = await createUser({
    firmId: user.firmId,
    email,
    password: tempPassword,
    name,
    role,
  });

  // Send invite email
  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  const loginUrl = `${baseUrl}/login`;
  const emailService = new EmailService();

  // Look up firm name for the email
  const firm = await prisma.firm.findUnique({ where: { id: user.firmId }, select: { name: true } });

  await emailService.sendInviteEmail(email, name, {
    loginUrl,
    tempPassword,
    firmName: firm?.name || 'BrokerComply',
    invitedByName: user.name,
  });

  // Audit
  await prisma.auditEvent.create({
    data: {
      firmId: user.firmId,
      actorId: user.id,
      action: 'user.invited',
      entityType: 'user',
      entityId: newUser.id,
      metadata: { email, role, invitedBy: user.email },
    },
  });

  // Do NOT return tempPassword in the API response
  return NextResponse.json({
    user: { id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role },
    message: 'Invitation sent. User will receive login instructions via email.',
  });
});
