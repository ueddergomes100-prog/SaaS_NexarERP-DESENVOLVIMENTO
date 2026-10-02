/*
 * FATURAMENTO & DRE DO ANO -- UMA CONTA SO' PARA A TELA E PARA O PAPEL.
 *
 * A tela Financeiro > Faturamento calcula, sobre os lancamentos PAGOS do ano,
 * o DRE simplificado, as receitas por forma de pagamento, as medias mensais e
 * o balancete mes a mes. Padronizacao dos relatorios (dono, 2026-10-02): a
 * conta mudou para ca' sem alteracao de regra e a tela usa esta mesma funcao
 * -- o numero impresso nunca diverge do numero da tela.
 *
 * Valores em CENTAVOS. Cada lancamento e' arredondado ao centavo antes de
 * somar, exatamente como a tela fazia ao somar os valores em reais.
 *
 * Arquivo puro: sem firebase e sem React.
 */
import {
  isRevenueReversal,
  toCents,
  transactionFeeAmount,
  transactionGrossAmount,
  transactionNetAmount,
} from './financeDomain';
import type { ColunaRelatorio, IndicadorRelatorio, SecaoRelatorio } from './relatorioPdfDomain';

type ValorDoLancamento = Parameters<typeof transactionGrossAmount>[0];

export interface TransacaoFaturamento extends ValorDoLancamento {
  id: string;
  /** AAAA-MM-DD */
  data?: string;
  descricao?: string;
  categoria?: string;
  tipo?: string;
  status?: string;
  formaPagamento?: string;
  sourceType?: string;
  createdAt?: { seconds?: number } | null;
}

export const MESES_FATURAMENTO = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const brutoCentavos = (t: TransacaoFaturamento): number => toCents(transactionGrossAmount(t));
const taxaCentavos = (t: TransacaoFaturamento): number => toCents(transactionFeeAmount(t));
const liquidoCentavos = (t: TransacaoFaturamento): number => toCents(transactionNetAmount(t));
const somar = (lista: TransacaoFaturamento[], valor: (t: TransacaoFaturamento) => number): number => (
  lista.reduce((acc, t) => acc + valor(t), 0)
);

/** Ano do lancamento: campo `data` (AAAA-MM-DD) ou, sem ele, a criacao. */
const anoDoLancamento = (t: TransacaoFaturamento): string => {
  if (t.data) return t.data.substring(0, 4);
  if (t.createdAt?.seconds) return String(new Date(t.createdAt.seconds * 1000).getFullYear());
  return '';
};

/** Mes do lancamento, "01".."12", pela mesma regra do ano. */
const mesDoLancamento = (t: TransacaoFaturamento): string => {
  if (t.data) return t.data.substring(5, 7);
  if (t.createdAt?.seconds) return String(new Date(t.createdAt.seconds * 1000).getMonth() + 1).padStart(2, '0');
  return '';
};

const ehServico = (t: TransacaoFaturamento) => t.categoria === 'Serviços' || t.categoria === 'Serviços Automotivos';
const ehPecas = (t: TransacaoFaturamento) => t.categoria === 'Venda de Peças';

/** Receita de verdade: entrada que nao e' credito de devolucao. */
const ehReceita = (t: TransacaoFaturamento) => t.tipo === 'entrada' && t.formaPagamento !== 'Crédito de Devolução';

/** Despesa de verdade: saida que nao e' estorno de receita. */
const ehDespesa = (t: TransacaoFaturamento) => t.tipo === 'saida' && !isRevenueReversal(t);

export interface MesBalancete {
  /** 0 = janeiro. */
  indice: number;
  nomeMes: string;
  receitaBrutaCentavos: number;
  taxasCentavos: number;
  receitaLiquidaCentavos: number;
  despesasCentavos: number;
  resultadoCentavos: number;
}

export interface FormaPagamentoFaturamento {
  forma: string;
  valorCentavos: number;
}

export interface ResumoFaturamentoAnual {
  ano: number;
  receitaPecasCentavos: number;
  receitaServicosCentavos: number;
  receitaOutrosCentavos: number;
  receitaBrutaCentavos: number;
  taxasCartaoCentavos: number;
  estornosCentavos: number;
  receitaLiquidaCentavos: number;
  despesasCentavos: number;
  lucroLiquidoCentavos: number;
  /** Lucro / receita bruta, em %. 0 sem receita. */
  margemLucro: number;
  formasPagamento: FormaPagamentoFaturamento[];
  /** Os 12 meses. */
  meses: MesBalancete[];
  /** Meses que a tela mostra: no ano corrente, so' ate' o mes atual. */
  mesesExibidos: MesBalancete[];
  /** Divisor das medias: meses transcorridos no ano corrente, 12 nos anteriores. */
  mesesTranscorridos: number;
  mediaMensalReceitaCentavos: number;
  mediaMensalDespesasCentavos: number;
}

/**
 * Conta do ano. `hoje` decide o "ano corrente" (medias e meses exibidos) --
 * hora local do computador, como a tela sempre usou.
 */
export const calcularFaturamentoAnual = (
  transacoes: TransacaoFaturamento[],
  ano: number,
  hoje: Date = new Date(),
): ResumoFaturamentoAnual => {
  // Somente lancamentos pagos do ano escolhido.
  const transacoesAno = transacoes.filter((t) => t.status === 'Paga' && anoDoLancamento(t) === String(ano));

  // --- DRE SIMPLIFICADO ---
  const receitasFiltradas = transacoesAno.filter(ehReceita);
  const receitaServicosCentavos = somar(receitasFiltradas.filter(ehServico), brutoCentavos);
  const receitaPecasCentavos = somar(receitasFiltradas.filter(ehPecas), brutoCentavos);
  const receitaOutrosCentavos = somar(receitasFiltradas.filter((t) => !ehServico(t) && !ehPecas(t)), brutoCentavos);

  // Estorno (OS/venda cancelada, devolucao) ANULA receita -- nao e' despesa.
  // Vira uma LINHA PROPRIA do DRE, e nao um desconto mudo no total: assim a
  // quebra por categoria (Pecas/Servicos/Outros) continua somando
  // exatamente a receita bruta.
  const estornosCentavos = somar(transacoesAno.filter(isRevenueReversal), liquidoCentavos);

  const receitaBrutaCentavos = receitaServicosCentavos + receitaPecasCentavos + receitaOutrosCentavos;
  const taxasCartaoCentavos = somar(receitasFiltradas, taxaCentavos);
  const receitaLiquidaCentavos = receitaBrutaCentavos - taxasCartaoCentavos - estornosCentavos;
  const despesasCentavos = somar(transacoesAno.filter(ehDespesa), liquidoCentavos);
  const lucroLiquidoCentavos = receitaLiquidaCentavos - despesasCentavos;
  const margemLucro = receitaBrutaCentavos > 0 ? (lucroLiquidoCentavos / receitaBrutaCentavos) * 100 : 0;

  // --- FORMAS DE PAGAMENTO (receita liquida) ---
  const porForma = new Map<string, number>();
  receitasFiltradas.forEach((t) => {
    const forma = t.formaPagamento || 'Não informada';
    porForma.set(forma, (porForma.get(forma) || 0) + liquidoCentavos(t));
  });
  const formasPagamento = [...porForma.entries()]
    .map(([forma, valorCentavos]) => ({ forma, valorCentavos }))
    .sort((a, b) => b.valorCentavos - a.valorCentavos);

  // --- BALANCETE MENSAL ---
  const meses: MesBalancete[] = MESES_FATURAMENTO.map((nomeMes, indice) => {
    const mesStr = String(indice + 1).padStart(2, '0');
    const transacoesMes = transacoesAno.filter((t) => mesDoLancamento(t) === mesStr);
    const receitasMes = transacoesMes.filter(ehReceita);
    // Mesmo criterio do DRE: estorno abate receita, nao vira despesa.
    const estornosMes = transacoesMes.filter(isRevenueReversal);

    const receitaBrutaMes = somar(receitasMes, brutoCentavos) - somar(estornosMes, brutoCentavos);
    const taxasMes = somar(receitasMes, taxaCentavos) - somar(estornosMes, taxaCentavos);
    const receitaLiquidaMes = somar(receitasMes, liquidoCentavos) - somar(estornosMes, liquidoCentavos);
    const despesasMes = somar(transacoesMes.filter(ehDespesa), liquidoCentavos);
    return {
      indice,
      nomeMes,
      receitaBrutaCentavos: receitaBrutaMes,
      taxasCentavos: taxasMes,
      receitaLiquidaCentavos: receitaLiquidaMes,
      despesasCentavos: despesasMes,
      resultadoCentavos: receitaLiquidaMes - despesasMes,
    };
  });

  // So' exibe meses que ja' passaram ou o atual, a menos que seja um ano
  // anterior completo.
  const anoCorrente = hoje.getFullYear() === ano;
  const mesesExibidos = anoCorrente ? meses.filter((m) => m.indice <= hoje.getMonth()) : meses;
  const mesesTranscorridos = anoCorrente ? hoje.getMonth() + 1 : 12;

  return {
    ano,
    receitaPecasCentavos,
    receitaServicosCentavos,
    receitaOutrosCentavos,
    receitaBrutaCentavos,
    taxasCartaoCentavos,
    estornosCentavos,
    receitaLiquidaCentavos,
    despesasCentavos,
    lucroLiquidoCentavos,
    margemLucro,
    formasPagamento,
    meses,
    mesesExibidos,
    mesesTranscorridos,
    mediaMensalReceitaCentavos: Math.round(receitaLiquidaCentavos / mesesTranscorridos),
    mediaMensalDespesasCentavos: Math.round(despesasCentavos / mesesTranscorridos),
  };
};

export interface LinhaDre {
  linha: string;
  /** null = linha sem valor em reais (ex: margem, que vai no proprio texto). */
  valorCentavos: number | null;
}

const percentualBr = (valor: number): string => `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(valor)}%`;

/** Linhas do DRE na ordem da tela. Valores dos "(-)" vao positivos, como na tela. */
export const linhasDre = (resumo: ResumoFaturamentoAnual): LinhaDre[] => [
  { linha: '1. Receita bruta total', valorCentavos: resumo.receitaBrutaCentavos },
  { linha: '   • Venda de peças (pedidos de venda)', valorCentavos: resumo.receitaPecasCentavos },
  { linha: '   • Serviços (mão de obra / OS)', valorCentavos: resumo.receitaServicosCentavos },
  { linha: '   • Outras receitas', valorCentavos: resumo.receitaOutrosCentavos },
  { linha: '2. (-) Taxas de cartão', valorCentavos: resumo.taxasCartaoCentavos },
  { linha: '3. (-) Cancelamentos e devoluções', valorCentavos: resumo.estornosCentavos },
  { linha: '4. (=) Receita líquida financeira', valorCentavos: resumo.receitaLiquidaCentavos },
  { linha: '5. (-) Despesas / custos totais', valorCentavos: resumo.despesasCentavos },
  { linha: '(=) Lucro líquido do exercício', valorCentavos: resumo.lucroLiquidoCentavos },
  { linha: `Margem de lucro: ${percentualBr(resumo.margemLucro)}`, valorCentavos: null },
];

export interface DocumentoFaturamentoAnual {
  titulo: string;
  periodo: string;
  filtros: string[];
  indicadores: IndicadorRelatorio[];
  secoes: SecaoRelatorio[];
}

const moeda = (valorCentavos: number): string => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valorCentavos / 100);

/** Documento (sem empresa/geradoPor, que o RelatorioPreview acrescenta). */
export const montarDocumentoFaturamentoAnual = (
  transacoes: TransacaoFaturamento[],
  ano: number,
  hoje: Date = new Date(),
): DocumentoFaturamentoAnual => {
  const resumo = calcularFaturamentoAnual(transacoes, ano, hoje);
  const parcial = resumo.mesesTranscorridos < 12;

  const colunasDre: ColunaRelatorio<LinhaDre>[] = [
    { id: 'linha', titulo: 'Demonstrativo', tipo: 'texto', largura: 110, valor: (l) => l.linha },
    // Linhas do DRE nao se somam (subtotal em cima de subtotal).
    { id: 'valor', titulo: 'Valor', tipo: 'moeda', total: 'nenhum', valor: (l) => l.valorCentavos },
  ];

  const colunasFormas: ColunaRelatorio<FormaPagamentoFaturamento>[] = [
    { id: 'forma', titulo: 'Forma de pagamento', tipo: 'texto', largura: 80, valor: (f) => f.forma },
    { id: 'valor', titulo: 'Receita líquida', tipo: 'moeda', valor: (f) => f.valorCentavos },
  ];

  const colunasBalancete: ColunaRelatorio<MesBalancete>[] = [
    { id: 'mes', titulo: 'Mês', tipo: 'texto', largura: 28, valor: (m) => m.nomeMes },
    { id: 'bruta', titulo: 'Receita bruta', tipo: 'moeda', valor: (m) => m.receitaBrutaCentavos },
    { id: 'taxas', titulo: 'Taxas cartão', tipo: 'moeda', valor: (m) => m.taxasCentavos },
    { id: 'liquida', titulo: 'Receita líquida', tipo: 'moeda', valor: (m) => m.receitaLiquidaCentavos },
    { id: 'despesas', titulo: 'Despesas', tipo: 'moeda', valor: (m) => m.despesasCentavos },
    { id: 'resultado', titulo: 'Resultado (saldo)', tipo: 'moeda', valor: (m) => m.resultadoCentavos },
  ];

  return {
    titulo: 'Faturamento e DRE',
    periodo: parcial
      ? `Ano de ${ano} (até ${MESES_FATURAMENTO[resumo.mesesTranscorridos - 1].toLocaleLowerCase('pt-BR')})`
      : `Ano de ${ano}`,
    filtros: ['Somente lançamentos pagos'],
    indicadores: [
      { rotulo: 'Receita bruta', valor: moeda(resumo.receitaBrutaCentavos) },
      { rotulo: 'Receita líquida', valor: moeda(resumo.receitaLiquidaCentavos) },
      { rotulo: 'Despesas', valor: moeda(resumo.despesasCentavos) },
      { rotulo: 'Lucro líquido', valor: moeda(resumo.lucroLiquidoCentavos) },
      { rotulo: 'Margem de lucro', valor: percentualBr(resumo.margemLucro) },
      { rotulo: 'Média mensal de receita', valor: moeda(resumo.mediaMensalReceitaCentavos) },
      { rotulo: 'Média mensal de despesas', valor: moeda(resumo.mediaMensalDespesasCentavos) },
    ],
    secoes: [
      {
        id: 'dre', titulo: `DRE do ano (${ano})`, colunas: colunasDre, linhas: linhasDre(resumo),
        rotuloTotal: 'DRE', unidade: ['linha', 'linhas'],
      } as SecaoRelatorio,
      {
        id: 'formas', titulo: 'Receitas líquidas por forma de pagamento', colunas: colunasFormas, linhas: resumo.formasPagamento,
        opcional: true, padrao: true, unidade: ['forma', 'formas'], mensagemVazia: 'Nenhuma receita paga neste ano.',
      } as SecaoRelatorio,
      {
        id: 'balancete', titulo: 'Balancete mensal', colunas: colunasBalancete, linhas: resumo.mesesExibidos,
        rotuloTotal: `Total de ${ano}`, unidade: ['mês', 'meses'],
      } as SecaoRelatorio,
    ],
  };
};
