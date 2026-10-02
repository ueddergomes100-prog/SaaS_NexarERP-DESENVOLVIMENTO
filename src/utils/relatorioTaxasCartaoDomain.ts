import type { ColunaRelatorio, IndicadorRelatorio, SecaoRelatorio } from './relatorioPdfDomain';

/*
 * RELATORIOS DIVERSOS > TAXAS PAGAS AS ADMINISTRADORAS (cartao).
 *
 * Mesma conta da pagina antiga de impressao: transacoes com `cartao` cuja
 * `data` esta no periodo, somadas por bandeira (bruto, taxa, liquido), da
 * bandeira que mais pagou taxa para a que menos pagou. A taxa media e'
 * ponderada pelo valor bruto (taxa / bruto), por bandeira e no total.
 *
 * Regra pura: recebe as transacoes ja lidas e devolve o documento.
 */

export interface TransacaoCartao {
  id: string;
  data?: string;
  cartao?: {
    bandeira?: string;
    valorBrutoCentavos?: number;
    valorTaxaCentavos?: number;
    valorLiquidoCentavos?: number;
  } | null;
}

export interface TotaisBandeira {
  bandeira: string;
  transacoes: number;
  brutoCentavos: number;
  taxaCentavos: number;
  liquidoCentavos: number;
}

export const transacoesCartaoNoPeriodo = (transacoes: TransacaoCartao[], inicio: string, fim: string): TransacaoCartao[] => (
  transacoes.filter((t) => Boolean(t.cartao) && Boolean(t.data) && (t.data as string) >= inicio && (t.data as string) <= fim)
);

export const totaisPorBandeira = (transacoes: TransacaoCartao[]): TotaisBandeira[] => {
  const mapa = new Map<string, TotaisBandeira>();
  transacoes.forEach((t) => {
    const bandeira = t.cartao?.bandeira?.trim() || 'Sem bandeira';
    const atual = mapa.get(bandeira) ?? { bandeira, transacoes: 0, brutoCentavos: 0, taxaCentavos: 0, liquidoCentavos: 0 };
    atual.transacoes += 1;
    atual.brutoCentavos += Number(t.cartao?.valorBrutoCentavos || 0);
    atual.taxaCentavos += Number(t.cartao?.valorTaxaCentavos || 0);
    atual.liquidoCentavos += Number(t.cartao?.valorLiquidoCentavos || 0);
    mapa.set(bandeira, atual);
  });
  return [...mapa.values()].sort((a, b) => b.taxaCentavos - a.taxaCentavos);
};

/** "2,35%" (taxa / bruto); "-" quando nao houve valor bruto. */
export const formatarTaxaMedia = (taxaCentavos: number, brutoCentavos: number): string => (
  brutoCentavos > 0 ? `${((taxaCentavos / brutoCentavos) * 100).toFixed(2).replace('.', ',')}%` : '-'
);

export interface DocumentoRelatorioTaxasCartao {
  titulo: string;
  periodo: string;
  indicadores: IndicadorRelatorio[];
  secoes: SecaoRelatorio[];
}

const moeda = (centavos: number): string => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(centavos / 100);
const dataBr = (iso: string): string => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('/') : '');

export const montarDocumentoTaxasCartao = (
  transacoes: TransacaoCartao[],
  inicio: string,
  fim: string,
): DocumentoRelatorioTaxasCartao => {
  const porBandeira = totaisPorBandeira(transacoesCartaoNoPeriodo(transacoes, inicio, fim));
  const total = porBandeira.reduce((acc, item) => ({
    transacoes: acc.transacoes + item.transacoes,
    brutoCentavos: acc.brutoCentavos + item.brutoCentavos,
    taxaCentavos: acc.taxaCentavos + item.taxaCentavos,
    liquidoCentavos: acc.liquidoCentavos + item.liquidoCentavos,
  }), { transacoes: 0, brutoCentavos: 0, taxaCentavos: 0, liquidoCentavos: 0 });

  const colunas: ColunaRelatorio<TotaisBandeira>[] = [
    { id: 'bandeira', titulo: 'Bandeira', tipo: 'texto', largura: 40, valor: (b) => b.bandeira },
    { id: 'transacoes', titulo: 'Transações', tipo: 'inteiro', largura: 20, valor: (b) => b.transacoes },
    { id: 'bruto', titulo: 'Valor Bruto', tipo: 'moeda', valor: (b) => b.brutoCentavos },
    // Percentual e' texto ja formatado: a linha de total do PDF so' formata
    // numero como moeda/inteiro, entao a media ponderada geral vai nos
    // indicadores ("Taxa média geral").
    { id: 'taxaMedia', titulo: 'Taxa Média', tipo: 'texto', total: 'nenhum', largura: 20, valor: (b) => formatarTaxaMedia(b.taxaCentavos, b.brutoCentavos) },
    { id: 'taxa', titulo: 'Taxa Paga', tipo: 'moeda', valor: (b) => b.taxaCentavos },
    { id: 'liquido', titulo: 'Valor Líquido', tipo: 'moeda', valor: (b) => b.liquidoCentavos },
  ];

  return {
    titulo: 'Taxas Pagas às Administradoras',
    periodo: `Período: ${dataBr(inicio)} a ${dataBr(fim)}`,
    indicadores: [
      { rotulo: 'Total de pagamentos em cartão', valor: String(total.transacoes) },
      { rotulo: 'Valor bruto', valor: moeda(total.brutoCentavos) },
      { rotulo: 'Taxa média geral', valor: formatarTaxaMedia(total.taxaCentavos, total.brutoCentavos) },
      { rotulo: 'Taxa paga', valor: moeda(total.taxaCentavos) },
      { rotulo: 'Valor líquido', valor: moeda(total.liquidoCentavos) },
    ],
    secoes: [{
      id: 'bandeiras',
      titulo: 'Por bandeira',
      colunas,
      linhas: porBandeira,
      rotuloTotal: 'Total',
      unidade: ['bandeira', 'bandeiras'],
      mensagemVazia: 'Nenhum pagamento em cartão encontrado para o período selecionado.',
    } as SecaoRelatorio],
  };
};
