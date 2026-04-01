export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { withAuth } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';

const OUTLOOK_SCOPES = ['Mail.Read', 'offline_access'];

export const GET = withAuth('agent:configure', async (user, _request) => {
  const rl = await checkRateLimit(`api:oauth:outlook:authorize:${user.id}`, 5, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded', retryAfter: rl.retryAfter }, { status: 429 });
  }

  const clientId = process.env.OUTLOOK_OAUTH_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: { code: 'CONFIG_ERROR', message: 'Outlook OAuth not configured' } },
      { status: 500 }
    );
  }

  const redirectUri = `${process.env.APP_URL}/api/agent/oauth/outlook/callback`;

  // Generate CSRF nonce and include in state
  const nonce = randomBytes(32).toString('hex');
  const state = Buffer.from(JSON.stringify({ firmId: user.firmId, nonce })).toString('base64url');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: OUTLOOK_SCOPES.join(' '),
    state,
    response_mode: 'query',
  });

  const response = NextResponse.redirect(
    `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`
  );

  // Store nonce in HttpOnly cookie for CSRF verification on callback
  response.cookies.set('oauth_nonce', nonce, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
    path: '/',
  });

  return response;
});
