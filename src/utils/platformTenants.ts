import { collection, getDocs } from 'firebase/firestore';
import { db } from '../services/firebase';
import { isPlatformAdminRole, normalizeUserRole } from './roles';

export interface TenantOption {
  id: string;
  nomeOficina: string;
  email: string;
}

export const activeTenantStorageKey = (uid: string) => `nexus_active_tenant_id:${uid}`;

export const loadTenantOptions = async (): Promise<TenantOption[]> => {
  const snap = await getDocs(collection(db, 'usuarios'));
  const tenants = new Map<string, TenantOption>();

  snap.forEach(userDoc => {
    const data = userDoc.data() as Record<string, unknown>;
    const role = normalizeUserRole(data.role, 'Funcionario');

    if (isPlatformAdminRole(role)) {
      return;
    }

    const profileTenantId = typeof data.tenantId === 'string' && data.tenantId ? data.tenantId : userDoc.id;
    const isTenantOwner = role === 'Master' || role === 'Admin' || userDoc.id === profileTenantId;

    if (!isTenantOwner) {
      return;
    }

    const currentTenant = tenants.get(profileTenantId);
    const isPrimaryTenantDoc = userDoc.id === profileTenantId;
    if (currentTenant && !isPrimaryTenantDoc && currentTenant.nomeOficina !== 'Empresa sem nome') {
      return;
    }

    tenants.set(profileTenantId, {
      id: profileTenantId,
      nomeOficina: String(data.nomeOficina || data.nome || 'Empresa sem nome'),
      email: String(data.email || '')
    });
  });

  return Array.from(tenants.values()).sort((a, b) => a.nomeOficina.localeCompare(b.nomeOficina));
};
