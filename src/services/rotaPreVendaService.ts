import { auth } from './firebase';
import { fetchComTimeout, mensagemDeFalhaDeRede } from '../utils/fetchComTimeout';
import type { ResultadoDaRota, RotaAberta } from '../utils/rotaPreVendaDomain';

/**
 * ROTA NA PRE-VENDA (21/10/2026) -- cliente HTTP de server/services/rotaPreVenda.js.
 * O pedido entra na rota pelo servidor porque quem grava pre-venda (balcao ou
 * app) normalmente nao tem a permissao do Romaneio. Regra em
 * src/utils/rotaPreVendaDomain.ts.
 */

const rawApiUrl = (import.meta.env.VITE_BACKEND_API_URL || '').trim();
const API_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : (import.meta.env.DEV ? 'http://localhost:3001' : '');

const chamar = async <T>(metodo: 'GET' | 'POST', rota: string, corpo?: Record<string, unknown>): Promise<T> => {
  if (!API_URL) throw new Error('O servidor não está configurado neste ambiente. Avise o suporte.');
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Sua sessão expirou. Entre novamente para continuar.');
  let resposta: Response;
  try {
    resposta = await fetchComTimeout(`${API_URL}/api/romaneios/${rota}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${token}`, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
      ...(corpo ? { body: JSON.stringify(corpo) } : {}),
    });
  } catch (erro) {
    throw new Error(mensagemDeFalhaDeRede(erro), { cause: erro });
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(dados.error || 'Não foi possível falar com o servidor. Tente de novo em instantes.');
  return dados as T;
};

/** Rotas em montagem da filial ativa. */
export const listarRotasAbertas = async (): Promise<RotaAberta[]> => (await chamar<{ rotas: RotaAberta[] }>('GET', 'abertos')).rotas;

/**
 * Coloca (ou anota) o pedido na rota, conforme a configuracao. Nunca lanca:
 * o pedido ja' esta' gravado, e a tela so' avisa se a rota nao deu certo.
 */
export const colocarPedidoNaRotaSemFalhar = async (pedidoId: string, romaneioId?: string | null): Promise<ResultadoDaRota> => {
  try {
    return await chamar<ResultadoDaRota>('POST', 'colocar-pedido', { pedidoId, ...(romaneioId ? { romaneioId } : {}) });
  } catch (erro) {
    return { acao: 'falhou', erro: erro instanceof Error ? erro.message : '' };
  }
};
