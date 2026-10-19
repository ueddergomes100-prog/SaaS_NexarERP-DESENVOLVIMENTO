"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasModuleAccess = exports.hasTenantFullAccess = exports.isTenantManagerRole = exports.isPlatformAdminRole = exports.normalizeUserRole = void 0;
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
const hasTenantFullAccess = (role, isOwner) => {
    return isOwner || (0, exports.isTenantManagerRole)(role) || (0, exports.isPlatformAdminRole)(role);
};
exports.hasTenantFullAccess = hasTenantFullAccess;
/**
 * Padrao de acesso a modulo/catalogo: dono, papel de plataforma/gestor da
 * empresa, ou permissao especifica concedida ao funcionario.
 */
const hasModuleAccess = (args) => {
    return (0, exports.hasTenantFullAccess)(args.role, args.isOwner) ||
        !!args.permissions?.includes(args.requiredPermission);
};
exports.hasModuleAccess = hasModuleAccess;
