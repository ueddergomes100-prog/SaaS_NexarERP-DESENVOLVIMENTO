export type UserRole = 'NexarAdmin' | 'SuperAdmin' | 'Master' | 'Admin' | 'Funcionario';

const VALID_ROLES: UserRole[] = ['NexarAdmin', 'SuperAdmin', 'Master', 'Admin', 'Funcionario'];
const PLATFORM_ROLES: UserRole[] = ['NexarAdmin', 'SuperAdmin'];
const TENANT_MANAGER_ROLES: UserRole[] = ['Master', 'Admin'];

export const normalizeUserRole = (role: unknown, fallback: UserRole = 'Funcionario'): UserRole => {
  return VALID_ROLES.includes(role as UserRole) ? role as UserRole : fallback;
};

export const isPlatformAdminRole = (role: unknown): boolean => {
  return PLATFORM_ROLES.includes(role as UserRole);
};

export const isTenantManagerRole = (role: unknown): boolean => {
  return TENANT_MANAGER_ROLES.includes(role as UserRole);
};

export const hasTenantFullAccess = (role: unknown, isOwner: boolean): boolean => {
  return isOwner || isTenantManagerRole(role) || isPlatformAdminRole(role);
};
