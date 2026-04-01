export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { simpleParser } from 'mailparser';
import { prisma } from '@/lib/prisma';
import { checkRateLimit } from '@/lib/rate-limit';
import { storeRawEmail } from '@/lib/email/storage';
import { enqueueJob } from '@/lib/agent/queue';
import { auditLog } from '@/lib/audit';
import { extractAttachmentText } from '@/lib/email/attachment-extractor';
import { resolveThreadId } from '@/lib/email/threading';

interface IngestBody {
  from: string;
  to: string;
  raw: string; // base64 encoded email
}

/**
 * Extract firm ID from forwarding address.
 * Format: agent-{firmId}@ingest.yourproduct.com
 */
function extractFirmId(toAddress: string): string | null {
  const match = toAddress.match(/^agent-([^@]+)@ingest\./i);
  return match ? match[1] : null;
}

/**
 * Verify webhook signature (HMAC-SHA256).
 */
function verifySignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret || !signature) return false;

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');

  try {
    return timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expected, 'hex')
    );
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  // Check webhook secret is configured
  if (!process.env.WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: { code: 'CONFIG_ERROR', message: 'Webhook secret not configured' } },
      { status: 500 }
    );
  }

  // Read raw body
  const rawBody = await request.text();
  const signature = request.headers.get('x-webhook-signature');

  // Parse body first (needed to extract raw email for signature verification)
  let body: IngestBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } },
      { status: 400 }
    );
  }

  // Rate limit: 100 emails/min per firm (extracted from recipient address)
  const firmIdFromTo = extractFirmId(body.to);
  const rlKey = firmIdFromTo ? `agent:ingest:firm:${firmIdFromTo}` : `agent:ingest:global`;
  const rl = await checkRateLimit(rlKey, 100, 60);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } }
    );
  }

  // Daily limit: 200 emails/firm/day (PRD §10)
  if (firmIdFromTo) {
    const DAILY_LIMIT = 200;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dailyCount = await prisma.incomingEmail.count({
      where: { firmId: firmIdFromTo, createdAt: { gte: today } },
    });

    if (dailyCount >= DAILY_LIMIT) {
      return NextResponse.json(
        { error: { code: 'DAILY_LIMIT_EXCEEDED', message: `Daily email limit (${DAILY_LIMIT}) reached` } },
        { status: 429 }
      );
    }
  }

  // Verify signature against the raw email content (not the JSON wrapper)
  const rawEmailContent = Buffer.from(body.raw, 'base64').toString('utf-8');
  if (!verifySignature(rawEmailContent, signature)) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Invalid webhook signature' } },
      { status: 401 }
    );
  }

  // Extract firm ID from recipient address
  const firmId = extractFirmId(body.to);
  if (!firmId) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Could not extract firm ID from recipient address' } },
      { status: 400 }
    );
  }

  // Check firm config exists and is active
  const config = await prisma.emailIngressConfig.findUnique({
    where: { firmId },
  });

  if (!config) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'No agent configuration found for this firm' } },
      { status: 404 }
    );
  }

  if (config.status !== 'active') {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: `Agent is ${config.status}` } },
      { status: 403 }
    );
  }

  // Decode and parse raw email
  const rawEmailBuffer = Buffer.from(body.raw, 'base64');
  const parsed = await simpleParser(rawEmailBuffer);

  const messageId = (parsed.messageId || '').replace(/^<|>$/g, '');

  if (!messageId) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Email has no Message-ID header' } },
      { status: 400 }
    );
  }

  // Extract email fields
  const fromAddress = (parsed.from as any)?.value?.[0]?.address || body.from;
  const toAddresses = ((parsed.to as any)?.value || []).map((v: any) => v.address || '').filter(Boolean);
  const ccAddresses = ((parsed.cc as any)?.value || []).map((v: any) => v.address || '').filter(Boolean);
  const subject = parsed.subject || '';
  const receivedAt = parsed.date || new Date();
  const bodyText = parsed.text || '';
  const bodyHtml = parsed.html || '';
  const inReplyTo = parsed.inReplyTo ? parsed.inReplyTo.replace(/^<|>$/g, '') : null;

  // Extract references
  const references: string[] = [];
  if (parsed.references) {
    if (Array.isArray(parsed.references)) {
      references.push(...parsed.references.map((r: string) => r.replace(/^<|>$/g, '')));
    } else {
      references.push(parsed.references.replace(/^<|>$/g, ''));
    }
  }

  // Determine thread ID
  const threadId = resolveThreadId({
    messageId,
    inReplyTo,
    references,
  });

  // Store email in DB (unique constraint on firmId+messageId handles dedup atomically)
  let email;
  try {
    email = await prisma.incomingEmail.create({
      data: {
        firmId,
        messageId,
        inReplyTo,
        threadId,
        fromAddress,
        toAddresses,
        ccAddresses,
        subject,
        receivedAt,
        bodyText,
        bodyHtml,
        status: 'pending_processing',
      },
    });
  } catch (err: any) {
    // P2002 = unique constraint violation = duplicate
    if (err.code === 'P2002') {
      return NextResponse.json({ status: 'duplicate', messageId }, { status: 200 });
    }
    throw err;
  }

  // Log audit event for email receipt
  await auditLog(firmId, 'agent.email_received', 'incoming_email', email.id, {
    fromAddress,
    subject,
    messageId,
  });

  // Store raw email in R2 (non-blocking)
  const rawUrl = await storeRawEmail(firmId, messageId, rawEmailBuffer);
  if (rawUrl) {
    await prisma.incomingEmail.update({
      where: { id: email.id },
      data: { rawUrl },
    });
  }

  // Process email attachments — extract text for agent analysis
  const emailAttachments = (parsed as any).attachments || [];
  for (const att of emailAttachments) {
    try {
      const extractedText = await extractAttachmentText(
        att.filename || 'unknown',
        att.contentType || 'application/octet-stream',
        att.content
      );

      await prisma.emailAttachment.create({
        data: {
          emailId: email.id,
          firmId,
          filename: att.filename || 'unknown',
          contentType: att.contentType || 'application/octet-stream',
          sizeBytes: att.size || 0,
          extractedText: extractedText || null,
        },
      });
    } catch (err) {
      console.error(`[ingest] Failed to process attachment ${att.filename}:`, err);
      // Store without extracted text — don't block the pipeline
      await prisma.emailAttachment.create({
        data: {
          emailId: email.id,
          firmId,
          filename: att.filename || 'unknown',
          contentType: att.contentType || 'application/octet-stream',
          sizeBytes: att.size || 0,
          extractedText: null,
        },
      });
    }
  }

  // Enqueue for async processing
  await enqueueJob({ type: 'process_email', data: { emailId: email.id } });

  return NextResponse.json(
    {
      status: 'queued',
      emailId: email.id,
      messageId,
    },
    { status: 200 }
  );
}
