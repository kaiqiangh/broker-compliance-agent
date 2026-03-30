import pdfParse from 'pdf-parse';

/**
 * Extract text from an email attachment.
 * Supports: PDF (pdf-parse), DOCX (mammoth), Images OCR (tesseract.js), HTML/text.
 * Pure JS — no Python dependency.
 */
export async function extractAttachmentText(
  filename: string,
  contentType: string,
  buffer: Buffer
): Promise<string> {
  // Skip very small files (likely empty/corrupt)
  if (buffer.length < 10) return '';

  // Skip very large files (>10MB)
  if (buffer.length > 10 * 1024 * 1024) {
    console.warn(`[attachment-extractor] Skipping large file: ${filename} (${buffer.length} bytes)`);
    return '';
  }

  try {
    // PDF extraction
    if (contentType === 'application/pdf' || filename.endsWith('.pdf')) {
      try {
        const result = await pdfParse(buffer);
        return result.text || '';
      } catch {
        return '';
      }
    }

    // Word document extraction
    if (
      contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      filename.endsWith('.docx')
    ) {
      try {
        const mammoth = await import('mammoth');
        const result = await mammoth.extractRawText({ buffer });
        return result.value || '';
      } catch {
        return '';
      }
    }

    // Image OCR
    if (contentType.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|tiff|bmp)$/i.test(filename)) {
      return await ocrImage(buffer);
    }

    // HTML extraction
    if (contentType === 'text/html' || filename.endsWith('.html')) {
      return extractTextFromHtml(buffer.toString('utf-8'));
    }

    // Plain text / CSV / JSON / XML
    if (
      contentType.startsWith('text/') ||
      contentType === 'application/json' ||
      contentType === 'application/xml' ||
      /\.(txt|csv|json|xml)$/i.test(filename)
    ) {
      return buffer.toString('utf-8');
    }

    return '';
  } catch (err) {
    console.error(`[attachment-extractor] Failed to extract ${filename}:`, err);
    return '';
  }
}

/**
 * OCR an image buffer using tesseract.js.
 */
async function ocrImage(buffer: Buffer): Promise<string> {
  try {
    const Tesseract = await import('tesseract.js');
    const { data } = await Tesseract.recognize(buffer, 'eng', {
      logger: () => {}, // Suppress logs
    });
    return data.text || '';
  } catch (err) {
    console.error('[attachment-extractor] OCR failed:', err);
    return '';
  }
}

/**
 * Strip HTML tags for plain text extraction.
 */
function extractTextFromHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}
