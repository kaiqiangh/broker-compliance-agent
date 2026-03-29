import { hash, compare } from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { prisma, setFirmContext, clearFirmContext } from './prisma';
import { hasPermission, UnauthorizedError, ForbiddenError } from './rbac';
import type { Permission, Role } from './rbac';

// ─── Session types ───────────────────────────────────────────

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  firmId: string;
}

// ─── JWT config ──────────────────────────────────────────────

const JWT_SECRET_RAW = process.env.NEXTAUTH_SECRET;
if (!JWT_SECRET_RAW && process.env.NODE_ENV === 'production') {
  throw new Error('NEXTAUTH_SECRET environment variable is required in production');
}
const JWT_SECRET = new TextEncoder().encode(
  JWT_SECRET_RAW || 'local-dev-secret-change-in-production'
);
const JWT_ISSUER = 'broker-comply';
const SESSION_TTL = '8h';

// ─── Auth helpers ────────────────────────────────────────────

export async function authenticateUser(email: string, password: string): Promise<SessionUser | null> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });

  if (!user || !user.isActive) return null;

  const isValid = await compare(password, user.passwordHash);
  if (!isValid) return null;

  // Update last login
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as Role,
    firmId: user.firmId,
  };
}

export async function createUser(params: {
  firmId: string;
  email: string;
  password: string;
  name: string;
  role: Role;
}): Promise<SessionUser> {
  const passwordHash = await hash(params.password, 12);

  const user = await prisma.user.create({
    data: {
      firmId: params.firmId,
      email: params.email.toLowerCase(),
      passwordHash,
      name: params.name,
      role: params.role,
    },
  });

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as Role,
    firmId: user.firmId,
  };
}

export async function registerFirm(params: {
  firmName: string;
  adminEmail: string;
  adminPassword: string;
  adminName: string;
}): Promise<{ firmId: string; user: SessionUser }> {
  const firm = await prisma.firm.create({
    data: { name: params.firmName },
  });

  const user = await createUser({
    firmId: firm.id,
    email: params.adminEmail,
    password: params.adminPassword,
    name: params.adminName,
    role: 'firm_admin',
  });

  // Audit
  await prisma.auditEvent.create({
    data: {
      firmId: firm.id,
      actorId: user.id,
      action: 'firm.created',
      entityType: 'firm',
      entityId: firm.id,
    },
  });

  return { firmId: firm.id, user };
}

// ─── JWT session management ─────────────────────────────────

/**
 * Create a signed JWT session token.
 * Stateless — no server-side session store needed.
 * Survives restarts, works across multiple instances.
 */
export async function createSession(user: SessionUser): Promise<string> {
  return new SignJWT({
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    firmId: user.firmId,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(JWT_ISSUER)
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(JWT_SECRET);
}

/**
 * Verify and decode a JWT session token.
 * Returns the session user or null if invalid/expired.
 */
export async function getSession(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
    });

    return {
      id: payload.sub as string,
      email: payload.email as string,
      name: payload.name as string,
      role: payload.role as Role,
      firmId: payload.firmId as string,
    };
  } catch {
    return null;
  }
}

// Note: JWT tokens can't be individually invalidated without a blocklist.
// For logout, we clear the cookie. For password changes, the token's
// short TTL (8h) limits exposure. For production, add a Redis-based
// token blocklist for immediate invalidation.

/**
 * Extract session from request cookie.
 */
export async function getUserFromRequest(request: Request): Promise<SessionUser | null> {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;

  // Parse cookies manually
  const cookies = cookieHeader.split(';').reduce((acc, part) => {
    const [key, ...valueParts] = part.trim().split('=');
    if (key) acc[key.trim()] = decodeURIComponent(valueParts.join('='));
    return acc;
  }, {} as Record<string, string>);

  const token = cookies['session'];
  if (!token) return null;

  return getSession(token);
}

/**
 * Require authenticated user or throw 401.
 */
export async function requireAuth(request: Request): Promise<SessionUser> {
  const user = await getUserFromRequest(request);
  if (!user) throw new UnauthorizedError('Not authenticated');
  return user;
}

/**
 * Require authenticated user with specific permission or throw 403.
 */
export async function requireAuthWithPermission(request: Request, permission: Permission): Promise<SessionUser> {
  const user = await requireAuth(request);
  if (!hasPermission(user.role, permission)) {
    throw new ForbiddenError(`Requires permission: ${permission}`);
  }
  return user;
}

/**
 * API route wrapper for auth + permission + error handling.
 */
export function withAuth(
  permission: Permission | null,
  handler: (user: SessionUser, request: Request) => Promise<Response>
) {
  return async (request: Request): Promise<Response> => {
    try {
      const user = permission
        ? await requireAuthWithPermission(request, permission)
        : await requireAuth(request);

      // Set firm context for RLS enforcement
      await setFirmContext(user.firmId);

      try {
        return await handler(user, request);
      } finally {
        await clearFirmContext();
      }
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        return Response.json(
          { error: { code: 'UNAUTHORIZED', message: err.message } },
          { status: 401 }
        );
      }
      if (err instanceof ForbiddenError) {
        return Response.json(
          { error: { code: 'FORBIDDEN', message: err.message } },
          { status: 403 }
        );
      }
      console.error('API error:', err);
      return Response.json(
        { error: { code: 'INTERNAL', message: 'Internal server error' } },
        { status: 500 }
      );
    }
  };
}
