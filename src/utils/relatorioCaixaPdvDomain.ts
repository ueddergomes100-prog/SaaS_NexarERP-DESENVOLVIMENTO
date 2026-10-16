import type { ColunaRelatorio, IndicadorRelatorio, SecaoRelatorio } from './relatorioPdfDomain';

/*
 * RELATORIO DO CAIXA (SESSOES DO PDV) (pedido do dono, 16/10/2026): "Mais
 * opcoes › Relatorio" em Financeiro › Caixa (Sessoes PDV). Sai o que a tela
 * mostra: caixas abertos + sessoes fechadas no periodo escolhido, com
 * abertura, sangrias e o fechamento (esperado x informado x diferenca).
 * Secao opcional com cada sangria.
 *
 * Regra pura: a tela entrega as sessoes com as datas ja' convertidas.
 */

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
  opcoes: { periodo: string; filtrosAplicados: string[] },
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
    { id: 'esperado', titulo: 'Esperado', tipo: 'moeda', total: 'nenhum', valor: (s) => (fechada(s) ? s.saldoEsperadoCentavos : null) },
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

  return {
    titulo: 'Relatório de Caixa (Sessões PDV)',
    periodo: opcoes.periodo,
    filtros: opcoes.filtrosAplicados,
    indicadores: [
      { rotulo: 'Sessões', valor: String(lista.length) },
      { rotulo: 'Abertas agora', valor: String(lista.length - fechadas.length) },
      { rotulo: 'Sangrias', valor: moeda(sangrias) },
      { rotulo: 'Diferença no fechamento', valor: comSinal(diferenca) },
      { rotulo: 'Fechamentos com diferença', valor: String(comDiferenca) },
    ],
    secoes: [
      {
        id: 'sessoes', titulo: 'Sessões de caixa', colunas, linhas: lista, opcional: true, padrao: true,
        unidade: ['sessão', 'sessões'], mensagemVazia: 'Nenhuma sessão de caixa no período.',
      } as SecaoRelatorio,
      {
        id: 'sangrias', titulo: 'Sangrias', colunas: colunasSangria, linhas: linhasSangria, opcional: true, padrao: false,
        unidade: ['sangria', 'sangrias'], mensagemVazia: 'Nenhuma sangria no período.',
      } as SecaoRelatorio,
    ],
  };
};
