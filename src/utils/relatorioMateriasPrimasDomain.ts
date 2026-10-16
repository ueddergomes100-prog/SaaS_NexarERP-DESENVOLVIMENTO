import type { ColunaRelatorio, IndicadorRelatorio, SecaoRelatorio } from './relatorioPdfDomain';
import { toCents } from './financeDomain';

/*
 * RELATORIO DE MATERIA-PRIMA (pedido do dono, 16/10/2026): "Mais opcoes ›
 * Relatorio" na tela de Materia-Prima, no padrao dos outros (PDF na tela,
 * colunas por caixa, Excel na visualizacao). Posicao do estoque, o que esta
 * abaixo do minimo e o valor parado em custo -- o mesmo que o relatorio de
 * Insumos ja' mostra. Sai o que esta filtrado na tela.
 *
 * Regra pura: sem tela, sem Firestore.
 */

export interface MateriaPrimaDoRelatorio {
  id: string;
  codigo?: string;
  nome?: string;
  categoria?: string;
  unidade?: string;
  quantidade?: number;
  estoqueMinimo?: number;
  /** Custo unitario em reais (como o cadastro grava). */
  precoCusto?: number;
  fornecedor?: string;
  ativo?: boolean;
  /** Reservado por ordens de producao em andamento (a tela calcula). */
  reservado?: number;
}

export type FiltroEstoqueMateriaPrima = '' | 'abaixo_minimo' | 'sem_estoque' | 'com_estoque';

export interface FiltroMateriasPrimas {
  /** '' = todas. */
  categoria: string;
  fornecedor: string;
  estoque: FiltroEstoqueMateriaPrima;
}

export const FILTRO_MATERIAS_PRIMAS_VAZIO: FiltroMateriasPrimas = { categoria: '', fornecedor: '', estoque: '' };

export const ROTULO_FILTRO_ESTOQUE: Record<Exclude<FiltroEstoqueMateriaPrima, ''>, string> = {
  abaixo_minimo: 'Abaixo do mínimo',
  sem_estoque: 'Sem estoque',
  com_estoque: 'Com estoque',
};

const qtd = (m: MateriaPrimaDoRelatorio): number => Number(m.quantidade || 0) || 0;

/** Mesma regra da lista: minimo informado e quantidade igual ou menor que ele. */
export const abaixoDoMinimoMp = (m: MateriaPrimaDoRelatorio): boolean => Number(m.estoqueMinimo || 0) > 0 && qtd(m) <= Number(m.estoqueMinimo || 0);

/** Valor parado em estoque, em centavos (quantidade x custo). Saldo negativo nao vale nada. */
export const valorEmEstoqueMpCentavos = (m: MateriaPrimaDoRelatorio): number => toCents(Math.max(0, qtd(m)) * (Number(m.precoCusto || 0) || 0));

export const quantosFiltrosMp = (f: FiltroMateriasPrimas): number => (f.categoria ? 1 : 0) + (f.fornecedor ? 1 : 0) + (f.estoque ? 1 : 0);

const textoLimpo = (texto: unknown): string => String(texto ?? '').trim();

export const passaNoFiltroMp = (m: MateriaPrimaDoRelatorio, f: FiltroMateriasPrimas): boolean => {
  if (f.categoria && textoLimpo(m.categoria) !== f.categoria) return false;
  if (f.fornecedor && textoLimpo(m.fornecedor) !== f.fornecedor) return false;
  if (f.estoque === 'abaixo_minimo' && !abaixoDoMinimoMp(m)) return false;
  if (f.estoque === 'sem_estoque' && qtd(m) > 0) return false;
  if (f.estoque === 'com_estoque' && qtd(m) <= 0) return false;
  return true;
};

/** Categorias e fornecedores que existem nos cadastros, para os selects do filtro. */
export const opcoesDosFiltrosMp = (materias: MateriaPrimaDoRelatorio[]): { categorias: string[]; fornecedores: string[] } => {
  const unicos = (valores: string[]) => [...new Set(valores.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  return {
    categorias: unicos(materias.map((m) => textoLimpo(m.categoria))),
    fornecedores: unicos(materias.map((m) => textoLimpo(m.fornecedor))),
  };
};

const quantidadeBr = (n: number | undefined): string => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(Number(n || 0));

const moeda = (centavos: number): string => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(centavos / 100);

interface CategoriaDoResumo {
  categoria: string;
  itens: number;
  abaixo: number;
  valorCentavos: number;
}

export const resumoPorCategoriaMp = (materias: MateriaPrimaDoRelatorio[]): CategoriaDoResumo[] => {
  const mapa = new Map<string, CategoriaDoResumo>();
  materias.forEach((m) => {
    const categoria = textoLimpo(m.categoria) || 'Sem categoria';
    const atual = mapa.get(categoria) || { categoria, itens: 0, abaixo: 0, valorCentavos: 0 };
    atual.itens += 1;
    if (abaixoDoMinimoMp(m)) atual.abaixo += 1;
    atual.valorCentavos += valorEmEstoqueMpCentavos(m);
    mapa.set(categoria, atual);
  });
  return [...mapa.values()].sort((a, b) => b.valorCentavos - a.valorCentavos || a.categoria.localeCompare(b.categoria, 'pt-BR'));
};

export interface DocumentoMateriasPrimas {
  titulo: string;
  periodo: string;
  filtros: string[];
  indicadores: IndicadorRelatorio[];
  secoes: SecaoRelatorio[];
}

export const montarDocumentoMateriasPrimas = (
  materias: MateriaPrimaDoRelatorio[],
  opcoes: { filtrosAplicados: string[]; dataHoje: string },
): DocumentoMateriasPrimas => {
  const total = materias.reduce((soma, m) => soma + valorEmEstoqueMpCentavos(m), 0);
  const abaixo = materias.filter(abaixoDoMinimoMp).length;
  const emProducao = materias.filter((m) => Number(m.reservado || 0) > 0).length;

  const colunas: ColunaRelatorio<MateriaPrimaDoRelatorio>[] = [
    { id: 'codigo', titulo: 'Código', tipo: 'texto', largura: 16, valor: (m) => m.codigo || '' },
    { id: 'nome', titulo: 'Matéria-prima', tipo: 'texto', largura: 60, valor: (m) => m.nome || '' },
    { id: 'categoria', titulo: 'Categoria', tipo: 'texto', largura: 30, valor: (m) => m.categoria || '' },
    { id: 'unidade', titulo: 'Un.', tipo: 'texto', largura: 12, valor: (m) => m.unidade || 'UN' },
    { id: 'quantidade', titulo: 'Em estoque', tipo: 'texto', largura: 22, valor: (m) => quantidadeBr(m.quantidade) },
    { id: 'reservado', titulo: 'Reservado em produção', tipo: 'texto', largura: 24, padrao: false, valor: (m) => (Number(m.reservado || 0) > 0 ? quantidadeBr(m.reservado) : '') },
    {
      id: 'previsto', titulo: 'Estoque previsto', tipo: 'texto', largura: 22, padrao: false,
      valor: (m) => quantidadeBr(Math.max(0, qtd(m) - Number(m.reservado || 0))),
    },
    { id: 'minimo', titulo: 'Mínimo', tipo: 'texto', largura: 18, padrao: false, valor: (m) => quantidadeBr(m.estoqueMinimo) },
    { id: 'custo', titulo: 'Custo unitário', tipo: 'moeda', total: 'nenhum', valor: (m) => toCents(Number(m.precoCusto || 0) || 0) },
    { id: 'valor', titulo: 'Valor em estoque', tipo: 'moeda', valor: valorEmEstoqueMpCentavos },
    { id: 'fornecedor', titulo: 'Fornecedor', tipo: 'texto', largura: 40, padrao: false, valor: (m) => m.fornecedor || '' },
    {
      id: 'situacao', titulo: 'Situação', tipo: 'texto', largura: 22,
      valor: (m) => (m.ativo === false ? 'Inativa' : (abaixoDoMinimoMp(m) ? 'Abaixo do mínimo' : 'Ok')),
    },
  ];

  const colunasCategoria: ColunaRelatorio<CategoriaDoResumo>[] = [
    { id: 'categoria', titulo: 'Categoria', tipo: 'texto', largura: 60, valor: (c) => c.categoria },
    { id: 'itens', titulo: 'Itens', tipo: 'inteiro', valor: (c) => c.itens },
    { id: 'abaixo', titulo: 'Abaixo do mínimo', tipo: 'inteiro', valor: (c) => c.abaixo },
    { id: 'valor', titulo: 'Valor em estoque', tipo: 'moeda', valor: (c) => c.valorCentavos },
  ];

  return {
    titulo: 'Relatório de Matéria-Prima',
    periodo: `Posição em ${opcoes.dataHoje.split('-').reverse().join('/')}`,
    filtros: opcoes.filtrosAplicados,
    indicadores: [
      { rotulo: 'Matérias-primas', valor: String(materias.length) },
      { rotulo: 'Valor em estoque', valor: moeda(total) },
      { rotulo: 'Abaixo do mínimo', valor: String(abaixo) },
      { rotulo: 'Em produção', valor: String(emProducao) },
    ],
    secoes: [
      {
        id: 'materias', titulo: 'Matérias-primas', colunas, linhas: materias, opcional: true, padrao: true,
        unidade: ['matéria-prima', 'matérias-primas'], mensagemVazia: 'Nenhuma matéria-prima com esses filtros.',
      } as SecaoRelatorio,
      {
        id: 'categorias', titulo: 'Por categoria', colunas: colunasCategoria, linhas: resumoPorCategoriaMp(materias), opcional: true, padrao: false,
        unidade: ['categoria', 'categorias'], mensagemVazia: 'Nenhuma matéria-prima com esses filtros.',
      } as SecaoRelatorio,
    ],
  };
};
