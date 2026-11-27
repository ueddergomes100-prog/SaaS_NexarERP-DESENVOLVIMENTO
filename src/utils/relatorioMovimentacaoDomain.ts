import { isRevenueReversal } from './financeDomain';
import { calcularRelatorioFinanceiro, type TransacaoRelatorioFinanceiro } from './relatorioFinanceiroDomain';
import { calcularRecebimentos, type LinhaDeRecebimento, type TotalAgrupado } from './relatorioRecebimentosDomain';
import { rotuloCondicaoPagamento, totaisVendas, totalPorFormaPagamento, type VendaRelatorio } from './relatorioVendasDomain';
import { secaoDetalheVendas, secaoPorFormaPagamento } from './relatorioVendasPdf';
import type { ColunaRelatorio, IndicadorRelatorio, SecaoRelatorio } from './relatorioPdfDomain';

/*
 * MOVIMENTACAO DO PERIODO (28/11/2026, pedido do dono): "tem que ter um
 * relatorio que ja' sai tudo junto, que seria meio que uma movimentacao de
 * caixa ... igual um ERP". O cliente tirava o relatorio de Vendas e o de
 * Recebimentos separados e juntava na mao.
 *
 * Empresa toda (decisao do dono), num papel so':
 *  - o que foi VENDIDO no periodo (a vista e a prazo) -- mesma conta do
 *    Relatorio de Vendas (relatorioVendasDomain);
 *  - o que ENTROU de dinheiro: vendas recebidas na hora, notinhas (contas a
 *    receber) baixadas no financeiro ou na Frente de Caixa, OS e lancamentos,
 *    por forma e por caixa/banco -- mesma conta do relatorio de Recebimentos
 *    (calcularRecebimentos, com estorno fora do total);
 *  - o que SAIU: contas pagas (sem o estorno de venda cancelada, que ja' sai
 *    da entrada como ESTORNADO) e as sangrias dos caixas da Frente de Caixa.
 *
 * Regra pura: recebe o que ja' foi lido e devolve o documento.
 */

export interface SangriaDaMovimentacao {
  /** yyyy-mm-dd (dia em que a sangria foi feita). */
  dia: string;
  hora: string;
  operadorNome: string;
  motivo: string;
  bancoNome: string;
  valorCentavos: number;
}

export interface FiltroDaMovimentacao {
  inicio: string;
  fim: string;
}

export interface FontesDaMovimentacao {
  /** Vendas ja' enriquecidas e cortadas no periodo (relatorioVendasDomain). */
  vendas: VendaRelatorio[];
  entradasPagas: TransacaoRelatorioFinanceiro[];
  saidasPagas: TransacaoRelatorioFinanceiro[];
  sangrias: SangriaDaMovimentacao[];
}

export type OrigemDaMovimentacao =
  | 'Venda à vista'
  | 'Notinha recebida na Frente de Caixa'
  | 'Conta recebida no Financeiro'
  | 'OS à vista'
  | 'Lançamento';

export interface LinhaDePagamento {
  id: string;
  data: string;
  descricao: string;
  categoria: string;
  favorecido: string;
  formaPagamento: string;
  valorCentavos: number;
}

export interface ResultadoDaMovimentacao {
  vendasValidas: number;
  vendidoCentavos: number;
  vendidoAVistaCentavos: number;
  vendidoAPrazoCentavos: number;
  porCondicao: TotalAgrupado[];
  entradas: LinhaDeRecebimento[];
  porOrigem: TotalAgrupado[];
  porForma: TotalAgrupado[];
  porDestino: TotalAgrupado[];
  entrouCentavos: number;
  caixaCentavos: number;
  bancosCentavos: number;
  semDinheiroCentavos: number;
  notinhasCentavos: number;
  estornadoCentavos: number;
  pagamentos: LinhaDePagamento[];
  pagamentosPorForma: TotalAgrupado[];
  pagoCentavos: number;
  sangrias: SangriaDaMovimentacao[];
  sangriasCentavos: number;
  /** Entrou (recebido) - saiu (pago). Sangria nao entra: e' dinheiro que muda de lugar. */
  saldoCentavos: number;
}

const texto = (v: unknown): string => String(v ?? '').trim();

const agruparPor = <T>(lista: T[], chave: (item: T) => string, valor: (item: T) => number): TotalAgrupado[] => {
  const mapa = new Map<string, TotalAgrupado>();
  lista.forEach((item) => {
    const rotulo = chave(item) || 'Sem informação';
    const atual = mapa.get(rotulo) || { rotulo, quantidade: 0, valorCentavos: 0 };
    mapa.set(rotulo, { rotulo, quantidade: atual.quantidade + 1, valorCentavos: atual.valorCentavos + valor(item) });
  });
  return [...mapa.values()].sort((a, b) => b.valorCentavos - a.valorCentavos || a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
};

/** Separa a notinha recebida na Frente de Caixa da recebida no Financeiro. */
export const origemDaMovimentacao = (linha: LinhaDeRecebimento, t: TransacaoRelatorioFinanceiro | undefined): OrigemDaMovimentacao => {
  if (linha.origem !== 'Conta recebida') return linha.origem;
  return t && texto(t.recebidoNoCaixaId) ? 'Notinha recebida na Frente de Caixa' : 'Conta recebida no Financeiro';
};

export const calcularMovimentacao = (fontes: FontesDaMovimentacao, filtro: FiltroDaMovimentacao): ResultadoDaMovimentacao => {
  // Vendido
  const vendasValidas = fontes.vendas.filter((v) => !v.cancelled);
  const totais = totaisVendas(fontes.vendas);
  const porCondicao = agruparPor(vendasValidas, (v) => rotuloCondicaoPagamento(String(v.paymentCondition || '')), (v) => Number(v.netCents || 0));
  const daCondicao = (rotulo: string) => porCondicao.find((g) => g.rotulo === rotulo)?.valorCentavos || 0;

  // Entrou
  const recebido = calcularRecebimentos(fontes.entradasPagas, { inicio: filtro.inicio, fim: filtro.fim, somenteContas: false }, fontes.saidasPagas);
  const porId = new Map(fontes.entradasPagas.map((t) => [t.id, t]));
  const origemDe = new Map(recebido.linhas.map((l) => [l.id, origemDaMovimentacao(l, porId.get(l.id))]));
  const entradasValidas = recebido.linhas.filter((l) => !l.estornado);
  const porOrigem = agruparPor(entradasValidas, (l) => origemDe.get(l.id) || l.origem, (l) => l.valorCentavos);
  const notinhasCentavos = entradasValidas
    .filter((l) => origemDe.get(l.id) === 'Notinha recebida na Frente de Caixa' || origemDe.get(l.id) === 'Conta recebida no Financeiro')
    .reduce((soma, l) => soma + l.valorCentavos, 0);

  // Saiu: contas pagas. O estorno de venda/OS cancelada nao e' conta paga: ja'
  // aparece na entrada como ESTORNADO.
  const saidasSemEstorno = fontes.saidasPagas.filter((t) => !isRevenueReversal(t as Parameters<typeof isRevenueReversal>[0]));
  const pagas = calcularRelatorioFinanceiro(saidasSemEstorno, { tipo: 'saida', status: 'Paga', inicio: filtro.inicio, fim: filtro.fim });
  const saidaPorId = new Map(saidasSemEstorno.map((t) => [t.id, t]));
  const pagamentos: LinhaDePagamento[] = pagas.linhas.map((l) => {
    const t = saidaPorId.get(l.id);
    return {
      id: l.id,
      data: l.data,
      descricao: l.descricao,
      categoria: l.categoria,
      favorecido: texto(t?.fornecedorNome) || l.clienteNome,
      formaPagamento: l.formaPagamento || 'Sem forma',
      valorCentavos: l.valorCentavos,
    };
  });
  const pagoCentavos = pagamentos.reduce((soma, p) => soma + p.valorCentavos, 0);

  // Sangrias do periodo
  const sangrias = fontes.sangrias
    .filter((s) => s.dia >= filtro.inicio && s.dia <= filtro.fim && s.valorCentavos > 0)
    .sort((a, b) => `${a.dia} ${a.hora}`.localeCompare(`${b.dia} ${b.hora}`));

  return {
    vendasValidas: totais.count,
    vendidoCentavos: totais.netCents,
    vendidoAVistaCentavos: daCondicao('À vista'),
    vendidoAPrazoCentavos: daCondicao('A prazo'),
    porCondicao,
    entradas: recebido.linhas,
    porOrigem,
    porForma: recebido.porForma,
    porDestino: recebido.porDestino,
    entrouCentavos: recebido.entrouCentavos,
    caixaCentavos: recebido.caixaCentavos,
    bancosCentavos: recebido.bancosCentavos,
    semDinheiroCentavos: recebido.semDinheiroCentavos,
    notinhasCentavos,
    estornadoCentavos: recebido.estornadoCentavos,
    pagamentos,
    pagamentosPorForma: agruparPor(pagamentos, (p) => p.formaPagamento, (p) => p.valorCentavos),
    pagoCentavos,
    sangrias,
    sangriasCentavos: sangrias.reduce((soma, s) => soma + s.valorCentavos, 0),
    saldoCentavos: recebido.entrouCentavos - pagoCentavos,
  };
};

const moeda = (centavos: number): string => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(centavos / 100);
const dataBr = (iso: string): string => iso.split('-').reverse().join('/');

const colunasDoGrupo = (titulo: string, contagem = 'Lançamentos'): ColunaRelatorio<TotalAgrupado>[] => [
  { id: 'rotulo', titulo, tipo: 'texto', largura: 70, valor: (g) => g.rotulo },
  { id: 'quantidade', titulo: contagem, tipo: 'inteiro', valor: (g) => g.quantidade },
  { id: 'valor', titulo: 'Valor', tipo: 'moeda', valor: (g) => g.valorCentavos },
];

const secaoDeGrupo = (id: string, titulo: string, rotulo: string, linhas: TotalAgrupado[], mensagemVazia: string, contagem?: string): SecaoRelatorio => ({
  id,
  titulo,
  colunas: colunasDoGrupo(rotulo, contagem),
  linhas,
  opcional: true,
  padrao: true,
  rotuloTotal: 'Total',
  mensagemVazia,
} as SecaoRelatorio);

export interface DocumentoDaMovimentacao {
  titulo: string;
  periodo: string;
  filtros: string[];
  indicadores: IndicadorRelatorio[];
  secoes: SecaoRelatorio[];
}

export const montarDocumentoDaMovimentacao = (fontes: FontesDaMovimentacao, filtro: FiltroDaMovimentacao): DocumentoDaMovimentacao => {
  const r = calcularMovimentacao(fontes, filtro);
  const umDia = filtro.inicio === filtro.fim;
  const entradaPorId = new Map(fontes.entradasPagas.map((t) => [t.id, t]));
  const origemDe = new Map(r.entradas.map((l) => [l.id, origemDaMovimentacao(l, entradaPorId.get(l.id))]));

  const indicadores: IndicadorRelatorio[] = [
    { rotulo: `${umDia ? 'Vendido no dia' : 'Vendido no período'} (${r.vendasValidas} ${r.vendasValidas === 1 ? 'venda' : 'vendas'})`, valor: moeda(r.vendidoCentavos) },
    { rotulo: 'Vendas à vista', valor: moeda(r.vendidoAVistaCentavos) },
    { rotulo: 'Vendas a prazo', valor: moeda(r.vendidoAPrazoCentavos) },
    { rotulo: 'Entrou (recebido)', valor: moeda(r.entrouCentavos) },
    { rotulo: 'Notinhas recebidas', valor: moeda(r.notinhasCentavos) },
    { rotulo: 'Em dinheiro (caixa)', valor: moeda(r.caixaCentavos) },
    { rotulo: 'Em banco', valor: moeda(r.bancosCentavos) },
    { rotulo: 'Saiu (contas pagas)', valor: moeda(r.pagoCentavos) },
    { rotulo: 'Sangrias', valor: moeda(r.sangriasCentavos) },
    { rotulo: 'Saldo (entrou menos saiu)', valor: moeda(r.saldoCentavos) },
  ];
  if (r.semDinheiroCentavos > 0) indicadores.push({ rotulo: 'Baixado sem entrar dinheiro (acerto/crédito)', valor: moeda(r.semDinheiroCentavos) });
  if (r.estornadoCentavos > 0) indicadores.push({ rotulo: 'Estornado (fora do total)', valor: moeda(r.estornadoCentavos) });

  const colunasEntradas: ColunaRelatorio<LinhaDeRecebimento>[] = [
    { id: 'data', titulo: 'Data', tipo: 'texto', largura: 20, padrao: !umDia, valor: (l) => dataBr(l.data) },
    { id: 'cliente', titulo: 'Cliente', tipo: 'texto', largura: 46, valor: (l) => l.clienteNome },
    { id: 'descricao', titulo: 'Descrição', tipo: 'texto', largura: 56, valor: (l) => l.descricao },
    { id: 'origem', titulo: 'Origem', tipo: 'texto', largura: 40, valor: (l) => origemDe.get(l.id) || l.origem },
    { id: 'forma', titulo: 'Forma', tipo: 'texto', largura: 30, valor: (l) => l.formaPagamento },
    { id: 'destino', titulo: 'Onde caiu', tipo: 'texto', largura: 36, padrao: false, valor: (l) => l.destino },
    { id: 'situacao', titulo: 'Situação', tipo: 'texto', largura: 20, padrao: r.estornadoCentavos > 0, valor: (l) => (l.estornado ? 'ESTORNADO' : '') },
    {
      id: 'valor', titulo: 'Valor', tipo: 'moeda', valor: (l) => l.valorCentavos,
      totalCalculado: (linhas) => linhas.reduce((soma, l) => soma + (l.estornado ? 0 : l.valorCentavos), 0),
    },
  ];
  const colunasPagamentos: ColunaRelatorio<LinhaDePagamento>[] = [
    { id: 'data', titulo: 'Data', tipo: 'texto', largura: 20, padrao: !umDia, valor: (p) => dataBr(p.data) },
    { id: 'favorecido', titulo: 'Fornecedor / favorecido', tipo: 'texto', largura: 46, valor: (p) => p.favorecido },
    { id: 'descricao', titulo: 'Descrição', tipo: 'texto', largura: 56, valor: (p) => p.descricao },
    { id: 'categoria', titulo: 'Categoria', tipo: 'texto', largura: 34, padrao: false, valor: (p) => p.categoria },
    { id: 'forma', titulo: 'Forma', tipo: 'texto', largura: 30, valor: (p) => p.formaPagamento },
    { id: 'valor', titulo: 'Valor', tipo: 'moeda', valor: (p) => p.valorCentavos },
  ];
  const colunasSangrias: ColunaRelatorio<SangriaDaMovimentacao>[] = [
    { id: 'data', titulo: 'Data', tipo: 'texto', largura: 20, padrao: !umDia, valor: (s) => dataBr(s.dia) },
    { id: 'hora', titulo: 'Hora', tipo: 'texto', largura: 14, valor: (s) => s.hora },
    { id: 'operador', titulo: 'Operador do caixa', tipo: 'texto', largura: 40, valor: (s) => s.operadorNome },
    { id: 'motivo', titulo: 'Motivo', tipo: 'texto', largura: 50, valor: (s) => s.motivo || 'Sangria' },
    { id: 'deposito', titulo: 'Depositado em', tipo: 'texto', largura: 34, valor: (s) => s.bancoNome },
    { id: 'valor', titulo: 'Valor', tipo: 'moeda', valor: (s) => s.valorCentavos },
  ];

  return {
    titulo: 'Movimentação do Período',
    periodo: umDia ? `Dia ${dataBr(filtro.inicio)}` : `Período: ${dataBr(filtro.inicio)} a ${dataBr(filtro.fim)}`,
    filtros: ['Empresa toda: vendas, recebimentos (vendas à vista, notinhas, OS), contas pagas e sangrias da Frente de Caixa'],
    indicadores,
    secoes: [
      secaoDeGrupo('vendasPorCondicao', 'Vendas: à vista e a prazo', 'Condição', r.porCondicao, 'Nenhuma venda no período.', 'Vendas'),
      secaoPorFormaPagamento(totalPorFormaPagamento(fontes.vendas), { id: 'vendasPorForma', titulo: 'Vendas por forma de pagamento', opcional: true, padrao: false }) as SecaoRelatorio,
      secaoDeGrupo('entradasPorOrigem', 'Entradas: de onde veio o dinheiro', 'Origem', r.porOrigem, 'Nada recebido no período.'),
      secaoDeGrupo('entradasPorForma', 'Entradas por forma de pagamento', 'Forma de pagamento', r.porForma, 'Nada recebido no período.'),
      secaoDeGrupo('entradasPorDestino', 'Entradas por caixa e banco', 'Onde caiu', r.porDestino, 'Nada recebido no período.'),
      secaoDeGrupo('saidasPorForma', 'Saídas: contas pagas por forma', 'Forma de pagamento', r.pagamentosPorForma, 'Nenhuma conta paga no período.'),
      {
        id: 'sangrias', titulo: 'Sangrias da Frente de Caixa', colunas: colunasSangrias, linhas: r.sangrias, opcional: true, padrao: true,
        unidade: ['sangria', 'sangrias'], mensagemVazia: 'Nenhuma sangria no período.',
      } as SecaoRelatorio,
      {
        id: 'entradas', titulo: 'Recebimentos (cada lançamento)', colunas: colunasEntradas, linhas: r.entradas, opcional: true, padrao: false,
        unidade: ['recebimento', 'recebimentos'], mensagemVazia: 'Nada recebido no período.',
      } as SecaoRelatorio,
      {
        id: 'pagamentos', titulo: 'Contas pagas (cada lançamento)', colunas: colunasPagamentos, linhas: r.pagamentos, opcional: true, padrao: false,
        unidade: ['conta paga', 'contas pagas'], mensagemVazia: 'Nenhuma conta paga no período.',
      } as SecaoRelatorio,
      secaoDetalheVendas(fontes.vendas, { id: 'vendas', titulo: 'Vendas do período (cada venda)', opcional: true, padrao: false }) as SecaoRelatorio,
    ],
  };
};
