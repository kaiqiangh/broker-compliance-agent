export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { DocumentService } from '@/services/document-service';
import { prisma } from '@/lib/prisma';

const documentService = new DocumentService();

export const POST = withAuth('complete_items', async (user, request) => {
  const body = await request.json();
  const { renewalId, documentType } = body;

  if (!renewalId || !documentType) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'renewalId and documentType required' } }, { status: 400 });
  }

  try {
    const result = await documentService.generate(
      user.firmId,
      renewalId,
      documentType,
      user.id
    );

    return NextResponse.json({
      data: {
        documentId: result.id,
        html: result.html,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 }
    );
  }
});

export const GET = withAuth('view_all', async (user, request) => {
  const url = new URL(request.url);
  const renewalId = url.searchParams.get('renewalId');

  const documents = await prisma.document.findMany({
    where: {
      firmId: user.firmId,
      ...(renewalId ? { renewalId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return NextResponse.json({ data: documents });
});
