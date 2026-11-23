import {
  fromCents,
  normalizeCreditCardFeeSchedule,
  parseCreditTerms,
  parsePagamentoCartaoSimplificadoAtivo,
  toCents,
  type CreditCardFeeSchedule,
} from '../../utils/financeDomain';
import type { CamposDePrecoDoItem } from '../../utils/precoComPromocaoDomain';
import {
  productMatchesExactCode as sharedProductMatchesExactCode,
  productMatchesSearch as sharedProductMatchesSearch,
} from '../../utils/productSearch';
import { toBaseQuantity, type OpcaoUnidadeVenda } from '../../utils/embalagemDomain';
import type { PdvCartItem, PdvProduct, PdvSession, PdvTotals } from './types';

export const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

export interface PdvFinanceConfig {
  defaultTermDays: number;
  maxCreditInstallments: number;
  creditFeePercentByInstallment: CreditCardFeeSchedule;
  debitFeePercent: number;
  creditSettlementDays: number;
  debitSettlementDays: number;
  pagamentoCartaoSimplificadoAtivo: boolean;
}

export const defaultPdvFinanceConfig = (): PdvFinanceConfig => ({
  defaultTermDays: 30,
  maxCreditInstallments: 12,
  creditFeePercentByInstallment: normalizeCreditCardFeeSchedule(null),
  debitFeePercent: 0,
  creditSettlementDays: 30,
  debitSettlementDays: 1,
  pagamentoCartaoSimplificadoAtivo: false,
});

export const buildPdvFinanceConfig = (config: Record<string, unknown> | null | undefined): PdvFinanceConfig => {
  const configuredTerms = parseCreditTerms(config?.diasCrediario);
  const creditSettlementDays = config?.prazoRecebimentoCartaoCreditoDias ?? 30;
  const debitSettlementDays = config?.prazoRecebimentoCartaoDebitoDias ?? 1;

  return {
    defaultTermDays: configuredTerms[0] || 30,
    maxCreditInstallments: Math.min(12, Math.max(1, Number(config?.maxParcelasCartao ?? 12) || 12)),
    creditFeePercentByInstallment: normalizeCreditCardFeeSchedule(
      config?.taxasCartaoCreditoPorParcela,
      Number(config?.taxaCartaoCreditoPercentual || 0),
    ),
    debitFeePercent: Math.max(0, Number(config?.taxaCartaoDebitoPercentual || 0)),
    creditSettlementDays: creditSettlementDays === '' ? 30 : Math.max(0, Number(creditSettlementDays)),
    debitSettlementDays: debitSettlementDays === '' ? 1 : Math.max(0, Number(debitSettlementDays)),
    pagamentoCartaoSimplificadoAtivo: parsePagamentoCartaoSimplificadoAtivo(config?.pagamentoCartaoSimplificadoAtivo),
  };
};

// Delega para o servico unificado de busca de produto (src/utils/productSearch.ts),
// preservando a assinatura e o comportamento (modo completa, sem limite aqui —
// o corte em 12 itens continua responsabilidade de PDV.tsx).
export const productMatchesSearch = (product: PdvProduct, search: string) => (
  sharedProductMatchesSearch(product, search, 'completa')
);

export const productMatchesExactCode = (product: PdvProduct, search: string) => (
  sharedProductMatchesExactCode(product, search)
);

export const cartLineGrossCents = (item: PdvCartItem) => (
  Math.max(0, Math.round(item.precoUnitarioCentavos * item.quantidade))
);

export const cartLineNetCents = (item: PdvCartItem) => (
  Math.max(0, cartLineGrossCents(item) - item.descontoCentavos)
);

export const calculatePdvTotals = (items: PdvCartItem[], saleDiscountCents: number): PdvTotals => {
  const subtotalCentavos = items.reduce((sum, item) => sum + cartLineGrossCents(item), 0);
  const itensDescontoCentavos = items.reduce((sum, item) => sum + item.descontoCentavos, 0);
  const maxSaleDiscount = Math.max(0, subtotalCentavos - itensDescontoCentavos);
  const vendaDescontoCentavos = Math.min(Math.max(0, saleDiscountCents), maxSaleDiscount);
  const totalCentavos = Math.max(0, subtotalCentavos - itensDescontoCentavos - vendaDescontoCentavos);

  return {
    subtotalCentavos,
    itensDescontoCentavos,
    vendaDescontoCentavos,
    descontoTotalCentavos: itensDescontoCentavos + vendaDescontoCentavos,
    totalCentavos,
    itemCount: items.length,
    volumeCount: items.reduce((sum, item) => sum + item.quantidade, 0),
  };
};

export const toCurrencyInput = (cents: number) => fromCents(cents).toFixed(2);

export const fromCurrencyInput = (value: string | number) => toCents(value);

export const clampDiscountCents = (discountCents: number, maxCents: number) => (
  Math.min(Math.max(0, discountCents), Math.max(0, maxCents))
);

export const makePdvSessionStorageKey = (tenantId: string | null | undefined, userId: string | null | undefined) => (
  `nexus_pdv_session_${tenantId || 'tenant'}_${userId || 'user'}`
);

/** Chave da linha do carrinho. O mesmo produto vendido em unidades
 * diferentes (quilo e saco) vira duas linhas, cada uma com seu preco --
 * fundir tudo por productId aplicaria um preco so aos dois. */
export const makeCartLineId = (productId: string, embalagemId?: string) => (
  embalagemId ? `${productId}::${embalagemId}` : productId
);

export const makeCartItemFromProduct = (
  product: PdvProduct,
  quantity = 1,
  opcao?: OpcaoUnidadeVenda,
  /** Preco ja' decidido pela tabela (a vista/promocao) e os campos de rastreio. Sem ele, vale o preco de venda. */
  precificacao?: { preco: number; campos: CamposDePrecoDoItem },
): PdvCartItem => ({
  id: makeCartLineId(product.id, opcao?.embalagemId),
  productId: product.id,
  nome: product.nome,
  codigo: product.codigo,
  codigoBarras: product.codigoBarras,
  categoria: product.categoria,
  imagemProduto: product.imagemProduto,
  estoqueDisponivel: Number(product.quantidade || 0),
  precoUnitarioCentavos: toCents(precificacao ? precificacao.preco : (opcao ? opcao.precoVenda : (product.precoVenda || 0))),
  ...(precificacao ? precificacao.campos : {}),
  quantidade: quantity,
  descontoCentavos: 0,
  unidadeMedidaSigla: opcao?.sigla || product.unidadeMedidaSigla || 'UN',
  unidadeMedidaCasasDecimais: opcao?.casasDecimais ?? product.unidadeMedidaCasasDecimais ?? 0,
  unidadeMedidaFracionado: opcao ? opcao.permiteFracionado : product.unidadeMedidaFracionado,
  // Linha na unidade base nao ganha campo de embalagem nenhum.
  ...(opcao?.embalagemId
    ? {
        embalagemId: opcao.embalagemId,
        fatorConversao: opcao.fatorConversao,
        quantidadeBase: toBaseQuantity(quantity, opcao.fatorConversao),
      }
    : {}),
});

const paraIso = (valor: unknown): string | null => {
  if (!valor) return null;
  if (typeof valor === 'string') return valor;
  const comToDate = valor as { toDate?: () => Date };
  if (typeof comToDate.toDate === 'function') return comToDate.toDate().toISOString();
  return valor instanceof Date ? valor.toISOString() : null;
};

/**
 * Caixa ja' aberto no banco (outro computador, ou deixado aberto) virando a
 * sessao da tela (22/11/2026: um caixa aberto por pessoa -- quem ja' tem um
 * continua nele em vez de abrir outro).
 */
export const sessaoDoDocumento = (id: string, dados: Record<string, unknown>): PdvSession => {
  const numero = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const numeroOuNulo = (v: unknown) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
  const sangrias = Array.isArray(dados.sangrias) ? dados.sangrias as Array<Record<string, unknown>> : [];
  return {
    id,
    tenantId: String(dados.tenantId || ''),
    operadorId: String(dados.operadorId || ''),
    operadorNome: String(dados.operadorNome || ''),
    status: dados.status === 'fechado' ? 'fechado' : 'aberto',
    saldoInicialCentavos: numero(dados.saldoInicialCentavos),
    saldoAnteriorSugeridoCentavos: numeroOuNulo(dados.saldoAnteriorSugeridoCentavos),
    saldoAnteriorConfirmado: dados.saldoAnteriorConfirmado === true,
    abertoEm: paraIso(dados.createdAt) || new Date().toISOString(),
    fechadoEm: paraIso(dados.fechadoEm),
    saldoFinalInformadoCentavos: numeroOuNulo(dados.saldoFinalInformadoCentavos),
    saldoEsperadoCentavos: numeroOuNulo(dados.saldoEsperadoCentavos),
    diferencaCentavos: numeroOuNulo(dados.diferencaCentavos),
    sangrias: sangrias.map((x, i) => ({
      id: String(x.id || `sangria-${i + 1}`),
      valorCentavos: numero(x.valorCentavos),
      motivo: String(x.motivo || ''),
      registradoEm: paraIso(x.registradoEm) || '',
      registradoPor: String(x.registradoPor || ''),
      registradoPorNome: String(x.registradoPorNome || ''),
      ...(x.bancoId ? { bancoId: String(x.bancoId), bancoNome: String(x.bancoNome || '') } : {}),
    })),
    totalSangriasCentavos: numero(dados.totalSangriasCentavos),
  };
};
