export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { encryptToken } from '@/lib/email/oauth/crypto';
import { connectIMAP } from '@/lib/email/imap/connector';
import { auditLog } from '@/lib/audit';
import { checkRateLimit } from '@/lib/rate-limit';

interface IMAPRequestBody {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
}

const IMAP_PRESETS: Record<string, { host: string; port: number }> = {
  gmail: { host: 'imap.gmail.com', port: 993 },
  outlook: { host: 'outlook.office365.com', port: 993 },
};

export const POST = withAuth(null, async (user, request) => {
  const rl = await checkRateLimit(`api:oauth:imap:connect:${user.id}`, 5, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded', retryAfter: rl.retryAfter }, { status: 429 });
  }

  let body: IMAPRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } },
      { status: 400 }
    );
  }

  const { host: customHost, port: customPort, username, password } = body;

  if (!username || !password) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'username and password are required' } },
      { status: 400 }
    );
  }

  // Resolve host/port — check presets or use custom
  let host = customHost || '';
  let port = customPort || 993;

  if (customHost && IMAP_PRESETS[customHost]) {
    host = IMAP_PRESETS[customHost].host;
    port = IMAP_PRESETS[customHost].port;
  } else if (!customHost) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'host is required (or use "gmail"/"outlook" as preset)' } },
      { status: 400 }
    );
  }

  // Save credentials with 'testing' status first (prevents race condition)
  const savedConfig = await prisma.emailIngressConfig.upsert({
    where: { firmId: user.firmId },
    update: {
      provider: 'imap',
      imapHost: host,
      imapPort: port,
      imapUsername: username,
      imapPasswordEncrypted: encryptToken(password),
      oauthAccessTokenEncrypted: null,
      oauthRefreshTokenEncrypted: null,
      oauthExpiresAt: null,
      status: 'testing',
      lastError: null,
      errorCount: 0,
    },
    create: {
      firmId: user.firmId,
      provider: 'imap',
      imapHost: host,
      imapPort: port,
      imapUsername: username,
      imapPasswordEncrypted: encryptToken(password),
      status: 'testing',
    },
  });

  // Test the connection
  try {
    const client = await connectIMAP(host, port, username, password);
    await client.logout();

    // Connection successful — update to active
    await prisma.emailIngressConfig.update({
      where: { id: savedConfig.id },
      data: { status: 'active', lastError: null, errorCount: 0 },
    });

    await auditLog(user.firmId, 'agent.email_connected', 'email_ingress_config', user.firmId, {
      provider: 'imap',
      host,
    });

    return NextResponse.json({
      data: { connected: true, provider: 'imap', host },
    });
  } catch (err) {
    // Connection failed — update to error state
    await prisma.emailIngressConfig.update({
      where: { id: savedConfig.id },
      data: {
        status: 'error',
        lastError: err instanceof Error ? err.message : 'Unknown error',
        errorCount: { increment: 1 },
      },
    });

    return NextResponse.json(
      {
        error: {
          code: 'CONNECTION_FAILED',
          message: `IMAP connection failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        },
      },
      { status: 400 }
    );
  }
});
