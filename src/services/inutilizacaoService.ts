import { auth } from './firebase';
import { fetchComTimeout, mensagemDeFalhaDeRede, TEMPO_LIMITE } from '../utils/fetchComTimeout';
import type { ModeloInutilizacao, StatusInutilizacao } from '../utils/inutilizacaoDomain';

/**
 * Cliente HTTP da inutilizacao de numeracao (21/10/2026). Quem fala com a
 * Spedy e grava e' o servidor (server/services/inutilizacao.js); a lista
 * tambem vem dele, sem regra nova no Firestore.
 */

const rawApiUrl = (import.meta.env.VITE_BACKEND_API_URL || '').trim();
const API_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : (import.meta.env.DEV ? 'http://localhost:3001' : '');

export class InutilizacaoError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'InutilizacaoError';
    this.status = status;
  }
}

export interface Inutilizacao {
  id: string;
  modelo: ModeloInutilizacao;
  serie: number;
  inicial: number;
  final: number;
  motivo: string;
  status: StatusInutilizacao;
  protocolo: string | null;
  codigoSefaz: string | null;
  mensagemSefaz: string | null;
  solicitadoPorNome?: string;
  criadoEmMs?: number;
}

const chamar = async <T>(rota: string, opcoes: { metodo: 'GET' | 'POST'; corpo?: unknown; tempo?: number }): Promise<T> => {
  if (!API_URL) throw new InutilizacaoError('O servidor da empresa não está configurado neste ambiente. Avise o suporte.', 0);
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new InutilizacaoError('Sua sessão expirou. Entre novamente para continuar.', 401);
  let resposta: Response;
  try {
    resposta = await fetchComTimeout(`${API_URL}/api/inutilizacoes${rota}`, {
      method: opcoes.metodo,
      headers: { Authorization: `Bearer ${token}`, ...(opcoes.corpo ? { 'Content-Type': 'application/json' } : {}) },
      ...(opcoes.corpo ? { body: JSON.stringify(opcoes.corpo) } : {}),
    }, opcoes.tempo);
  } catch (erro) {
    throw new InutilizacaoError(mensagemDeFalhaDeRede(erro), 0);
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new InutilizacaoError(dados.error || 'Não foi possível concluir. Tente novamente.', resposta.status);
  return dados as T;
};

export const listarInutilizacoes = () => chamar<{ inutilizacoes: Inutilizacao[] }>('', { metodo: 'GET' })
  .then((r) => r.inutilizacoes || []);

export const pedirInutilizacao = (pedido: { modelo: ModeloInutilizacao; serie: string; inicial: string; final: string; motivo: string }) => (
  chamar<{ inutilizacao: Inutilizacao }>('', { metodo: 'POST', corpo: pedido, tempo: TEMPO_LIMITE.emissaoNota }).then((r) => r.inutilizacao)
);

export const consultarInutilizacao = (id: string) => (
  chamar<{ inutilizacao: Inutilizacao }>(`/${encodeURIComponent(id)}/consultar`, { metodo: 'POST' }).then((r) => r.inutilizacao)
);
