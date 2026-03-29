import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Routes that don't require auth
const PUBLIC_PATHS = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/health',
];

// Methods that don't require CSRF validation (read-only + preflight)
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function getCsrfTokenFromCookie(request: NextRequest): string | undefined {
  return request.cookies.get('csrf_token')?.value;
}

function getCsrfTokenFromHeader(request: NextRequest): string | undefined {
  return request.headers.get('x-csrf-token') ?? undefined;
}

function handleCorsPreflight(request: NextRequest): NextResponse {
  const origin = request.headers.get('origin') ?? '*';
  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'http://localhost:3000';

  const response = new NextResponse(null, { status: 204 });
  response.headers.set('Access-Control-Allow-Origin', allowedOrigin);
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token');
  response.headers.set('Access-Control-Allow-Credentials', 'true');
  response.headers.set('Access-Control-Max-Age', '86400');
  return response;
}

function addCorsHeaders(response: NextResponse, request: NextRequest): NextResponse {
  const origin = request.headers.get('origin');
  if (origin) {
    const allowedOrigin = process.env.ALLOWED_ORIGIN || 'http://localhost:3000';
    response.headers.set('Access-Control-Allow-Origin', allowedOrigin);
    response.headers.set('Access-Control-Allow-Credentials', 'true');
    response.headers.set('Access-Control-Expose-Headers', 'Set-Cookie');
  }
  return response;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const method = request.method.toUpperCase();

  // ── CORS preflight ──────────────────────────────────────────
  if (method === 'OPTIONS') {
    return handleCorsPreflight(request);
  }

  // ── CSRF validation for state-changing methods ──────────────
  if (!SAFE_METHODS.has(method)) {
    // Skip CSRF check for auth endpoints (user hasn't got a CSRF token yet)
    const isAuthEndpoint =
      pathname.startsWith('/api/auth/login') ||
      pathname.startsWith('/api/auth/register') ||
      pathname.startsWith('/api/auth/forgot-password') ||
      pathname.startsWith('/api/auth/reset-password');

    if (!isAuthEndpoint) {
      const cookieToken = getCsrfTokenFromCookie(request);
      const headerToken = getCsrfTokenFromHeader(request);

      if (!cookieToken || !headerToken || cookieToken !== headerToken) {
        const res = NextResponse.json(
          { error: { code: 'CSRF_ERROR', message: 'CSRF token validation failed' } },
          { status: 403 }
        );
        return addCorsHeaders(res, request);
      }
    }
  }

  // ── Auth gate ───────────────────────────────────────────────
  // Allow public paths
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    const res = NextResponse.next();
    return addCorsHeaders(res, request);
  }

  // Check for session cookie
  const session = request.cookies.get('session');
  if (!session?.value) {
    // Redirect to login for pages
    if (!pathname.startsWith('/api/')) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      return NextResponse.redirect(loginUrl);
    }
    // Return 401 for API routes
    const res = NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
      { status: 401 }
    );
    return addCorsHeaders(res, request);
  }

  const res = NextResponse.next();
  return addCorsHeaders(res, request);
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
