import { collection, getDocs } from 'firebase/firestore';
import { db } from '../services/firebase';
import { isPlatformAdminRole, normalizeUserRole } from './roles';
import { lerGrupo, rotuloFilial } from './filialDomain';

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

  // Filiais (2026-10-06): a filial nao tem usuario proprio (quem trabalha
  // nela entra pela matriz), entao vem do cadastro do grupo.
  try {
    const grupos = await getDocs(collection(db, 'grupos'));
    grupos.forEach((grupoDoc) => {
      const grupo = lerGrupo(grupoDoc.id, grupoDoc.data());
      const matriz = tenants.get(grupo.matrizTenantId);
      grupo.filiais.filter((f) => !f.matriz && !tenants.has(f.tenantId)).forEach((f) => {
        tenants.set(f.tenantId, {
          id: f.tenantId,
          nomeOficina: `${matriz?.nomeOficina || grupo.nome} · filial ${rotuloFilial(f)}${f.ativa ? '' : ' (inativa)'}`,
          email: matriz?.email || '',
        });
      });
    });
  } catch (erro) {
    console.warn('Seletor de empresas: não foi possível listar as filiais.', erro);
  }

  return Array.from(tenants.values()).sort((a, b) => a.nomeOficina.localeCompare(b.nomeOficina));
};
