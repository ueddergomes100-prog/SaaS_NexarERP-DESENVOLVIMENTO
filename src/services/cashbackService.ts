import { auth } from './firebase';
import { fetchComTimeout, mensagemDeFalhaDeRede } from '../utils/fetchComTimeout';

/**
 * Cliente HTTP do cashback (20/10/2026). O saldo so' muda no servidor
 * (server/services/cashback.js); a tela chama estas rotas DEPOIS de gravar a
 * venda, a baixa ou a devolucao por conta propria. Sao idempotentes: chamar de
 * novo nao gera nem estorna em dobro. Falha aqui nao desfaz a venda -- por isso
 * as versoes "semFalhar" so' avisam no console.
 */

const rawApiUrl = (import.meta.env.VITE_BACKEND_API_URL || '').trim();
const API_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : (import.meta.env.DEV ? 'http://localhost:3001' : '');

export class CashbackError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'CashbackError';
    this.status = status;
  }
}

export interface ResultadoCashback {
  gerado?: boolean;
  estornado?: boolean;
  motivo?: string;
  modelo?: 'reais' | 'pontos';
  centavos?: number;
  pontos?: number;
  validade?: string | null;
}

const chamar = async (rota: string, corpo: Record<string, unknown>): Promise<ResultadoCashback> => {
  if (!API_URL) throw new CashbackError('O servidor da empresa não está configurado neste ambiente. Avise o suporte.', 0);
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new CashbackError('Sua sessão expirou. Entre novamente para continuar.', 401);
  let resposta: Response;
  try {
    resposta = await fetchComTimeout(`${API_URL}/api/cashback/${rota}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    });
  } catch (erro) {
    throw new CashbackError(mensagemDeFalhaDeRede(erro), 0);
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new CashbackError(dados.error || 'Não foi possível concluir a operação de cashback.', resposta.status);
  return dados as ResultadoCashback;
};

export const gerarCashbackDaVenda = (pedidoId: string) => chamar('gerar', { pedidoId });
export const estornarCashbackDaVenda = (pedidoId: string) => chamar('estornar-venda', { pedidoId });
export const estornarCashbackDaDevolucao = (devolucaoId: string) => chamar('estornar-devolucao', { devolucaoId });

const semFalhar = (nome: string, promessa: Promise<ResultadoCashback>) => promessa.catch((erro) => {
  console.error(`[Cashback] ${nome}:`, erro instanceof Error ? erro.message : erro);
  return null;
});

/** A venda ja' esta' gravada: cashback que nao gerou agora gera na proxima baixa ou pelo servidor. */
export const gerarCashbackSemFalhar = (pedidoId: string) => semFalhar('gerar', gerarCashbackDaVenda(pedidoId));
export const estornarCashbackDaVendaSemFalhar = (pedidoId: string) => semFalhar('estornar venda', estornarCashbackDaVenda(pedidoId));
export const estornarCashbackDaDevolucaoSemFalhar = (devolucaoId: string) => semFalhar('estornar devolução', estornarCashbackDaDevolucao(devolucaoId));
