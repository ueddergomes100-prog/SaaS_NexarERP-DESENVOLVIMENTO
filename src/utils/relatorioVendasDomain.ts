/*
 * CONTA DO RELATORIO DE VENDAS -- UMA SO' PARA O SISTEMA INTEIRO.
 *
 * Antes existiam duas contas diferentes para a mesma pergunta ("quanto cada
 * vendedor vendeu no periodo?"):
 *
 *  - a tela Vendas > Relatorio de Vendas, que ja seguia as regras certas
 *    (data da venda, pre-venda fora do faturamento, devolucao abatida da
 *    venda de origem);
 *  - o Vendas por Vendedor de Relatorios Diversos, que usava a data de
 *    criacao, somava pedido em aberto como venda e nao mostrava desconto.
 *
 * Resultado: o mesmo periodo dava um total na tela e outro no papel. Esta
 * conta mora aqui e as duas telas usam ela -- o numero impresso e' sempre o
 * numero da tela.
 */
import { dateInputToUtcStart } from './dateTime';
import { contaComoFaturamento } from './preVendaDomain';
import { toCents } from './financeDomain';

export interface DadosRelatorioVendas {
  sales: any[];
  transactions: any[];
  users: Record<string, any>;
  products: Record<string, any>;
  returns: any[];
}

export interface VendaRelatorio {
  [campo: string]: any;
  id: string;
  date: Date | null;
  sellerId: string;
  sellerName: string;
  grossCents: number;
  discountCents: number;
  saleTotalCents: number;
  returnedCents: number;
  netCents: number;
  receivedCents: number;
  pendingCents: number;
  payments: any[];
  paymentMethods: string[];
  paymentCondition: 'avista' | 'aprazo' | string;
  cardFeeCents: number;
  financialNetCents: number;
  commissionCents: number;
  commissionStatus: string;
  cancelled: boolean;
}

export interface TotaisVendas {
  count: number;
  cancelledCount: number;
  grossCents: number;
  discountCents: number;
  netCents: number;
  receivedCents: number;
  pendingCents: number;
  cardFeeCents: number;
  financialNetCents: number;
  commissionCents: number;
  returnedCents: number;
  averageCents: number;
}

export interface ResumoVendedor {
  id: string;
  name: string;
  sales: number;
  cancellations: number;
  grossCents: number;
  discountCents: number;
  netCents: number;
  receivedCents: number;
  pendingCents: number;
  cardFeeCents: number;
  financialNetCents: number;
  commissionCents: number;
  returnedCents: number;
  averageCents: number;
  payments: Record<string, number>;
}

export const VENDEDOR_NAO_IDENTIFICADO = 'nao_identificado';

export const toDateRelatorio = (value: any): Date | null => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value.seconds) return new Date(value.seconds * 1000);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return dateInputToUtcStart(value);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/**
 * Este relatorio e' de FATURAMENTO -- pedido em aberto (pre-venda do balcao
 * ou pedido do agente aguardando confirmacao) fica de fora: nao gerou
 * lancamento financeiro nenhum. Pre-venda em aberto tem tela propria
 * (Relatorio de Pre-vendas em Aberto).
 */
export const filtrarVendasFaturadas = <T extends { status?: unknown }>(vendas: T[]): T[] => (
  vendas.filter((venda) => contaComoFaturamento(venda.status))
);

export const enriquecerVendas = (data: DadosRelatorioVendas): VendaRelatorio[] => {
  const transactionsBySale = new Map<string, any[]>();
  data.transactions.forEach((transaction) => {
    const saleId = transaction.pedidoId || (transaction.sourceType === 'pedido_venda' ? transaction.sourceId : '');
    if (!saleId) return;
    const current = transactionsBySale.get(saleId) || [];
    current.push(transaction);
    transactionsBySale.set(saleId, current);
  });

  const returnsBySale = new Map<string, number>();
  data.returns
    .filter((item) => item.status === 'concluida')
    .forEach((item) => {
      const saleId = item.pedidoVendaId || item.pedidoOrigemId;
      if (saleId) {
        returnsBySale.set(
          saleId,
          (returnsBySale.get(saleId) || 0) +
            Number(item.valorTotalDevolvidoCentavos ?? toCents(item.valorTotalDevolvido)),
        );
      }
    });

  return data.sales.map((sale) => {
    const saleTransactions = transactionsBySale.get(sale.id) || [];
    const sellerId = sale.vendedorId || sale.usuarioResponsavelId || '';
    const seller = data.users[sellerId];
    const sellerName = sale.vendedorNome || seller?.nome || seller?.nomeResponsavel || seller?.email || 'Não identificado';
    const grossCents = Number(sale.valorTotalItensCentavos ?? toCents(Number(sale.valorTotal || 0) + Number(sale.valorTotalDescontos || 0)));
    const discountCents = Number(sale.valorTotalDescontosCentavos ?? toCents(sale.valorTotalDescontos));
    const saleTotalCents = Number(sale.valorTotalCentavos ?? toCents(sale.valorTotal));
    const returnedCents = returnsBySale.get(sale.id) || 0;
    const cancelled = sale.status === 'Cancelada';
    const netCents = cancelled ? 0 : Math.max(0, saleTotalCents - returnedCents);
    const rawReceivedCents = cancelled ? 0 : saleTransactions
      .filter((transaction) => transaction.tipo === 'entrada' && transaction.status === 'Paga')
      .reduce((sum, transaction) => sum + Number(transaction.valorCentavos ?? toCents(transaction.valor)), 0);
    const rawPendingCents = cancelled ? 0 : saleTransactions
      .filter((transaction) => transaction.tipo === 'entrada' && transaction.status === 'Pendente')
      .reduce((sum, transaction) => sum + Number(transaction.valorCentavos ?? toCents(transaction.valor)), 0);
    const fallbackReceivedCents = Number(sale.totalRecebidoCentavos ?? toCents(sale.totalRecebido));
    const fallbackPendingCents = Number(sale.totalPendenteCentavos ?? toCents(sale.totalPendente));
    const receivedCents = cancelled
      ? 0
      : Math.min(netCents, rawReceivedCents || fallbackReceivedCents);
    const pendingCents = cancelled
      ? 0
      : Math.min(Math.max(0, netCents - receivedCents), rawPendingCents || fallbackPendingCents);
    const payments = Array.isArray(sale.pagamentos) && sale.pagamentos.length > 0
      ? sale.pagamentos
      : [{ formaPagamento: sale.formaPagamento || 'Não informado', condicaoPagamento: sale.condicaoPagamento || (String(sale.formaPagamento).includes('Prazo') ? 'aprazo' : 'avista'), valorCentavos: saleTotalCents }];
    const paymentMethods = Array.from(new Set(payments.map((payment: any) => payment.formaPagamento).filter(Boolean))) as string[];
    const paymentCondition = sale.condicaoPagamento || (payments.some((payment: any) => payment.condicaoPagamento === 'aprazo') ? 'aprazo' : 'avista');
    const storedCardFeeCents = sale.totalTaxasPagamentoCentavos !== undefined
      ? Number(sale.totalTaxasPagamentoCentavos)
      : sale.totalTaxasPagamento !== undefined
        ? toCents(sale.totalTaxasPagamento)
        : payments.reduce((sum: number, payment: any) => (
            sum + Number(payment.cartao?.valorTaxaCentavos ?? toCents(payment.cartao?.valorTaxa))
          ), 0);
    const cardFeeCents = cancelled ? 0 : Math.min(netCents, Math.max(0, storedCardFeeCents));
    const financialNetCents = cancelled ? 0 : Math.max(0, netCents - cardFeeCents);
    const commissionCents = cancelled ? 0 : Number(sale.comissao?.valorAtualCentavos ?? toCents(sale.comissao?.valorAtual));
    const commissionStatus = sale.comissao?.status || 'legado_sem_snapshot';

    return {
      ...sale,
      date: toDateRelatorio(sale.dataVenda) || toDateRelatorio(sale.createdAt),
      sellerId,
      sellerName,
      grossCents,
      discountCents,
      saleTotalCents,
      returnedCents,
      netCents,
      receivedCents,
      pendingCents,
      payments,
      paymentMethods,
      paymentCondition,
      cardFeeCents,
      financialNetCents,
      commissionCents,
      commissionStatus,
      cancelled,
    };
  });
};

export const vendaNoPeriodo = (venda: Pick<VendaRelatorio, 'date'>, inicio: Date | null, fim: Date | null): boolean => (
  Boolean(venda.date && inicio && fim && venda.date >= inicio && venda.date <= fim)
);

export const totaisVendas = (vendas: VendaRelatorio[]): TotaisVendas => {
  const valid = vendas.filter((sale) => !sale.cancelled);
  const soma = (campo: keyof VendaRelatorio) => valid.reduce((sum, sale) => sum + Number(sale[campo] || 0), 0);
  const netCents = soma('netCents');
  return {
    count: valid.length,
    cancelledCount: vendas.length - valid.length,
    grossCents: soma('grossCents'),
    discountCents: soma('discountCents'),
    netCents,
    receivedCents: soma('receivedCents'),
    pendingCents: soma('pendingCents'),
    cardFeeCents: soma('cardFeeCents'),
    financialNetCents: soma('financialNetCents'),
    commissionCents: soma('commissionCents'),
    returnedCents: soma('returnedCents'),
    averageCents: valid.length ? Math.round(netCents / valid.length) : 0,
  };
};

export const resumoPorVendedor = (vendas: VendaRelatorio[]): ResumoVendedor[] => {
  const map = new Map<string, ResumoVendedor>();
  vendas.forEach((sale) => {
    const id = sale.sellerId || VENDEDOR_NAO_IDENTIFICADO;
    const current = map.get(id) || {
      id,
      name: sale.sellerName,
      sales: 0,
      cancellations: 0,
      grossCents: 0,
      discountCents: 0,
      netCents: 0,
      receivedCents: 0,
      pendingCents: 0,
      cardFeeCents: 0,
      financialNetCents: 0,
      commissionCents: 0,
      returnedCents: 0,
      averageCents: 0,
      payments: {},
    };
    if (sale.cancelled) {
      current.cancellations += 1;
    } else {
      current.sales += 1;
      current.grossCents += sale.grossCents;
      current.discountCents += sale.discountCents;
      current.netCents += sale.netCents;
      current.receivedCents += sale.receivedCents;
      current.pendingCents += sale.pendingCents;
      current.cardFeeCents += sale.cardFeeCents;
      current.financialNetCents += sale.financialNetCents;
      current.commissionCents += sale.commissionCents;
      current.returnedCents += sale.returnedCents;
      sale.payments.forEach((payment: any) => {
        const method = payment.formaPagamento || 'Não informado';
        current.payments[method] = (current.payments[method] || 0) + Number(payment.valorCentavos ?? toCents(payment.valor));
      });
    }
    current.averageCents = current.sales ? Math.round(current.netCents / current.sales) : 0;
    map.set(id, current);
  });
  return Array.from(map.values()).sort((a, b) => b.financialNetCents - a.financialNetCents);
};

export const rotuloCondicaoPagamento = (condicao: string): string => (
  condicao === 'aprazo' ? 'A prazo' : 'À vista'
);
