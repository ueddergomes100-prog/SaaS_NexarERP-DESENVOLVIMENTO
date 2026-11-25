import { auth } from './firebase';
import { fetchComTimeout, mensagemDeFalhaDeRede } from '../utils/fetchComTimeout';
import type { DestinoDoValor } from '../utils/devolucaoVendaDomain';

/**
 * Cliente HTTP da DEVOLUCAO PELO ESCRITORIO (25/11/2026, Embala Minas). A
 * devolucao feita no sistema e o "Confirmar" da que veio do app gravam no
 * servidor (server/services/devolucaoVendaEscritorio.js): estoque, pedido,
 * credito, caixa/banco e o abatimento nas parcelas do cliente.
 */

const rawApiUrl = (import.meta.env.VITE_BACKEND_API_URL || '').trim();
const API_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : (import.meta.env.DEV ? 'http://localhost:3001' : '');

const chamar = async <T>(caminho: string, corpo?: Record<string, unknown>): Promise<T> => {
  if (!API_URL) throw new Error('A devolução precisa do servidor da empresa, que não está configurado neste ambiente. Avise o suporte.');
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Sua sessão expirou. Entre novamente para continuar.');
  let resposta: Response;
  try {
    resposta = await fetchComTimeout(`${API_URL}/api/devolucoes-venda${caminho}`, {
      method: corpo ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
      ...(corpo ? { body: JSON.stringify(corpo) } : {}),
    });
  } catch (erro) {
    throw new Error(`${mensagemDeFalhaDeRede(erro)}${corpo ? ' Confira na lista de Devoluções se ela foi registrada antes de fazer de novo.' : ''}`, { cause: erro });
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(dados.error || 'Não foi possível concluir a devolução. Tente novamente.');
  return dados as T;
};

export interface ParcelaEmAbertoDoCliente {
  id: string;
  descricao: string;
  /** AAAA-MM-DD */
  vencimento: string;
  centavos: number;
  formaPagamento: string;
  numeroPedido: string;
}

export interface OpcoesDoValor {
  parcelas: ParcelaEmAbertoDoCliente[];
  bancos: Array<{ id: string; nome: string }>;
  podeAbater: boolean;
}

export interface AbatimentoFeito {
  id: string;
  descricao: string;
  centavos: number;
  quita: boolean;
  restaCentavos: number;
}

export interface DevolucaoGravada {
  id: string;
  pedidoId: string;
  numeroPedido: string;
  valor: number;
  semPedido?: boolean;
}

export interface ResultadoDaDevolucaoNoSistema {
  ok: boolean;
  jaEnviada: boolean;
  clienteNome?: string;
  valorTotal?: number;
  destino?: DestinoDoValor['tipo'];
  bancoNome?: string;
  abatimento?: AbatimentoFeito[];
  sobraDeCreditoCentavos?: number;
  devolucoes: DevolucaoGravada[];
}

export interface ResultadoDaConfirmacao {
  ok: boolean;
  devolucaoId: string;
  pedidoId: string;
  numeroPedido: string;
  valorTotal: number;
  destino: DestinoDoValor['tipo'];
  bancoNome: string;
  abatimento: AbatimentoFeito[];
  sobraDeCreditoCentavos: number;
}

export interface LinhaDoPedidoDoCliente {
  indice: number;
  produtoId: string;
  nome: string;
  quantidade: number;
  disponivel: number;
  precoUnitario: number;
  desconto: number;
  unidadeMedidaSigla: string;
  fracionado: boolean;
}

export interface PedidoDoClienteComProduto {
  id: string;
  numeroPedido: string;
  dataVenda: string;
  linhas: LinhaDoPedidoDoCliente[];
}

export interface DevolucaoNoSistema {
  idDocumento: string;
  clienteId: string;
  clienteNome: string;
  pedidos: Array<{ pedidoId: string; itens: Array<{ indice: number; quantidade: number }> }>;
  semPedido: Array<{ produtoId: string; quantidade: number; precoUnitario: number | null }>;
  motivo: string;
  observacao: string;
  destino: DestinoDoValor;
}

/** Id do envio: o mesmo em todas as tentativas de uma devolucao (reenviar nao duplica). */
export const novoIdDeDevolucao = (): string => {
  const aleatorio = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().replace(/-/g, '') : `${Date.now()}${Math.random().toString(36).slice(2)}`;
  return `dv${aleatorio}`.slice(0, 34);
};

export const devolucaoEscritorioService = {
  opcoesDoValor: (cliente: { id?: string; nome?: string }) => chamar<OpcoesDoValor>(
    `/opcoes-do-valor?${new URLSearchParams({ clienteId: cliente.id || '', clienteNome: cliente.nome || '' }).toString()}`,
  ),
  pedidosDoCliente: (clienteId: string, produtoIds: string[]) => (
    chamar<{ pedidos: PedidoDoClienteComProduto[] }>('/pedidos-do-cliente', { clienteId, produtoIds })
  ),
  registrar: (devolucao: DevolucaoNoSistema) => chamar<ResultadoDaDevolucaoNoSistema>('/sistema', { ...devolucao }),
  confirmar: (devolucaoId: string, destino: DestinoDoValor) => (
    chamar<ResultadoDaConfirmacao>(`/${encodeURIComponent(devolucaoId)}/confirmar`, { destino })
  ),
};
