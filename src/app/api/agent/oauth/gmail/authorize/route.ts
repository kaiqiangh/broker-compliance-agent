export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';

const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

export const GET = withAuth(null, async (user, _request) => {
  const clientId = process.env.GMAIL_OAUTH_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: { code: 'CONFIG_ERROR', message: 'Gmail OAuth not configured' } },
      { status: 500 }
    );
  }

  const redirectUri = `${process.env.APP_URL}/api/agent/oauth/gmail/callback`;
  const state = Buffer.from(JSON.stringify({ firmId: user.firmId })).toString('base64url');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  );
});
