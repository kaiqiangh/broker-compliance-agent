import { NextResponse } from 'next/server';
import { parseCSV } from '@/lib/csv-parser';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File too large. Max 10MB.' }, { status: 400 });
    }

    if (!file.name.endsWith('.csv') && !file.name.endsWith('.tsv')) {
      return NextResponse.json({ error: 'Only CSV/TSV files accepted' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = parseCSV(buffer);

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
      { error: `Parse error: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
