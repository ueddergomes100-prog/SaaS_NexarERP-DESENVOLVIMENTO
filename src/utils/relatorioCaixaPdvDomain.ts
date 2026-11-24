import type { ColunaRelatorio, IndicadorRelatorio, SecaoRelatorio } from './relatorioPdfDomain';
import type { ComposicaoDaGaveta } from './gavetaDinheiroDomain';

/*
 * RELATORIO DO CAIXA (SESSOES DO PDV) (pedido do dono, 16/10/2026): "Mais
 * opcoes › Relatorio" em Financeiro › Caixa (Sessoes PDV). Sai o que a tela
 * mostra: caixas abertos + sessoes fechadas no periodo escolhido, com
 * abertura, sangrias e o fechamento (esperado x informado x diferenca).
 * Secao opcional com cada sangria.
 *
 * CAIXA ABERTO AO VIVO (pedido do dono, 23/11/2026): "no relatorio aparecer os
 * lancamentos e valores do caixa sem ter que esperar fechar". O caixa aberto
 * sai com o esperado calculado na hora, e duas secoes novas mostram cada
 * lancamento dele e o total por forma de pagamento.
 *
 * O QUE COMPOE O ESPERADO (pedido do dono, 24/11/2026, Embala Minas): "preciso
 * de tudo certinho saindo no relatorio". Secao com cada venda em dinheiro,
 * sangria, transferencia e diferenca, agrupada por dia (decisao do dono), com
 * subtotal do dia; o total da secao e' o esperado.
 *
 * Regra pura: a tela entrega as sessoes com as datas ja' convertidas.
 */

/** Uma composicao por caixa (gaveta ligada: uma so', a do CAIXA). */
export interface ComposicaoDoRelatorio {
  /** "CAIXA (gaveta)" ou o nome do operador do caixa. */
  rotulo: string;
  composicao: ComposicaoDaGaveta;
}

interface LinhaDaComposicao {
  grupo: string;
  quando: Date | null;
  descricao: string;
  clienteNome: string;
  valorCentavos: number;
}

const dataBr = (iso: string): string => iso.split('-').reverse().join('/');

/** Linhas da secao: o que veio antes (uma linha) e cada movimento, com o sinal. */
export const linhasDaComposicao = (itens: ReadonlyArray<ComposicaoDoRelatorio>): LinhaDaComposicao[] => itens.flatMap(({ rotulo, composicao }) => {
  const prefixo = itens.length > 1 ? `${rotulo} — ` : '';
  const anterior: LinhaDaComposicao[] = composicao.saldoAnteriorCentavos !== 0
    ? [{ grupo: `${prefixo}Antes de ${dataBr(composicao.inicio)}`, quando: null, descricao: 'Saldo que vinha dos dias anteriores', clienteNome: '', valorCentavos: composicao.saldoAnteriorCentavos }]
    : [];
  return [
    ...anterior,
    ...composicao.dias.flatMap((dia) => dia.movimentos.map((m) => ({
      grupo: `${prefixo}${dataBr(dia.data)}`,
      quando: m.criadoEmIso ? new Date(m.criadoEmIso) : null,
      descricao: m.descricao,
      clienteNome: m.clienteNome || '',
      valorCentavos: m.direcao === 'credito' ? m.valorCentavos : -m.valorCentavos,
    }))),
  ];
});

export interface SangriaDoRelatorio {
  valorCentavos: number;
  motivo?: string;
  /** ISO, como o PDV grava. */
  registradoEm?: string;
  registradoPorNome?: string;
}

export interface SessaoCaixaDoRelatorio {
  id: string;
  operadorNome: string;
  status: 'aberto' | 'fechado';
  abertoEm: Date | null;
  fechadoEm: Date | null;
  saldoInicialCentavos: number;
  totalSangriasCentavos: number;
  saldoEsperadoCentavos: number | null;
  saldoFinalInformadoCentavos: number | null;
  diferencaCentavos: number | null;
  sangrias: SangriaDoRelatorio[];
  /** Caixa aberto: saldo esperado calculado agora (a tela faz a conta). */
  esperadoAoVivoCentavos?: number | null;
  /** Caixa aberto: o que ja' passou por ele (titulos da sessao). */
  lancamentos?: LancamentoDoCaixaAberto[];
}

/** Titulo gerado por uma venda do caixa (colecao `transacoes`, pela sessao). */
export interface LancamentoDoCaixaAberto {
  id: string;
  descricao: string;
  clienteNome: string;
  formaPagamento: string;
  valorCentavos: number;
  criadoEm: Date | null;
  /** Venda cancelada/estornada: aparece na lista, fora dos totais. */
  cancelado: boolean;
  /** A prazo/boleto ainda nao recebido. */
  pendente: boolean;
}

export interface TotalPorForma {
  formaPagamento: string;
  quantidade: number;
  valorCentavos: number;
}

/** Total por forma de pagamento, maior primeiro; cancelados ficam fora. */
export const totaisPorForma = (lancamentos: ReadonlyArray<LancamentoDoCaixaAberto>): TotalPorForma[] => {
  const mapa = new Map<string, TotalPorForma>();
  lancamentos.filter((l) => !l.cancelado).forEach((l) => {
    const forma = l.formaPagamento || 'Sem forma';
    const atual = mapa.get(forma) || { formaPagamento: forma, quantidade: 0, valorCentavos: 0 };
    mapa.set(forma, { ...atual, quantidade: atual.quantidade + 1, valorCentavos: atual.valorCentavos + l.valorCentavos });
  });
  return [...mapa.values()].sort((a, b) => b.valorCentavos - a.valorCentavos || a.formaPagamento.localeCompare(b.formaPagamento, 'pt-BR'));
};

/** Quanto ja' passou pelo caixa aberto (todas as formas, sem os cancelados). */
export const totalDoCaixaAberto = (lancamentos: ReadonlyArray<LancamentoDoCaixaAberto>): number => (
  lancamentos.filter((l) => !l.cancelado).reduce((soma, l) => soma + l.valorCentavos, 0)
);

interface LinhaDeLancamento extends LancamentoDoCaixaAberto {
  operadorNome: string;
}

interface LinhaDeForma extends TotalPorForma {
  operadorNome: string;
}

interface LinhaDeSangria extends SangriaDoRelatorio {
  operadorNome: string;
}

const fechada = (s: SessaoCaixaDoRelatorio): boolean => s.status === 'fechado';

const moeda = (centavos: number): string => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(centavos / 100);

const comSinal = (centavos: number): string => `${centavos > 0 ? '+' : ''}${moeda(centavos)}`;

/** "Conferido", "Sobrou R$ X" ou "Faltou R$ X"; caixa aberto ainda nao fechou. */
export const resultadoDoFechamento = (s: SessaoCaixaDoRelatorio): string => {
  if (!fechada(s)) return 'Aberto';
  const dif = Number(s.diferencaCentavos || 0);
  if (dif === 0) return 'Conferido';
  return dif > 0 ? `Sobrou ${moeda(dif)}` : `Faltou ${moeda(Math.abs(dif))}`;
};

export interface DocumentoCaixaPdv {
  titulo: string;
  periodo: string;
  filtros: string[];
  indicadores: IndicadorRelatorio[];
  secoes: SecaoRelatorio[];
}

export const montarDocumentoCaixaPdv = (
  sessoes: SessaoCaixaDoRelatorio[],
  opcoes: { periodo: string; filtrosAplicados: string[]; composicoes?: ComposicaoDoRelatorio[] },
): DocumentoCaixaPdv => {
  // Mais antiga primeiro: e' como se confere o caixa dia a dia.
  const lista = [...sessoes].sort((a, b) => (a.abertoEm?.getTime() || 0) - (b.abertoEm?.getTime() || 0));
  const fechadas = lista.filter(fechada);
  const sangrias = lista.reduce((soma, s) => soma + Number(s.totalSangriasCentavos || 0), 0);
  const diferenca = fechadas.reduce((soma, s) => soma + Number(s.diferencaCentavos || 0), 0);
  const comDiferenca = fechadas.filter((s) => Number(s.diferencaCentavos || 0) !== 0).length;

  const colunas: ColunaRelatorio<SessaoCaixaDoRelatorio>[] = [
    { id: 'operador', titulo: 'Operador', tipo: 'texto', largura: 40, valor: (s) => s.operadorNome || '' },
    { id: 'abertura', titulo: 'Abertura', tipo: 'dataHora', largura: 30, valor: (s) => s.abertoEm },
    { id: 'fechamento', titulo: 'Fechamento', tipo: 'dataHora', largura: 30, valor: (s) => (fechada(s) ? s.fechadoEm : null) },
    // Saldo inicial de sessoes diferentes nao se soma.
    { id: 'inicial', titulo: 'Saldo inicial', tipo: 'moeda', total: 'nenhum', valor: (s) => s.saldoInicialCentavos },
    { id: 'qtdSangrias', titulo: 'Nº sangrias', tipo: 'inteiro', padrao: false, valor: (s) => s.sangrias.length },
    { id: 'sangrias', titulo: 'Sangrias', tipo: 'moeda', valor: (s) => s.totalSangriasCentavos },
    // Caixa aberto: o esperado de agora (23/11/2026); informado e diferenca so' existem depois de fechar.
    { id: 'vendido', titulo: 'Vendido (aberto)', tipo: 'moeda', padrao: false, valor: (s) => (!fechada(s) && s.lancamentos ? totalDoCaixaAberto(s.lancamentos) : null) },
    { id: 'esperado', titulo: 'Esperado', tipo: 'moeda', total: 'nenhum', valor: (s) => (fechada(s) ? s.saldoEsperadoCentavos : s.esperadoAoVivoCentavos ?? null) },
    { id: 'informado', titulo: 'Informado', tipo: 'moeda', total: 'nenhum', valor: (s) => (fechada(s) ? s.saldoFinalInformadoCentavos : null) },
    { id: 'diferenca', titulo: 'Diferença', tipo: 'moeda', valor: (s) => (fechada(s) ? Number(s.diferencaCentavos || 0) : null) },
    { id: 'resultado', titulo: 'Resultado', tipo: 'texto', largura: 30, valor: resultadoDoFechamento },
  ];

  const linhasSangria: LinhaDeSangria[] = lista.flatMap((s) => s.sangrias.map((g) => ({ ...g, operadorNome: s.operadorNome })));
  const colunasSangria: ColunaRelatorio<LinhaDeSangria>[] = [
    { id: 'horario', titulo: 'Horário', tipo: 'dataHora', largura: 30, valor: (g) => (g.registradoEm ? new Date(g.registradoEm) : null) },
    { id: 'operador', titulo: 'Caixa de', tipo: 'texto', largura: 36, valor: (g) => g.operadorNome || '' },
    { id: 'motivo', titulo: 'Motivo', tipo: 'texto', largura: 60, valor: (g) => g.motivo || '' },
    { id: 'responsavel', titulo: 'Responsável', tipo: 'texto', largura: 36, valor: (g) => g.registradoPorNome || '' },
    { id: 'valor', titulo: 'Valor', tipo: 'moeda', valor: (g) => g.valorCentavos },
  ];

  // Caixa aberto ao vivo: cada lancamento e o total por forma de pagamento.
  const abertas = lista.filter((s) => !fechada(s));
  const linhasLancamento: LinhaDeLancamento[] = abertas.flatMap((s) => (s.lancamentos || []).map((l) => ({ ...l, operadorNome: s.operadorNome })));
  const colunasLancamento: ColunaRelatorio<LinhaDeLancamento>[] = [
    { id: 'horario', titulo: 'Horário', tipo: 'dataHora', largura: 30, valor: (l) => l.criadoEm },
    { id: 'operador', titulo: 'Caixa de', tipo: 'texto', largura: 30, valor: (l) => l.operadorNome || '' },
    { id: 'descricao', titulo: 'Lançamento', tipo: 'texto', largura: 62, valor: (l) => l.descricao || '' },
    { id: 'cliente', titulo: 'Cliente', tipo: 'texto', largura: 44, padrao: false, valor: (l) => l.clienteNome || '' },
    { id: 'forma', titulo: 'Forma', tipo: 'texto', largura: 30, valor: (l) => l.formaPagamento || '' },
    { id: 'situacao', titulo: 'Situação', tipo: 'texto', largura: 24, valor: (l) => (l.cancelado ? 'Cancelado' : l.pendente ? 'A receber' : 'Recebido') },
    { id: 'valor', titulo: 'Valor', tipo: 'moeda', total: 'nenhum', valor: (l) => l.valorCentavos },
  ];
  const linhasForma: LinhaDeForma[] = abertas.flatMap((s) => totaisPorForma(s.lancamentos || []).map((f) => ({ ...f, operadorNome: s.operadorNome })));
  const colunasForma: ColunaRelatorio<LinhaDeForma>[] = [
    { id: 'operador', titulo: 'Caixa de', tipo: 'texto', largura: 40, valor: (f) => f.operadorNome || '' },
    { id: 'forma', titulo: 'Forma de pagamento', tipo: 'texto', largura: 60, valor: (f) => f.formaPagamento },
    { id: 'quantidade', titulo: 'Lançamentos', tipo: 'inteiro', valor: (f) => f.quantidade },
    { id: 'valor', titulo: 'Valor', tipo: 'moeda', valor: (f) => f.valorCentavos },
  ];
  const vendidoNosAbertos = abertas.reduce((soma, s) => soma + totalDoCaixaAberto(s.lancamentos || []), 0);

  const composicoes = opcoes.composicoes || [];
  const linhasComposicao = linhasDaComposicao(composicoes);
  const colunasComposicao: ColunaRelatorio<LinhaDaComposicao>[] = [
    { id: 'quando', titulo: 'Horário', tipo: 'dataHora', largura: 30, valor: (l) => l.quando },
    { id: 'descricao', titulo: 'Lançamento', tipo: 'texto', largura: 80, valor: (l) => l.descricao },
    { id: 'cliente', titulo: 'Cliente', tipo: 'texto', largura: 44, valor: (l) => l.clienteNome },
    { id: 'valor', titulo: 'Valor', tipo: 'moeda', valor: (l) => l.valorCentavos },
  ];
  const esperadoComposto = composicoes.reduce((soma, c) => soma + c.composicao.saldoCentavos, 0);

  return {
    titulo: 'Caixa (Sessões PDV)',
    periodo: opcoes.periodo,
    filtros: opcoes.filtrosAplicados,
    indicadores: [
      { rotulo: 'Sessões', valor: String(lista.length) },
      { rotulo: 'Abertas agora', valor: String(lista.length - fechadas.length) },
      ...(abertas.length > 0 ? [{ rotulo: 'Vendido nos caixas abertos', valor: moeda(vendidoNosAbertos) }] : []),
      ...(composicoes.length > 0 ? [{ rotulo: 'Esperado agora', valor: moeda(esperadoComposto) }] : []),
      { rotulo: 'Sangrias', valor: moeda(sangrias) },
      { rotulo: 'Diferença no fechamento', valor: comSinal(diferenca) },
      { rotulo: 'Fechamentos com diferença', valor: String(comDiferenca) },
    ],
    secoes: [
      ...(composicoes.length > 0 ? [{
        id: 'composicaoEsperado', titulo: 'O que compõe o esperado agora (por dia)', colunas: colunasComposicao, linhas: linhasComposicao,
        opcional: true, padrao: true, agruparPor: { chave: (l: LinhaDaComposicao) => l.grupo, rotulo: (l: LinhaDaComposicao) => l.grupo },
        rotuloTotal: 'Esperado agora', unidade: ['lançamento', 'lançamentos'], mensagemVazia: 'Nenhum dinheiro entrou ou saiu ainda.',
      } as SecaoRelatorio] : []),
      {
        id: 'sessoes', titulo: 'Sessões de caixa', colunas, linhas: lista, opcional: true, padrao: true,
        unidade: ['sessão', 'sessões'], mensagemVazia: 'Nenhuma sessão de caixa no período.',
      } as SecaoRelatorio,
      {
        id: 'formasAbertos', titulo: 'Caixas abertos: total por forma de pagamento', colunas: colunasForma, linhas: linhasForma, opcional: true, padrao: abertas.length > 0,
        unidade: ['forma', 'formas'], mensagemVazia: 'Nenhum lançamento nos caixas abertos.',
      } as SecaoRelatorio,
      {
        id: 'lancamentosAbertos', titulo: 'Caixas abertos: lançamentos', colunas: colunasLancamento, linhas: linhasLancamento, opcional: true, padrao: abertas.length > 0,
        unidade: ['lançamento', 'lançamentos'], mensagemVazia: 'Nenhum lançamento nos caixas abertos.',
      } as SecaoRelatorio,
      {
        id: 'sangrias', titulo: 'Sangrias', colunas: colunasSangria, linhas: linhasSangria, opcional: true, padrao: false,
        unidade: ['sangria', 'sangrias'], mensagemVazia: 'Nenhuma sangria no período.',
      } as SecaoRelatorio,
    ],
  };
};
