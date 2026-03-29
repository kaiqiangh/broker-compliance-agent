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
    // Inspection pack — generates ZIP with multiple documents
    if (documentType === 'inspection_pack') {
      // Support filtered packs via body params
      const { dateFrom, dateTo, policyType, adviserId } = body;
      const hasFilters = dateFrom || dateTo || policyType || adviserId;

      if (hasFilters) {
        const pack = await inspectionPackService.generateFilteredPack(
          user.firmId,
          { dateFrom, dateTo, policyType, adviserId },
          user.id
        );
        return new Response(new Uint8Array(pack.buffer), {
          headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="${pack.fileName}"`,
          },
        });
      }

      const pack = await inspectionPackService.generatePack(
        user.firmId,
        renewalId,
        user.id
      );

      return new Response(new Uint8Array(pack.buffer), {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${pack.fileName}"`,
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
