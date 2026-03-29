export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

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
  const body = await request.json();
  const { name, email, phone, address } = body;

  if (!name) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Name is required' } }, { status: 400 });
  }

  const client = await prisma.client.create({
    data: { firmId: user.firmId, name, email, phone, address },
  });

  return NextResponse.json({ data: client }, { status: 201 });
});
