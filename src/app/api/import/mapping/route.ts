export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { parseCSV } from '@/lib/csv-parser';
import { ImportService } from '@/services/import-service';

const importService = new ImportService();

/**
 * Standard field names the platform expects.
 * Maps from canonical name → description.
 */
const TARGET_FIELDS: Record<string, { label: string; required: boolean; examples: string[] }> = {
  policyNumber: { label: 'Policy Number', required: true, examples: ['PolicyRef', 'PolicyNo', 'Policy #', 'Reference'] },
  clientName: { label: 'Client Name', required: true, examples: ['ClientName', 'InsuredName', 'Customer Name', 'Name'] },
  clientAddress: { label: 'Client Address', required: false, examples: ['ClientAddress', 'Address', 'AddressLine1'] },
  policyType: { label: 'Policy Type', required: false, examples: ['PolicyType', 'Class', 'Type', 'Category'] },
  insurerName: { label: 'Insurer Name', required: false, examples: ['InsurerName', 'Insurer', 'Company', 'Provider'] },
  inceptionDate: { label: 'Inception Date', required: true, examples: ['InceptionDate', 'EffectiveDate', 'StartDate', 'From'] },
  expiryDate: { label: 'Expiry Date', required: true, examples: ['ExpiryDate', 'ExpirationDate', 'EndDate', 'To', 'RenewalDate'] },
  premium: { label: 'Premium', required: true, examples: ['Premium', 'GrossPremium', 'Cost', 'Price', 'Annual'] },
  commission: { label: 'Commission Rate', required: false, examples: ['Commission', 'CommissionRate', 'Comm'] },
  ncb: { label: 'No Claims Bonus', required: false, examples: ['NCB', 'NCD', 'NoClaimsBonus'] },
  vehicleReg: { label: 'Vehicle Reg', required: false, examples: ['VehicleReg', 'Reg', 'Registration'] },
  coverType: { label: 'Cover Type', required: false, examples: ['CoverType', 'Cover', 'Level'] },
  status: { label: 'Policy Status', required: false, examples: ['Status', 'PolicyStatus', 'State'] },
};

/**
 * POST /api/import/mapping
 *
 * Given a CSV file, return the detected headers and allow the user
 * to manually map columns to target fields.
 *
 * Body: multipart/form-data with 'file' field
 * Response: { headers: string[], targetFields: Record, preview: Row[] }
 */
export const POST = withAuth('import', async (user, request) => {
  const formData = await request.formData();
  const file = formData.get('file') as File | null;

  if (!file) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'No file provided' } }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Try auto-detection first
  const autoResult = parseCSV(buffer);

  // Get raw headers from the file
  const raw = buffer.toString('utf-8');
  const firstLine = raw.split('\n')[0] || '';
  const headers = firstLine
    .replace(/^\uFEFF/, '') // BOM
    .split(',')
    .map(h => h.trim().replace(/^["']|["']$/g, ''));

  // Auto-suggest mappings based on fuzzy matching
  const suggestedMappings: Record<string, string | null> = {};
  for (const [targetField, config] of Object.entries(TARGET_FIELDS)) {
    const match = headers.find(h =>
      config.examples.some(ex => h.toLowerCase().includes(ex.toLowerCase())) ||
      h.toLowerCase().includes(targetField.toLowerCase())
    );
    suggestedMappings[targetField] = match || null;
  }

  // Parse first few rows for preview (raw, unmapped)
  const records = raw.split('\n').slice(1, 6).filter(l => l.trim());
  const preview = records.map(record => {
    const values = record.split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] || ''; });
    return row;
  });

  return NextResponse.json({
    headers,
    targetFields: TARGET_FIELDS,
    suggestedMappings,
    autoDetectedFormat: autoResult.format,
    autoDetectedConfidence: autoResult.confidence,
    autoParseResult: autoResult.format !== 'unknown' ? {
      rowCount: autoResult.policies.length,
      errorCount: autoResult.errors.length,
      errors: autoResult.errors.slice(0, 10),
    } : null,
    preview,
  });
});
