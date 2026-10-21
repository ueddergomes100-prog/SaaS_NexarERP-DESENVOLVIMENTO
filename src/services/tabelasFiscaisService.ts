import { auth } from './firebase';
import { fetchComTimeout, mensagemDeFalhaDeRede } from '../utils/fetchComTimeout';

/**
 * Cliente HTTP das Tabelas Fiscais (20/10/2026). A base de NCM/CEST e' unica
 * do sistema e so' o servidor grava (server/services/tabelasFiscais.js); a
 * leitura tambem passa por ele, para nao precisar de regra nova no Firestore.
 */

const rawApiUrl = (import.meta.env.VITE_BACKEND_API_URL || '').trim();
const API_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : (import.meta.env.DEV ? 'http://localhost:3001' : '');

export class TabelasFiscaisError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'TabelasFiscaisError';
    this.status = status;
  }
}

export interface LinhaNcm { codigo: string; descricao: string }
export interface LinhaCest { codigo: string; descricao: string; ncms: string[] }

const chamar = async <T>(rota: string, opcoes: { metodo: 'GET' | 'POST'; corpo?: unknown }): Promise<T> => {
  if (!API_URL) throw new TabelasFiscaisError('O servidor da empresa não está configurado neste ambiente. Avise o suporte.', 0);
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new TabelasFiscaisError('Sua sessão expirou. Entre novamente para continuar.', 401);
  let resposta: Response;
  try {
    resposta = await fetchComTimeout(`${API_URL}/api/tabelas-fiscais/${rota}`, {
      method: opcoes.metodo,
      headers: { Authorization: `Bearer ${token}`, ...(opcoes.corpo ? { 'Content-Type': 'application/json' } : {}) },
      ...(opcoes.corpo ? { body: JSON.stringify(opcoes.corpo) } : {}),
    });
  } catch (erro) {
    throw new TabelasFiscaisError(mensagemDeFalhaDeRede(erro), 0);
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new TabelasFiscaisError(dados.error || 'Não foi possível concluir. Tente novamente.', resposta.status);
  return dados as T;
};

export const buscarNcm = (busca: string) => chamar<{ linhas: LinhaNcm[]; total: number }>(
  `busca?tipo=ncm&busca=${encodeURIComponent(busca)}`, { metodo: 'GET' },
);

export const buscarCest = (busca: string, ncm = '') => chamar<{ linhas: LinhaCest[]; total: number }>(
  `busca?tipo=cest&busca=${encodeURIComponent(busca)}&ncm=${encodeURIComponent(ncm)}`, { metodo: 'GET' },
);

export const cadastrarNcm = (codigo: string, descricao: string) => chamar<{ codigo: string; novo: boolean }>(
  'ncm', { metodo: 'POST', corpo: { codigo, descricao } },
);

export const cadastrarCest = (codigo: string, descricao: string, ncm: string) => chamar<{ codigo: string; novo: boolean }>(
  'cest', { metodo: 'POST', corpo: { codigo, descricao, ncm } },
);

export const definirCfopAtivo = (codigo: string, ativo: boolean) => chamar<{ codigo: string; ativo: boolean; filiais: number }>(
  'cfop/ativo', { metodo: 'POST', corpo: { codigo, ativo } },
);

/**
 * Leva para a base os codigos de NCM/CEST de produtos/notas (so' os codigos).
 * Nunca atrapalha quem chamou: falha so' vai para o console.
 */
export const registrarUsoFiscal = (itens: Array<{ ncm?: unknown; cest?: unknown }>): void => {
  const limpos = itens
    .map((i) => ({ ncm: String(i.ncm ?? '').replace(/\D/g, ''), cest: String(i.cest ?? '').replace(/\D/g, '') }))
    .filter((i) => i.ncm || i.cest);
  if (limpos.length === 0) return;
  void chamar('uso', { metodo: 'POST', corpo: { itens: limpos.slice(0, 300) } }).catch((erro) => {
    console.warn('[Tabelas fiscais] uso não registrado:', erro instanceof Error ? erro.message : erro);
  });
};
