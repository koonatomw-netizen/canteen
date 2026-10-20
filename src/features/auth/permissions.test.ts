import { describe, expect, it } from 'vitest';
import { canAccessRoute, canViewAdminWorkflow, homePathForRole, isReadOnlyDemo } from './permissions';

describe('role access', () => {
  it('keeps managers in the read-only analysis area', () => {
    expect(canAccessRoute('manager', '/')).toBe(true);
    expect(canAccessRoute('manager', '/reports')).toBe(true);
    expect(canAccessRoute('manager', '/expenses')).toBe(false);
    expect(canAccessRoute('manager', '/stock')).toBe(false);
    expect(canAccessRoute('manager', '/closing')).toBe(false);
    expect(canAccessRoute('manager', '/manage')).toBe(false);
  });

  it('keeps Co-living scoped to its own tracker while managers inspect it through Reports', () => {
    expect(canAccessRoute('coliving', '/coliving')).toBe(true);
    expect(canAccessRoute('coliving', '/coliving/records')).toBe(true);
    expect(canAccessRoute('coliving', '/')).toBe(false);
    expect(canAccessRoute('coliving', '/reports')).toBe(false);
    expect(canAccessRoute('coliving', '/stock')).toBe(false);
    expect(canAccessRoute('manager', '/coliving')).toBe(false);
    expect(canAccessRoute('manager', '/coliving/records')).toBe(false);
    expect(canAccessRoute('manager', '/reports')).toBe(true);
    expect(canAccessRoute('admin', '/coliving')).toBe(true);
    expect(canAccessRoute('admin', '/coliving/records')).toBe(true);
    expect(canAccessRoute('auditor', '/coliving')).toBe(false);
  });

  it('gives Front the daily workflows without expense access', () => {
    expect(canAccessRoute('front', '/')).toBe(true);
    for (const path of ['/production', '/menus', '/stock', '/waste', '/closing']) {
      expect(canAccessRoute('front', path)).toBe(true);
    }
    expect(canAccessRoute('front', '/expenses')).toBe(false);
    expect(canAccessRoute('front', '/reports')).toBe(false);
    expect(canAccessRoute('front', '/manage')).toBe(false);
  });

  it('keeps Kitchen in expenses and reserves settings for Website Admin', () => {
    expect(canAccessRoute('kitchen', '/')).toBe(false);
    expect(canAccessRoute('kitchen', '/expenses')).toBe(true);
    expect(canAccessRoute('kitchen', '/waste')).toBe(false);
    expect(canAccessRoute('kitchen', '/manage')).toBe(false);
    expect(canAccessRoute('kitchen', '/menus')).toBe(false);
    expect(canAccessRoute('manager', '/menus')).toBe(false);
    expect(canAccessRoute('admin', '/menus')).toBe(true);
    expect(canAccessRoute('admin', '/expenses')).toBe(true);
    expect(canAccessRoute('admin', '/manage')).toBe(true);
    expect(canAccessRoute('admin', '/activity')).toBe(true);
  });

  it('shares podcast bookings only with the operational booking roles', () => {
    for (const role of ['admin', 'manager', 'front', 'auditor'] as const) {
      expect(canAccessRoute(role, '/bookings')).toBe(true);
    }
    expect(canAccessRoute('kitchen', '/bookings')).toBe(false);
    expect(canAccessRoute('coliving', '/bookings')).toBe(false);
  });

  it('gives Website Auditor read-only routes across the workspace', () => {
    for (const path of ['/', '/production', '/menus', '/stock', '/waste', '/closing', '/reports', '/manage', '/activity']) {
      expect(canAccessRoute('auditor', path)).toBe(true);
    }
    expect(canAccessRoute('auditor', '/expenses')).toBe(false);
    expect(isReadOnlyDemo('auditor')).toBe(true);
    expect(canViewAdminWorkflow('auditor')).toBe(true);
    expect(isReadOnlyDemo('admin')).toBe(false);
    expect(canViewAdminWorkflow('admin')).toBe(true);
    expect(canViewAdminWorkflow('manager')).toBe(false);
  });

  it('sends each role to its main workspace', () => {
    expect(homePathForRole('front')).toBe('/');
    expect(homePathForRole('kitchen')).toBe('/expenses');
    expect(homePathForRole('manager')).toBe('/');
    expect(homePathForRole('admin')).toBe('/');
    expect(homePathForRole('auditor')).toBe('/');
    expect(homePathForRole('coliving')).toBe('/coliving');
  });
});
