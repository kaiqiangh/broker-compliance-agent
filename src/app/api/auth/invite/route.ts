import { NextResponse } from 'next/server';
import { withAuth, createUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
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
    return NextResponse.json({ error: 'User with this email already exists' }, { status: 409 });
  }

  // Generate temporary password (in production, send invite email)
  const tempPassword = crypto.randomUUID().slice(0, 12);

  const newUser = await createUser({
    firmId: user.firmId,
    email,
    password: tempPassword,
    name,
    role,
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

  return NextResponse.json({
    user: { id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role },
    tempPassword, // In production, send via email instead
  });
});
