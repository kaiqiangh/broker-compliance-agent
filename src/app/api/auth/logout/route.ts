export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { deleteSession, getUserFromRequest } from '@/lib/auth';

export async function POST(request: Request) {
  const token = request.headers.get('cookie')?.match(/session=([^;]+)/)?.[1];
  if (token) {
    deleteSession(token);
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set('session', '', { maxAge: 0, path: '/' });
  return response;
}
