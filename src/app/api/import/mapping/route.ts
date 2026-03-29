export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { parseCSV } from '@/lib/csv-parser';

/**
 * Standard field names the platform expects.
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
 * GET /api/import/mapping
 * Returns the firm's saved import mapping (if any) plus target field definitions.
 */
export const GET = withAuth('import', async (user) => {
  const firm = await prisma.firm.findUnique({
    where: { id: user.firmId },
    select: { importMapping: true },
  });

  return NextResponse.json({
    targetFields: TARGET_FIELDS,
    savedMapping: firm?.importMapping ?? null,
  });
});

/**
 * POST /api/import/mapping
 *
 * Two modes:
 * 1. With file (multipart): analyze CSV → return headers + suggestions + preview
 * 2. With JSON body { mapping: {...} }: save mapping config to firm
 */
export const POST = withAuth('import', async (user, request) => {
  const contentType = request.headers.get('content-type') || '';

  // Mode 2: JSON body — save mapping
  if (contentType.includes('application/json')) {
    const body = await request.json();
    const mapping = body.mapping;

    if (!mapping || typeof mapping !== 'object') {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid mapping object' } },
        { status: 400 }
      );
    }

    await prisma.firm.update({
      where: { id: user.firmId },
      data: { importMapping: mapping },
    });

    return NextResponse.json({ success: true, mapping });
  }

  // Mode 1: File upload — analyze and suggest
  const formData = await request.formData();
  const file = formData.get('file') as File | null;

  if (!file) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'No file provided' } },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Try auto-detection first
  const autoResult = parseCSV(buffer);

  // Get headers from parsed result (handles delimiters, BOM, quoting)
  const headers = autoResult.headers;

  // Auto-suggest mappings based on fuzzy matching
  const suggestedMappings: Record<string, string | null> = {};
  for (const [targetField, config] of Object.entries(TARGET_FIELDS)) {
    const match = headers.find(h =>
      config.examples.some(ex => h.toLowerCase().includes(ex.toLowerCase())) ||
      h.toLowerCase().includes(targetField.toLowerCase())
    );
    suggestedMappings[targetField] = match || null;
  }

  // Also load any previously saved mapping for this firm
  const firm = await prisma.firm.findUnique({
    where: { id: user.firmId },
    select: { importMapping: true },
  });

  return NextResponse.json({
    headers,
    targetFields: TARGET_FIELDS,
    suggestedMappings,
    savedMapping: firm?.importMapping ?? null,
    autoDetectedFormat: autoResult.format,
    autoDetectedConfidence: autoResult.confidence,
    autoParseResult: autoResult.format !== 'unknown' ? {
      rowCount: autoResult.policies.length,
      errorCount: autoResult.errors.length,
      errors: autoResult.errors.slice(0, 10),
    } : null,
    preview: autoResult.policies.slice(0, 5).map(p => ({ ...p })),
  });
});
