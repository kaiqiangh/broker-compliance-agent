export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { checkRateLimit } from '@/lib/rate-limit';

// Built-in insurer domains
const PRESET_DOMAINS = [
  'aviva.ie', 'allianz.ie', 'axa.ie', 'zurich.ie', 'fbd.ie',
  'libertyinsurance.ie', 'rsai.ie', 'irishlife.ie', 'newireland.ie',
  'brokersireland.ie', 'kennco.ie', 'arachas.ie', 'campion.ie',
  'aa.ie', 'chill.ie', 'anpostinsurance.ie',
];

export const GET = withAuth(null, async (user, _request) => {
  const rl = await checkRateLimit(`api:config:insurer-domains:${user.id}`, 5, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded', retryAfter: rl.retryAfter }, { status: 429 });
  }

  const config = await prisma.emailIngressConfig.findUnique({
    where: { firmId: user.firmId },
    select: { insurerDomains: true },
  });

  return NextResponse.json({
    data: {
      custom: config?.insurerDomains || [],
      builtin: PRESET_DOMAINS,
    },
  });
});

export const PUT = withAuth('agent:configure', async (user, request) => {
  const rl = await checkRateLimit(`api:config:insurer-domains:${user.id}`, 5, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded', retryAfter: rl.retryAfter }, { status: 429 });
  }

  let domains: string[] = [];
  try {
    const body = await request.json();
    domains = body.domains || [];
  } catch {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid JSON' } },
      { status: 400 }
    );
  }

  if (!Array.isArray(domains) || domains.length > 100) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'domains must be array of max 100' } },
      { status: 400 }
    );
  }

  // Validate domain format
  const valid = domains.filter(d =>
    typeof d === 'string' && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d.trim())
  );

  await prisma.emailIngressConfig.upsert({
    where: { firmId: user.firmId },
    update: { insurerDomains: valid },
    create: {
      firmId: user.firmId,
      insurerDomains: valid,
      executionMode: 'suggestion',
      status: 'active',
    },
  });

  return NextResponse.json({ data: { domains: valid } });
});
