import {
  fromCents,
  normalizeCreditCardFeeSchedule,
  parseCreditTerms,
  toCents,
  type CreditCardFeeSchedule,
} from '../../utils/financeDomain';
import type { PdvCartItem, PdvProduct, PdvTotals } from './types';

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
}

export const defaultPdvFinanceConfig = (): PdvFinanceConfig => ({
  defaultTermDays: 30,
  maxCreditInstallments: 12,
  creditFeePercentByInstallment: normalizeCreditCardFeeSchedule(null),
  debitFeePercent: 0,
  creditSettlementDays: 30,
  debitSettlementDays: 1,
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
  };
};

export const productSearchText = (product: PdvProduct) => [
  product.nome,
  product.codigo,
  product.codigoBarras,
  product.referencia,
  product.skuSistema,
  product.categoria,
].filter(Boolean).join(' ').toLowerCase();

export const productMatchesSearch = (product: PdvProduct, search: string) => {
  const term = search.trim().toLowerCase();
  if (!term) return false;
  return productSearchText(product).includes(term);
};

export const productMatchesExactCode = (product: PdvProduct, search: string) => {
  const term = search.trim().toLowerCase();
  if (!term) return false;
  return [
    product.codigo,
    product.codigoBarras,
    product.referencia,
    product.skuSistema,
  ].some((value) => String(value || '').trim().toLowerCase() === term);
};

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

export const makeCartItemFromProduct = (product: PdvProduct, quantity = 1): PdvCartItem => ({
  id: product.id,
  productId: product.id,
  nome: product.nome,
  codigo: product.codigo,
  codigoBarras: product.codigoBarras,
  categoria: product.categoria,
  imagemProduto: product.imagemProduto,
  estoqueDisponivel: Number(product.quantidade || 0),
  precoUnitarioCentavos: toCents(product.precoVenda || 0),
  quantidade: quantity,
  descontoCentavos: 0,
  unidadeMedidaSigla: product.unidadeMedidaSigla || 'UN',
  unidadeMedidaCasasDecimais: product.unidadeMedidaCasasDecimais ?? 0,
  unidadeMedidaFracionado: product.unidadeMedidaFracionado,
});
