import { describe, it, expect } from 'vitest';
import { hasPermission, hasMinRole, ForbiddenError, UnauthorizedError } from '../../lib/rbac';
import type { Role } from '../../lib/rbac';

describe('hasPermission', () => {
  it('firm_admin has all permissions', () => {
    const allPerms = ['import', 'view_all', 'view_own', 'complete_items', 'sign_off', 'admin', 'invite_users', 'manage_firm', 'export_audit'] as const;
    for (const perm of allPerms) {
      expect(hasPermission('firm_admin', perm)).toBe(true);
    }
  });

  it('adviser has limited permissions', () => {
    expect(hasPermission('adviser', 'view_own')).toBe(true);
    expect(hasPermission('adviser', 'complete_items')).toBe(true);
    expect(hasPermission('adviser', 'import')).toBe(false);
    expect(hasPermission('adviser', 'sign_off')).toBe(false);
    expect(hasPermission('adviser', 'admin')).toBe(false);
  });

  it('read_only can only view', () => {
    expect(hasPermission('read_only', 'view_all')).toBe(true);
    expect(hasPermission('read_only', 'view_own')).toBe(false);
    expect(hasPermission('read_only', 'complete_items')).toBe(false);
    expect(hasPermission('read_only', 'import')).toBe(false);
  });

  it('compliance_officer can sign off but not admin', () => {
    expect(hasPermission('compliance_officer', 'sign_off')).toBe(true);
    expect(hasPermission('compliance_officer', 'import')).toBe(true);
    expect(hasPermission('compliance_officer', 'admin')).toBe(false);
    expect(hasPermission('compliance_officer', 'invite_users')).toBe(false);
  });

  it('returns false for unknown role', () => {
    expect(hasPermission('unknown_role' as Role, 'view_all')).toBe(false);
  });
});

describe('hasMinRole', () => {
  it('firm_admin >= all roles', () => {
    expect(hasMinRole('firm_admin', 'firm_admin')).toBe(true);
    expect(hasMinRole('firm_admin', 'compliance_officer')).toBe(true);
    expect(hasMinRole('firm_admin', 'adviser')).toBe(true);
    expect(hasMinRole('firm_admin', 'read_only')).toBe(true);
  });

  it('read_only is not >= any higher role', () => {
    expect(hasMinRole('read_only', 'adviser')).toBe(false);
    expect(hasMinRole('read_only', 'compliance_officer')).toBe(false);
    expect(hasMinRole('read_only', 'firm_admin')).toBe(false);
  });

  it('same role >= itself', () => {
    expect(hasMinRole('adviser', 'adviser')).toBe(true);
  });
});

describe('Error classes', () => {
  it('ForbiddenError has status 403', () => {
    const err = new ForbiddenError('nope');
    expect(err.status).toBe(403);
    expect(err.name).toBe('ForbiddenError');
  });

  it('UnauthorizedError has status 401', () => {
    const err = new UnauthorizedError('nope');
    expect(err.status).toBe(401);
    expect(err.name).toBe('UnauthorizedError');
  });
});

describe('Permission enforcement — sign_off vs complete_items', () => {
  // This test verifies the critical fix: adviser CANNOT approve
  it('adviser cannot approve (sign_off required)', () => {
    expect(hasPermission('adviser', 'sign_off')).toBe(false);
  });

  it('adviser can complete (complete_items)', () => {
    expect(hasPermission('adviser', 'complete_items')).toBe(true);
  });

  it('compliance_officer can approve (has sign_off)', () => {
    expect(hasPermission('compliance_officer', 'sign_off')).toBe(true);
  });
});
