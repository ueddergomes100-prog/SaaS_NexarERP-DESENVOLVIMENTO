import { API_URL, ErroDoServidor, chamarServidor } from './apiServidor';
import { fetchComTimeout, mensagemDeFalhaDeRede } from '../utils/fetchComTimeout';
import type { DadosDoPedidoCompra, ItemDaCotacao, PedidoDeCotacao, RespostaDoFornecedor, StatusPedidoCompra } from '../utils/comprasDomain';

/**
 * COMPRAS (22/10/2026) -- cliente HTTP de server/services/compras.js. As
 * listas vem do Firestore (useTenantCollection em `cotacoes_compra` e
 * `pedidos_compra`); toda escrita passa por aqui. Regra em comprasDomain.ts.
 */

export const criarCotacao = (corpo: PedidoDeCotacao) => chamarServidor<{ ok: true; id: string; numero: number }>('POST', 'compras/cotacoes', { ...corpo });
export const editarCotacao = (id: string, corpo: PedidoDeCotacao) => chamarServidor<{ ok: true; id: string; numero: number }>('POST', `compras/cotacoes/${encodeURIComponent(id)}`, { ...corpo });
export const cancelarCotacao = (id: string) => chamarServidor<{ ok: true }>('POST', `compras/cotacoes/${encodeURIComponent(id)}/cancelar`, {});
export const fecharCotacao = (id: string) => chamarServidor<{ ok: true }>('POST', `compras/cotacoes/${encodeURIComponent(id)}/fechar`, {});
export const gerarPedidosDaCotacao = (id: string, escolhas: Record<string, string>) => (
  chamarServidor<{ ok: true; pedidos: Array<{ pedidoId: string; fornecedorId: string; fornecedorNome: string; numero: number; totalCentavos: number }> }>(
    'POST', `compras/cotacoes/${encodeURIComponent(id)}/gerar-pedidos`, { escolhas },
  )
);

export const criarPedidoCompra = (corpo: Omit<DadosDoPedidoCompra, 'totalCentavos' | 'itens'> & { itens: Array<Partial<ItemDaCotacao> & { produtoId: string; nome: string; quantidade: number; precoUnitarioCentavos: number }> }) => (
  chamarServidor<{ ok: true; id: string; numero: number; totalCentavos: number }>('POST', 'compras/pedidos', { ...corpo })
);
export const editarPedidoCompra = (id: string, corpo: Parameters<typeof criarPedidoCompra>[0]) => (
  chamarServidor<{ ok: true; id: string; numero: number; totalCentavos: number }>('POST', `compras/pedidos/${encodeURIComponent(id)}`, { ...corpo })
);
export const mudarStatusPedidoCompra = (id: string, status: Exclude<StatusPedidoCompra, 'aberto'>) => (
  chamarServidor<{ ok: true; status: StatusPedidoCompra }>('POST', `compras/pedidos/${encodeURIComponent(id)}/status`, { status })
);

// ---------------------------------------------------------------------------
// LINK PUBLICO (fornecedor, sem login)
// ---------------------------------------------------------------------------

export interface CotacaoPublica {
  empresa: string;
  titulo: string;
  numero: number;
  fornecedorNome: string;
  responderAte: string;
  observacao: string;
  itens: ItemDaCotacao[];
  respostaAnterior: (RespostaDoFornecedor & { respondidoEmIso: string }) | null;
  /** Texto em portugues quando nao da' mais para responder (vencida, fechada, cancelada). */
  bloqueio: string | null;
}

const chamarPublico = async <T>(rota: string, corpo: Record<string, unknown>): Promise<T> => {
  if (!API_URL) throw new ErroDoServidor('O servidor não está configurado neste ambiente.', 0);
  let resposta: Response;
  try {
    resposta = await fetchComTimeout(`${API_URL}/api/cotacoes-publicas/${rota}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    });
  } catch (erro) {
    throw new ErroDoServidor(mensagemDeFalhaDeRede(erro), 0, { cause: erro });
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new ErroDoServidor(dados.error || 'Não foi possível abrir a cotação. Tente de novo em instantes.', resposta.status);
  return dados as T;
};

export const abrirCotacaoPublica = (token: string, codigo: string) => chamarPublico<CotacaoPublica>('abrir', { token, codigo });
export const responderCotacaoPublica = (token: string, codigo: string, resposta: { precos: Record<string, number>; prazoEntregaDias: number | null; condicaoPagamento: string; observacao: string }) => (
  chamarPublico<{ ok: true; itensCotados: number; empresa: string }>('responder', { token, codigo, ...resposta })
);
