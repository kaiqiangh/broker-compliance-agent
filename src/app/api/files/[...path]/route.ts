export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { readFile } from 'fs/promises';
import { join } from 'path';

/**
 * Authenticated file serving route.
 * Files in the uploads directory are only accessible if:
 * 1. User is authenticated
 * 2. The file path starts with the user's firmId (prevents cross-tenant access)
 */
export const GET = withAuth('view_all', async (user, request) => {
  const url = new URL(request.url);
  // Extract path from URL: /api/files/firmId/checklistItemId/hash-name → firmId/checklistItemId/hash-name
  const filePath = url.pathname.replace('/api/files/', '');

  if (!filePath) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'No file path provided' } }, { status: 400 });
  }

  // Security: ensure file path starts with user's firmId
  if (!filePath.startsWith(user.firmId + '/')) {
    return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Access denied' } }, { status: 403 });
  }

  // Prevent path traversal
  const normalizedPath = filePath.replace(/\.\./g, '');
  if (normalizedPath !== filePath) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid path' } }, { status: 400 });
  }

  try {
    const fullPath = join(process.cwd(), 'uploads', normalizedPath);
    const fileBuffer = await readFile(fullPath);

    // Determine content type from extension
    const ext = normalizedPath.split('.').pop()?.toLowerCase() || '';
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

    return new Response(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${normalizedPath.split('/').pop()}"`,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (err) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'File not found' } }, { status: 404 });
  }
});
