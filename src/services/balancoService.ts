import { auth } from './firebase';
import { fetchComTimeout, mensagemDeFalhaDeRede, TEMPO_LIMITE } from '../utils/fetchComTimeout';
import type { EscopoBalanco, RegraNegativo, StatusBalanco } from '../utils/balancoDomain';

/**
 * Cliente HTTP do balanco (21/10/2026). Tudo passa pelo servidor
 * (server/services/balanco.js): a colecao `balancos` e' so' dele, sem regra
 * nova no Firestore. A mesma tela de contar serve o app e o computador.
 */

const rawApiUrl = (import.meta.env.VITE_BACKEND_API_URL || '').trim();
const API_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : (import.meta.env.DEV ? 'http://localhost:3001' : '');

export class BalancoError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'BalancoError';
    this.status = status;
  }
}

export interface UnidadeDoItemBalanco { sigla: string; fracionado: boolean; casas: number }

export interface BalancoResumo {
  id: string;
  nome: string;
  status: StatusBalanco;
  escopo: EscopoBalanco;
  travaVendas: boolean;
  totalItens: number;
  contadores: Array<{ uid: string; nome: string; concluido: boolean }>;
  abertoPorNome: string;
  criadoEmMs: number;
  fechadoEmMs: number;
  resumo: Record<string, number> | null;
  regraNegativo: RegraNegativo | null;
}

export interface ItemParaContar {
  chave: string;
  nome: string;
  codigo: string;
  codigoBarras: string;
  grupo: string;
  unidade: UnidadeDoItemBalanco;
  controlaLote: boolean;
  contado: number | null;
  lotes: Array<{ lote: string; validade: string; contado: number | null }>;
}

export interface LinhaConferencia {
  chave: string;
  nome: string;
  codigo: string;
  grupo: string;
  unidade: UnidadeDoItemBalanco;
  contadorUid: string;
  contadoPorNome: string | null;
  saldoNaContagem: number | null;
  saldoAgora: number;
  contado: number | null;
  naoContado: boolean;
  controlaLote: boolean;
  lotes: Array<{ loteId: string | null; lote: string; validade: string; antes: number; depois: number; delta: number }>;
  depoisContado: number;
  depoisDescontar: number;
  aplicado: boolean;
}

export interface Conferencia {
  balanco: { id: string; nome: string; status: StatusBalanco; travaVendas: boolean; escopo: EscopoBalanco; regraNegativo: RegraNegativo | null; resumo: Record<string, number> | null };
  progresso: Array<{ uid: string; nome: string; concluido: boolean; total: number; contados: number }>;
  linhas: LinhaConferencia[];
}

const chamar = async <T>(rota: string, opcoes: { metodo: 'GET' | 'POST'; corpo?: unknown; tempo?: number } = { metodo: 'GET' }): Promise<T> => {
  if (!API_URL) throw new BalancoError('O servidor da empresa não está configurado neste ambiente. Avise o suporte.', 0);
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new BalancoError('Sua sessão expirou. Entre novamente para continuar.', 401);
  let resposta: Response;
  try {
    resposta = await fetchComTimeout(`${API_URL}/api/balancos${rota}`, {
      method: opcoes.metodo,
      headers: { Authorization: `Bearer ${token}`, ...(opcoes.corpo ? { 'Content-Type': 'application/json' } : {}) },
      ...(opcoes.corpo ? { body: JSON.stringify(opcoes.corpo) } : {}),
    }, opcoes.tempo);
  } catch (erro) {
    throw new BalancoError(mensagemDeFalhaDeRede(erro), 0);
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new BalancoError(dados.error || 'Não foi possível concluir. Tente novamente.', resposta.status);
  return dados as T;
};

const id = (v: string) => encodeURIComponent(v);

// ---- gestor ----
export const listarBalancos = () => chamar<{ balancos: BalancoResumo[] }>('').then((r) => r.balancos || []);
/** Grupos que os produtos ativos tem de verdade (com a quantidade de itens). */
export const gruposParaBalanco = () => chamar<{ grupos: Array<{ nome: string; itens: number }> }>('/grupos').then((r) => r.grupos || []);
export const abrirBalanco = (corpo: { nome: string; escopo: EscopoBalanco; contadores: string[]; travaVendas: boolean }) => (
  chamar<{ balanco: { id: string; nome: string; totalItens: number; blocos: Array<{ contadorUid: string; itens: number; grupos: Array<{ nome: string; itens: number }> }> } }>('', { metodo: 'POST', corpo, tempo: TEMPO_LIMITE.arquivo }).then((r) => r.balanco)
);
export const conferenciaDoBalanco = (balancoId: string) => chamar<Conferencia>(`/${id(balancoId)}/conferencia`, { metodo: 'GET', tempo: TEMPO_LIMITE.arquivo });
export const trocarContador = (balancoId: string, corpo: { de: string; para: string; grupo?: string }) => (
  chamar<{ movidos: number }>(`/${id(balancoId)}/trocar-contador`, { metodo: 'POST', corpo })
);
export const fecharBalanco = (balancoId: string, regraNegativo: RegraNegativo) => (
  chamar<{ resumo: Record<string, number> }>(`/${id(balancoId)}/fechar`, { metodo: 'POST', corpo: { regraNegativo }, tempo: TEMPO_LIMITE.emissaoNota })
);
export const cancelarBalanco = (balancoId: string, motivo: string) => chamar<{ nome: string }>(`/${id(balancoId)}/cancelar`, { metodo: 'POST', corpo: { motivo } });

// ---- quem conta ----
export const balancosParaContar = () => chamar<{ balancos: Array<{ id: string; nome: string; itens: number }> }>('/para-contar').then((r) => r.balancos || []);
export const minhaListaDoBalanco = (balancoId: string) => (
  chamar<{ balanco: { id: string; nome: string; status: StatusBalanco; concluido: boolean }; itens: ItemParaContar[] }>(`/${id(balancoId)}/minha-lista`)
);
export const contarItem = (balancoId: string, corpo: { chave: string; quantidade: number; modo: 'somar' | 'definir'; loteIndice?: number; loteNovo?: { lote: string; validade: string } }) => (
  chamar<{ item: { chave: string; contado: number | null; lotes: ItemParaContar['lotes'] } }>(`/${id(balancoId)}/contar`, { metodo: 'POST', corpo }).then((r) => r.item)
);
export const concluirMinhaParte = (balancoId: string) => chamar<{ ok: true }>(`/${id(balancoId)}/concluir`, { metodo: 'POST', corpo: {} });
