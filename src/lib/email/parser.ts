import { simpleParser, type ParsedMail } from 'mailparser';

export interface ParsedEmail {
  messageId: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  date: Date;
  bodyText: string;
  bodyHtml: string;
  attachments: ParsedAttachment[];
  inReplyTo?: string;
  references: string[];
  headers: Map<string, string>;
}

export interface ParsedAttachment {
  filename: string;
  contentType: string;
  size: number;
  content: Buffer;
  extractedText?: string;
}

export async function parseEmail(raw: Buffer): Promise<ParsedEmail> {
  let parsed: ParsedMail;
  try {
    parsed = await simpleParser(raw);
  } catch {
    // Malformed email - return minimal result
    return {
      messageId: crypto.randomUUID(),
      from: '',
      to: [],
      cc: [],
      subject: '',
      date: new Date(),
      bodyText: raw.toString('utf-8', 0, Math.min(raw.length, 10000)),
      bodyHtml: '',
      attachments: [],
      references: [],
      headers: new Map(),
    };
  }

  // Extract plain text body
  const bodyText = parsed.text || (parsed.html ? htmlToText(parsed.html) : '');

  // Parse attachments
  const attachments: ParsedAttachment[] = (parsed.attachments || []).map(att => ({
    filename: att.filename || 'unnamed',
    contentType: att.contentType || 'application/octet-stream',
    size: att.size,
    content: att.content,
  }));

  // Extract references
  const references: string[] = [];
  if (parsed.references) {
    if (Array.isArray(parsed.references)) {
      references.push(...parsed.references.map(stripAngleBrackets));
    } else if (typeof parsed.references === 'string') {
      references.push(stripAngleBrackets(parsed.references));
    }
  }

  // Build headers map
  const headers = new Map<string, string>();
  if (parsed.headers) {
    for (const [key, value] of parsed.headers) {
      headers.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
  }

  return {
    messageId: stripAngleBrackets(parsed.messageId) || crypto.randomUUID(),
    from: (parsed.from as any)?.value?.[0]?.address || '',
    to: ((parsed.to as any)?.value || []).map((v: any) => v.address || '').filter(Boolean),
    cc: ((parsed.cc as any)?.value || []).map((v: any) => v.address || '').filter(Boolean),
    subject: parsed.subject || '',
    date: parsed.date || new Date(),
    bodyText,
    bodyHtml: parsed.html || '',
    attachments,
    inReplyTo: parsed.inReplyTo ? stripAngleBrackets(parsed.inReplyTo) : undefined,
    references,
    headers,
  };
}

function stripAngleBrackets(id: string | undefined): string {
  if (!id) return '';
  return id.replace(/^<|>$/g, '');
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
