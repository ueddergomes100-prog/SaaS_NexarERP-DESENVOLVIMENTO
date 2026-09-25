import { toCents } from './financeDomain';
import type { ColunaRelatorio, IndicadorRelatorio, SecaoRelatorio } from './relatorioPdfDomain';
import { formatarPlaca } from './frotaDomain';

/*
 * CUSTO POR VEICULO (2026-09-25): soma das despesas do Contas a Pagar ligadas a
 * cada veiculo da frota (combustivel, manutencao, IPVA, seguro, pneus...), por
 * periodo de VENCIMENTO. Cancelada nao conta. Relatorio sempre em PDF na tela
 * (regra do dono, 2026-09-23), colunas escolhidas por caixa de marcar.
 *
 * Regra pura: recebe os titulos ja lidos e devolve as secoes do relatorio.
 */

export interface TituloDeVeiculo {
  id: string;
  /** Vencimento AAAA-MM-DD. */
  data: string;
  descricao: string;
  categoria: string;
  valor: number;
  valorCentavos?: number;
  status: string;
  veiculoId?: string;
  veiculoNome?: string;
  veiculoPlaca?: string;
  motoristaNome?: string;
  dataPagamento?: string;
}

export interface FiltroCustoVeiculo {
  de: string;
  ate: string;
  veiculoId?: string;
  /** 'todas' | 'pagas' | 'a_pagar' */
  situacao?: 'todas' | 'pagas' | 'a_pagar';
}

const centavos = (t: TituloDeVeiculo): number => (Number.isFinite(t.valorCentavos) ? Number(t.valorCentavos) : toCents(t.valor));

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Titulos que entram: tem veiculo, nao esta cancelado, esta no periodo e na situacao pedida. */
export const titulosDoRelatorio = (titulos: TituloDeVeiculo[], filtro: FiltroCustoVeiculo): TituloDeVeiculo[] => (
  titulos.filter((t) => {
    if (!t.veiculoId || t.status === 'Cancelada') return false;
    if (filtro.veiculoId && t.veiculoId !== filtro.veiculoId) return false;
    if (DATA.test(filtro.de) && t.data < filtro.de) return false;
    if (DATA.test(filtro.ate) && t.data > filtro.ate) return false;
    if (filtro.situacao === 'pagas' && t.status !== 'Paga') return false;
    if (filtro.situacao === 'a_pagar' && t.status === 'Paga') return false;
    return true;
  }).sort((a, b) => a.data.localeCompare(b.data) || a.descricao.localeCompare(b.descricao, 'pt-BR'))
);

export interface ResumoDoVeiculo {
  veiculoId: string;
  nome: string;
  placa: string;
  despesas: number;
  totalCentavos: number;
  pagoCentavos: number;
  aPagarCentavos: number;
}

export const resumirPorVeiculo = (titulos: TituloDeVeiculo[]): ResumoDoVeiculo[] => {
  const mapa = new Map<string, ResumoDoVeiculo>();
  titulos.forEach((t) => {
    const id = String(t.veiculoId);
    const atual = mapa.get(id) ?? { veiculoId: id, nome: t.veiculoNome || 'Veículo', placa: t.veiculoPlaca || '', despesas: 0, totalCentavos: 0, pagoCentavos: 0, aPagarCentavos: 0 };
    const valor = centavos(t);
    atual.despesas += 1;
    atual.totalCentavos += valor;
    if (t.status === 'Paga') atual.pagoCentavos += valor; else atual.aPagarCentavos += valor;
    mapa.set(id, atual);
  });
  return [...mapa.values()].sort((a, b) => b.totalCentavos - a.totalCentavos || a.nome.localeCompare(b.nome, 'pt-BR'));
};

export interface ResumoDaCategoria {
  categoria: string;
  despesas: number;
  totalCentavos: number;
}

export const resumirPorCategoria = (titulos: TituloDeVeiculo[]): ResumoDaCategoria[] => {
  const mapa = new Map<string, ResumoDaCategoria>();
  titulos.forEach((t) => {
    const categoria = (t.categoria || 'SEM CATEGORIA').toUpperCase();
    const atual = mapa.get(categoria) ?? { categoria, despesas: 0, totalCentavos: 0 };
    atual.despesas += 1;
    atual.totalCentavos += centavos(t);
    mapa.set(categoria, atual);
  });
  return [...mapa.values()].sort((a, b) => b.totalCentavos - a.totalCentavos);
};

const rotuloDaSituacao = (t: TituloDeVeiculo): string => (t.status === 'Paga' ? 'Paga' : 'A pagar');

export interface DocumentoCustoVeiculo {
  titulo: string;
  periodo: string;
  filtros: string[];
  indicadores: IndicadorRelatorio[];
  secoes: SecaoRelatorio[];
}

const moeda = (valorCentavos: number): string => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valorCentavos / 100);
const dataBr = (iso: string): string => (DATA.test(iso) ? iso.split('-').reverse().join('/') : '');

/** Monta o documento (sem empresa/geradoPor, que a tela acrescenta) para o RelatorioPreview. */
export const montarDocumentoCustoPorVeiculo = (
  titulos: TituloDeVeiculo[],
  filtro: FiltroCustoVeiculo,
  rotuloDoFiltroDeVeiculo?: string,
): DocumentoCustoVeiculo => {
  const lista = titulosDoRelatorio(titulos, filtro);
  const resumo = resumirPorVeiculo(lista);
  const porCategoria = resumirPorCategoria(lista);
  const total = resumo.reduce((soma, v) => soma + v.totalCentavos, 0);
  const pago = resumo.reduce((soma, v) => soma + v.pagoCentavos, 0);

  const colunasResumo: ColunaRelatorio<ResumoDoVeiculo>[] = [
    { id: 'veiculo', titulo: 'Veículo', tipo: 'texto', largura: 48, valor: (v) => v.nome },
    { id: 'placa', titulo: 'Placa', tipo: 'texto', largura: 20, valor: (v) => formatarPlaca(v.placa) },
    { id: 'despesas', titulo: 'Despesas', tipo: 'inteiro', valor: (v) => v.despesas },
    { id: 'total', titulo: 'Total', tipo: 'moeda', valor: (v) => v.totalCentavos },
    { id: 'pago', titulo: 'Pago', tipo: 'moeda', valor: (v) => v.pagoCentavos },
    { id: 'apagar', titulo: 'A pagar', tipo: 'moeda', valor: (v) => v.aPagarCentavos },
    {
      id: 'media', titulo: 'Média por despesa', tipo: 'moeda', padrao: false,
      valor: (v) => (v.despesas ? Math.round(v.totalCentavos / v.despesas) : 0),
      totalCalculado: (linhas) => {
        const n = linhas.reduce((soma, v) => soma + v.despesas, 0);
        return n ? Math.round(linhas.reduce((soma, v) => soma + v.totalCentavos, 0) / n) : 0;
      },
    },
  ];

  const colunasCategoria: ColunaRelatorio<ResumoDaCategoria>[] = [
    { id: 'categoria', titulo: 'Categoria', tipo: 'texto', largura: 60, valor: (c) => c.categoria },
    { id: 'despesas', titulo: 'Despesas', tipo: 'inteiro', valor: (c) => c.despesas },
    { id: 'total', titulo: 'Total', tipo: 'moeda', valor: (c) => c.totalCentavos },
  ];

  const colunasLancamentos: ColunaRelatorio<TituloDeVeiculo>[] = [
    { id: 'data', titulo: 'Vencimento', tipo: 'texto', largura: 22, valor: (t) => dataBr(t.data) },
    { id: 'descricao', titulo: 'Descrição', tipo: 'texto', largura: 60, valor: (t) => t.descricao },
    { id: 'categoria', titulo: 'Categoria', tipo: 'texto', largura: 34, valor: (t) => t.categoria },
    { id: 'motorista', titulo: 'Motorista', tipo: 'texto', largura: 28, padrao: false, valor: (t) => t.motoristaNome || '' },
    { id: 'situacao', titulo: 'Situação', tipo: 'texto', largura: 18, valor: rotuloDaSituacao },
    { id: 'pagoem', titulo: 'Pago em', tipo: 'texto', largura: 20, padrao: false, valor: (t) => dataBr(t.dataPagamento || '') },
    { id: 'valor', titulo: 'Valor', tipo: 'moeda', valor: (t) => centavos(t) },
  ];

  const filtros: string[] = [];
  if (rotuloDoFiltroDeVeiculo) filtros.push(`Veículo: ${rotuloDoFiltroDeVeiculo}`);
  if (filtro.situacao === 'pagas') filtros.push('Somente despesas pagas');
  if (filtro.situacao === 'a_pagar') filtros.push('Somente despesas a pagar');

  return {
    titulo: 'Custo por Veículo',
    periodo: `Vencimento de ${dataBr(filtro.de) || '—'} a ${dataBr(filtro.ate) || '—'}`,
    filtros,
    indicadores: [
      { rotulo: 'Total das despesas', valor: moeda(total) },
      { rotulo: 'Pago', valor: moeda(pago) },
      { rotulo: 'A pagar', valor: moeda(total - pago) },
      { rotulo: 'Veículos', valor: String(resumo.length) },
      { rotulo: 'Despesas', valor: String(lista.length) },
    ],
    secoes: [
      { id: 'resumo', titulo: 'Total por veículo', colunas: colunasResumo, linhas: resumo, unidade: ['veículo', 'veículos'], mensagemVazia: 'Nenhuma despesa de veículo neste período.' } as SecaoRelatorio,
      { id: 'categorias', titulo: 'Por categoria de despesa', colunas: colunasCategoria, linhas: porCategoria, opcional: true, padrao: true, unidade: ['categoria', 'categorias'] } as SecaoRelatorio,
      {
        id: 'lancamentos', titulo: 'Lançamentos', colunas: colunasLancamentos, linhas: lista, opcional: true, padrao: true, unidade: ['despesa', 'despesas'],
        agruparPor: { chave: (t: TituloDeVeiculo) => String(t.veiculoId), rotulo: (t: TituloDeVeiculo) => t.veiculoNome || `Veículo ${formatarPlaca(t.veiculoPlaca || '')}`.trim() },
      } as SecaoRelatorio,
    ],
  };
};
