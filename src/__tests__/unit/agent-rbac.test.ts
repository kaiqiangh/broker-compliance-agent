import { describe, it, expect } from 'vitest';
import { hasPermission } from '@/lib/rbac';

describe('Agent action RBAC permissions', () => {
  it('firm_admin can confirm actions', () => {
    expect(hasPermission('firm_admin', 'agent:confirm_action')).toBe(true);
  });

  it('firm_admin can configure agent', () => {
    expect(hasPermission('firm_admin', 'agent:configure')).toBe(true);
  });

  it('compliance_officer can confirm but not configure', () => {
    expect(hasPermission('compliance_officer', 'agent:confirm_action')).toBe(true);
    expect(hasPermission('compliance_officer', 'agent:configure')).toBe(false);
  });

  it('adviser can confirm but not reverse', () => {
    expect(hasPermission('adviser', 'agent:confirm_action')).toBe(true);
    expect(hasPermission('adviser', 'agent:reverse_action')).toBe(false);
  });

  it('adviser can view own but not all', () => {
    expect(hasPermission('adviser', 'agent:view_own')).toBe(true);
    expect(hasPermission('adviser', 'agent:view_all')).toBe(false);
  });

  it('read_only can only view own', () => {
    expect(hasPermission('read_only', 'agent:view_own')).toBe(true);
    expect(hasPermission('read_only', 'agent:confirm_action')).toBe(false);
    expect(hasPermission('read_only', 'agent:modify_action')).toBe(false);
    expect(hasPermission('read_only', 'agent:reject_action')).toBe(false);
  });
});
