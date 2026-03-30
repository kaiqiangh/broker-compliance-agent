import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { auditLog } from '@/lib/audit';

export const DELETE = withAuth(null, async (user, request) => {
  const url = new URL(request.url);
  const provider = url.searchParams.get('provider');

  if (!provider || !['gmail', 'outlook', 'imap'].includes(provider)) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid provider' } },
      { status: 400 }
    );
  }

  await prisma.emailIngressConfig.update({
    where: { firmId: user.firmId },
    data: {
      provider: null,
      oauthAccessTokenEncrypted: null,
      oauthRefreshTokenEncrypted: null,
      oauthExpiresAt: null,
      imapHost: null,
      imapUsername: null,
      imapPasswordEncrypted: null,
      status: 'active',
    },
  });

  await auditLog(user.firmId, 'agent.email_disconnected', 'email_ingress_config', user.firmId, {
    provider,
  });

  return NextResponse.json({ data: { disconnected: true } });
});
