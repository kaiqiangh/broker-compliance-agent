export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

const UpdateClientSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  email: z.string().email().max(255).optional().or(z.literal('')),
  phone: z.string().max(50).optional().or(z.literal('')),
  address: z.string().max(2000).optional().or(z.literal('')),
});

// GET /api/clients/[id]
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withAuth('view_all', async (user) => {
    const client = await prisma.client.findFirst({
      where: { id, firmId: user.firmId },
      include: {
        policies: {
          orderBy: { expiryDate: 'asc' },
          include: {
            renewals: {
              orderBy: { dueDate: 'desc' },
              take: 1,
            },
          },
        },
        _count: { select: { policies: true } },
      },
    });

    if (!client) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Client not found' } }, { status: 404 });
    }

    return NextResponse.json({ data: client });
  })(request);
}

// PATCH /api/clients/[id]
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withAuth('import', async (user) => {
    try {
      const body = await request.json();
      const data = UpdateClientSchema.parse(body);

      const existing = await prisma.client.findFirst({
        where: { id, firmId: user.firmId },
      });

      if (!existing) {
        return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Client not found' } }, { status: 404 });
      }

      const updated = await prisma.client.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.email !== undefined ? { email: data.email || null } : {}),
          ...(data.phone !== undefined ? { phone: data.phone || null } : {}),
          ...(data.address !== undefined ? { address: data.address || null } : {}),
        },
      });

      await prisma.auditEvent.create({
        data: {
          firmId: user.firmId,
          actorId: user.id,
          action: 'client.updated',
          entityType: 'client',
          entityId: id,
          metadata: { changes: Object.keys(data) },
        },
      });

      return NextResponse.json({ data: updated });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input' } }, { status: 400 });
      }
      throw err;
    }
  })(request);
}

// DELETE /api/clients/[id]
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withAuth('admin', async (user) => {
    const client = await prisma.client.findFirst({
      where: { id, firmId: user.firmId },
    });

    if (!client) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Client not found' } }, { status: 404 });
    }

    // Check for active policies before deletion
    const policyCount = await prisma.policy.count({
      where: { clientId: id, firmId: user.firmId },
    });

    if (policyCount > 0) {
      return NextResponse.json({
        error: { code: 'CONFLICT', message: `Cannot delete client with ${policyCount} active policies. Anonymize via GDPR erasure instead.` },
      }, { status: 409 });
    }

    await prisma.client.delete({ where: { id } });

    await prisma.auditEvent.create({
      data: {
        firmId: user.firmId,
        actorId: user.id,
        action: 'client.deleted',
        entityType: 'client',
        entityId: id,
        metadata: { clientName: client.name },
      },
    });

    return NextResponse.json({ success: true });
  })(request);
}
