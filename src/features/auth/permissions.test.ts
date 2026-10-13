import { describe, expect, it } from 'vitest';
import { canAccessRoute, canViewAdminWorkflow, homePathForRole, isReadOnlyDemo } from './permissions';

describe('role access', () => {
  it('keeps managers in the read-only analysis area', () => {
    expect(canAccessRoute('manager', '/')).toBe(true);
    expect(canAccessRoute('manager', '/reports')).toBe(true);
    expect(canAccessRoute('manager', '/stock')).toBe(false);
    expect(canAccessRoute('manager', '/closing')).toBe(false);
    expect(canAccessRoute('manager', '/manage')).toBe(false);
  });

  it('gives Front the daily workflows and read-only expense access', () => {
    expect(canAccessRoute('front', '/')).toBe(true);
    for (const path of ['/production', '/menus', '/stock', '/waste', '/closing', '/expenses']) {
      expect(canAccessRoute('front', path)).toBe(true);
    }
    expect(canAccessRoute('front', '/reports')).toBe(false);
    expect(canAccessRoute('front', '/manage')).toBe(false);
  });

  it('keeps Kitchen in expenses and reserves settings for Website Admin', () => {
    expect(canAccessRoute('kitchen', '/')).toBe(true);
    expect(canAccessRoute('kitchen', '/expenses')).toBe(true);
    expect(canAccessRoute('kitchen', '/waste')).toBe(false);
    expect(canAccessRoute('kitchen', '/manage')).toBe(false);
    expect(canAccessRoute('kitchen', '/menus')).toBe(false);
    expect(canAccessRoute('manager', '/menus')).toBe(false);
    expect(canAccessRoute('admin', '/menus')).toBe(true);
    expect(canAccessRoute('admin', '/manage')).toBe(true);
    expect(canAccessRoute('admin', '/activity')).toBe(true);
  });

  it('gives Website Auditor read-only routes across the workspace', () => {
    for (const path of ['/', '/production', '/menus', '/stock', '/waste', '/closing', '/expenses', '/reports', '/manage', '/activity']) {
      expect(canAccessRoute('auditor', path)).toBe(true);
    }
    expect(isReadOnlyDemo('auditor')).toBe(true);
    expect(canViewAdminWorkflow('auditor')).toBe(true);
    expect(isReadOnlyDemo('admin')).toBe(false);
    expect(canViewAdminWorkflow('admin')).toBe(true);
    expect(canViewAdminWorkflow('manager')).toBe(false);
  });

  it('sends each role to its main workspace', () => {
    expect(homePathForRole('front')).toBe('/');
    expect(homePathForRole('kitchen')).toBe('/');
    expect(homePathForRole('manager')).toBe('/');
    expect(homePathForRole('admin')).toBe('/');
    expect(homePathForRole('auditor')).toBe('/');
  });
});
