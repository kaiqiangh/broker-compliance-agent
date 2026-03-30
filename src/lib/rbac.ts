export type Role = 'firm_admin' | 'compliance_officer' | 'adviser' | 'read_only';

export type Permission =
  | 'import'
  | 'view_all'
  | 'view_own'
  | 'complete_items'
  | 'sign_off'
  | 'admin'
  | 'invite_users'
  | 'manage_firm'
  | 'export_audit'
  | 'agent:confirm_action'
  | 'agent:modify_action'
  | 'agent:reject_action'
  | 'agent:reverse_action'
  | 'agent:bulk_confirm'
  | 'agent:view_all'
  | 'agent:view_own'
  | 'agent:configure';

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  firm_admin:         ['import', 'view_all', 'view_own', 'complete_items', 'sign_off', 'admin', 'invite_users', 'manage_firm', 'export_audit',
                       'agent:confirm_action', 'agent:modify_action', 'agent:reject_action', 'agent:reverse_action', 'agent:bulk_confirm', 'agent:view_all', 'agent:view_own', 'agent:configure'],
  compliance_officer: ['import', 'view_all', 'view_own', 'complete_items', 'sign_off', 'export_audit',
                       'agent:confirm_action', 'agent:modify_action', 'agent:reject_action', 'agent:reverse_action', 'agent:view_all', 'agent:view_own'],
  adviser:            ['view_own', 'complete_items',
                       'agent:confirm_action', 'agent:modify_action', 'agent:reject_action', 'agent:view_own'],
  read_only:          ['view_all',
                       'agent:view_own'],
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
