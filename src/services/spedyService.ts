// Servico de integracao com a Spedy API para emissao de Notas Fiscais (NF-e e NFS-e)

const SANDBOX_URL = 'https://sandbox-api.spedy.com.br/v1';
const PRODUCTION_URL = 'https://api.spedy.com.br/v1';

const getBaseUrl = (env: 'sandbox' | 'production'): string => {
  return env === 'sandbox' ? SANDBOX_URL : PRODUCTION_URL;
};

const getHeaders = (apiKey: string) => {
  return {
    'Content-Type': 'application/json',
    'X-Api-Key': apiKey,
  };
};

export interface SpedyInvoice {
  id: string;
  number: number | null;
  series?: string;
  status: 'enqueued' | 'authorized' | 'rejected' | 'canceled' | 'denied' | 'created';
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

export const spedyService = {
  /**
   * Busca a lista de NFS-e (Serviço) emitidas
   */
  async fetchServiceInvoices(
    apiKey: string,
    env: 'sandbox' | 'production',
    page = 1,
    pageSize = 20
  ): Promise<SpedyInvoiceListResponse> {
    const baseUrl = getBaseUrl(env);
    const response = await fetch(`${baseUrl}/service-invoices?page=${page}&pageSize=${pageSize}`, {
      method: 'GET',
      headers: getHeaders(apiKey),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.errors?.[0]?.message || 'Erro ao buscar notas de serviço no Spedy.');
    }

    return response.json();
  },

  /**
   * Busca uma NFS-e (Serviço) individual pelo ID
   */
  async getServiceInvoice(
    apiKey: string,
    env: 'sandbox' | 'production',
    id: string
  ): Promise<SpedyInvoice> {
    const baseUrl = getBaseUrl(env);
    const response = await fetch(`${baseUrl}/service-invoices/${id}`, {
      method: 'GET',
      headers: getHeaders(apiKey),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.errors?.[0]?.message || 'Erro ao consultar nota de serviço no Spedy.');
    }

    return response.json();
  },

  /**
   * Busca a lista de NF-e (Produto) emitidas
   */
  async fetchProductInvoices(
    apiKey: string,
    env: 'sandbox' | 'production',
    page = 1,
    pageSize = 20
  ): Promise<SpedyInvoiceListResponse> {
    const baseUrl = getBaseUrl(env);
    const response = await fetch(`${baseUrl}/product-invoices?page=${page}&pageSize=${pageSize}`, {
      method: 'GET',
      headers: getHeaders(apiKey),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.errors?.[0]?.message || 'Erro ao buscar notas de produto no Spedy.');
    }

    return response.json();
  },

  /**
   * Busca uma NF-e (Produto) individual pelo ID
   */
  async getProductInvoice(
    apiKey: string,
    env: 'sandbox' | 'production',
    id: string
  ): Promise<SpedyInvoice> {
    const baseUrl = getBaseUrl(env);
    const response = await fetch(`${baseUrl}/product-invoices/${id}`, {
      method: 'GET',
      headers: getHeaders(apiKey),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.errors?.[0]?.message || 'Erro ao consultar nota de produto no Spedy.');
    }

    return response.json();
  },

  /**
   * Emite uma nota fiscal de serviço (NFS-e)
   */
  async emitServiceInvoice(
    apiKey: string,
    env: 'sandbox' | 'production',
    invoiceData: Record<string, unknown>
  ): Promise<SpedyInvoice> {
    const baseUrl = getBaseUrl(env);
    const response = await fetch(`${baseUrl}/service-invoices`, {
      method: 'POST',
      headers: getHeaders(apiKey),
      body: JSON.stringify(invoiceData),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.errors?.[0]?.message || 'Erro ao emitir NFS-e.');
    }

    return response.json();
  },

  /**
   * Emite uma nota fiscal de produto (NF-e)
   */
  async emitProductInvoice(
    apiKey: string,
    env: 'sandbox' | 'production',
    invoiceData: Record<string, unknown>
  ): Promise<SpedyInvoice> {
    const baseUrl = getBaseUrl(env);
    const response = await fetch(`${baseUrl}/product-invoices`, {
      method: 'POST',
      headers: getHeaders(apiKey),
      body: JSON.stringify(invoiceData),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.errors?.[0]?.message || 'Erro ao emitir NF-e.');
    }

    return response.json();
  },

  /**
   * Busca a lista de NFC-e (Cupom Fiscal) emitidas
   */
  async fetchConsumerInvoices(
    apiKey: string,
    env: 'sandbox' | 'production',
    page = 1,
    pageSize = 20
  ): Promise<SpedyInvoiceListResponse> {
    const baseUrl = getBaseUrl(env);
    const response = await fetch(`${baseUrl}/consumer-invoices?page=${page}&pageSize=${pageSize}`, {
      method: 'GET',
      headers: getHeaders(apiKey),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.errors?.[0]?.message || 'Erro ao buscar cupons fiscais no Spedy.');
    }

    return response.json();
  },

  /**
   * Busca uma NFC-e (Cupom Fiscal) individual pelo ID
   */
  async getConsumerInvoice(
    apiKey: string,
    env: 'sandbox' | 'production',
    id: string
  ): Promise<SpedyInvoice> {
    const baseUrl = getBaseUrl(env);
    const response = await fetch(`${baseUrl}/consumer-invoices/${id}`, {
      method: 'GET',
      headers: getHeaders(apiKey),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.errors?.[0]?.message || 'Erro ao consultar cupom fiscal no Spedy.');
    }

    return response.json();
  },

  /**
   * Emite uma nota fiscal de consumidor (NFC-e / Cupom Fiscal)
   */
  async emitConsumerInvoice(
    apiKey: string,
    env: 'sandbox' | 'production',
    invoiceData: Record<string, unknown>
  ): Promise<SpedyInvoice> {
    const baseUrl = getBaseUrl(env);
    const response = await fetch(`${baseUrl}/consumer-invoices`, {
      method: 'POST',
      headers: getHeaders(apiKey),
      body: JSON.stringify(invoiceData),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.errors?.[0]?.message || 'Erro ao emitir NFC-e.');
    }

    return response.json();
  },

  /**
   * Cancela uma nota fiscal (NF-e, NFS-e ou NFC-e)
   */
  async cancelInvoice(
    apiKey: string,
    env: 'sandbox' | 'production',
    type: 'service' | 'product' | 'consumer',
    id: string,
    justification: string
  ): Promise<{ success: boolean }> {
    const baseUrl = getBaseUrl(env);
    const pathSegment =
      type === 'service'
        ? 'service-invoices'
        : type === 'product'
        ? 'product-invoices'
        : 'consumer-invoices';

    const response = await fetch(`${baseUrl}/${pathSegment}/${id}`, {
      method: 'DELETE',
      headers: getHeaders(apiKey),
      body: JSON.stringify({ justification }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.errors?.[0]?.message || 'Erro ao solicitar cancelamento da nota fiscal.');
    }

    return response.json();
  },

  /**
   * Retorna a URL direta de download do PDF (DANFE/Extrato) sem exigir headers
   */
  getPdfUrl(id: string, type: 'service' | 'product' | 'consumer', env: 'sandbox' | 'production'): string {
    const baseUrl = getBaseUrl(env);
    const pathSegment =
      type === 'service'
        ? 'service-invoices'
        : type === 'product'
        ? 'product-invoices'
        : 'consumer-invoices';
    return `${baseUrl}/${pathSegment}/${id}/pdf`;
  },

  /**
   * Retorna a URL direta de download do XML sem exigir headers
   */
  getXmlUrl(id: string, type: 'service' | 'product' | 'consumer', env: 'sandbox' | 'production'): string {
    const baseUrl = getBaseUrl(env);
    const pathSegment =
      type === 'service'
        ? 'service-invoices'
        : type === 'product'
        ? 'product-invoices'
        : 'consumer-invoices';
    return `${baseUrl}/${pathSegment}/${id}/xml`;
  }
};
