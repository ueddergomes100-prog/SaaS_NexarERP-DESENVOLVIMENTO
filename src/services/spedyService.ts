import { auth } from './firebase';
import { fetchComTimeout, mensagemDeFalhaDeRede, TEMPO_LIMITE } from '../utils/fetchComTimeout';

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
    // 0 = a chamada nem chegou (rede fora, tempo esgotado): vale tentar de novo.
    this.retryable = status === 0 || status === 429 || status >= 500;
  }
}

const MENSAGEM_REDE = 'Não foi possível falar com o servidor fiscal. Verifique a internet e tente de novo.';

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

/**
 * `timeoutMs`: padrao 30 s; emissao/cancelamento de nota usam
 * TEMPO_LIMITE.emissaoNota, porque a Spedy pode esperar a SEFAZ antes de
 * responder. Rede fora ou tempo esgotado viram SpedyApiError(status 0) com
 * mensagem em portugues -- "Failed to fetch" nunca chega na tela.
 */
const requestJson = async <T>(
  path: string,
  options: RequestInit = {},
  fallbackError = 'Erro ao comunicar com o backend fiscal.',
  timeoutMs: number = TEMPO_LIMITE.padrao,
): Promise<T> => {
  const baseUrl = ensureApiUrl();
  const headers = {
    ...(await getAuthHeaders(options.method !== 'GET')),
    ...(options.headers || {})
  };

  let response: Response;
  try {
    response = await fetchComTimeout(`${baseUrl}${path}`, { ...options, headers }, timeoutMs);
  } catch (erro) {
    throw new SpedyApiError(mensagemDeFalhaDeRede(erro, MENSAGEM_REDE), 0);
  }

  if (!response.ok) {
    throw await getApiError(response, fallbackError);
  }

  return response.json();
};

/** Arquivo (PDF/XML) do backend fiscal, com o mesmo tratamento de rede/tempo. */
const requestBlob = async (path: string, fallbackError: string): Promise<Blob> => {
  const baseUrl = ensureApiUrl();
  const headers = await getAuthHeaders(false);
  let response: Response;
  try {
    response = await fetchComTimeout(`${baseUrl}${path}`, { method: 'GET', headers }, TEMPO_LIMITE.arquivo);
  } catch (erro) {
    throw new SpedyApiError(mensagemDeFalhaDeRede(erro, MENSAGEM_REDE), 0);
  }

  if (!response.ok) {
    throw await getApiError(response, fallbackError);
  }
  return response.blob();
};

const legacyArgsNotice = (apiKey: string, env: SpedyEnv) => {
  void apiKey;
  void env;
  // Assinatura mantida para compatibilidade com as telas antigas.
};

export interface SpedyInvoice {
  id: string;
  /** Id da nota no nosso sistema, enviado na criacao (idempotencia da Spedy). */
  integrationId?: string | null;
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

/** Blocos de numeracao fiscal por tipo de documento (schema
 * CompanySettingsDto da Spedy, confirmado via openapi/v1.json 2026-09-11).
 * `series`/`nextNumber` sao a serie e o PROXIMO numero que a Spedy vai
 * usar -- pensados pra continuar a numeracao de uma migracao de outro
 * ERP, nunca pra "zerar" (SEFAZ nao aceita reemitir numero ja usado).
 * NFC-e tambem carrega o numero ATUAL (nao o proximo) e o CSC (Codigo de
 * Seguranca do Contribuinte) exigido pra gerar o QR Code do cupom. */
export type AmbienteNotaSefaz = 'development' | 'production';

export interface SpedyNumberingUpdate {
  // `environmentType` (Homologacao = development, Producao = production) vai
  // no mesmo bloco: a Spedy rejeita a nota com "Ambiente: 0" quando a empresa
  // nunca teve o ambiente da NF-e definido. series/nextNumber sao opcionais
  // aqui -- da' pra salvar so' o ambiente.
  productInvoice?: { series?: string; nextNumber?: number; environmentType?: AmbienteNotaSefaz };
  consumerInvoice?: { series?: string; currentNumber?: number; csc?: string; tokenId?: string; environmentType?: AmbienteNotaSefaz };
  serviceInvoice?: { series: string; nextNumber: number };
}

export interface SpedyInvoiceListResponse {
  items: SpedyInvoice[];
  totalCount: number;
  pageCount: number;
  pageSize: number;
  hasNext: boolean;
}

export interface SpedyCity {
  code: string | null;
  name: string | null;
  state: string | null;
}

export interface SpedyCityListResponse {
  items: SpedyCity[];
  totalCount: number;
  pageCount: number;
  pageSize: number;
  hasNext: boolean;
}

/** Um item da conferencia "o que precisa pra emitir nota". */
export interface RequisitoFiscal {
  id: string;
  situacao: 'ok' | 'pendente' | 'atencao' | 'desconhecido';
  gravidade: 'ok' | 'bloqueio' | 'aviso';
  mensagem: string;
  comoResolver: string;
}

export interface RequisitosFiscais {
  ambienteSpedy: SpedyEnv;
  ambientes: { nfe: string | null; nfce: string | null };
  /** Proximo numero sugerido quando a Spedy esta sem numeracao ou atrasada. */
  sugestaoProximoNumero?: { nfe: number | null; nfce: number | null };
  nfe: { pronto: boolean; checks: RequisitoFiscal[] };
  nfce: { pronto: boolean; checks: RequisitoFiscal[] };
  spedyLegivel: boolean;
  /** Por que a Spedy nao pode ser lida (quando nao pode), em portugues. */
  diagnosticoSpedy?: string[];
}

/** Resposta do servidor ao enviar uma carta de correcao (CC-e). */
export interface CartaCorrecaoEnviada {
  eventId: string | null;
  status: string;
  texto: string;
  enviadaEm: string;
  enviadaPorEmail?: string | null;
}

export interface SpedyRuntimeConfig {
  spedyEnabled: boolean;
  spedyApiKeyConfigured: boolean;
  spedyEnvironment: SpedyEnv;
}

export const spedyService = {
  /** O que falta pra emitir NF-e/NFC-e (ambiente, serie, certificado...). */
  async getRequisitos(): Promise<RequisitosFiscais> {
    // O servidor faz mais de uma consulta a Spedy nesta rota.
    return requestJson<RequisitosFiscais>('/api/spedy/requisitos', { method: 'GET' }, 'Erro ao conferir os requisitos para emitir nota.', TEMPO_LIMITE.arquivo);
  },

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

  async searchServiceInvoiceCities(apiKey: string, env: SpedyEnv, filterText: string, state?: string): Promise<SpedyCityListResponse> {
    legacyArgsNotice(apiKey, env);
    const params = new URLSearchParams();
    if (filterText) params.set('filterText', filterText);
    if (state) params.set('state', state);
    return requestJson<SpedyCityListResponse>(`/api/spedy/service/cities?${params.toString()}`, { method: 'GET' }, 'Erro ao buscar cidades integradas.');
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
    }, 'Erro ao emitir NFS-e.', TEMPO_LIMITE.emissaoNota);
  },

  async emitProductInvoice(apiKey: string, env: SpedyEnv, invoiceData: Record<string, unknown>): Promise<SpedyInvoice> {
    legacyArgsNotice(apiKey, env);
    return requestJson<SpedyInvoice>('/api/spedy/product', {
      method: 'POST',
      body: JSON.stringify({ invoiceData })
    }, 'Erro ao emitir NF-e.', TEMPO_LIMITE.emissaoNota);
  },

  async fetchConsumerInvoices(apiKey: string, env: SpedyEnv, page = 1, pageSize = 20): Promise<SpedyInvoiceListResponse> {
    legacyArgsNotice(apiKey, env);
    return requestJson<SpedyInvoiceListResponse>(`/api/spedy/consumer?page=${page}&pageSize=${pageSize}`, { method: 'GET' }, 'Erro ao buscar cupons fiscais.');
  },

  /** Consulta uma nota de qualquer tipo pelo id da Spedy (o backend usa a chave da empresa). */
  async getInvoice(type: SpedyType, id: string): Promise<SpedyInvoice> {
    return requestJson<SpedyInvoice>(`/api/spedy/${type}/${id}`, { method: 'GET' }, 'Erro ao consultar a nota fiscal.');
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
    }, 'Erro ao emitir NFC-e.', TEMPO_LIMITE.emissaoNota);
  },

  async cancelInvoice(apiKey: string, env: SpedyEnv, type: SpedyType, id: string, justification: string): Promise<{ success: boolean }> {
    legacyArgsNotice(apiKey, env);
    return requestJson<{ success: boolean }>(`/api/spedy/${type}/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ justification })
    }, 'Erro ao solicitar cancelamento da nota fiscal.', TEMPO_LIMITE.emissaoNota);
  },

  /** Atualiza serie/numeracao de NF-e, NFC-e e/ou NFS-e na empresa ja
   * cadastrada na Spedy (PUT /companies/{id}/settings da Spedy, blocos
   * productInvoice/consumerInvoice/serviceInvoice). So manda os blocos
   * informados -- os outros ficam como ja estavam la. */
  /** Reenvia pra Spedy os dados cadastrais da empresa (razao social, CNPJ, IE,
   *  endereco) -- e' o emitente impresso na nota. So' dono/Admin. */
  async sincronizarEmpresa(): Promise<{ ok: boolean }> {
    return requestJson<{ ok: boolean }>('/api/spedy/empresa/sincronizar', { method: 'POST' }, 'Não foi possível atualizar os dados da empresa na Spedy.', TEMPO_LIMITE.arquivo);
  },

  async updateNumbering(blocks: SpedyNumberingUpdate): Promise<{ success: boolean }> {
    // O servidor le a configuracao atual na Spedy e so' depois grava.
    return requestJson<{ success: boolean }>('/api/spedy/numbering', {
      method: 'PUT',
      body: JSON.stringify(blocks)
    }, 'Erro ao atualizar a numeração fiscal na Spedy.', TEMPO_LIMITE.arquivo);
  },

  getPdfUrl(id: string, type: SpedyType): string {
    const baseUrl = ensureApiUrl();
    return `${baseUrl}/api/spedy/${type}/${id}/pdf`;
  },

  getXmlUrl(id: string, type: SpedyType): string {
    const baseUrl = ensureApiUrl();
    return `${baseUrl}/api/spedy/${type}/${id}/xml`;
  },

  /** Envia a carta de correcao (CC-e) de uma NF-e autorizada. O servidor confere as
   * regras (texto de 15 a 1000 caracteres, limite de 20 por nota) e guarda o
   * historico na propria nota -- por isso a tela nao grava nada aqui. */
  async sendCorrectionLetter(id: string, letter: string): Promise<{ ok: boolean; evento: CartaCorrecaoEnviada }> {
    return requestJson<{ ok: boolean; evento: CartaCorrecaoEnviada }>(`/api/spedy/product/${id}/corrections`, {
      method: 'POST',
      body: JSON.stringify({ letter })
    }, 'Erro ao enviar a carta de correção.', TEMPO_LIMITE.emissaoNota);
  },

  /** Abre o PDF (nova aba) ou baixa o XML de uma carta de correcao ja enviada. */
  async openCorrectionFile(id: string, eventId: string, fileType: 'pdf' | 'xml') {
    const blob = await requestBlob(`/api/spedy/product/${id}/corrections/${eventId}/${fileType}`, 'Erro ao baixar a carta de correção.');
    const url = URL.createObjectURL(blob);

    if (fileType === 'pdf') {
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return;
    }

    const link = document.createElement('a');
    link.href = url;
    link.download = `cce-${eventId}.xml`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },

  /** PDF (DANFE) ou XML da nota como arquivo, pra mostrar dentro do sistema / salvar com nome. */
  async baixarArquivoFiscal(id: string, type: SpedyType, fileType: 'pdf' | 'xml'): Promise<Blob> {
    return requestBlob(`/api/spedy/${type}/${id}/${fileType}`, 'Erro ao baixar arquivo fiscal.');
  },

  /** `nomeArquivo`: nome do XML baixado (ex.: "NFE 000040 - CLIENTE.xml"); sem ele, o id da Spedy. */
  async openFiscalFile(id: string, type: SpedyType, fileType: 'pdf' | 'xml', nomeArquivo?: string) {
    const blob = await spedyService.baixarArquivoFiscal(id, type, fileType);
    const url = URL.createObjectURL(blob);

    if (fileType === 'pdf') {
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return;
    }

    const link = document.createElement('a');
    link.href = url;
    link.download = nomeArquivo || `${id}.xml`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
};
