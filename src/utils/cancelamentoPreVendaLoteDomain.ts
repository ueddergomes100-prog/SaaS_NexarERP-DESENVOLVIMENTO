/**
 * CANCELAR PRE-VENDAS EM LOTE (08/11/2026, pedido do dono).
 *
 * Na lista de Pedidos de Venda, os pedidos marcados no checkbox (os mesmos da
 * impressao em lote) podem ser cancelados de uma vez. Cada um passa pelo MESMO
 * cancelamento da tela do pedido -- POST /api/vendas/cancelar-pre-venda, um por
 * pedido: o servidor confere a permissao "Pré-venda: Cancelar", a rota de
 * entrega aberta, libera a reserva de estoque, reabre o orcamento de origem e
 * grava o historico. Este arquivo so' decide QUAIS dos marcados entram e monta
 * as mensagens.
 *
 * Entra so' pre-venda do balcao em aberto (mesma regra do botao "Cancelar
 * Pré-venda" do pedido: status "Pré-venda" e origem balcao). Pedido do agente
 * ("Em Análise") tem fluxo proprio (Recusar); venda finalizada se cancela pelo
 * pedido, com o motivo e a nota fiscal. Pre-venda aberta para editar por outra
 * pessoa (trava de edicao) fica de fora: cancelar por baixo dela faria a outra
 * pessoa perder o que esta digitando.
 */
import { resolveOrigemPedido, STATUS_PRE_VENDA } from './preVendaDomain';

export interface PedidoParaCancelarEmLote {
  id: string;
  numeroPedido?: unknown;
  clienteNome?: unknown;
  status?: unknown;
  origem?: unknown;
}

export interface PreVendaParaCancelar {
  id: string;
  numero: string;
  cliente: string;
}

export interface SelecaoParaCancelar {
  cancelaveis: PreVendaParaCancelar[];
  /** Marcados que nao sao pre-venda do balcao em aberto (venda, cancelado, pedido do agente). */
  naoSaoPreVenda: number;
  /** Pre-vendas abertas para editar por outra pessoa agora. */
  emEdicao: PreVendaParaCancelar[];
}

const numeroDo = (p: PedidoParaCancelarEmLote): string => String(p.numeroPedido ?? '').trim() || '—';

export const ehPreVendaCancelavelEmLote = (p: PedidoParaCancelarEmLote): boolean => (
  String(p.status ?? '').trim() === STATUS_PRE_VENDA && resolveOrigemPedido(p) === 'balcao'
);

export const separarPreVendasParaCancelar = (
  pedidos: readonly PedidoParaCancelarEmLote[],
  marcados: ReadonlySet<string>,
  emEdicaoPorOutro: (id: string) => boolean,
): SelecaoParaCancelar => {
  const cancelaveis: PreVendaParaCancelar[] = [];
  const emEdicao: PreVendaParaCancelar[] = [];
  let naoSaoPreVenda = 0;
  pedidos.forEach((p) => {
    if (!marcados.has(p.id)) return;
    if (!ehPreVendaCancelavelEmLote(p)) {
      naoSaoPreVenda += 1;
      return;
    }
    const item = { id: p.id, numero: numeroDo(p), cliente: String(p.clienteNome ?? '').trim() };
    (emEdicaoPorOutro(p.id) ? emEdicao : cancelaveis).push(item);
  });
  const porNumero = (a: PreVendaParaCancelar, b: PreVendaParaCancelar) => a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true });
  return { cancelaveis: cancelaveis.sort(porNumero), naoSaoPreVenda, emEdicao: emEdicao.sort(porNumero) };
};

/** "#0032, #0035 e #0038" -- ate' `max` numeros, depois "e mais N". */
export const listaDeNumeros = (itens: readonly PreVendaParaCancelar[], max = 12): string => {
  const numeros = itens.map((i) => `#${i.numero}`);
  if (numeros.length <= max) {
    return numeros.length <= 1 ? (numeros[0] ?? '') : `${numeros.slice(0, -1).join(', ')} e ${numeros[numeros.length - 1]}`;
  }
  return `${numeros.slice(0, max).join(', ')} e mais ${numeros.length - max}`;
};

/** Avisos da confirmacao sobre os marcados que ficam de fora. */
export const avisosDaSelecao = (s: SelecaoParaCancelar): string[] => {
  const avisos: string[] = [];
  if (s.naoSaoPreVenda > 0) {
    avisos.push(s.naoSaoPreVenda === 1
      ? '1 pedido marcado não é pré-venda em aberto e fica como está.'
      : `${s.naoSaoPreVenda} pedidos marcados não são pré-venda em aberto e ficam como estão.`);
  }
  if (s.emEdicao.length > 0) {
    avisos.push(`${listaDeNumeros(s.emEdicao)} ${s.emEdicao.length === 1 ? 'está aberta' : 'estão abertas'} para editar por outra pessoa e não ${s.emEdicao.length === 1 ? 'será cancelada' : 'serão canceladas'}.`);
  }
  return avisos;
};

export interface ResultadoDoCancelamentoEmLote {
  canceladas: PreVendaParaCancelar[];
  falhas: Array<PreVendaParaCancelar & { motivo: string }>;
}

/** Mensagem final: quantas foram canceladas e, das que nao foram, o porque de cada uma. */
export const resumoDoCancelamentoEmLote = (r: ResultadoDoCancelamentoEmLote): { titulo: string; texto: string; tudoCerto: boolean } => {
  const n = r.canceladas.length;
  const tudoCerto = r.falhas.length === 0;
  const titulo = n === 0
    ? 'Nenhuma pré-venda foi cancelada'
    : tudoCerto
      ? (n === 1 ? '1 pré-venda cancelada' : `${n} pré-vendas canceladas`)
      : `${n} de ${n + r.falhas.length} pré-vendas canceladas`;
  const partes: string[] = [];
  if (n > 0) partes.push(`Canceladas: ${listaDeNumeros(r.canceladas)}. O estoque reservado voltou a ficar disponível.`);
  if (!tudoCerto) {
    partes.push('Não canceladas:');
    r.falhas.forEach((f) => partes.push(`#${f.numero}: ${f.motivo}`));
  }
  return { titulo, texto: partes.join('\n'), tudoCerto };
};
