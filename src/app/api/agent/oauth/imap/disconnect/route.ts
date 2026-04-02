export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { auditLog } from '@/lib/audit';
import { checkRateLimit } from '@/lib/rate-limit';

export const POST = withAuth('agent:configure', async (user, _request) => {
  const rl = await checkRateLimit(`api:oauth:imap:disconnect:${user.id}`, 5, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded', retryAfter: rl.retryAfter }, { status: 429 });
  }

  await prisma.emailIngressConfig.update({
    where: { firmId: user.firmId },
    data: {
      provider: null,
      imapHost: null,
      imapPort: null,
      imapUsername: null,
      imapPasswordEncrypted: null,
      status: 'active',
      lastError: null,
      errorCount: 0,
    },
  });

  await auditLog(user.firmId, 'agent.email_disconnected', 'email_ingress_config', user.firmId, {
    provider: 'imap',
  });

  return NextResponse.json({ data: { disconnected: true } });
});
