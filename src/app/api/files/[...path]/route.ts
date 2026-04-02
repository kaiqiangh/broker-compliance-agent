export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { getStorage } from '@/lib/storage';
import { readFile } from 'fs/promises';
import { resolve, sep } from 'path';
import { prisma } from '@/lib/prisma';

const UPLOADS_ROOT = resolve(process.cwd(), 'uploads');

/**
 * Authenticated file serving route.
 * - Cloud storage: redirects to the public/presigned URL
 * - Local storage: reads from disk and returns the file
 * In both cases, the user must be authenticated and the file path must start
 * with the user's firmId (prevents cross-tenant access).
 */
export const GET = withAuth(null, async (user, request) => {
  const url = new URL(request.url);
  const filePath = url.pathname.replace('/api/files/', '');

  if (!filePath) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'No file path provided' } }, { status: 400 });
  }

  // Security: ensure file path starts with user's firmId (segment-based, not prefix)
  const firstSegment = filePath.split('/')[0];
  if (firstSegment !== user.firmId) {
    return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Access denied' } }, { status: 403 });
  }

  const storage = getStorage();

  // Encode filename safely for audit
  const rawFilename = filePath.split('/').pop() || 'download';

  // Log document download audit event
  await prisma.auditEvent.create({
    data: {
      firmId: user.firmId,
      actorId: user.id,
      action: 'document.downloaded',
      entityType: 'document',
      entityId: filePath,
      metadata: { fileName: rawFilename },
    },
  });

  // Cloud storage: redirect to public URL
  if (storage.isCloud()) {
    const cloudUrl = storage.getUrl(filePath);
    return NextResponse.redirect(cloudUrl);
  }

  // Local storage: read from disk
  const fullPath = resolve(UPLOADS_ROOT, filePath);
  if (!fullPath.startsWith(UPLOADS_ROOT + sep)) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid path' } }, { status: 400 });
  }

  try {
    const fileBuffer = await readFile(fullPath);

    // Determine content type from extension
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    const contentTypes: Record<string, string> = {
      pdf: 'application/pdf',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      txt: 'text/plain',
      csv: 'text/csv',
    };
    const contentType = contentTypes[ext] || 'application/octet-stream';

    // Use attachment to prevent browser execution
    const safeFilename = encodeURIComponent(rawFilename);

    return new Response(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename*=UTF-8''${safeFilename}`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (err) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'File not found' } }, { status: 404 });
  }
});
