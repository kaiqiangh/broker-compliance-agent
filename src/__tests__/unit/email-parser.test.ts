import { describe, it, expect } from 'vitest';

// These imports will fail until we implement them (TDD: red phase)
import { parseEmail } from '../../lib/email/parser';
import { extractAttachmentText } from '../../lib/email/attachment-extractor';

describe('parseEmail', () => {
  const simpleEmail = Buffer.from(
    `From: insurer@aviva.ie\r\n` +
    `To: broker@example.com\r\n` +
    `Subject: Motor Policy Renewal - POL-2024-001\r\n` +
    `Date: Mon, 30 Mar 2026 10:00:00 +0000\r\n` +
    `Message-ID: <test-msg-001@aviva.ie>\r\n` +
    `Content-Type: text/plain; charset=utf-8\r\n` +
    `\r\n` +
    `Dear Broker,\r\n` +
    `Your motor policy POL-2024-001 for client Seán Ó Briain is due for renewal.\r\n` +
    `New premium: €1,350.00 (was €1,245.00)\r\n` +
    `New expiry: 15/03/2027\r\n` +
    `NCB: 6 years\r\n` +
    `Regards,\r\n` +
    `Aviva Ireland`
  );

  it('parses headers correctly', async () => {
    const result = await parseEmail(simpleEmail);
    expect(result.from).toBe('insurer@aviva.ie');
    expect(result.to).toEqual(['broker@example.com']);
    expect(result.subject).toBe('Motor Policy Renewal - POL-2024-001');
    expect(result.messageId).toBe('test-msg-001@aviva.ie');
  });

  it('parses plain text body', async () => {
    const result = await parseEmail(simpleEmail);
    expect(result.bodyText).toContain('POL-2024-001');
    expect(result.bodyText).toContain('€1,350.00');
    expect(result.bodyText).toContain('Seán Ó Briain');
  });

  it('handles Irish characters (fadas)', async () => {
    const result = await parseEmail(simpleEmail);
    expect(result.bodyText).toContain('Seán Ó Briain');
  });

  it('parses date correctly', async () => {
    const result = await parseEmail(simpleEmail);
    expect(result.date).toBeInstanceOf(Date);
    expect(result.date.getFullYear()).toBe(2026);
  });

  it('returns empty attachments for email without attachments', async () => {
    const result = await parseEmail(simpleEmail);
    expect(result.attachments).toEqual([]);
  });

  it('parses multipart email with HTML and text', async () => {
    const multipartEmail = Buffer.from(
      `From: insurer@allianz.ie\r\n` +
      `To: broker@example.com\r\n` +
      `Subject: Home Policy Renewal\r\n` +
      `Date: Mon, 30 Mar 2026 10:00:00 +0000\r\n` +
      `Message-ID: <test-msg-002@allianz.ie>\r\n` +
      `Content-Type: multipart/alternative; boundary="boundary123"\r\n` +
      `\r\n` +
      `--boundary123\r\n` +
      `Content-Type: text/plain; charset=utf-8\r\n` +
      `\r\n` +
      `Plain text version: Policy HOME-2024-005 renewal.\r\n` +
      `New premium: €920.00\r\n` +
      `--boundary123\r\n` +
      `Content-Type: text/html; charset=utf-8\r\n` +
      `\r\n` +
      `<html><body><p>HTML version: Policy HOME-2024-005 renewal.</p></body></html>\r\n` +
      `--boundary123--\r\n`
    );

    const result = await parseEmail(multipartEmail);
    expect(result.bodyText).toContain('HOME-2024-005');
    expect(result.bodyHtml).toContain('<html>');
  });

  it('parses email with PDF attachment', async () => {
    // This test requires a real or mock PDF buffer
    // For now, test that attachment metadata is extracted
    const emailWithAttachment = Buffer.from(
      `From: insurer@zurich.ie\r\n` +
      `To: broker@example.com\r\n` +
      `Subject: Policy Documents\r\n` +
      `Date: Mon, 30 Mar 2026 10:00:00 +0000\r\n` +
      `Message-ID: <test-msg-003@zurich.ie>\r\n` +
      `Content-Type: multipart/mixed; boundary="attach-boundary"\r\n` +
      `\r\n` +
      `--attach-boundary\r\n` +
      `Content-Type: text/plain\r\n` +
      `\r\n` +
      `Please find attached policy documents.\r\n` +
      `--attach-boundary\r\n` +
      `Content-Type: application/pdf; name="policy.pdf"\r\n` +
      `Content-Disposition: attachment; filename="policy.pdf"\r\n` +
      `Content-Transfer-Encoding: base64\r\n` +
      `\r\n` +
      `JVBERi0xLjQKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoK` +
      `--attach-boundary--\r\n`
    );

    const result = await parseEmail(emailWithAttachment);
    expect(result.attachments.length).toBeGreaterThan(0);
    expect(result.attachments[0].filename).toBe('policy.pdf');
    expect(result.attachments[0].contentType).toBe('application/pdf');
  });

  it('handles In-Reply-To and References headers for threading', async () => {
    const replyEmail = Buffer.from(
      `From: insurer@aviva.ie\r\n` +
      `To: broker@example.com\r\n` +
      `Subject: RE: Motor Policy Renewal - POL-2024-001\r\n` +
      `Date: Mon, 30 Mar 2026 12:00:00 +0000\r\n` +
      `Message-ID: <test-reply-001@aviva.ie>\r\n` +
      `In-Reply-To: <test-msg-001@aviva.ie>\r\n` +
      `References: <test-msg-001@aviva.ie>\r\n` +
      `Content-Type: text/plain\r\n` +
      `\r\n` +
      `Follow-up on the renewal.\r\n`
    );

    const result = await parseEmail(replyEmail);
    expect(result.inReplyTo).toBe('test-msg-001@aviva.ie');
    expect(result.references).toContain('test-msg-001@aviva.ie');
  });

  it('handles malformed email gracefully', async () => {
    const malformed = Buffer.from('This is not a valid email');
    const result = await parseEmail(malformed);
    // Should not throw, should return partial data
    expect(result).toBeDefined();
    expect(result.bodyText).toBeDefined();
  });

  it('handles empty email', async () => {
    const empty = Buffer.from('');
    const result = await parseEmail(empty);
    expect(result).toBeDefined();
  });

  it('handles quoted-printable encoding', async () => {
    const qpEmail = Buffer.from(
      `From: insurer@fbd.ie\r\n` +
      `To: broker@example.com\r\n` +
      `Subject: =?UTF-8?Q?Rinnovamento_Polizza?= \r\n` +
      `Date: Mon, 30 Mar 2026 10:00:00 +0000\r\n` +
      `Message-ID: <test-qp@fbd.ie>\r\n` +
      `Content-Type: text/plain; charset=utf-8\r\n` +
      `Content-Transfer-Encoding: quoted-printable\r\n` +
      `\r\n` +
      `Premium: =E2=82=AC1,200.00\r\n` +
      `Expiry: 15/03/2027\r\n`
    );

    const result = await parseEmail(qpEmail);
    expect(result.bodyText).toContain('€1,200.00');
    expect(result.subject).toContain('Rinnovamento');
  });
});

describe('extractAttachmentText', () => {
  it('extracts text from PDF buffer', async () => {
    // This test needs a real PDF buffer - placeholder for now
    // Will be completed when pdf-parse is integrated
    const pdfBuffer = Buffer.from('mock-pdf-content');
    const text = await extractAttachmentText(pdfBuffer, 'application/pdf');
    expect(typeof text).toBe('string');
  });

  it('returns empty string for unsupported content type', async () => {
    const zipBuffer = Buffer.from('mock-zip-content');
    const text = await extractAttachmentText(zipBuffer, 'application/zip');
    expect(text).toBe('');
  });

  it('handles image content type (OCR placeholder)', async () => {
    const imageBuffer = Buffer.from('mock-image-content');
    const text = await extractAttachmentText(imageBuffer, 'image/png');
    // Phase 1: returns empty (no OCR yet)
    // Phase 2: will return OCR text
    expect(typeof text).toBe('string');
  });
});
