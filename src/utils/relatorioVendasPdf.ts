/*
 * Colunas e secoes dos relatorios de vendas em PDF.
 *
 * Toda coluna que o sistema tem esta aqui -- o cliente escolhe por checkbox o
 * que sai. As marcadas por padrao sao o conjunto que a Taiene (Shopping
 * Rural) montava na mao no Excel todo dia: Pedido, Data (sem hora), valores,
 * Pagamento, Condicao, Recebido (video de 22/09/2026). O resto continua
 * disponivel para quem usa.
 */
import { fromCents } from './financeDomain';
import {
  rotuloCondicaoPagamento,
  type ResumoVendedor,
  type TotaisVendas,
  type VendaRelatorio,
} from './relatorioVendasDomain';
import type { ColunaRelatorio, IndicadorRelatorio, SecaoRelatorio } from './relatorioPdfDomain';

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const inteiro = new Intl.NumberFormat('pt-BR');

const horaDaVenda = (venda: VendaRelatorio): string => (
  venda.date
    ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false }).format(venda.date)
    : ''
);

export const colunasVendas = (opcoes: { vendedorPadrao?: boolean } = {}): ColunaRelatorio<VendaRelatorio>[] => [
  { id: 'pedido', titulo: 'Pedido', tipo: 'texto', largura: 16, valor: (v) => (v.numeroPedido ? `#${v.numeroPedido}` : `#${String(v.id).slice(0, 6)}`) },
  { id: 'data', titulo: 'Data', tipo: 'data', valor: (v) => v.date },
  { id: 'hora', titulo: 'Hora', tipo: 'texto', largura: 12, padrao: false, valor: horaDaVenda },
  { id: 'cliente', titulo: 'Cliente', tipo: 'texto', largura: 56, valor: (v) => v.clienteNome || 'Consumidor final' },
  { id: 'vendedor', titulo: 'Vendedor', tipo: 'texto', largura: 26, padrao: opcoes.vendedorPadrao ?? true, valor: (v) => v.sellerName },
  { id: 'bruto', titulo: 'Bruto', tipo: 'moeda', valor: (v) => v.grossCents },
  { id: 'desconto', titulo: 'Desconto', tipo: 'moeda', valor: (v) => v.discountCents },
  { id: 'devolvido', titulo: 'Devolvido', tipo: 'moeda', padrao: false, valor: (v) => v.returnedCents },
  { id: 'liquida', titulo: 'Venda líquida', tipo: 'moeda', valor: (v) => v.netCents },
  { id: 'taxas', titulo: 'Taxas cartão', tipo: 'moeda', padrao: false, valor: (v) => v.cardFeeCents },
  { id: 'receita', titulo: 'Receita líquida', tipo: 'moeda', padrao: false, valor: (v) => v.financialNetCents },
  { id: 'pagamento', titulo: 'Pagamento', tipo: 'texto', largura: 32, valor: (v) => v.paymentMethods.join(' + ') },
  { id: 'condicao', titulo: 'Condição', tipo: 'texto', largura: 17, valor: (v) => rotuloCondicaoPagamento(v.paymentCondition) },
  { id: 'status', titulo: 'Status', tipo: 'texto', largura: 20, padrao: false, valor: (v) => v.status },
  { id: 'recebido', titulo: 'Recebido', tipo: 'moeda', valor: (v) => v.receivedCents },
  { id: 'pendente', titulo: 'Pendente', tipo: 'moeda', valor: (v) => v.pendingCents },
  { id: 'comissao', titulo: 'Comissão', tipo: 'moeda', padrao: false, valor: (v) => v.commissionCents },
];

export const colunasResumoVendedor = (): ColunaRelatorio<ResumoVendedor>[] => [
  { id: 'vendedor', titulo: 'Vendedor', tipo: 'texto', largura: 28, valor: (s) => s.name },
  { id: 'vendas', titulo: 'Vendas', tipo: 'inteiro', valor: (s) => s.sales },
  { id: 'bruto', titulo: 'Bruto', tipo: 'moeda', valor: (s) => s.grossCents },
  { id: 'descontos', titulo: 'Descontos', tipo: 'moeda', valor: (s) => s.discountCents },
  { id: 'canceladas', titulo: 'Cancel.', tipo: 'inteiro', padrao: false, valor: (s) => s.cancellations },
  { id: 'devolvido', titulo: 'Devolvido', tipo: 'moeda', padrao: false, valor: (s) => s.returnedCents },
  { id: 'liquida', titulo: 'Venda líquida', tipo: 'moeda', valor: (s) => s.netCents },
  { id: 'taxas', titulo: 'Taxas cartão', tipo: 'moeda', padrao: false, valor: (s) => s.cardFeeCents },
  { id: 'receita', titulo: 'Receita líquida', tipo: 'moeda', padrao: false, valor: (s) => s.financialNetCents },
  {
    id: 'ticket',
    titulo: 'Ticket médio',
    tipo: 'moeda',
    valor: (s) => s.averageCents,
    totalCalculado: (linhas) => {
      const vendas = linhas.reduce((soma, s) => soma + s.sales, 0);
      return vendas ? Math.round(linhas.reduce((soma, s) => soma + s.netCents, 0) / vendas) : 0;
    },
  },
  { id: 'recebido', titulo: 'Recebido', tipo: 'moeda', valor: (s) => s.receivedCents },
  { id: 'receber', titulo: 'A receber', tipo: 'moeda', valor: (s) => s.pendingCents },
  {
    id: 'pagamentos',
    titulo: 'Pagamentos',
    tipo: 'texto',
    largura: 48,
    padrao: false,
    valor: (s) => Object.entries(s.payments).map(([forma, valor]) => `${forma}: ${moeda.format(fromCents(Number(valor)))}`).join(' • '),
  },
  { id: 'comissao', titulo: 'Comissão', tipo: 'moeda', padrao: false, valor: (s) => s.commissionCents },
];

export const indicadoresVendas = (totais: TotaisVendas): IndicadorRelatorio[] => [
  { rotulo: 'Vendas válidas', valor: inteiro.format(totais.count) },
  { rotulo: 'Bruto', valor: moeda.format(fromCents(totais.grossCents)) },
  { rotulo: 'Descontos', valor: moeda.format(fromCents(totais.discountCents)) },
  { rotulo: 'Venda líquida', valor: moeda.format(fromCents(totais.netCents)) },
  { rotulo: 'Taxas de cartão', valor: moeda.format(fromCents(totais.cardFeeCents)) },
  { rotulo: 'Receita líquida', valor: moeda.format(fromCents(totais.financialNetCents)) },
  { rotulo: 'Ticket médio', valor: moeda.format(fromCents(totais.averageCents)) },
  { rotulo: 'Recebido', valor: moeda.format(fromCents(totais.receivedCents)) },
  { rotulo: 'Pendente', valor: moeda.format(fromCents(totais.pendingCents)) },
  { rotulo: 'Comissões', valor: moeda.format(fromCents(totais.commissionCents)) },
];

export const secaoResumoVendedor = (
  resumo: ResumoVendedor[],
  extra: Partial<SecaoRelatorio<ResumoVendedor>> = {},
): SecaoRelatorio<ResumoVendedor> => ({
  id: 'resumo-vendedor',
  titulo: 'Vendas por vendedor',
  colunas: colunasResumoVendedor(),
  linhas: resumo,
  rotuloTotal: 'Total geral',
  unidade: ['vendedor', 'vendedores'],
  mensagemVazia: 'Nenhuma venda no período.',
  ...extra,
});

export const secaoDetalheVendas = (
  vendas: VendaRelatorio[],
  extra: Partial<SecaoRelatorio<VendaRelatorio>> = {},
): SecaoRelatorio<VendaRelatorio> => ({
  id: 'detalhe-vendas',
  titulo: 'Vendas do período',
  colunas: colunasVendas(),
  linhas: vendas,
  rotuloTotal: 'Total geral',
  unidade: ['venda', 'vendas'],
  mensagemVazia: 'Nenhuma venda no período.',
  ...extra,
});

/** Detalhe agrupado: cada vendedor com suas vendas e subtotal. */
export const secaoVendasPorVendedorDetalhe = (vendas: VendaRelatorio[]): SecaoRelatorio<VendaRelatorio> => {
  const ordenadas = [...vendas].sort((a, b) => (
    a.sellerName.localeCompare(b.sellerName, 'pt-BR') || (a.date?.getTime() || 0) - (b.date?.getTime() || 0)
  ));
  return secaoDetalheVendas(ordenadas, {
    id: 'detalhe-por-vendedor',
    titulo: 'Vendas de cada vendedor',
    colunas: colunasVendas({ vendedorPadrao: false }),
    opcional: true,
    padrao: false,
    agruparPor: { chave: (v) => v.sellerId || v.sellerName, rotulo: (v) => v.sellerName },
  });
};
