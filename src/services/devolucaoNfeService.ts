import { auth } from './firebase';

/**
 * Cliente HTTP da NF-e de devolucao de venda. A nota e' montada NO SERVIDOR
 * (server/services/devolucaoNfe.js) a partir do que esta gravado; a tela so'
 * diz qual devolucao emitir e, se preciso, qual nota original e o CFOP
 * escolhido -- nunca envia itens, valores nem impostos.
 */

const rawApiUrl = (import.meta.env.VITE_BACKEND_API_URL || '').trim();
const API_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : (import.meta.env.DEV ? 'http://localhost:3001' : '');

export interface ItemPreviaDevolucao {
  itemNumber: number;
  descricao: string;
  quantidade: number;
  unidade: string;
  valorUnitario: number;
  valorTotal: number;
  cfop: number;
  icmsValor: number | null;
}

export interface NotaCandidataDevolucao {
  id: string;
  tipo: string;
  numero: number | null;
  data: string | null;
}

export interface PreviaDevolucaoNfe {
  ok: boolean;
  erros: string[];
  avisos: string[];
  candidatas: NotaCandidataDevolucao[];
  notaOriginal: { id: string; tipo: string; numero: number | null; chave: string | null; data: string | null } | null;
  /** Itens cujo CFOP da nota original nao tem devolucao automatica -- o usuario escolhe. */
  precisaCfop: { itemNumber: number; nome: string; cfopOriginal: number | null }[];
  cfopsPermitidos: number[];
  valorTotal: number | null;
  destinatario: { nome: string; documento: string } | null;
  itens: ItemPreviaDevolucao[];
  /** Presente quando a devolucao ja tem nota valendo. */
  jaEmitida?: { notaId: string | null; status: string; numero: number | null };
}

export interface ResultadoEmissaoDevolucao {
  ok: boolean;
  /** Id do documento em `notas_fiscais`. */
  notaId: string;
  nota: {
    id: string;
    status: 'enqueued' | 'authorized' | 'rejected' | 'canceled' | 'denied' | 'created' | 'processing';
    number: number | null;
    accessKey: string | null;
    processingDetail: { status: string; message: string | null; code: string | null } | null;
  };
}

export interface ParametrosDevolucaoNfe {
  devolucaoId: string;
  /** Obrigatorio quando o pedido tem mais de uma nota autorizada. */
  notaOriginalId?: string;
  /** itemNumber -> CFOP, pros itens sem mapa automatico. */
  cfopEscolhido?: Record<number, number>;
}

export class DevolucaoNfeError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'DevolucaoNfeError';
    this.status = status;
  }
}

const chamar = async <T>(rota: 'previa' | 'emitir', corpo: ParametrosDevolucaoNfe): Promise<T> => {
  if (!API_URL) {
    throw new DevolucaoNfeError('Esta operação precisa do servidor da empresa, que não está configurado neste ambiente. Avise o suporte.', 0);
  }
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new DevolucaoNfeError('Sua sessão expirou. Entre novamente para continuar.', 401);

  let resposta: Response;
  try {
    resposta = await fetch(`${API_URL}/api/devolucao-nfe/${rota}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    });
  } catch {
    throw new DevolucaoNfeError('Não foi possível falar com o servidor. Verifique a internet e tente de novo.', 0);
  }

  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    throw new DevolucaoNfeError(dados.error || 'Não foi possível concluir a operação. Tente novamente.', resposta.status);
  }
  return dados as T;
};

export const devolucaoNfeService = {
  /** Monta a nota e mostra o que sairia -- nao emite nem grava nada. */
  previa: (params: ParametrosDevolucaoNfe) => chamar<PreviaDevolucaoNfe>('previa', params),
  /** Emite a NF-e de devolucao na Spedy. */
  emitir: (params: ParametrosDevolucaoNfe) => chamar<ResultadoEmissaoDevolucao>('emitir', params),
};
