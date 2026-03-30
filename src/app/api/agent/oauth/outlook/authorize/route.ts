export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';

const OUTLOOK_SCOPES = ['Mail.Read', 'offline_access'];

export const GET = withAuth(null, async (user, _request) => {
  const clientId = process.env.OUTLOOK_OAUTH_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: { code: 'CONFIG_ERROR', message: 'Outlook OAuth not configured' } },
      { status: 500 }
    );
  }

  const redirectUri = `${process.env.APP_URL}/api/agent/oauth/outlook/callback`;
  const state = Buffer.from(JSON.stringify({ firmId: user.firmId })).toString('base64url');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: OUTLOOK_SCOPES.join(' '),
    state,
    response_mode: 'query',
  });

  return NextResponse.redirect(
    `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`
  );
});
