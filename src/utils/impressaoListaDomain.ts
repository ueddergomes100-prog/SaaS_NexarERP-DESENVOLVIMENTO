/**
 * COLUNA "IMP." DAS LISTAS (pedido do cliente de 15/10/2026).
 *
 * A coluna que ja' existia nas pre-vendas (impresso ou nao, com "nao impressas
 * primeiro") passou a valer em todas as abas de Pedidos de Venda e na lista
 * de Trocas, com um filtro de verdade: Todos / Impressos / Nao impressos.
 *
 * O que conta como impresso (decisao do dono, 15/10): o recibo/pre-venda OU
 * a minuta -- qualquer um dos dois papeis ja' saiu. Na troca so' existe a
 * minuta.
 */

export type FiltroImpressao = '' | 'impressos' | 'nao_impressos';

export const OPCOES_FILTRO_IMPRESSAO: Exclude<FiltroImpressao, ''>[] = ['impressos', 'nao_impressos'];

export const ROTULO_FILTRO_IMPRESSAO: Record<Exclude<FiltroImpressao, ''>, string> = {
  impressos: 'Impressos',
  nao_impressos: 'Não impressos',
};

export const rotuloDoFiltroDeImpressao = (valor: string): string => (
  ROTULO_FILTRO_IMPRESSAO[valor as Exclude<FiltroImpressao, ''>] || valor
);

/** Recibo/pre-venda (`impresso`) ou minuta (`minutaImpressa`) ja' saiu no papel. */
export const foiImpresso = (documento: { impresso?: unknown; minutaImpressa?: unknown }): boolean => (
  documento.impresso === true || documento.minutaImpressa === true
);

export const passaNoFiltroDeImpressao = (impresso: boolean, filtro: FiltroImpressao): boolean => {
  if (filtro === 'impressos') return impresso;
  if (filtro === 'nao_impressos') return !impresso;
  return true;
};
