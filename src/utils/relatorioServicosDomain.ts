import type { ColunaRelatorio, IndicadorRelatorio, SecaoRelatorio } from './relatorioPdfDomain';
import { toCents } from './financeDomain';

/*
 * RELATORIO DE SERVICOS (pedido do dono, 16/10/2026): a tabela de precos da
 * mao de obra para o balcao -- "Mais opcoes › Relatorio" na tela de
 * Servicos, no padrao dos outros relatorios. Sai o que esta filtrado na tela.
 *
 * Regra pura: sem tela, sem Firestore.
 */

export interface ServicoDoRelatorio {
  id: string;
  codigo?: string;
  nome?: string;
  categoria?: string;
  /** Valor/hora em reais (como o cadastro grava). */
  preco?: number;
  comissaoPercentual?: number | string | null;
  ativo?: boolean;
}

const textoLimpo = (texto: unknown): string => String(texto ?? '').trim();

/** Categorias que existem nos cadastros, em ordem, para o select do filtro. */
export const categoriasDosServicos = (servicos: ServicoDoRelatorio[]): string[] => (
  [...new Set(servicos.map((s) => textoLimpo(s.categoria)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
);

/** '' = todas as categorias. */
export const passaNaCategoria = (servico: ServicoDoRelatorio, categoria: string): boolean => !categoria || textoLimpo(servico.categoria) === categoria;

const comissaoTexto = (valor: unknown): string => {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? `${String(valor).replace('.', ',')}%` : '';
};

interface CategoriaDoResumo {
  categoria: string;
  servicos: number;
  menorCentavos: number;
  maiorCentavos: number;
}

export const resumoPorCategoriaServicos = (servicos: ServicoDoRelatorio[]): CategoriaDoResumo[] => {
  const mapa = new Map<string, CategoriaDoResumo>();
  servicos.forEach((s) => {
    const categoria = textoLimpo(s.categoria) || 'Sem categoria';
    const valor = toCents(Number(s.preco || 0) || 0);
    const atual = mapa.get(categoria);
    if (!atual) {
      mapa.set(categoria, { categoria, servicos: 1, menorCentavos: valor, maiorCentavos: valor });
      return;
    }
    atual.servicos += 1;
    atual.menorCentavos = Math.min(atual.menorCentavos, valor);
    atual.maiorCentavos = Math.max(atual.maiorCentavos, valor);
  });
  return [...mapa.values()].sort((a, b) => a.categoria.localeCompare(b.categoria, 'pt-BR'));
};

export interface DocumentoServicos {
  titulo: string;
  periodo: string;
  filtros: string[];
  indicadores: IndicadorRelatorio[];
  secoes: SecaoRelatorio[];
}

export const montarDocumentoServicos = (
  servicos: ServicoDoRelatorio[],
  opcoes: { filtrosAplicados: string[]; dataHoje: string },
): DocumentoServicos => {
  const ativos = servicos.filter((s) => s.ativo !== false).length;
  const porCategoria = resumoPorCategoriaServicos(servicos);

  const colunas: ColunaRelatorio<ServicoDoRelatorio>[] = [
    { id: 'codigo', titulo: 'Código', tipo: 'texto', largura: 16, valor: (s) => s.codigo || '' },
    { id: 'nome', titulo: 'Serviço', tipo: 'texto', largura: 80, valor: (s) => s.nome || '' },
    { id: 'categoria', titulo: 'Categoria', tipo: 'texto', largura: 36, valor: (s) => s.categoria || '' },
    // Tabela de precos: somar valores de servicos diferentes nao significa nada.
    { id: 'preco', titulo: 'Valor / hora', tipo: 'moeda', total: 'nenhum', valor: (s) => toCents(Number(s.preco || 0) || 0) },
    { id: 'comissao', titulo: 'Comissão', tipo: 'texto', largura: 18, padrao: false, valor: (s) => comissaoTexto(s.comissaoPercentual) },
    { id: 'situacao', titulo: 'Situação', tipo: 'texto', largura: 16, padrao: false, valor: (s) => (s.ativo === false ? 'Inativo' : 'Ativo') },
  ];

  const colunasCategoria: ColunaRelatorio<CategoriaDoResumo>[] = [
    { id: 'categoria', titulo: 'Categoria', tipo: 'texto', largura: 60, valor: (c) => c.categoria },
    { id: 'servicos', titulo: 'Serviços', tipo: 'inteiro', valor: (c) => c.servicos },
    { id: 'menor', titulo: 'Menor valor', tipo: 'moeda', total: 'nenhum', valor: (c) => c.menorCentavos },
    { id: 'maior', titulo: 'Maior valor', tipo: 'moeda', total: 'nenhum', valor: (c) => c.maiorCentavos },
  ];

  return {
    titulo: 'Tabela de Serviços',
    periodo: `Valores em ${opcoes.dataHoje.split('-').reverse().join('/')}`,
    filtros: opcoes.filtrosAplicados,
    indicadores: [
      { rotulo: 'Serviços', valor: String(servicos.length) },
      { rotulo: 'Ativos', valor: String(ativos) },
      { rotulo: 'Inativos', valor: String(servicos.length - ativos) },
      { rotulo: 'Categorias', valor: String(porCategoria.filter((c) => c.categoria !== 'Sem categoria').length) },
    ],
    secoes: [
      {
        id: 'servicos', titulo: 'Serviços', colunas, linhas: servicos, opcional: true, padrao: true,
        unidade: ['serviço', 'serviços'], mensagemVazia: 'Nenhum serviço com esses filtros.',
      } as SecaoRelatorio,
      {
        id: 'categorias', titulo: 'Por categoria', colunas: colunasCategoria, linhas: porCategoria, opcional: true, padrao: false,
        unidade: ['categoria', 'categorias'], mensagemVazia: 'Nenhum serviço com esses filtros.',
      } as SecaoRelatorio,
    ],
  };
};
