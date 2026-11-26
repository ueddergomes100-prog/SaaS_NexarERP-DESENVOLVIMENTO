"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasModuleAccess = exports.hasTenantFullAccess = exports.isTenantManagerRole = exports.isPlatformAdminRole = exports.normalizeUserRole = void 0;
const papelAdministradorDomain_1 = require("./papelAdministradorDomain");
const VALID_ROLES = ['NexarAdmin', 'SuperAdmin', 'Master', 'Admin', 'Funcionario'];
const PLATFORM_ROLES = ['NexarAdmin', 'SuperAdmin'];
const TENANT_MANAGER_ROLES = ['Master', 'Admin'];
const normalizeUserRole = (role, fallback = 'Funcionario') => {
    return VALID_ROLES.includes(role) ? role : fallback;
};
exports.normalizeUserRole = normalizeUserRole;
const isPlatformAdminRole = (role) => {
    return PLATFORM_ROLES.includes(role);
};
exports.isPlatformAdminRole = isPlatformAdminRole;
const isTenantManagerRole = (role) => {
    return TENANT_MANAGER_ROLES.includes(role);
};
exports.isTenantManagerRole = isTenantManagerRole;
/**
 * Liberado em tudo sem olhar permissao: o DONO da empresa e a equipe da
 * plataforma. Troca do administrador (25/11/2026, decisao do dono: "o dono
 * sempre pode; o resto so' com a permissao marcada"): o papel Master/Admin
 * deixou de liberar sozinho -- o administrador passa pelas permissoes
 * efetivas (permissoesNovasDomain.ts, pacote 'administrador-1': enquanto o
 * dono nao salvar as permissoes dele, sao todas). `isTenantManagerRole` fica
 * so' para saber QUEM e' administrador (alvo da Equipe, rotulos).
 */
const hasTenantFullAccess = (role, isOwner) => {
    return isOwner || (0, exports.isPlatformAdminRole)(role);
};
exports.hasTenantFullAccess = hasTenantFullAccess;
/**
 * Padrao de acesso a modulo/catalogo: dono, plataforma, ou a permissao
 * concedida ao funcionario ou ao administrador. `permissions` pode vir crua
 * (cadastro de outra pessoa lido do banco): o administrador cujo pacote o
 * dono ainda nao salvou conta com todas (papelAdministradorDomain.ts).
 */
const hasModuleAccess = (args) => {
    return (0, exports.hasTenantFullAccess)(args.role, args.isOwner) ||
        !!args.permissions?.includes(args.requiredPermission) ||
        (0, papelAdministradorDomain_1.administradorTemSemPacote)(args.permissions, args.role, args.requiredPermission);
};
exports.hasModuleAccess = hasModuleAccess;
