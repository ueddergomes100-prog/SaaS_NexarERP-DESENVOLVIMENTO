import { auth } from './firebase';
import type { AvisoTroca, ItemTroca } from '../utils/trocaDomain';

/**
 * Cliente HTTP das trocas. TODA escrita em `trocas` e todo movimento de estoque
 * da troca passam pelo servidor (server/routes/trocas.routes.js): o app nunca
 * escreve em `trocas` nem em `estoque`, e as firestore.rules deixam a colecao so'
 * pra leitura. A tela so' manda o que o vendedor escolheu (produto, quantidade,
 * motivo) -- nome, unidade e custo vem do cadastro, no servidor.
 */

const rawApiUrl = (import.meta.env.VITE_BACKEND_API_URL || '').trim();
const API_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : (import.meta.env.DEV ? 'http://localhost:3001' : '');

export class TrocaError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'TrocaError';
    this.status = status;
  }
}

export interface ItemPedidoTroca {
  id: string;
  quantidade: number;
  motivo: string;
  motivoDescricao?: string;
}

export interface PedidoDeTroca {
  clienteId: string;
  itens: ItemPedidoTroca[];
  observacao?: string;
  /** Id do rascunho: reenviar o mesmo rascunho NAO duplica a troca. */
  idDocumento?: string;
}

export interface PreviaTroca {
  ok: boolean;
  erros: string[];
  avisos: AvisoTroca[];
  itens: ItemTroca[];
}

export interface AberturaConferenciaTroca {
  ok: boolean;
  itens: import('../utils/conferenciaDomain').ConferenciaItem[];
  status: import('../utils/conferenciaDomain').StatusConferencia;
  abertoPorNome: string;
  troca: { numeroTroca: string; clienteNome: string };
}

export interface TrocaSolicitada {
  ok: boolean;
  id: string;
  numeroTroca: string;
  jaEnviada: boolean;
  avisos: AvisoTroca[];
}

const chamar = async <T>(caminho: string, corpo: Record<string, unknown>): Promise<T> => {
  if (!API_URL) {
    throw new TrocaError('Esta operação precisa do servidor da empresa, que não está configurado neste ambiente. Avise o suporte.', 0);
  }
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new TrocaError('Sua sessão expirou. Entre novamente para continuar.', 401);

  let resposta: Response;
  try {
    resposta = await fetch(`${API_URL}/api/trocas${caminho}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    });
  } catch {
    throw new TrocaError('Não foi possível falar com o servidor. Verifique a internet e tente de novo.', 0);
  }

  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    throw new TrocaError(dados.error || 'Não foi possível concluir a operação. Tente novamente.', resposta.status);
  }
  return dados as T;
};

export const trocaService = {
  /** Mostra os avisos (ex.: "cliente não comprou X nos últimos 60 dias") antes de enviar. Não grava nada. */
  previa: (pedido: PedidoDeTroca) => chamar<PreviaTroca>('/previa', { ...pedido }),
  /** Cria a troca (fica "Solicitada", aguardando a loja). */
  solicitar: (pedido: PedidoDeTroca) => chamar<TrocaSolicitada>('/solicitar', { ...pedido }),
  /** Loja: aprova (reserva o estoque da reposição). */
  aprovar: (id: string) => chamar<{ ok: boolean }>(`/${id}/aprovar`, {}),
  /** Loja: recusa, com o motivo que o vendedor vai ver. */
  recusar: (id: string, motivo: string) => chamar<{ ok: boolean }>(`/${id}/recusar`, { motivo }),
  /** Loja (Solicitada ou Aprovada) ou o próprio vendedor (Solicitada). Libera a reserva se houver. */
  cancelar: (id: string, motivo?: string) => chamar<{ ok: boolean }>(`/${id}/cancelar`, { motivo: motivo || '' }),
  /** Expedição: abre (ou reabre) a conferência de mercadoria da troca — a mesma tela da pré-venda. */
  abrirConferencia: (id: string) => chamar<AberturaConferenciaTroca>(`/${id}/conferencia/abrir`, {}),
  /** Expedição: fecha a conferência (conferido/divergente). Só as quantidades conferidas vão para o servidor. */
  fecharConferencia: (id: string, itens: { produtoId: string; quantidadeConferida: number }[], observacao: string) => (
    chamar<{ ok: boolean; statusConferencia: 'conferido' | 'divergente' }>(`/${id}/conferencia/fechar`, { itens, observacao })
  ),
  /** Loja: confirma a entrega e baixa o estoque (uma vez). `lotes` = índice do item -> id do lote (produto com lote). */
  entregar: (id: string, lotes?: Record<number, string>) => chamar<{ ok: boolean; custoTotalCentavos: number }>(`/${id}/entregar`, { lotes: lotes || {} }),
};
