import type { AppRole } from './AuthContext';

export const roleLabels: Record<AppRole, string> = {
  admin: 'Website Admin',
  manager: 'Manager · reports',
  front: 'Front',
  kitchen: 'Kitchen',
  auditor: 'Website Auditor · read only',
  coliving: 'Co-living',
};

const routeRoles: Record<string, readonly AppRole[]> = {
  '/': ['admin', 'manager', 'front', 'auditor'],
  '/production': ['admin', 'front', 'auditor'],
  '/menus': ['admin', 'front', 'auditor'],
  '/stock': ['admin', 'front', 'auditor'],
  '/waste': ['admin', 'front', 'auditor'],
  '/closing': ['admin', 'front', 'auditor'],
  '/expenses': ['admin', 'kitchen'],
  '/reports': ['admin', 'manager', 'auditor'],
  '/manage': ['admin', 'auditor'],
  '/activity': ['admin', 'auditor'],
  '/coliving': ['admin', 'coliving'],
  '/coliving/records': ['admin', 'coliving'],
  '/bookings': ['admin', 'manager', 'front', 'auditor'],
};

export function canAccessRoute(role: AppRole, path: string): boolean {
  return routeRoles[path]?.includes(role) ?? false;
}

export function isReadOnlyDemo(role: AppRole | null | undefined): boolean {
  return role === 'auditor';
}

export function canViewAdminWorkflow(role: AppRole | null | undefined): boolean {
  return role === 'admin' || isReadOnlyDemo(role);
}

export function homePathForRole(role: AppRole): string {
  if (role === 'kitchen') return '/expenses';
  if (role === 'coliving') return '/coliving';
  return '/';
}
