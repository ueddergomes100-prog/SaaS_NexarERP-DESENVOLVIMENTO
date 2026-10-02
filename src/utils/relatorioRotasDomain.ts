import { dentroDoPeriodo } from './filtroListaDomain';
import type { ColunaRelatorio, IndicadorRelatorio, SecaoRelatorio } from './relatorioPdfDomain';
import { rotuloDoTipoDespesa, totaisPorTipo, type DespesaRota } from './rotaDomain';

/*
 * RELATORIO DE ROTAS E DESPESAS (padrao de relatorio, 2026-10-02).
 *
 * A tela /operacoes/rotas e' a lista + o "relatorio por motorista" (o resumo
 * do topo). O item "Relatório" do menu Mais opcoes abre no RelatorioPreview
 * (PDF paginado, colunas por caixa de marcar, Excel dentro da visualizacao)
 * com exatamente o que esta filtrado na tela: busca, motorista e periodo.
 *
 * Regra pura: sem tela, sem Firestore.
 */

export interface RotaDoRelatorio {
  id: string;
  motoristaId?: string;
  motoristaNome?: string;
  veiculo?: string;
  /** AAAA-MM-DD. */
  data?: string;
  observacao?: string;
  despesas?: DespesaRota[];
  total?: number;
  totalCentavos?: number;
}

export interface FiltroRotas {
  busca: string;
  motoristaId: string;
  /** AAAA-MM-DD ou vazio. */
  de: string;
  ate: string;
}

/** Os filtros da tela, na ordem da tela (data mais recente primeiro). */
export const filtrarRotas = <T extends RotaDoRelatorio>(rotas: T[], filtro: FiltroRotas): T[] => {
  const termo = filtro.busca.trim().toLowerCase();
  return rotas
    .filter((r) => !filtro.motoristaId || r.motoristaId === filtro.motoristaId)
    .filter((r) => dentroDoPeriodo(r.data || '', filtro.de, filtro.ate))
    .filter((r) => !termo
      || String(r.motoristaNome || '').toLowerCase().includes(termo)
      || String(r.veiculo || '').toLowerCase().includes(termo)
      || String(r.observacao || '').toLowerCase().includes(termo))
    .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));
};

/** Total gravado na rota, em centavos (rota antiga so' tem `total` em reais). */
export const totalDaRotaDoRelatorioCentavos = (rota: RotaDoRelatorio): number => (
  Number(rota.totalCentavos || Math.round(Number(rota.total || 0) * 100))
);

/** Despesas que contam (valor maior que zero), como em totaisPorTipo. */
const despesasComValor = (rota: RotaDoRelatorio): DespesaRota[] => (
  (rota.despesas || []).filter((d) => Math.round((Number(d.valor) || 0) * 100) > 0)
);

export interface ResumoRotas {
  totalCentavos: number;
  porTipo: Array<{ tipo: string; label: string; totalCentavos: number }>;
}

/** O resumo do topo da tela: total gasto e quanto foi em cada tipo de despesa. */
export const resumirRotas = (rotas: RotaDoRelatorio[]): ResumoRotas => {
  const todasAsDespesas = rotas.flatMap((r) => r.despesas || []);
  const totalCentavos = rotas.reduce((soma, r) => soma + totalDaRotaDoRelatorioCentavos(r), 0);
  return { totalCentavos, porTipo: totaisPorTipo(todasAsDespesas) };
};

export interface ResumoDoMotorista {
  chave: string;
  nome: string;
  rotas: number;
  despesas: number;
  totalCentavos: number;
}

const chaveDoMotorista = (r: RotaDoRelatorio): string => r.motoristaId || r.motoristaNome || '';
const nomeDoMotorista = (r: RotaDoRelatorio): string => r.motoristaNome || 'Sem motorista';

export const resumirRotasPorMotorista = (rotas: RotaDoRelatorio[]): ResumoDoMotorista[] => {
  const mapa = new Map<string, ResumoDoMotorista>();
  rotas.forEach((r) => {
    const chave = chaveDoMotorista(r);
    const atual = mapa.get(chave) ?? { chave, nome: nomeDoMotorista(r), rotas: 0, despesas: 0, totalCentavos: 0 };
    atual.rotas += 1;
    atual.despesas += despesasComValor(r).length;
    atual.totalCentavos += totalDaRotaDoRelatorioCentavos(r);
    mapa.set(chave, atual);
  });
  return [...mapa.values()].sort((a, b) => b.totalCentavos - a.totalCentavos || a.nome.localeCompare(b.nome, 'pt-BR'));
};

export interface ResumoDoTipoDeDespesa {
  tipo: string;
  label: string;
  despesas: number;
  totalCentavos: number;
}

/** Por tipo de despesa, na mesma ordem do resumo da tela (totaisPorTipo). */
export const resumirRotasPorTipo = (rotas: RotaDoRelatorio[]): ResumoDoTipoDeDespesa[] => {
  const despesas = rotas.flatMap(despesasComValor);
  return totaisPorTipo(despesas).map((t) => ({
    tipo: t.tipo,
    label: t.label,
    despesas: despesas.filter((d) => d.tipo === t.tipo).length,
    totalCentavos: t.totalCentavos,
  }));
};

export interface DocumentoRotas {
  titulo: string;
  periodo: string;
  filtros: string[];
  indicadores: IndicadorRelatorio[];
  secoes: SecaoRelatorio[];
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const dataBr = (iso: string): string => (DATA.test(iso) ? iso.split('-').reverse().join('/') : '');
const moeda = (valorCentavos: number): string => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valorCentavos / 100);

/**
 * Monta o documento (sem empresa/geradoPor, que a tela acrescenta) para o
 * RelatorioPreview. `rotas` = exatamente o que esta na tela (ja' filtrado).
 * `nomeDoMotoristaFiltrado` = nome do motorista escolhido no filtro, se houver.
 */
export const montarDocumentoRotas = (
  rotas: RotaDoRelatorio[],
  filtro: FiltroRotas,
  nomeDoMotoristaFiltrado?: string,
): DocumentoRotas => {
  const resumo = resumirRotas(rotas);
  const porMotorista = resumirRotasPorMotorista(rotas);
  const porTipo = resumirRotasPorTipo(rotas);

  const colunasMotorista: ColunaRelatorio<ResumoDoMotorista>[] = [
    { id: 'motorista', titulo: 'Motorista', tipo: 'texto', largura: 60, valor: (m) => m.nome },
    { id: 'rotas', titulo: 'Rotas', tipo: 'inteiro', valor: (m) => m.rotas },
    { id: 'despesas', titulo: 'Despesas', tipo: 'inteiro', valor: (m) => m.despesas },
    { id: 'total', titulo: 'Total', tipo: 'moeda', valor: (m) => m.totalCentavos },
    {
      id: 'media', titulo: 'Média por rota', tipo: 'moeda', padrao: false,
      valor: (m) => (m.rotas ? Math.round(m.totalCentavos / m.rotas) : 0),
      totalCalculado: (linhas) => {
        const n = linhas.reduce((soma, m) => soma + m.rotas, 0);
        return n ? Math.round(linhas.reduce((soma, m) => soma + m.totalCentavos, 0) / n) : 0;
      },
    },
  ];

  const colunasRotas: ColunaRelatorio<RotaDoRelatorio>[] = [
    { id: 'data', titulo: 'Data', tipo: 'texto', largura: 22, valor: (r) => dataBr(r.data || '') },
    // As rotas saem agrupadas por motorista (o nome ja' vai no titulo do bloco): coluna desmarcada por padrao.
    { id: 'motorista', titulo: 'Motorista', tipo: 'texto', largura: 36, padrao: false, valor: (r) => r.motoristaNome || '' },
    { id: 'veiculo', titulo: 'Veículo', tipo: 'texto', largura: 34, valor: (r) => r.veiculo || '' },
    {
      id: 'despesas', titulo: 'Despesas', tipo: 'texto', largura: 60,
      valor: (r) => totaisPorTipo(r.despesas || []).map((t) => rotuloDoTipoDespesa(t.tipo)).join(', '),
    },
    { id: 'qtd', titulo: 'Qtd. despesas', tipo: 'inteiro', padrao: false, valor: (r) => despesasComValor(r).length },
    { id: 'observacao', titulo: 'Observação', tipo: 'texto', largura: 50, padrao: false, valor: (r) => r.observacao || '' },
    { id: 'total', titulo: 'Total', tipo: 'moeda', valor: totalDaRotaDoRelatorioCentavos },
  ];

  const colunasTipo: ColunaRelatorio<ResumoDoTipoDeDespesa>[] = [
    { id: 'tipo', titulo: 'Tipo de despesa', tipo: 'texto', largura: 60, valor: (t) => t.label },
    { id: 'despesas', titulo: 'Despesas', tipo: 'inteiro', valor: (t) => t.despesas },
    { id: 'total', titulo: 'Total', tipo: 'moeda', valor: (t) => t.totalCentavos },
  ];

  const filtros: string[] = [];
  if (filtro.motoristaId) filtros.push(`Motorista: ${nomeDoMotoristaFiltrado || 'motorista escolhido'}`);
  if (filtro.busca.trim()) filtros.push(`Busca: "${filtro.busca.trim()}"`);

  const periodo = filtro.de || filtro.ate
    ? `Data da rota de ${dataBr(filtro.de) || '—'} a ${dataBr(filtro.ate) || '—'}`
    : 'Todas as datas';

  return {
    titulo: 'Rotas e Despesas de Viagem',
    periodo,
    filtros,
    indicadores: [
      { rotulo: 'Total gasto', valor: moeda(resumo.totalCentavos) },
      { rotulo: 'Rotas', valor: String(rotas.length) },
      ...resumo.porTipo.map((t) => ({ rotulo: t.label, valor: moeda(t.totalCentavos) })),
    ],
    secoes: [
      {
        id: 'motoristas', titulo: 'Total por motorista', colunas: colunasMotorista, linhas: porMotorista,
        opcional: true, padrao: true, unidade: ['motorista', 'motoristas'], mensagemVazia: 'Nenhuma rota com esses filtros.',
      } as SecaoRelatorio,
      {
        id: 'rotas', titulo: 'Rotas', colunas: colunasRotas, linhas: rotas, opcional: true, padrao: true, unidade: ['rota', 'rotas'],
        mensagemVazia: 'Nenhuma rota com esses filtros.',
        agruparPor: { chave: chaveDoMotorista, rotulo: nomeDoMotorista },
      } as SecaoRelatorio,
      {
        id: 'tipos', titulo: 'Por tipo de despesa', colunas: colunasTipo, linhas: porTipo, opcional: true, padrao: false,
        unidade: ['tipo', 'tipos'], mensagemVazia: 'Nenhuma despesa com esses filtros.',
      } as SecaoRelatorio,
    ],
  };
};
