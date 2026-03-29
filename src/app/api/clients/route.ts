export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

const CreateClientSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email().max(255).optional().or(z.literal('')),
  phone: z.string().max(50).optional().or(z.literal('')),
  address: z.string().max(2000).optional().or(z.literal('')),
});

export const GET = withAuth('view_all', async (user, request) => {
  const url = new URL(request.url);
  const search = url.searchParams.get('q') || '';

  const clients = await prisma.client.findMany({
    where: {
      firmId: user.firmId,
      ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
    },
    include: {
      _count: { select: { policies: true } },
    },
    orderBy: { name: 'asc' },
    take: 50,
  });

  return NextResponse.json({ data: clients });
});

export const POST = withAuth('import', async (user, request) => {
  try {
    const body = await request.json();
    const data = CreateClientSchema.parse(body);

    const client = await prisma.client.create({
      data: {
        firmId: user.firmId,
        name: data.name,
        email: data.email || null,
        phone: data.phone || null,
        address: data.address || null,
      },
    });

    return NextResponse.json({ data: client }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input' } }, { status: 400 });
    }
    throw err;
  }
});
