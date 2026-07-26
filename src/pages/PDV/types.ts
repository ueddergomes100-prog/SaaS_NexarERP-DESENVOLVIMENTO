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
}

export interface PdvClient {
  id: string;
  nome: string;
  telefone?: string;
  documento?: string;
  email?: string;
  isPadrao?: boolean;
}

export interface PdvCartItem {
  id: string;
  productId: string;
  nome: string;
  codigo: string;
  codigoBarras: string;
  categoria: string;
  imagemProduto: string;
  estoqueDisponivel: number;
  precoUnitarioCentavos: number;
  quantidade: number;
  descontoCentavos: number;
  unidadeMedidaSigla?: string;
  unidadeMedidaCasasDecimais?: number;
  unidadeMedidaFracionado?: boolean;
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

export interface PdvSession {
  id: string;
  openedAt: string;
  openingAmount: number;
  operatorId: string;
  operatorName: string;
}

export type PdvPaymentDraft = PaymentDraft;
