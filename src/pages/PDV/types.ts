import type { PaymentDraft } from '../../utils/financeDomain';

export interface PdvProduct {
  id: string;
  nome: string;
  codigo: string;
  codigoBarras: string;
  referencia: string;
  skuSistema: string;
  categoria: string;
  precoVenda: number;
  quantidade: number;
  imagemProduto: string;
  unidadeMedidaSigla?: string;
  unidadeMedidaCasasDecimais?: number;
  unidadeMedidaFracionado?: boolean;
  statusAtivo?: boolean;
  /** Array cru do documento de estoque -- normalizado por embalagemDomain. */
  embalagens?: unknown;
  descontoMaximoPercentual?: number;
}

export interface PdvClient {
  id: string;
  nome: string;
  codigo?: string;
  telefone?: string;
  documento?: string;
  email?: string;
  isPadrao?: boolean;
}

export interface PdvCartItem {
  /** `productId` quando vendido na unidade base, `productId::embalagemId`
   * quando vendido em embalagem -- o mesmo produto em KG e em SC precisa
   * ocupar DUAS linhas do carrinho, com precos diferentes. */
  id: string;
  productId: string;
  nome: string;
  codigo: string;
  codigoBarras: string;
  categoria: string;
  imagemProduto: string;
  /** Sempre na unidade BASE do produto (o saldo real do estoque). */
  estoqueDisponivel: number;
  precoUnitarioCentavos: number;
  quantidade: number;
  descontoCentavos: number;
  unidadeMedidaSigla?: string;
  unidadeMedidaCasasDecimais?: number;
  unidadeMedidaFracionado?: boolean;
  /** Vazio/ausente = unidade base. */
  embalagemId?: string;
  /** Quantas unidades base cada unidade vendida consome. */
  fatorConversao?: number;
  quantidadeBase?: number;
}

export interface PdvTotals {
  subtotalCentavos: number;
  itensDescontoCentavos: number;
  vendaDescontoCentavos: number;
  descontoTotalCentavos: number;
  totalCentavos: number;
  itemCount: number;
  volumeCount: number;
}

export type SaleDiscountMode = 'valor' | 'percentual';

export interface CaixaSangria {
  id: string;
  valorCentavos: number;
  motivo: string;
  registradoEm: string;
  registradoPor: string;
  registradoPorNome: string;
}

export interface PdvSession {
  id: string;
  tenantId: string;
  operadorId: string;
  operadorNome: string;
  status: 'aberto' | 'fechado';
  saldoInicialCentavos: number;
  saldoAnteriorSugeridoCentavos: number | null;
  saldoAnteriorConfirmado: boolean;
  abertoEm: string;
  fechadoEm: string | null;
  saldoFinalInformadoCentavos: number | null;
  saldoEsperadoCentavos: number | null;
  diferencaCentavos: number | null;
  sangrias: CaixaSangria[];
  totalSangriasCentavos: number;
}

export type PdvPaymentDraft = PaymentDraft;
