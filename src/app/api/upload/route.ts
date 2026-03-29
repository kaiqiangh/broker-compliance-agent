export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getStorage, buildStoragePath } from '@/lib/storage';
import path from 'path';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'text/plain',
  'text/csv',
  'application/vnd.ms-excel',
];

/**
 * Validate file content against known magic bytes.
 * Returns true if the file header matches the expected signature for its MIME type.
 */
async function validateMagicBytes(file: File, buffer: Buffer): Promise<{ valid: boolean; reason?: string }> {
  if (buffer.length < 4) {
    return { valid: false, reason: 'File is too small to validate' };
  }

  const header = buffer.subarray(0, 16);

  switch (file.type) {
    case 'application/pdf': {
      // PDF: %PDF (25 50 44 46)
      const sig = Buffer.from([0x25, 0x50, 0x44, 0x46]);
      if (!header.subarray(0, 4).equals(sig)) {
        return { valid: false, reason: 'PDF magic bytes mismatch' };
      }
      break;
    }
    case 'image/png': {
      // PNG: 89 50 4E 47 0D 0A 1A 0A
      const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      if (!header.subarray(0, 8).equals(sig)) {
        return { valid: false, reason: 'PNG magic bytes mismatch' };
      }
      break;
    }
    case 'image/jpeg': {
      // JPEG: FF D8 FF
      const sig = Buffer.from([0xFF, 0xD8, 0xFF]);
      if (!header.subarray(0, 3).equals(sig)) {
        return { valid: false, reason: 'JPEG magic bytes mismatch' };
      }
      break;
    }
    case 'image/gif': {
      // GIF: GIF87a or GIF89a
      const gif87 = Buffer.from('GIF87a');
      const gif89 = Buffer.from('GIF89a');
      if (!header.subarray(0, 6).equals(gif87) && !header.subarray(0, 6).equals(gif89)) {
        return { valid: false, reason: 'GIF magic bytes mismatch' };
      }
      break;
    }
    case 'text/plain':
    case 'text/csv':
    case 'application/vnd.ms-excel': {
      // CSV/text: reject if first 16 bytes contain null bytes (binary content)
      for (let i = 0; i < Math.min(header.length, buffer.length); i++) {
        if (header[i] === 0x00) {
          return { valid: false, reason: 'Text/CSV file contains binary data' };
        }
      }
      break;
    }
  }

  return { valid: true };
}

/**
 * Sanitize and validate a user-supplied filename.
 * - Uses path.basename() to strip any directory components
 * - Replaces remaining unsafe characters with underscores
 * - Rejects filenames that resolve to empty or contain '..'
 */
function sanitizeFileName(rawName: string): string {
  // Strip any path components (handles both / and \)
  const base = path.basename(rawName);
  // Replace any character that isn't alphanumeric, dot, hyphen, or underscore
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  // Reject if result is empty, starts with dot (hidden file), or contains '..'
  if (!safe || safe.startsWith('.') || safe.includes('..')) {
    return 'unnamed_file';
  }
  return safe;
}

export const POST = withAuth('complete_items', async (user, request) => {
  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const checklistItemId = formData.get('checklistItemId') as string | null;

  if (!file) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'No file provided' } }, { status: 400 });
  }

  if (!checklistItemId) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Missing checklistItemId' } }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'File too large. Max 10MB.' } }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'File type not allowed' } }, { status: 400 });
  }

  // Magic bytes validation (second layer beyond MIME type)
  const buffer = Buffer.from(await file.arrayBuffer());
  const magicCheck = await validateMagicBytes(file, buffer);
  if (!magicCheck.valid) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: magicCheck.reason ?? 'File content does not match declared type' } }, { status: 400 });
  }

  // Verify checklist item belongs to user's firm
  const item = await prisma.checklistItem.findFirst({
    where: { id: checklistItemId, firmId: user.firmId },
  });

  if (!item) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Checklist item not found' } }, { status: 404 });
  }

  // Store file
  const fileHash = Buffer.from(
    await crypto.subtle.digest('SHA-256', buffer)
  ).toString('hex').slice(0, 16);

  const safeName = sanitizeFileName(file.name);
  const storagePath = buildStoragePath(user.firmId, checklistItemId, `${fileHash}-${safeName}`);

  const storage = getStorage();
  const fileUrl = await storage.upload(storagePath, buffer, file.type);

  // Update checklist item with evidence URL
  await prisma.checklistItem.update({
    where: { id: checklistItemId },
    data: { evidenceUrl: fileUrl },
  });

  // Audit
  await prisma.auditEvent.create({
    data: {
      firmId: user.firmId,
      actorId: user.id,
      action: 'evidence.uploaded',
      entityType: 'checklist_item',
      entityId: checklistItemId,
      metadata: {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        fileUrl,
      },
    },
  });

  return NextResponse.json({
    data: {
      fileUrl,
      fileName: file.name,
      fileSize: file.size,
    },
  });
});
