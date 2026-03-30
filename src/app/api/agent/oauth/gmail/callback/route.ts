import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { encryptToken } from '@/lib/email/oauth/crypto';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error || !code) {
    return NextResponse.redirect(
      `${process.env.APP_URL}/agent/config?error=${encodeURIComponent(error || 'missing_code')}`
    );
  }

  // Decode state
  let firmId: string;
  let nonce: string;
  try {
    const decoded = JSON.parse(Buffer.from(state!, 'base64url').toString());
    firmId = decoded.firmId;
    nonce = decoded.nonce;
  } catch {
    return NextResponse.redirect(`${process.env.APP_URL}/agent/config?error=invalid_state`);
  }

  // Verify CSRF nonce
  const cookieHeader = request.headers.get('cookie') || '';
  const nonceMatch = cookieHeader.match(/oauth_nonce=([^;]+)/);
  const cookieNonce = nonceMatch?.[1];

  if (!cookieNonce || cookieNonce !== nonce) {
    return NextResponse.redirect(
      `${process.env.APP_URL}/agent/config?error=invalid_state`
    );
  }

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GMAIL_OAUTH_CLIENT_ID!,
      client_secret: process.env.GMAIL_OAUTH_CLIENT_SECRET!,
      redirect_uri: `${process.env.APP_URL}/api/agent/oauth/gmail/callback`,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    return NextResponse.redirect(
      `${process.env.APP_URL}/agent/config?error=token_exchange_failed`
    );
  }

  const tokens = await tokenRes.json();

  // Store encrypted tokens
  await prisma.emailIngressConfig.upsert({
    where: { firmId },
    update: {
      provider: 'gmail',
      oauthAccessTokenEncrypted: encryptToken(tokens.access_token),
      oauthRefreshTokenEncrypted: encryptToken(tokens.refresh_token),
      oauthExpiresAt: new Date(Date.now() + (tokens.expires_in || 3600) * 1000),
      status: 'active',
    },
    create: {
      firmId,
      provider: 'gmail',
      oauthAccessTokenEncrypted: encryptToken(tokens.access_token),
      oauthRefreshTokenEncrypted: encryptToken(tokens.refresh_token),
      oauthExpiresAt: new Date(Date.now() + (tokens.expires_in || 3600) * 1000),
      status: 'active',
      executionMode: 'suggestion',
    },
  });

  return NextResponse.redirect(`${process.env.APP_URL}/agent/config?connected=gmail`);
}
