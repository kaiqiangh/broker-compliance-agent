import { prisma } from '@/lib/prisma';
import { decryptToken } from '@/lib/email/oauth/crypto';
import { enqueueJob } from '@/lib/agent/queue';

/**
 * Poll OAuth-connected mailboxes for new emails.
 * Uses Gmail API or Microsoft Graph API depending on provider.
 */
export async function pollConnectedMailboxes(): Promise<number> {
  const configs = await prisma.emailIngressConfig.findMany({
    where: {
      provider: { in: ['gmail', 'outlook'] },
      status: 'active',
      oauthAccessTokenEncrypted: { not: null },
    },
  });

  let totalNew = 0;

  for (const config of configs) {
    try {
      // Check if token needs refresh
      if (config.oauthExpiresAt && config.oauthExpiresAt < new Date()) {
        await refreshToken(config);
      }

      const accessToken = decryptToken(config.oauthAccessTokenEncrypted!);

      let messages: { id: string; raw: string }[] = [];

      if (config.provider === 'gmail') {
        messages = await fetchGmailMessages(accessToken, config.lastPolledAt);
      } else if (config.provider === 'outlook') {
        messages = await fetchOutlookMessages(accessToken, config.lastPolledAt);
      }

      // Process each message
      for (const msg of messages) {
        try {
          // Create incoming email record (dedup handled by unique constraint)
          const parsed = await import('mailparser').then(m =>
            m.simpleParser(Buffer.from(msg.raw, 'base64url'))
          );

          const messageId = (parsed.messageId || msg.id).replace(/^<|>$/g, '');

          const email = await prisma.incomingEmail.create({
            data: {
              firmId: config.firmId,
              messageId,
              fromAddress: (parsed.from as any)?.value?.[0]?.address || '',
              toAddresses: ((parsed.to as any)?.value || []).map((v: any) => v.address || ''),
              subject: parsed.subject || '',
              receivedAt: parsed.date || new Date(),
              bodyText: parsed.text || '',
              bodyHtml: parsed.html || '',
              status: 'pending_processing',
            },
          });

          // Enqueue for processing
          await enqueueJob({ type: 'process_email', data: { emailId: email.id } });
          totalNew++;
        } catch (err: any) {
          // P2002 = duplicate
          if (err.code !== 'P2002') {
            console.error(`[IMAP Poll] Failed to process message:`, err);
          }
        }
      }

      // Update last polled time
      await prisma.emailIngressConfig.update({
        where: { id: config.id },
        data: { lastPolledAt: new Date(), lastError: null, errorCount: 0 },
      });
    } catch (err) {
      console.error(`[IMAP Poll] Error for firm ${config.firmId}:`, err);
      await prisma.emailIngressConfig.update({
        where: { id: config.id },
        data: {
          lastError: err instanceof Error ? err.message : 'Unknown error',
          errorCount: { increment: 1 },
          ...(config.errorCount >= 10 && { status: 'error' }),
        },
      });
    }
  }

  return totalNew;
}

async function refreshToken(config: any): Promise<void> {
  if (!config.oauthRefreshTokenEncrypted) return;

  const refreshToken = decryptToken(config.oauthRefreshTokenEncrypted);
  const isGmail = config.provider === 'gmail';

  const tokenUrl = isGmail
    ? 'https://oauth2.googleapis.com/token'
    : 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

  const clientId = isGmail
    ? process.env.GMAIL_OAUTH_CLIENT_ID
    : process.env.OUTLOOK_OAUTH_CLIENT_ID;

  const clientSecret = isGmail
    ? process.env.GMAIL_OAUTH_CLIENT_SECRET
    : process.env.OUTLOOK_OAUTH_CLIENT_SECRET;

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId!,
      client_secret: clientSecret!,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status}`);
  }

  const tokens = await res.json();
  const { encryptToken } = await import('@/lib/email/oauth/crypto');

  await prisma.emailIngressConfig.update({
    where: { id: config.id },
    data: {
      oauthAccessTokenEncrypted: encryptToken(tokens.access_token),
      oauthExpiresAt: new Date(Date.now() + (tokens.expires_in || 3600) * 1000),
      ...(tokens.refresh_token && {
        oauthRefreshTokenEncrypted: encryptToken(tokens.refresh_token),
      }),
    },
  });
}

async function fetchGmailMessages(
  accessToken: string,
  since: Date | null
): Promise<{ id: string; raw: string }[]> {
  // List recent messages
  const query = since ? `after:${Math.floor(since.getTime() / 1000)}` : 'newer_than:1d';
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=20`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!listRes.ok) return [];

  const listData = await listRes.json();
  if (!listData.messages) return [];

  // Fetch raw content for each message
  const messages: { id: string; raw: string }[] = [];
  for (const msg of listData.messages.slice(0, 10)) {
    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=raw`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (msgRes.ok) {
      const msgData = await msgRes.json();
      messages.push({ id: msg.id, raw: msgData.raw });
    }
  }

  return messages;
}

async function fetchOutlookMessages(
  accessToken: string,
  since: Date | null
): Promise<{ id: string; raw: string }[]> {
  const filter = since
    ? `$filter=receivedDateTime ge ${since.toISOString()}&$orderby=receivedDateTime desc`
    : `$orderby=receivedDateTime desc`;

  const listRes = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages?$top=20&${filter}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!listRes.ok) return [];

  const listData = await listRes.json();
  if (!listData.value) return [];

  const messages: { id: string; raw: string }[] = [];
  for (const msg of listData.value.slice(0, 10)) {
    // Get MIME content
    const mimeRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${msg.id}/$value`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (mimeRes.ok) {
      const raw = Buffer.from(await mimeRes.arrayBuffer()).toString('base64url');
      messages.push({ id: msg.id, raw });
    }
  }

  return messages;
}
