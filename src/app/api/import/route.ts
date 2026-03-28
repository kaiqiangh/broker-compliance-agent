import { NextResponse } from 'next/server';
import { parseCSV } from '@/lib/csv-parser';

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB — CSVs are text, 2MB = ~50K rows
const MAX_ROWS = 10000;

// CSV injection prevention: strip leading formula characters
function sanitizeCsvCell(value: string): string {
  if (!value) return value;
  const first = value.trim()[0];
  if (first === '=' || first === '+' || first === '-' || first === '@' || first === '\t' || first === '\r') {
    return "'" + value;
  }
  return value;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File too large. Max 2MB.' }, { status: 400 });
    }

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'csv' && ext !== 'tsv') {
      return NextResponse.json({ error: 'Only CSV/TSV files accepted' }, { status: 400 });
    }

    // Check MIME type
    const allowedMimes = ['text/csv', 'text/plain', 'text/tab-separated-values', 'application/vnd.ms-excel'];
    if (file.type && !allowedMimes.includes(file.type)) {
      return NextResponse.json({ error: 'Invalid file type' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Validate content starts with printable ASCII (not binary)
    const first100 = buffer.slice(0, 100).toString('ascii');
    if (!/^[\x20-\x7E\r\n\t,;"]/.test(first100)) {
      return NextResponse.json({ error: 'File does not appear to be CSV content' }, { status: 400 });
    }

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
      preview: result.policies.slice(0, 10),
    });
  } catch (err) {
    console.error('Import parse error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
