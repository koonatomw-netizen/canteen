import type { AppRole } from './AuthContext';

export const roleLabels: Record<AppRole, string> = {
  admin: 'Website Admin',
  manager: 'Manager · reports',
  front: 'Front',
  kitchen: 'Kitchen',
};

const routeRoles: Record<string, readonly AppRole[]> = {
  '/': ['admin', 'manager', 'front', 'kitchen'],
  '/production': ['admin', 'front'],
  '/stock': ['admin', 'front'],
  '/waste': ['admin', 'front'],
  '/closing': ['admin', 'front'],
  '/expenses': ['admin', 'front', 'kitchen'],
  '/reports': ['admin', 'manager'],
  '/manage': ['admin'],
  '/activity': ['admin'],
};

export function canAccessRoute(role: AppRole, path: string): boolean {
  return routeRoles[path]?.includes(role) ?? false;
}

export function homePathForRole(role: AppRole): string {
  void role;
  return '/';
}
