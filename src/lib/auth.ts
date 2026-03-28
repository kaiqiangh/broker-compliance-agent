import { hash, compare } from 'bcryptjs';
import { prisma } from './prisma';
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

// ─── API route auth middleware ───────────────────────────────

/**
 * In-memory session store for MVP (replace with NextAuth/JWT in production).
 * Maps session token → user info.
 */
const sessions = new Map<string, { user: SessionUser; expiresAt: number }>();

const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

export function createSession(user: SessionUser): string {
  const token = crypto.randomUUID();
  sessions.set(token, { user, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

export function getSession(token: string): SessionUser | null {
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }
  // Sliding window: refresh expiry on access
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session.user;
}

export function deleteSession(token: string): void {
  sessions.delete(token);
}

// Periodic cleanup of expired sessions (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (now > session.expiresAt) {
      sessions.delete(token);
    }
  }
}, 5 * 60 * 1000);

/**
 * Extract session from request cookie.
 */
export function getUserFromRequest(request: Request): SessionUser | null {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;

  // Parse cookies manually to handle URL encoding
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
export function requireAuth(request: Request): SessionUser {
  const user = getUserFromRequest(request);
  if (!user) throw new UnauthorizedError('Not authenticated');
  return user;
}

/**
 * Require authenticated user with specific permission or throw 403.
 */
export function requireAuthWithPermission(request: Request, permission: Permission): SessionUser {
  const user = requireAuth(request);
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
        ? requireAuthWithPermission(request, permission)
        : requireAuth(request);
      return await handler(user, request);
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
