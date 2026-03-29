export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { ImportService } from '@/services/import-service';

const importService = new ImportService();

/**
 * PUT /api/import/confirm
 *
 * Import with custom field mappings. Transforms CSV using the user-provided
 * column mapping, then imports the transformed data.
 *
 * Body: {
 *   fileName: string,
 *   mappings: Record<string, string>,  // targetField → sourceColumnName
 *   fileBuffer: string (base64)
 * }
 */
export const PUT = withAuth('import', async (user, request) => {
  const body = await request.json();
  const { fileName, mappings, fileBuffer } = body;

  if (!fileBuffer || !mappings) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'fileBuffer and mappings required' } }, { status: 400 });
  }

  // Body size limit: max ~2.7MB base64 string ≈ 2MB decoded
  const MAX_BASE64_LENGTH = Math.ceil(2 * 1024 * 1024 * 4 / 3); // ~2.8MB for 2MB decoded
  if (fileBuffer.length > MAX_BASE64_LENGTH) {
    return NextResponse.json(
      { error: { code: 'PAYLOAD_TOO_LARGE', message: `File too large. Maximum decoded size is 2MB (got base64 length ${fileBuffer.length})` } },
      { status: 413 }
    );
  }

  const rawBuffer = Buffer.from(fileBuffer, 'base64');
  const raw = rawBuffer.toString('utf-8');

  // Parse the raw CSV to get headers and rows
  const lines = raw.split('\n').filter(l => l.trim());
  if (lines.length < 2) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'CSV must have header + at least one data row' } }, { status: 400 });
  }

  const rawHeaders = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));

  // Target headers in canonical order
  const targetHeaders = [
    'PolicyRef', 'ClientName', 'ClientAddress', 'PolicyType',
    'InsurerName', 'InceptionDate', 'ExpiryDate', 'Premium',
    'Commission', 'NCB', 'VehicleReg', 'CoverType', 'Status',
  ];

  // Build column index map: source column index → target column index
  const sourceToTarget: Record<number, number> = {};
  for (const [targetField, sourceCol] of Object.entries(mappings as Record<string, string>)) {
    const sourceIdx = rawHeaders.findIndex(h => h === sourceCol);
    const targetIdx = targetHeaders.findIndex(h =>
      h.toLowerCase() === targetField ||
      h.toLowerCase() === targetField.toLowerCase()
    );
    if (sourceIdx >= 0 && targetIdx >= 0) {
      sourceToTarget[sourceIdx] = targetIdx;
    }
  }

  // Transform each row
  const transformedRows = [targetHeaders.join(',')];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
    const newRow = new Array(targetHeaders.length).fill('');
    for (const [srcIdx, tgtIdx] of Object.entries(sourceToTarget)) {
      newRow[tgtIdx] = values[parseInt(srcIdx)] || '';
    }
    transformedRows.push(newRow.join(','));
  }

  const transformedCsv = transformedRows.join('\n');
  const transformedBuffer = Buffer.from(transformedCsv, 'utf-8');

  const result = await importService.import(
    user.firmId,
    transformedBuffer,
    user.id,
    fileName || 'custom-mapping.csv',
  );

  return NextResponse.json({
    importId: result.importId,
    format: 'custom_mapping',
    mappingsApplied: Object.keys(mappings).length,
    rowCount: result.importedRows,
    errorCount: result.errorRows,
    skippedRows: result.skippedRows,
    totalRows: result.totalRows,
    errors: result.errors.slice(0, 20),
  });
});
