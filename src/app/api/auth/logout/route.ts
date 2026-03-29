export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { deleteSession, getUserFromRequest } from '@/lib/auth';

export async function POST(request: Request) {
  const user = getUserFromRequest(request);
  if (user) {
    const cookie = request.headers.get('cookie');
    const match = cookie?.match(/session=([^;]+)/);
    if (match) deleteSession(match[1]);
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set('session', '', { maxAge: 0, path: '/' });
  return response;
}
