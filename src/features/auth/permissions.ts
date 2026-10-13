import type { AppRole } from './AuthContext';

export const roleLabels: Record<AppRole, string> = {
  admin: 'Website Admin',
  manager: 'Manager · reports',
  front: 'Front',
  kitchen: 'Kitchen',
  auditor: 'Website Auditor · read only',
};

const routeRoles: Record<string, readonly AppRole[]> = {
  '/': ['admin', 'manager', 'front', 'kitchen', 'auditor'],
  '/production': ['admin', 'front', 'auditor'],
  '/menus': ['admin', 'front', 'auditor'],
  '/stock': ['admin', 'front', 'auditor'],
  '/waste': ['admin', 'front', 'auditor'],
  '/closing': ['admin', 'front', 'auditor'],
  '/expenses': ['admin', 'front', 'kitchen', 'auditor'],
  '/reports': ['admin', 'manager', 'auditor'],
  '/manage': ['admin', 'auditor'],
  '/activity': ['admin', 'auditor'],
};

export function canAccessRoute(role: AppRole, path: string): boolean {
  return routeRoles[path]?.includes(role) ?? false;
}

export function homePathForRole(role: AppRole): string {
  void role;
  return '/';
}
