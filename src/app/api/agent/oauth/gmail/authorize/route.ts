export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { withAuth } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';

const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

export const GET = withAuth('agent:configure', async (user, _request) => {
  const rl = await checkRateLimit(`api:oauth:gmail:authorize:${user.id}`, 5, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded', retryAfter: rl.retryAfter }, { status: 429 });
  }

  const clientId = process.env.GMAIL_OAUTH_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: { code: 'CONFIG_ERROR', message: 'Gmail OAuth not configured' } },
      { status: 500 }
    );
  }

  const redirectUri = `${process.env.APP_URL}/api/agent/oauth/gmail/callback`;

  // Generate CSRF nonce and include in state
  const nonce = randomBytes(32).toString('hex');
  const state = Buffer.from(JSON.stringify({ firmId: user.firmId, nonce })).toString('base64url');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  const response = NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params}`
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
