import type { UserRole } from '@domdelo/domain';

export function roleHomePath(role: UserRole): string {
  if (role === 'authority') return '/reports';
  if (['dispatcher', 'executor', 'admin'].includes(role)) return '/dispatcher';
  return '/';
}
