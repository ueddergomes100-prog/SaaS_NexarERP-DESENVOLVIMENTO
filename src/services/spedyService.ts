import { auth } from './firebase';

const rawApiUrl = (import.meta.env.VITE_BACKEND_API_URL || '').trim();
const API_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : (import.meta.env.DEV ? 'http://localhost:3001' : '');

type SpedyEnv = 'sandbox' | 'production';
type SpedyType = 'service' | 'product' | 'consumer';

const ensureApiUrl = () => {
  if (!API_URL) {
    throw new Error('Backend nao configurado. Configure VITE_BACKEND_API_URL para usar o modulo fiscal.');
  }
  return API_URL;
};

const getAuthHeaders = async (json = true) => {
  const token = await auth.currentUser?.getIdToken();
  if (!token) {
    throw new Error('Usuario nao autenticado.');
  }

  return {
    Authorization: `Bearer ${token}`,
    ...(json ? { 'Content-Type': 'application/json' } : {})
  };
};

/** Erro de chamada a Spedy com o status HTTP original anexado -- a Spedy
 * usa os codigos de forma consistente (ver docs.spedy.com.br/pages/start/erros-e-respostas):
 * 400 e definitivo (nao adianta reenviar sem corrigir os dados), 403 e
 * configuracao (chave/ambiente errados), 429 e limite de requisicoes
 * (reenviar com espera). `retryable` deixa a UI decidir se vale oferecer
 * "tentar de novo" sem o usuario precisar interpretar a mensagem. */
export class SpedyApiError extends Error {
  status: number;
  retryable: boolean;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'SpedyApiError';
    this.status = status;
    this.retryable = status === 429 || status >= 500;
  }
}

const STATUS_MESSAGE_PREFIX: Record<number, string> = {
  400: 'Dados inválidos para a Spedy: ',
  403: 'Configuração da integração fiscal incorreta: ',
  429: 'Limite de requisições da Spedy atingido, aguarde um instante e tente novamente: ',
};

const getApiError = async (response: Response, fallback: string) => {
  let message = fallback;
  try {
    const data = await response.json();
    message = data.error || fallback;
  } catch {
    // mantem o fallback
  }
  const prefix = STATUS_MESSAGE_PREFIX[response.status] || '';
  return new SpedyApiError(`${prefix}${message}`, response.status);
};

const requestJson = async <T>(path: string, options: RequestInit = {}, fallbackError = 'Erro ao comunicar com o backend fiscal.'): Promise<T> => {
  const baseUrl = ensureApiUrl();
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(await getAuthHeaders(options.method !== 'GET')),
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    throw await getApiError(response, fallbackError);
  }

  return response.json();
};

const legacyArgsNotice = (apiKey: string, env: SpedyEnv) => {
  void apiKey;
  void env;
  // Assinatura mantida para compatibilidade com as telas antigas.
};

export interface SpedyInvoice {
  id: string;
  number: number | null;
  series?: string;
  status: 'enqueued' | 'authorized' | 'rejected' | 'canceled' | 'denied' | 'created' | 'processing';
  model: 'serviceInvoice' | 'productInvoice';
  environmentType: 'development' | 'production';
  amount: number;
  description?: string;
  issuedOn: string | null;
  accessKey?: string;
  receiver: {
    name: string;
    federalTaxNumber: string;
    email?: string;
  };
  processingDetail?: {
    status: 'success' | 'processing' | 'failed';
    message: string | null;
    code: string | null;
  };
}

export interface SpedyInvoiceListResponse {
  items: SpedyInvoice[];
  totalCount: number;
  pageCount: number;
  pageSize: number;
  hasNext: boolean;
}

export interface SpedyRuntimeConfig {
  spedyEnabled: boolean;
  spedyApiKeyConfigured: boolean;
  spedyEnvironment: SpedyEnv;
}

export const spedyService = {
  async getRuntimeConfig(): Promise<SpedyRuntimeConfig> {
    return requestJson<SpedyRuntimeConfig>('/api/spedy/config', { method: 'GET' }, 'Erro ao carregar configuracao fiscal.');
  },

  async fetchServiceInvoices(apiKey: string, env: SpedyEnv, page = 1, pageSize = 20): Promise<SpedyInvoiceListResponse> {
    legacyArgsNotice(apiKey, env);
    return requestJson<SpedyInvoiceListResponse>(`/api/spedy/service?page=${page}&pageSize=${pageSize}`, { method: 'GET' }, 'Erro ao buscar notas de servico.');
  },

  async getServiceInvoice(apiKey: string, env: SpedyEnv, id: string): Promise<SpedyInvoice> {
    legacyArgsNotice(apiKey, env);
    return requestJson<SpedyInvoice>(`/api/spedy/service/${id}`, { method: 'GET' }, 'Erro ao consultar nota de servico.');
  },

  async fetchProductInvoices(apiKey: string, env: SpedyEnv, page = 1, pageSize = 20): Promise<SpedyInvoiceListResponse> {
    legacyArgsNotice(apiKey, env);
    return requestJson<SpedyInvoiceListResponse>(`/api/spedy/product?page=${page}&pageSize=${pageSize}`, { method: 'GET' }, 'Erro ao buscar notas de produto.');
  },

  async getProductInvoice(apiKey: string, env: SpedyEnv, id: string): Promise<SpedyInvoice> {
    legacyArgsNotice(apiKey, env);
    return requestJson<SpedyInvoice>(`/api/spedy/product/${id}`, { method: 'GET' }, 'Erro ao consultar nota de produto.');
  },

  async emitServiceInvoice(apiKey: string, env: SpedyEnv, invoiceData: Record<string, unknown>): Promise<SpedyInvoice> {
    legacyArgsNotice(apiKey, env);
    return requestJson<SpedyInvoice>('/api/spedy/service', {
      method: 'POST',
      body: JSON.stringify({ invoiceData })
    }, 'Erro ao emitir NFS-e.');
  },

  async emitProductInvoice(apiKey: string, env: SpedyEnv, invoiceData: Record<string, unknown>): Promise<SpedyInvoice> {
    legacyArgsNotice(apiKey, env);
    return requestJson<SpedyInvoice>('/api/spedy/product', {
      method: 'POST',
      body: JSON.stringify({ invoiceData })
    }, 'Erro ao emitir NF-e.');
  },

  async fetchConsumerInvoices(apiKey: string, env: SpedyEnv, page = 1, pageSize = 20): Promise<SpedyInvoiceListResponse> {
    legacyArgsNotice(apiKey, env);
    return requestJson<SpedyInvoiceListResponse>(`/api/spedy/consumer?page=${page}&pageSize=${pageSize}`, { method: 'GET' }, 'Erro ao buscar cupons fiscais.');
  },

  async getConsumerInvoice(apiKey: string, env: SpedyEnv, id: string): Promise<SpedyInvoice> {
    legacyArgsNotice(apiKey, env);
    return requestJson<SpedyInvoice>(`/api/spedy/consumer/${id}`, { method: 'GET' }, 'Erro ao consultar cupom fiscal.');
  },

  async emitConsumerInvoice(apiKey: string, env: SpedyEnv, invoiceData: Record<string, unknown>): Promise<SpedyInvoice> {
    legacyArgsNotice(apiKey, env);
    return requestJson<SpedyInvoice>('/api/spedy/consumer', {
      method: 'POST',
      body: JSON.stringify({ invoiceData })
    }, 'Erro ao emitir NFC-e.');
  },

  async cancelInvoice(apiKey: string, env: SpedyEnv, type: SpedyType, id: string, justification: string): Promise<{ success: boolean }> {
    legacyArgsNotice(apiKey, env);
    return requestJson<{ success: boolean }>(`/api/spedy/${type}/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ justification })
    }, 'Erro ao solicitar cancelamento da nota fiscal.');
  },

  getPdfUrl(id: string, type: SpedyType): string {
    const baseUrl = ensureApiUrl();
    return `${baseUrl}/api/spedy/${type}/${id}/pdf`;
  },

  getXmlUrl(id: string, type: SpedyType): string {
    const baseUrl = ensureApiUrl();
    return `${baseUrl}/api/spedy/${type}/${id}/xml`;
  },

  async openFiscalFile(id: string, type: SpedyType, fileType: 'pdf' | 'xml') {
    const baseUrl = ensureApiUrl();
    const response = await fetch(`${baseUrl}/api/spedy/${type}/${id}/${fileType}`, {
      method: 'GET',
      headers: await getAuthHeaders(false)
    });

    if (!response.ok) {
      throw await getApiError(response, 'Erro ao baixar arquivo fiscal.');
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);

    if (fileType === 'pdf') {
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return;
    }

    const link = document.createElement('a');
    link.href = url;
    link.download = `${id}.xml`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
};
