import { auth } from './firebase';
import { fetchComTimeout, mensagemDeFalhaDeRede } from '../utils/fetchComTimeout';
import type { DestinoDevolucao, StatusDevolucao } from '../utils/devolucaoVendaDomain';

/**
 * Cliente HTTP da DEVOLUCAO PELO APP VENDAS (24/11/2026). O app nunca grava
 * em `devolucoes_venda`: pede ao servidor (server/routes/devolucoesVenda.routes.js),
 * que confere empresa, vendedor, pedido e quantidades. Precisa de internet.
 */

const rawApiUrl = (import.meta.env.VITE_BACKEND_API_URL || '').trim();
const API_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : (import.meta.env.DEV ? 'http://localhost:3001' : '');

const chamar = async <T>(caminho: string, corpo?: Record<string, unknown>): Promise<T> => {
  if (!API_URL) throw new Error('A devolução precisa do servidor da empresa, que não está configurado neste ambiente. Avise o suporte.');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('Sem internet. A devolução só pode ser feita com o aparelho conectado: conecte e tente de novo.');
  }
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Sua sessão expirou. Entre novamente no aplicativo.');
  let resposta: Response;
  try {
    resposta = await fetchComTimeout(`${API_URL}/api/devolucoes-venda${caminho}`, {
      method: corpo ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
      ...(corpo ? { body: JSON.stringify(corpo) } : {}),
    });
  } catch (erro) {
    throw new Error(`${mensagemDeFalhaDeRede(erro)}${corpo ? ' Confira em "Minhas Devoluções" se ela foi registrada antes de enviar de novo.' : ''}`, { cause: erro });
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(dados.error || 'Não foi possível concluir. Tente novamente.');
  return dados as T;
};

export interface ItemParaDevolverNoApp {
  indice: number;
  id: string;
  nome: string;
  quantidade: number;
  quantidadeJaDevolvida: number;
  emAguardo: number;
  disponivel: number;
  precoUnitario: number;
  desconto: number;
  unidadeMedidaSigla: string;
  fracionado: boolean;
}

export interface DadosDevolucaoNoApp {
  pedido: { id: string; numeroPedido: string; clienteNome: string; dataVenda: string };
  itens: ItemParaDevolverNoApp[];
  bancos: Array<{ id: string; nome: string }>;
  motivos: string[];
  formasBancarias: string[];
  jaConfirmada: boolean;
  /** O vendedor escolhe o destino do valor (permissao propria, 25/11/2026)? */
  podeEscolherDestino?: boolean;
  prazo: { foraDoPrazo: boolean; acao: string; mensagem: string };
}

export interface DevolucaoDoVendedor {
  id: string;
  pedidoId: string;
  numeroPedido: string;
  clienteNome: string;
  valorTotal: number;
  destino: DestinoDevolucao;
  bancoNome: string;
  status: StatusDevolucao;
  motivo: string;
  observacao: string;
  motivoRecusa: string;
  itens: Array<{ nome: string; quantidade: number; unidadeMedidaSigla: string }>;
  criadaEmMillis: number | null;
  decididaEmMillis: number | null;
}

export interface PedidoDeDevolucaoNoApp {
  pedidoId: string;
  itens: Array<{ indice: number; quantidade: number }>;
  motivo: string;
  observacao: string;
  destino: DestinoDevolucao;
  bancoId: string;
  formaBancaria: string;
  idDocumento: string;
}

export const devolucaoAppService = {
  dados: (pedidoId: string) => chamar<DadosDevolucaoNoApp>(`/app/pedido/${encodeURIComponent(pedidoId)}`),
  enviar: (pedido: PedidoDeDevolucaoNoApp) => (
    chamar<{ ok: boolean; id: string; jaEnviada: boolean; status: StatusDevolucao; numeroPedido: string; valorTotal: number }>('/app', { ...pedido })
  ),
  minhas: () => chamar<{ devolucoes: DevolucaoDoVendedor[] }>('/app/minhas'),
};
