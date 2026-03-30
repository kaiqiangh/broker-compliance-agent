import pdfParse from 'pdf-parse';

export async function extractAttachmentText(
  buffer: Buffer,
  contentType: string
): Promise<string> {
  try {
    if (contentType === 'application/pdf') {
      const result = await (pdfParse as any)(buffer);
      return result.text || '';
    }

    // Phase 1: No OCR for images yet
    if (contentType.startsWith('image/')) {
      return '';
    }

    // Office docs
    if (
      contentType.includes('word') ||
      contentType.includes('document') ||
      contentType.includes('officedocument')
    ) {
      return '';
    }

    // Unsupported type
    return '';
  } catch {
    return '';
  }
}
