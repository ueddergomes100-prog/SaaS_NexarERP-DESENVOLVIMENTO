import { contaComoFaturamento, isPedidoCancelado } from './preVendaDomain';

/*
 * COMPRAS DO CLIENTE (27/11/2026, pedido do dono: "nosso sistema tem o
 * historico de compra do cliente?"). A ficha do cliente (e a consulta do
 * cliente no app Vendas) mostram as vendas feitas no Hennder para ele: a
 * lista de pedidos, o total comprado, a ultima compra e os produtos que ele
 * mais leva. Le as vendas ja' gravadas (pedidos_venda pelo clienteId): tudo o
 * que ja' foi vendido aparece sem importar nada.
 *
 * Total, ticket e produtos contam so' venda faturada (contaComoFaturamento:
 * pre-venda em aberto e cancelada ficam na lista, fora das contas). O valor e'
 * o total do pedido; devolucao feita depois nao abate aqui (aparece em
 * Devolucoes de Venda).
 *
 * Regra pura: recebe os pedidos ja' lidos e devolve o resumo.
 */

export interface VendaDoCliente {
  id: string;
  numero: string;
  /** yyyy-mm-dd */
  data: string;
  status: string;
  totalCentavos: number;
  formas: string;
  vendedorNome: string;
  /** Entra no total (faturada). */
  conta: boolean;
  cancelada: boolean;
  bonificacao: boolean;
}

export interface ProdutoMaisComprado {
  chave: string;
  nome: string;
  unidade: string;
  quantidade: number;
  valorCentavos: number;
  /** Em quantas vendas o produto apareceu. */
  vezes: number;
}

export interface ResumoComprasDoCliente {
  vendas: VendaDoCliente[];
  compras: number;
  totalCentavos: number;
  ticketMedioCentavos: number;
  /** yyyy-mm-dd da ultima venda faturada; '' sem nenhuma. */
  ultimaCompra: string;
  primeiraCompra: string;
  produtos: ProdutoMaisComprado[];
}

const texto = (v: unknown): string => String(v ?? '').trim();
const centavos = (reais: unknown, cent: unknown): number => {
  const c = Number(cent);
  if (cent !== undefined && cent !== null && Number.isFinite(c)) return Math.round(c);
  const r = Number(reais);
  return Number.isFinite(r) ? Math.round(r * 100) : 0;
};

const dataIso = (v: unknown): string => {
  const s = texto(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const comToDate = v as { toDate?: () => Date } | null;
  if (comToDate && typeof comToDate.toDate === 'function') {
    const d = comToDate.toDate();
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
  }
  return '';
};

const formasDoPedido = (p: Record<string, unknown>): string => {
  const pagamentos = Array.isArray(p.pagamentos) ? p.pagamentos as Array<Record<string, unknown>> : [];
  const formas = [...new Set(pagamentos.map((pg) => texto(pg.formaPagamento)).filter(Boolean))];
  return formas.length > 0 ? formas.join(' + ') : texto(p.formaPagamento);
};

/** Uma venda do Firestore no formato da lista. */
export const vendaDoCliente = (id: string, p: Record<string, unknown>): VendaDoCliente => ({
  id,
  numero: texto(p.numeroPedido) || id.slice(0, 6),
  data: dataIso(p.dataVenda) || dataIso(p.createdAt),
  status: texto(p.status),
  totalCentavos: centavos(p.valorTotal, p.valorTotalCentavos),
  formas: formasDoPedido(p),
  vendedorNome: texto(p.vendedorNome),
  conta: contaComoFaturamento(p.status),
  cancelada: isPedidoCancelado(p.status),
  bonificacao: texto(p.tipoPedido) === 'bonificacao',
});

export const resumirComprasDoCliente = (
  pedidos: Array<{ id: string } & Record<string, unknown>>,
  opcoes: { desde?: string; maxProdutos?: number } = {},
): ResumoComprasDoCliente => {
  const desde = opcoes.desde || '';
  const noPeriodo = pedidos
    .map((p) => ({ bruto: p, venda: vendaDoCliente(p.id, p) }))
    .filter(({ venda }) => !desde || (venda.data && venda.data >= desde))
    .sort((a, b) => b.venda.data.localeCompare(a.venda.data) || b.venda.numero.localeCompare(a.venda.numero, 'pt-BR', { numeric: true }));

  const faturadas = noPeriodo.filter(({ venda }) => venda.conta);
  // Bonificacao e' brinde: aparece na lista, nao conta como compra.
  const compradas = faturadas.filter(({ venda }) => !venda.bonificacao);
  const totalCentavos = compradas.reduce((soma, { venda }) => soma + venda.totalCentavos, 0);

  const produtos = new Map<string, ProdutoMaisComprado>();
  compradas.forEach(({ bruto }) => {
    const itens = Array.isArray(bruto.itens) ? bruto.itens as Array<Record<string, unknown>> : [];
    const nestaVenda = new Set<string>();
    itens.forEach((item) => {
      if (item.bonificado === true) return;
      const nome = texto(item.nome) || texto(item.descricao) || 'Produto sem nome';
      const unidade = texto(item.unidadeMedidaSigla) || texto(item.unidade);
      // Mesma unidade junto: o mesmo produto vendido em PCT e em UN fica em duas linhas (nao soma pacote com unidade).
      const chave = `${texto(item.produtoId) || texto(item.id) || nome.toUpperCase()}|${unidade}`;
      const atual = produtos.get(chave) || { chave, nome, unidade, quantidade: 0, valorCentavos: 0, vezes: 0 };
      atual.quantidade += Number(item.quantidade) || 0;
      atual.valorCentavos += centavos(item.subtotal, item.subtotalCentavos);
      if (!nestaVenda.has(chave)) {
        atual.vezes += 1;
        nestaVenda.add(chave);
      }
      produtos.set(chave, atual);
    });
  });

  const datas = compradas.map(({ venda }) => venda.data).filter(Boolean).sort();
  return {
    vendas: noPeriodo.map(({ venda }) => venda),
    compras: compradas.length,
    totalCentavos,
    ticketMedioCentavos: compradas.length > 0 ? Math.round(totalCentavos / compradas.length) : 0,
    ultimaCompra: datas.length > 0 ? datas[datas.length - 1] : '',
    primeiraCompra: datas.length > 0 ? datas[0] : '',
    produtos: [...produtos.values()]
      .sort((a, b) => b.vezes - a.vezes || b.valorCentavos - a.valorCentavos || a.nome.localeCompare(b.nome, 'pt-BR'))
      .slice(0, opcoes.maxProdutos ?? 8),
  };
};
