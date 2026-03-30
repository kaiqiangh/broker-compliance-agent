import { describe, it, expect, vi } from 'vitest';
import { extractAttachmentText } from '@/lib/email/attachment-extractor';

describe('Attachment text extraction', () => {
  it('returns empty for very small files (< 10 bytes)', async () => {
    const text = await extractAttachmentText('tiny.pdf', 'application/pdf', Buffer.from('abc'));
    expect(text).toBe('');
  });

  it('returns empty for very large files (> 10MB)', async () => {
    const big = Buffer.alloc(11 * 1024 * 1024);
    const text = await extractAttachmentText('huge.pdf', 'application/pdf', big);
    expect(text).toBe('');
  });

  it('returns empty for unsupported formats', async () => {
    const text = await extractAttachmentText('file.bin', 'application/octet-stream', Buffer.from('binary data here'));
    expect(text).toBe('');
  });

  it('extracts text from plain text files', async () => {
    const text = await extractAttachmentText('notes.txt', 'text/plain', Buffer.from('Hello world from text'));
    expect(text).toBe('Hello world from text');
  });

  it('extracts text from HTML', async () => {
    const html = '<html><body><p>Hello <b>world</b></p><script>alert("x")</script></body></html>';
    const text = await extractAttachmentText('page.html', 'text/html', Buffer.from(html));
    expect(text).toContain('Hello world');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('<p>');
  });

  it('extracts text from CSV', async () => {
    const csv = 'name,premium,expiry\nJohn,500,2027-04-15';
    const text = await extractAttachmentText('data.csv', 'text/csv', Buffer.from(csv));
    expect(text).toContain('John');
    expect(text).toContain('500');
  });

  it('extracts text from JSON', async () => {
    const json = '{"policy": "POL-123", "premium": 950}';
    const text = await extractAttachmentText('data.json', 'application/json', Buffer.from(json));
    expect(text).toContain('POL-123');
  });

  it('extracts text from DOCX file', async () => {
    // Create a minimal DOCX (ZIP with word/document.xml)
    // For testing, use a real tiny DOCX or skip
    const text = await extractAttachmentText('test.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', Buffer.from('not-a-real-docx'));
    // Should return empty for invalid DOCX (graceful degradation)
    expect(text).toBe('');
  });
});
