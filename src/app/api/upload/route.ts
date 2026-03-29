import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

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

  // Verify checklist item belongs to user's firm
  const item = await prisma.checklistItem.findFirst({
    where: { id: checklistItemId, firmId: user.firmId },
  });

  if (!item) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Checklist item not found' } }, { status: 404 });
  }

  // Store file to disk (in production: upload to S3/R2)
  const buffer = Buffer.from(await file.arrayBuffer());
  const fileHash = Buffer.from(
    await crypto.subtle.digest('SHA-256', buffer)
  ).toString('hex').slice(0, 16);

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const fileName = `${user.firmId}/${checklistItemId}/${fileHash}-${safeName}`;
  const fileUrl = `uploads/${fileName}`;

  // Write to local filesystem (production: replace with S3/R2)
  const fs = await import('fs/promises');
  const path = await import('path');
  const uploadDir = path.join(process.cwd(), 'uploads', user.firmId, checklistItemId);
  await fs.mkdir(uploadDir, { recursive: true });
  await fs.writeFile(path.join(uploadDir, `${fileHash}-${safeName}`), buffer);

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
