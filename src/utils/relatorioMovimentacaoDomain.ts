import { isRevenueReversal } from './financeDomain';
import { calcularRelatorioFinanceiro, type TransacaoRelatorioFinanceiro } from './relatorioFinanceiroDomain';
import { calcularRecebimentos, DESTINO_ACERTO, DESTINO_CAIXA, DESTINO_CREDITO, type LinhaDeRecebimento, type TotalAgrupado } from './relatorioRecebimentosDomain';
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

/**
 * Turno do caixa (sessao da Frente de Caixa, 27/11/2026, pedido do dono: "turnos do
 * caixa, tudo completo"): quem abriu, quando, troco inicial, sangrias e a conferencia
 * do fechamento (esperado x contado). null = ainda nao fechado.
 */
export interface TurnoDoCaixa {
  id: string;
  /** yyyy-mm-dd da abertura. */
  dia: string;
  abertura: string;
  fechamento: string;
  operadorNome: string;
  aberto: boolean;
  saldoInicialCentavos: number;
  sangriasCentavos: number;
  /** Suprimentos (27/11/2026); ausente = 0. */
  suprimentosCentavos?: number;
  esperadoCentavos: number | null;
  contadoCentavos: number | null;
  diferencaCentavos: number | null;
}

export interface FiltroDaMovimentacao {
  inicio: string;
  fim: string;
  /** So' estas formas (vendas, recebimentos e contas pagas). Vazio/ausente = todas. */
  formas?: string[];
}

export interface FontesDaMovimentacao {
  /** Vendas ja' enriquecidas e cortadas no periodo (relatorioVendasDomain). */
  vendas: VendaRelatorio[];
  entradasPagas: TransacaoRelatorioFinanceiro[];
  saidasPagas: TransacaoRelatorioFinanceiro[];
  sangrias: SangriaDaMovimentacao[];
  /** Turnos da Frente de Caixa abertos no periodo (27/11/2026). */
  turnos?: TurnoDoCaixa[];
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
  vendasPorForma: Array<{ forma: string; vendas: number; valorCentavos: number }>;
  vendasDaLista: VendaRelatorio[];
  turnos: TurnoDoCaixa[];
  /** Soma das diferencas dos turnos fechados (sobra +, falta -). */
  diferencaDosTurnosCentavos: number;
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
  const formas = new Set((filtro.formas || []).map((f) => texto(f)).filter(Boolean));
  const naForma = (forma: unknown): boolean => formas.size === 0 || formas.has(texto(forma));

  // Vendido: com filtro de forma, so' as vendas que tem alguma das formas e so' a parte delas.
  const vendasDaLista = formas.size === 0
    ? fontes.vendas
    : fontes.vendas.filter((v) => (Array.isArray(v.payments) ? v.payments : []).some((p: { formaPagamento?: unknown }) => naForma(p?.formaPagamento)));
  const vendasValidas = vendasDaLista.filter((v) => !v.cancelled);
  const totais = totaisVendas(vendasDaLista);
  const vendasPorForma = totalPorFormaPagamento(vendasDaLista).filter((f) => naForma(f.forma));
  const porCondicao = agruparPor(vendasValidas, (v) => rotuloCondicaoPagamento(String(v.paymentCondition || '')), (v) => Number(v.netCents || 0));
  const daCondicao = (rotulo: string) => porCondicao.find((g) => g.rotulo === rotulo)?.valorCentavos || 0;
  const vendidoCentavos = formas.size === 0 ? totais.netCents : vendasPorForma.reduce((soma, f) => soma + f.valorCentavos, 0);

  // Entrou (mesma conta do relatorio de Recebimentos), so' nas formas escolhidas.
  const recebido = calcularRecebimentos(fontes.entradasPagas, { inicio: filtro.inicio, fim: filtro.fim, somenteContas: false }, fontes.saidasPagas);
  const porId = new Map(fontes.entradasPagas.map((t) => [t.id, t]));
  const entradas = recebido.linhas.filter((l) => naForma(l.formaPagamento));
  const origemDe = new Map(entradas.map((l) => [l.id, origemDaMovimentacao(l, porId.get(l.id))]));
  const entradasValidas = entradas.filter((l) => !l.estornado);
  const somaDe = (lista: LinhaDeRecebimento[]) => lista.reduce((soma, l) => soma + l.valorCentavos, 0);
  const totalRecebido = somaDe(entradasValidas);
  const semDinheiroCentavos = somaDe(entradasValidas.filter((l) => l.destino === DESTINO_ACERTO || l.destino === DESTINO_CREDITO));
  const caixaCentavos = somaDe(entradasValidas.filter((l) => l.destino === DESTINO_CAIXA));
  const entrouCentavos = totalRecebido - semDinheiroCentavos;
  const notinhasCentavos = somaDe(entradasValidas.filter((l) => {
    const origem = origemDe.get(l.id);
    return origem === 'Notinha recebida na Frente de Caixa' || origem === 'Conta recebida no Financeiro';
  }));

  // Saiu: contas pagas. O estorno de venda/OS cancelada nao e' conta paga: ja'
  // aparece na entrada como ESTORNADO.
  const saidasSemEstorno = fontes.saidasPagas.filter((t) => !isRevenueReversal(t as Parameters<typeof isRevenueReversal>[0]));
  const pagas = calcularRelatorioFinanceiro(saidasSemEstorno, { tipo: 'saida', status: 'Paga', inicio: filtro.inicio, fim: filtro.fim });
  const saidaPorId = new Map(saidasSemEstorno.map((t) => [t.id, t]));
  const pagamentos: LinhaDePagamento[] = pagas.linhas
    .filter((l) => naForma(l.formaPagamento || 'Sem forma'))
    .map((l) => {
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

  // Sangrias e turnos do periodo (dinheiro da gaveta: so' com Dinheiro no filtro).
  const comDinheiro = naForma('Dinheiro');
  const sangrias = comDinheiro
    ? fontes.sangrias
      .filter((s) => s.dia >= filtro.inicio && s.dia <= filtro.fim && s.valorCentavos > 0)
      .sort((a, b) => `${a.dia} ${a.hora}`.localeCompare(`${b.dia} ${b.hora}`))
    : [];
  const turnos = (fontes.turnos || [])
    .filter((t) => t.dia >= filtro.inicio && t.dia <= filtro.fim)
    .sort((a, b) => `${a.dia} ${a.abertura}`.localeCompare(`${b.dia} ${b.abertura}`));

  return {
    vendasValidas: totais.count,
    vendidoCentavos,
    vendidoAVistaCentavos: daCondicao('À vista'),
    vendidoAPrazoCentavos: daCondicao('A prazo'),
    porCondicao,
    entradas,
    porOrigem: agruparPor(entradasValidas, (l) => origemDe.get(l.id) || l.origem, (l) => l.valorCentavos),
    porForma: agruparPor(entradasValidas, (l) => l.formaPagamento, (l) => l.valorCentavos),
    porDestino: agruparPor(entradasValidas, (l) => l.destino, (l) => l.valorCentavos),
    entrouCentavos,
    caixaCentavos,
    bancosCentavos: entrouCentavos - caixaCentavos,
    semDinheiroCentavos,
    notinhasCentavos,
    estornadoCentavos: somaDe(entradas.filter((l) => l.estornado)),
    pagamentos,
    pagamentosPorForma: agruparPor(pagamentos, (p) => p.formaPagamento, (p) => p.valorCentavos),
    pagoCentavos,
    sangrias,
    sangriasCentavos: sangrias.reduce((soma, s) => soma + s.valorCentavos, 0),
    saldoCentavos: entrouCentavos - pagoCentavos,
    vendasPorForma,
    vendasDaLista,
    turnos,
    diferencaDosTurnosCentavos: turnos.reduce((soma, t) => soma + (t.aberto ? 0 : (t.diferencaCentavos || 0)), 0),
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
  if (r.turnos.length > 0) {
    indicadores.push({ rotulo: `Turnos do caixa (${r.turnos.length})`, valor: r.diferencaDosTurnosCentavos === 0 ? 'Sem diferença' : `${r.diferencaDosTurnosCentavos > 0 ? 'Sobrou' : 'Faltou'} ${moeda(Math.abs(r.diferencaDosTurnosCentavos))}` });
  }
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
  const colunasTurnos: ColunaRelatorio<TurnoDoCaixa>[] = [
    { id: 'data', titulo: 'Data', tipo: 'texto', largura: 20, padrao: !umDia, valor: (t) => dataBr(t.dia) },
    { id: 'operador', titulo: 'Operador', tipo: 'texto', largura: 40, valor: (t) => t.operadorNome },
    { id: 'abertura', titulo: 'Abriu', tipo: 'texto', largura: 14, valor: (t) => t.abertura },
    { id: 'fechamento', titulo: 'Fechou', tipo: 'texto', largura: 16, valor: (t) => (t.aberto ? 'ABERTO' : t.fechamento) },
    { id: 'inicial', titulo: 'Troco inicial', tipo: 'moeda', valor: (t) => t.saldoInicialCentavos },
    { id: 'sangrias', titulo: 'Sangrias', tipo: 'moeda', valor: (t) => t.sangriasCentavos },
    { id: 'suprimentos', titulo: 'Suprimentos', tipo: 'moeda', padrao: r.turnos.some((t) => (t.suprimentosCentavos || 0) > 0), valor: (t) => t.suprimentosCentavos || 0 },
    { id: 'esperado', titulo: 'Esperado', tipo: 'moeda', valor: (t) => t.esperadoCentavos ?? 0, total: 'nenhum' },
    { id: 'contado', titulo: 'Contado', tipo: 'moeda', valor: (t) => t.contadoCentavos ?? 0, total: 'nenhum' },
    { id: 'diferenca', titulo: 'Diferença', tipo: 'moeda', valor: (t) => t.diferencaCentavos ?? 0 },
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
    filtros: [
      'Empresa toda: vendas, recebimentos (vendas à vista, notinhas, OS), contas pagas, turnos e sangrias da Frente de Caixa',
      ...((filtro.formas || []).length > 0 ? [`Só as formas: ${(filtro.formas || []).join(', ')}`] : []),
    ],
    indicadores,
    secoes: [
      // Ordem do fechamento (27/11/2026): o que vendeu e como, o que recebeu e como, depois o resto.
      secaoPorFormaPagamento(r.vendasPorForma, { id: 'vendasPorForma', titulo: 'Vendido por forma de pagamento', opcional: true, padrao: true }) as SecaoRelatorio,
      secaoDeGrupo('entradasPorForma', 'Recebido por forma de pagamento', 'Forma de pagamento', r.porForma, 'Nada recebido no período.'),
      secaoDeGrupo('vendasPorCondicao', 'Vendas: à vista e a prazo', 'Condição', r.porCondicao, 'Nenhuma venda no período.', 'Vendas'),
      secaoDeGrupo('entradasPorOrigem', 'Recebido: de onde veio o dinheiro', 'Origem', r.porOrigem, 'Nada recebido no período.'),
      {
        id: 'turnos', titulo: 'Turnos do caixa (Frente de Caixa)', colunas: colunasTurnos, linhas: r.turnos, opcional: true, padrao: true,
        unidade: ['turno', 'turnos'], mensagemVazia: 'Nenhum caixa aberto no período.',
      } as SecaoRelatorio,
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
      secaoDetalheVendas(r.vendasDaLista, { id: 'vendas', titulo: 'Vendas do período (cada venda)', opcional: true, padrao: false }) as SecaoRelatorio,
    ],
  };
};
