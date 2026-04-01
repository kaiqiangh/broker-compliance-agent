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
    // PDF extraction with OCR fallback for scanned PDFs
    if (contentType === 'application/pdf' || filename.endsWith('.pdf')) {
      try {
        const result = await pdfParse(buffer);
        const text = result.text || '';
        // If very little text extracted, likely a scanned PDF — fall back to OCR
        if (text.trim().length < 50) {
          return await ocrPdfPages(buffer);
        }
        return text;
      } catch {
        // pdf-parse failed (possibly corrupt or scanned), try OCR fallback
        return await ocrPdfPages(buffer);
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
 * Convert PDF pages to images via pdf2pic, then OCR each page with tesseract.js.
 */
async function ocrPdfPages(buffer: Buffer): Promise<string> {
  try {
    const { fromBuffer } = await import('pdf2pic');
    const convert = fromBuffer(buffer, {
      density: 200,
      saveFilename: 'page',
      format: 'png',
      width: 2000,
      height: 2800,
    });

    // pdf-parse may return numPages; try to get page count, fallback to 5
    let pageCount = 5;
    try {
      const pdfParse = (await import('pdf-parse')).default;
      const meta = await pdfParse(buffer, { max: 0 });
      if (meta.numpages) pageCount = meta.numpages;
    } catch {
      // keep default
    }

    const texts: string[] = [];
    for (let i = 1; i <= pageCount; i++) {
      try {
        const page = await convert(i);
        const pageBase64 = (page as { base64?: string }).base64;
        if (pageBase64) {
          const imgBuffer = Buffer.from(pageBase64, 'base64');
          const pageText = await ocrImage(imgBuffer);
          if (pageText.trim()) texts.push(pageText.trim());
        }
      } catch {
        // page conversion failed, skip
      }
    }
    return texts.join('\n\n');
  } catch (err) {
    console.error('[attachment-extractor] PDF OCR fallback failed:', err);
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
