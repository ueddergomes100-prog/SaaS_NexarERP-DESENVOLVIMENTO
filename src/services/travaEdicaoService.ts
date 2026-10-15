import { auth } from './firebase';
import { fetchComTimeout, mensagemDeFalhaDeRede } from '../utils/fetchComTimeout';
import type { Aparelho, TipoDeTrava, TravaDeEdicao } from '../utils/travaEdicaoDomain';

/**
 * Cliente HTTP da TRAVA DE EDICAO (15/10/2026) -- server/routes/travas.routes.js.
 * O servidor e' quem grava `travas_edicao`; as telas so' pedem.
 */

const rawApiUrl = (import.meta.env.VITE_BACKEND_API_URL || '').trim();
const API_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : (import.meta.env.DEV ? 'http://localhost:3001' : '');

export class TravaError extends Error {
  status: number;
  trava?: TravaDeEdicao;

  constructor(message: string, status: number, trava?: TravaDeEdicao) {
    super(message);
    this.name = 'TravaError';
    this.status = status;
    this.trava = trava;
  }
}

interface Alvo {
  tipo: TipoDeTrava;
  registroId: string;
}

// O ultimo token valido: o fechamento da janela (beacon) nao da tempo de pedir outro.
let ultimoToken = '';

const chamar = async <T>(caminho: string, corpo: Record<string, unknown>): Promise<T> => {
  if (!API_URL) throw new TravaError('O servidor da empresa não está configurado neste ambiente. Avise o suporte.', 0);
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new TravaError('Sua sessão expirou. Entre novamente para continuar.', 401);
  ultimoToken = token;
  let resposta: Response;
  try {
    resposta = await fetchComTimeout(`${API_URL}/api/travas${caminho}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    });
  } catch (erro) {
    throw new TravaError(mensagemDeFalhaDeRede(erro), 0);
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new TravaError(dados.error || 'Não foi possível confirmar quem está editando.', resposta.status, dados.trava);
  return dados as T;
};

export const pegarTrava = (dados: Alvo & { sessaoId: string; aparelho: Aparelho }) => (
  chamar<{ trava: TravaDeEdicao; assumiuDeOutraTela: boolean }>('/pegar', { ...dados })
);

export const renovarTrava = (dados: Alvo & { sessaoId: string; mexeu: boolean }) => (
  chamar<{ estado: 'ok' | 'venceu' | 'perdeu'; mensagem?: string; trava?: TravaDeEdicao }>('/renovar', { ...dados })
);

export const liberarTrava = (dados: Alvo) => chamar<{ liberou: boolean; de?: string }>('/liberar', { ...dados });

/**
 * Solta a vez quando a tela fecha. Na saida normal (voltar, trocar de tela)
 * vai por fetch; com a janela morrendo, por `sendBeacon` (token no corpo,
 * texto simples -- mesmo motivo de /api/sessions/end). Falha aqui nao
 * importa: sem o aviso de "continuo aqui", a vez se libera em 2 minutos.
 */
export const soltarTrava = async (dados: Alvo & { sessaoId: string; tenantId: string }, janelaFechando = false): Promise<void> => {
  if (!API_URL || !ultimoToken) return;
  const url = `${API_URL}/api/travas/soltar`;
  const corpo = JSON.stringify({ ...dados, token: ultimoToken });
  try {
    if (janelaFechando && typeof navigator.sendBeacon === 'function'
      && navigator.sendBeacon(url, new Blob([corpo], { type: 'text/plain;charset=UTF-8' }))) return;
    await fetch(url, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: corpo });
  } catch {
    // Sem rede: a trava vence sozinha.
  }
};
