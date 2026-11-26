import { administradorTemSemPacote } from './papelAdministradorDomain';

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

/**
 * Liberado em tudo sem olhar permissao: o DONO da empresa e a equipe da
 * plataforma. Troca do administrador (25/11/2026, decisao do dono: "o dono
 * sempre pode; o resto so' com a permissao marcada"): o papel Master/Admin
 * deixou de liberar sozinho -- o administrador passa pelas permissoes
 * efetivas (permissoesNovasDomain.ts, pacote 'administrador-1': enquanto o
 * dono nao salvar as permissoes dele, sao todas). `isTenantManagerRole` fica
 * so' para saber QUEM e' administrador (alvo da Equipe, rotulos).
 */
export const hasTenantFullAccess = (role: unknown, isOwner: boolean): boolean => {
  return isOwner || isPlatformAdminRole(role);
};

/**
 * Padrao de acesso a modulo/catalogo: dono, plataforma, ou a permissao
 * concedida ao funcionario ou ao administrador. `permissions` pode vir crua
 * (cadastro de outra pessoa lido do banco): o administrador cujo pacote o
 * dono ainda nao salvou conta com todas (papelAdministradorDomain.ts).
 */
export const hasModuleAccess = (args: {
  role: unknown;
  isOwner: boolean;
  permissions: string[] | null | undefined;
  requiredPermission: string;
}): boolean => {
  return hasTenantFullAccess(args.role, args.isOwner) ||
    !!args.permissions?.includes(args.requiredPermission) ||
    administradorTemSemPacote(args.permissions, args.role, args.requiredPermission);
};
