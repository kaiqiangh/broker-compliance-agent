import { prisma } from '@/lib/prisma';
import { decryptToken } from '@/lib/email/oauth/crypto';
import { connectIMAP } from './connector';
import { simpleParser } from 'mailparser';
import { enqueueJob } from '@/lib/agent/queue';
import { resolveThreadId } from '@/lib/email/threading';

// Prevent concurrent polling of the same firm's mailbox
const pollingLock = new Set<string>();

/**
 * Poll IMAP-connected mailboxes for new (unseen) emails.
 * Parses each message and creates IncomingEmail records.
 */
export async function pollIMAPConnections(): Promise<number> {
  const configs = await prisma.emailIngressConfig.findMany({
    where: {
      provider: 'imap',
      status: 'active',
      imapHost: { not: null },
      imapUsername: { not: null },
      imapPasswordEncrypted: { not: null },
    },
  });

  let totalNew = 0;

  for (const config of configs) {
    const lockKey = `imap-poll:${config.firmId}`;
    if (pollingLock.has(lockKey)) {
      continue;
    }

    pollingLock.add(lockKey);
    try {
      const password = decryptToken(config.imapPasswordEncrypted!);
      const client = await connectIMAP(
        config.imapHost!,
        config.imapPort || 993,
        config.imapUsername!,
        password
      );

      try {
        const lock = await client.getMailboxLock('INBOX');
        try {
          // Fetch unseen messages since lastPoll (or all unseen if no lastPoll)
          const searchCriteria: Record<string, any> = { seen: false };
          if (config.lastPolledAt) {
            searchCriteria.since = config.lastPolledAt;
          }

          for await (const message of client.fetch(searchCriteria, {
            source: true,
            uid: true,
          })) {
            try {
              if (!message.source) {
                continue;
              }

              const parsed = await simpleParser(message.source as any);
              const messageId = (parsed.messageId || String(message.uid)).replace(/^<|>$/g, '');
              const inReplyTo = parsed.inReplyTo ? parsed.inReplyTo.replace(/^<|>$/g, '') : null;
              const references = Array.isArray(parsed.references)
                ? parsed.references.map((reference) => reference.replace(/^<|>$/g, ''))
                : parsed.references
                  ? [parsed.references.replace(/^<|>$/g, '')]
                  : [];
              const threadId = resolveThreadId({
                messageId,
                inReplyTo,
                references,
              });

              const email = await prisma.incomingEmail.create({
                data: {
                  firmId: config.firmId,
                  messageId,
                  inReplyTo,
                  threadId,
                  fromAddress: (parsed.from as any)?.value?.[0]?.address || '',
                  toAddresses: ((parsed.to as any)?.value || []).map((v: any) => v.address || ''),
                  ccAddresses: ((parsed.cc as any)?.value || []).map((v: any) => v.address || ''),
                  subject: parsed.subject || '',
                  receivedAt: parsed.date || new Date(),
                  bodyText: parsed.text || '',
                  bodyHtml: parsed.html || '',
                  status: 'pending_processing',
                },
              });

              await enqueueJob({ type: 'process_email', data: { emailId: email.id } });
              totalNew++;
            } catch (err: any) {
              if (err.code !== 'P2002') {
                console.error(`[IMAP Poll] Failed to process message:`, err);
              }
            }
          }
        } finally {
          lock.release();
        }
      } finally {
        await client.logout();
      }

      // Update last polled time and reset errors
      await prisma.emailIngressConfig.update({
        where: { id: config.id },
        data: { lastPolledAt: new Date(), lastError: null, errorCount: 0 },
      });
    } catch (err) {
      console.error(`[IMAP Poll] Error for firm ${config.firmId}:`, err);
      const newErrorCount = config.errorCount + 1;
      await prisma.emailIngressConfig.update({
        where: { id: config.id },
        data: {
          lastError: err instanceof Error ? err.message : 'Unknown error',
          errorCount: { increment: 1 },
          ...(newErrorCount >= 10 && { status: 'error' }),
        },
      });
    } finally {
      pollingLock.delete(lockKey);
    }
  }

  return totalNew;
}
