import { auth } from './firebase';
import { fetchComTimeout, mensagemDeFalhaDeRede, TEMPO_LIMITE } from '../utils/fetchComTimeout';

/**
 * Cliente HTTP da devolucao de compra ao fornecedor (21/10/2026). Registrar e
 * emitir a NF-e sao do servidor (server/services/devolucaoCompra.js); a lista
 * vem dele tambem, sem regra nova no Firestore.
 */

const rawApiUrl = (import.meta.env.VITE_BACKEND_API_URL || '').trim();
const API_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : (import.meta.env.DEV ? 'http://localhost:3001' : '');

export class DevolucaoCompraError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'DevolucaoCompraError';
    this.status = status;
  }
}

export interface DevolucaoCompraResumo {
  id: string;
  data: string;
  itens: Array<{ indice: number; nome: string; quantidade: number; unidade: string; totalCentavos: number }>;
  totalCentavos: number;
  abatidoCentavos: number;
  aReceberCentavos: number;
  motivo: string;
  registradoPorNome: string;
  notaFiscal: { status: string; numero: number | null; mensagem: string | null; codigo: string | null } | null;
}

const chamar = async <T>(rota: string, opcoes: { metodo: 'GET' | 'POST'; corpo?: unknown; tempo?: number }): Promise<T> => {
  if (!API_URL) throw new DevolucaoCompraError('O servidor da empresa não está configurado neste ambiente. Avise o suporte.', 0);
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new DevolucaoCompraError('Sua sessão expirou. Entre novamente para continuar.', 401);
  let resposta: Response;
  try {
    resposta = await fetchComTimeout(`${API_URL}/api/devolucao-compra${rota}`, {
      method: opcoes.metodo,
      headers: { Authorization: `Bearer ${token}`, ...(opcoes.corpo ? { 'Content-Type': 'application/json' } : {}) },
      ...(opcoes.corpo ? { body: JSON.stringify(opcoes.corpo) } : {}),
    }, opcoes.tempo);
  } catch (erro) {
    throw new DevolucaoCompraError(mensagemDeFalhaDeRede(erro), 0);
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new DevolucaoCompraError(dados.error || 'Não foi possível concluir. Tente novamente.', resposta.status);
  return dados as T;
};

export const listarDevolucoesDaNota = (notaEntradaId: string) => (
  chamar<{ devolucoes: DevolucaoCompraResumo[] }>(`?notaEntradaId=${encodeURIComponent(notaEntradaId)}`, { metodo: 'GET' }).then((r) => r.devolucoes || [])
);

export const registrarDevolucaoCompra = (pedido: { notaEntradaId: string; itens: Array<{ indice: number; quantidade: number }>; motivo: string }) => (
  chamar<{ devolucao: { id: string; totalCentavos: number; abatidoCentavos: number; aReceberCentavos: number } }>('', { metodo: 'POST', corpo: pedido }).then((r) => r.devolucao)
);

export const emitirNotaDaDevolucaoCompra = (devolucaoId: string) => (
  chamar<{ nota: { notaId: string; status: string; numero: number | null; mensagem: string | null } }>('/emitir', { metodo: 'POST', corpo: { devolucaoId }, tempo: TEMPO_LIMITE.emissaoNota }).then((r) => r.nota)
);
