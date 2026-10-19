/*
 * FECHAMENTO DA VENDA PELO SERVIDOR (item 8 da auditoria, fatia 3 -- 13/10/2026).
 *
 * Com a chave "Venda pelo servidor" ligada para a empresa (SuperAdmin), o
 * "Finalizar" do Pedido de Venda manda para cá o que a pessoa escolheu e o
 * servidor (server/services/vendaFechamento.js) grava pedido, estoque, lotes,
 * comissão, títulos e saldo do banco numa transação só. Repetir o envio da
 * mesma venda direta não duplica: o id da venda é gerado na tela e vai junto.
 *
 * Fatia 3b (19/10/2026): cancelar a venda finalizada, cancelar a pré-venda e
 * alterar a forma de pagamento também passam pelo servidor com a chave ligada.
 */
import { auth } from './firebase';
import { fetchComTimeout, mensagemDeFalhaDeRede } from '../utils/fetchComTimeout';

const rawApiUrl = (import.meta.env.VITE_BACKEND_API_URL || '').trim();
const API_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : (import.meta.env.DEV ? 'http://localhost:3001' : '');

/** Erro já em português, pronto para a tela. `status` 0 = sem resposta (rede). */
export class VendaServidorError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'VendaServidorError';
    this.status = status;
  }
}

export interface ResultadoDoFechamento {
  ok: true;
  jaEnviado: boolean;
  pedidoId: string;
  numeroPedido: string;
  vendedorId: string;
  vendedorNome: string;
  totalCentavos: number;
  formaPagamento: string;
  condicaoPagamento: 'avista' | 'aprazo';
}

export const finalizarVendaNoServidor = async (corpo: Record<string, unknown>): Promise<ResultadoDoFechamento> => {
  if (!API_URL) {
    throw new VendaServidorError('A venda desta empresa é fechada pelo servidor, que não está configurado neste ambiente. Avise o suporte.', 0);
  }
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new VendaServidorError('Sua sessão expirou. Entre novamente para continuar.', 401);

  let resposta: Response;
  try {
    resposta = await fetchComTimeout(`${API_URL}/api/vendas/finalizar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    });
  } catch (erro) {
    // Sem resposta não dá para saber se gravou. Repetir é seguro: o servidor
    // reconhece a mesma venda e não grava duas vezes.
    throw new VendaServidorError(`${mensagemDeFalhaDeRede(erro)} Toque em Finalizar de novo: se a venda já tiver sido gravada, o sistema não grava duas vezes.`, 0);
  }

  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    throw new VendaServidorError(dados.error || 'Não foi possível finalizar a venda. Nada foi gravado. Tente novamente.', resposta.status);
  }
  return dados as ResultadoDoFechamento;
};

/**
 * POST numa rota de /api/<base> (vendas; os desde a fatia 3d), com o token da
 * sessão. `semResposta` = texto quando a rede falha.
 */
export const postarNoServidor = async <T>(
  rota: string,
  corpo: Record<string, unknown>,
  falhou: string,
  semResposta: string,
  base: 'vendas' | 'os' | 'descontos' = 'vendas',
): Promise<T> => {
  if (!API_URL) {
    throw new VendaServidorError('As vendas desta empresa são gravadas pelo servidor, que não está configurado neste ambiente. Avise o suporte.', 0);
  }
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new VendaServidorError('Sua sessão expirou. Entre novamente para continuar.', 401);

  let resposta: Response;
  try {
    resposta = await fetchComTimeout(`${API_URL}/api/${base}/${rota}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    });
  } catch (erro) {
    throw new VendaServidorError(`${mensagemDeFalhaDeRede(erro)} ${semResposta}`, 0);
  }

  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new VendaServidorError(dados.error || falhou, resposta.status);
  return dados as T;
};

const CONFIRA_ANTES = 'Abra a venda de novo para conferir se a operação foi gravada antes de tentar outra vez.';

export interface ResultadoDoCancelamento {
  ok: true;
  pedidoId: string;
  numeroPedido: string;
  vendedorId: string;
  vendedorNome: string;
  totalCentavos: number;
  creditoDevolvidoCentavos: number;
}

/** Venda finalizada. A nota fiscal autorizada tem de ter sido cancelada antes (pela tela). */
export const cancelarVendaNoServidor = (pedidoId: string, motivo: string) =>
  postarNoServidor<ResultadoDoCancelamento>('cancelar', { pedidoId, motivo },
    'Não foi possível cancelar a venda. Nada foi gravado. Tente novamente.', CONFIRA_ANTES);

export interface ResultadoDoCancelamentoDaPreVenda {
  ok: true;
  pedidoId: string;
  numeroPedido: string;
  reservaLiberada: boolean;
}

export const cancelarPreVendaNoServidor = (pedidoId: string, nota?: string) =>
  postarNoServidor<ResultadoDoCancelamentoDaPreVenda>('cancelar-pre-venda', nota ? { pedidoId, nota } : { pedidoId },
    'Não foi possível cancelar a pré-venda. Nada foi gravado. Tente novamente.', CONFIRA_ANTES);

export interface ResultadoDaAlteracaoDePagamento {
  ok: true;
  pedidoId: string;
  numeroPedido: string;
  formaAnterior: string;
  formaNova: string;
  totalCentavos: number;
}

/** `pagamentos` = as linhas da tela (forma, valor, banco...). O total vem da venda gravada. */
export const alterarPagamentoNoServidor = (pedidoId: string, pagamentos: unknown[]) =>
  postarNoServidor<ResultadoDaAlteracaoDePagamento>('alterar-pagamento', { pedidoId, pagamentos },
    'Não foi possível alterar a forma de pagamento. Nada foi gravado. Tente novamente.', CONFIRA_ANTES);
