import { auth } from './firebase';

const rawApiUrl = (import.meta.env.VITE_BACKEND_API_URL || '').trim();
const API_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : (import.meta.env.DEV ? 'http://localhost:3001' : '');

export type SpedyEnv = 'sandbox' | 'production';

/**
 * Cadastro de empresa+certificado na Spedy pelo admin da PLATAFORMA (nao
 * do tenant) -- automatiza o passo manual de hoje (pedir a chave pro
 * consultor da Spedy e colar em Configuracoes). Ver
 * server/routes/spedyCompanies.routes.js. So chamado de src/pages/Admin/SuperAdmin.tsx.
 */

const ensureApiUrl = () => {
  if (!API_URL) {
    throw new Error('Backend nao configurado. Configure VITE_BACKEND_API_URL para usar o cadastro de empresas na Spedy.');
  }
  return API_URL;
};

const getAuthHeaders = async () => {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Usuario nao autenticado.');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
};

const requestJson = async <T>(path: string, options: RequestInit, fallbackError: string): Promise<T> => {
  const baseUrl = ensureApiUrl();
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...(await getAuthHeaders()), ...(options.headers || {}) },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || fallbackError);
  }
  return response.json();
};

/** Le um arquivo (o .pfx do certificado) como base64, sem o prefixo
 * "data:...;base64," que o FileReader inclui -- o backend so quer o
 * conteudo puro pra converter em multipart/form-data antes de mandar pra
 * Spedy. */
const readFileAsBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const result = String(reader.result || '');
    const base64 = result.includes(',') ? result.split(',')[1] : result;
    resolve(base64);
  };
  reader.onerror = () => reject(new Error('Não foi possível ler o arquivo do certificado.'));
  reader.readAsDataURL(file);
});

export interface SpedyMasterKeyStatus {
  sandboxConfigured: boolean;
  productionConfigured: boolean;
}

export interface SpedyCompanyCreated {
  companyId: string;
  environment: SpedyEnv;
}

export interface SpedyCertificateResult {
  id: string;
  expirationAt: string | null;
  subject: string | null;
  issuer: string | null;
  isActive: boolean;
}

export const spedyAdminService = {
  async getMasterKeyStatus(): Promise<SpedyMasterKeyStatus> {
    return requestJson<SpedyMasterKeyStatus>('/api/spedy-admin/master-key', { method: 'GET' }, 'Erro ao carregar a chave mestra da Spedy.');
  },

  async saveMasterKey(environment: SpedyEnv, apiKey: string): Promise<void> {
    await requestJson('/api/spedy-admin/master-key', {
      method: 'POST',
      body: JSON.stringify({ environment, apiKey }),
    }, 'Erro ao salvar a chave mestra da Spedy.');
  },

  async createCompany(tenantId: string, environment: SpedyEnv): Promise<SpedyCompanyCreated> {
    return requestJson<SpedyCompanyCreated>('/api/spedy-admin/companies', {
      method: 'POST',
      body: JSON.stringify({ tenantId, environment }),
    }, 'Erro ao cadastrar a empresa na Spedy.');
  },

  async updateCompanySettings(tenantId: string, environment: SpedyEnv): Promise<SpedyCompanyCreated> {
    return requestJson<SpedyCompanyCreated>(`/api/spedy-admin/companies/${tenantId}/settings`, {
      method: 'PUT',
      body: JSON.stringify({ environment }),
    }, 'Erro ao atualizar os dados da empresa na Spedy.');
  },

  async uploadCertificate(tenantId: string, environment: SpedyEnv, certificado: File, senha: string): Promise<SpedyCertificateResult> {
    const certificadoBase64 = await readFileAsBase64(certificado);
    return requestJson<SpedyCertificateResult>(`/api/spedy-admin/companies/${tenantId}/certificate`, {
      method: 'POST',
      body: JSON.stringify({ certificadoBase64, certificadoSenha: senha, environment }),
    }, 'Erro ao enviar o certificado digital.');
  },
};
