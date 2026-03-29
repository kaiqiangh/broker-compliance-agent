export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { readFile } from 'fs/promises';
import { resolve, sep } from 'path';

const UPLOADS_ROOT = resolve(process.cwd(), 'uploads');

/**
 * Authenticated file serving route.
 * Files in the uploads directory are only accessible if:
 * 1. User is authenticated
 * 2. The file path starts with the user's firmId (prevents cross-tenant access)
 * 3. The resolved canonical path is within the uploads root (prevents traversal)
 */
export const GET = withAuth('view_all', async (user, request) => {
  const url = new URL(request.url);
  const filePath = url.pathname.replace('/api/files/', '');

  if (!filePath) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'No file path provided' } }, { status: 400 });
  }

  // Security: ensure file path starts with user's firmId
  if (!filePath.startsWith(user.firmId + '/')) {
    return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Access denied' } }, { status: 403 });
  }

  // Prevent path traversal — resolve canonical path and verify it's within uploads root
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

    // Encode filename safely and use attachment to prevent browser execution
    const rawFilename = filePath.split('/').pop() || 'download';
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
