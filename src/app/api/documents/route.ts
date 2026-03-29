export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { DocumentService } from '@/services/document-service';
import { InspectionPackService } from '@/services/inspection-pack-service';
import { htmlToPdf } from '@/lib/pdf';
import { prisma } from '@/lib/prisma';

const documentService = new DocumentService();
const inspectionPackService = new InspectionPackService();

export const POST = withAuth('complete_items', async (user, request) => {
  const body = await request.json();
  const { renewalId, documentType, format, cpcVersion } = body;

  if (!renewalId || !documentType) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'renewalId and documentType required' } }, { status: 400 });
  }

  try {
    // Inspection pack — queue async generation (Puppeteer PDF is slow)
    if (documentType === 'inspection_pack') {
      const doc = await prisma.document.create({
        data: {
          firmId: user.firmId,
          renewalId,
          documentType: 'inspection_pack',
          fileUrl: '',
          generatedBy: user.id,
          status: 'pending',
        },
      });

      await prisma.scheduledJob.create({
        data: {
          jobType: 'generate_inspection_pack',
          payload: {
            firmId: user.firmId,
            renewalId,
            documentId: doc.id,
            generatedBy: user.id,
            dateFrom: body.dateFrom || null,
            dateTo: body.dateTo || null,
            policyType: body.policyType || null,
            adviserId: body.adviserId || null,
          },
          scheduledFor: new Date(),
        },
      });

      return NextResponse.json({
        data: {
          documentId: doc.id,
          status: 'pending',
          message: 'Inspection pack generation queued. Poll /api/documents?documentId=' + doc.id + ' for status.',
        },
      });
    }

    const result = await documentService.generate(
      user.firmId,
      renewalId,
      documentType,
      user.id,
      cpcVersion || '2012'
    );

    // PDF output
    if (format === 'pdf') {
      const pdfBuffer = await htmlToPdf(result.html);
      return new Response(new Uint8Array(pdfBuffer), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${documentType}-${renewalId.slice(0, 8)}.pdf"`,
        },
      });
    }

    // HTML output (default)
    return NextResponse.json({
      data: {
        documentId: result.id,
        html: result.html,
      },
    });
  } catch (err) {
    console.error('Document generation error:', err);
    return NextResponse.json(
      { error: { code: 'GENERATION_FAILED', message: 'Failed to generate document' } },
      { status: 400 }
    );
  }
});

export const GET = withAuth('view_all', async (user, request) => {
  const url = new URL(request.url);
  const renewalId = url.searchParams.get('renewalId');
  const documentId = url.searchParams.get('documentId');

  // Single document poll (for async generation status)
  if (documentId) {
    const doc = await prisma.document.findFirst({
      where: { id: documentId, firmId: user.firmId },
    });
    if (!doc) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Document not found' } }, { status: 404 });
    }
    return NextResponse.json({ data: doc });
  }

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
