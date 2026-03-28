import type { Role } from './rbac';

export type Permission =
  | 'import'
  | 'view_all'
  | 'view_own'
  | 'complete_items'
  | 'sign_off'
  | 'admin'
  | 'invite_users'
  | 'manage_firm'
  | 'export_audit';

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  firm_admin:         ['import', 'view_all', 'view_own', 'complete_items', 'sign_off', 'admin', 'invite_users', 'manage_firm', 'export_audit'],
  compliance_officer: ['import', 'view_all', 'view_own', 'complete_items', 'sign_off', 'export_audit'],
  adviser:            ['view_own', 'complete_items'],
  read_only:          ['view_all'],
};

const ROLE_HIERARCHY: Record<Role, number> = {
  firm_admin: 4,
  compliance_officer: 3,
  adviser: 2,
  read_only: 1,
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function hasMinRole(userRole: Role, minRole: Role): boolean {
  return (ROLE_HIERARCHY[userRole] ?? 0) >= (ROLE_HIERARCHY[minRole] ?? 0);
}

export class ForbiddenError extends Error {
  status = 403;
  constructor(message: string) { super(message); this.name = 'ForbiddenError'; }
}

export class UnauthorizedError extends Error {
  status = 401;
  constructor(message: string) { super(message); this.name = 'UnauthorizedError'; }
}
