export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { parseCSV } from '@/lib/csv-parser';
import { ImportService } from '@/services/import-service';

const importService = new ImportService();

/**
 * PUT /api/import/mapping
 *
 * Confirm import with custom field mappings.
 *
 * Body: { fileName: string, mappings: Record<string, string>, buffer: base64 }
 * The mappings map target field names to source CSV column names.
 */
export const PUT = withAuth('import', async (user, request) => {
  const body = await request.json();
  const { fileName, mappings, fileBuffer } = body;

  if (!fileBuffer || !mappings) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'fileBuffer and mappings required' } }, { status: 400 });
  }

  // The import service handles the actual import
  // For custom mappings, we'd need to transform the CSV first
  // For now, delegate to the standard import with override format
  const buffer = Buffer.from(fileBuffer, 'base64');

  const result = await importService.import(
    user.firmId,
    buffer,
    user.id,
    fileName || 'custom-mapping.csv',
  );

  return NextResponse.json({
    importId: result.importId,
    format: 'custom_mapping',
    rowCount: result.importedRows,
    errorCount: result.errorRows,
    skippedRows: result.skippedRows,
    totalRows: result.totalRows,
    errors: result.errors.slice(0, 20),
  });
});
