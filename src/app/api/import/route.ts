import { NextResponse } from 'next/server';
import { parseCSV } from '@/lib/csv-parser';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = parseCSV(buffer);

    return NextResponse.json({
      format: result.format,
      confidence: result.confidence,
      headers: result.headers,
      rowCount: result.policies.length,
      errorCount: result.errors.length,
      errors: result.errors.slice(0, 20), // limit error response
      preview: result.policies.slice(0, 10), // first 10 for preview
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Parse error: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
