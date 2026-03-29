export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { parseCSV } from '@/lib/csv-parser';
import { ImportService } from '@/services/import-service';

const importService = new ImportService();

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
const MAX_ROWS = 10000;

// CSV injection prevention
function sanitizeCsvCell(value: string): string {
  if (!value) return value;
  const first = value.trim()[0];
  if (first === '=' || first === '+' || first === '-' || first === '@' || first === '\t' || first === '\r') {
    return "'" + value;
  }
  return value;
}

export const POST = withAuth('import', async (user, request) => {
  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const confirm = formData.get('confirm') === 'true';

  if (!file) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'No file provided' } }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'File too large. Max 2MB.' } }, { status: 400 });
  }

  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext !== 'csv' && ext !== 'tsv') {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Only CSV/TSV files accepted' } }, { status: 400 });
  }

  // Check MIME type
  const allowedMimes = ['text/csv', 'text/plain', 'text/tab-separated-values', 'application/vnd.ms-excel'];
  if (file.type && !allowedMimes.includes(file.type)) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid file type' } }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Validate content starts with printable ASCII (not binary)
  const first100 = buffer.slice(0, 100).toString('ascii');
  if (!/^[\x20-\x7E\r\n\t,;"]/.test(first100)) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'File does not appear to be CSV content' } }, { status: 400 });
  }

  if (confirm) {
    // ACTUAL IMPORT: persist to database via ImportService
    const result = await importService.import(
      user.firmId,
      buffer,
      user.id,
      file.name
    );

    return NextResponse.json({
      importId: result.importId,
      format: result.format,
      confidence: result.confidence,
      rowCount: result.importedRows,
      errorCount: result.errorRows,
      skippedRows: result.skippedRows,
      needsReviewRows: result.needsReviewRows,
      totalRows: result.totalRows,
      errors: result.errors.slice(0, 20),
    });
  }

  // PREVIEW ONLY: parse and return without persisting
  const result = parseCSV(buffer);

  // Enforce row limit
  if (result.policies.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `Too many rows. Max ${MAX_ROWS}.` },
      { status: 400 }
    );
  }

  // Sanitize all string fields against CSV injection
  for (const policy of result.policies) {
    policy.clientName = sanitizeCsvCell(policy.clientName);
    policy.clientAddress = sanitizeCsvCell(policy.clientAddress);
    policy.policyNumber = sanitizeCsvCell(policy.policyNumber);
    policy.insurerName = sanitizeCsvCell(policy.insurerName);
  }

  return NextResponse.json({
    format: result.format,
    confidence: result.confidence,
    headers: result.headers,
    rowCount: result.policies.length,
    errorCount: result.errors.length,
    errors: result.errors.slice(0, 20),
    preview: result.policies.slice(0, 20),
  });
});
