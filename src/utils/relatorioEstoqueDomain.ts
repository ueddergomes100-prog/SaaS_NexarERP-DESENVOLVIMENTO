import { toCents } from './financeDomain';
import { ROTULO_POR_ORIGEM, type ComponenteComposicao } from './producaoDomain';
import {
  formatarDataRelatorio,
  type ColunaRelatorio,
  type IndicadorRelatorio,
  type SecaoRelatorio,
} from './relatorioPdfDomain';

/*
 * RELATORIO DE ESTOQUE (posicao atual) -- padrao de relatorio do sistema
 * (decisao do dono, 2026-09-23 e 2026-10-02): abre na tela como PDF, com as
 * colunas escolhidas por caixa de marcar no RelatorioPreview.
 *
 * Regra pura: recebe os produtos ja lidos do Firestore e devolve os filtrados
 * (a tabela da tela usa a mesma lista) e o documento do relatorio. As contas
 * sao as mesmas do relatorio antigo (CSV):
 *   - valor em estoque = quantidade x custo (sem custo, usa o preco de venda);
 *   - estoque baixo = tem saldo, tem minimo e o saldo esta no minimo ou abaixo;
 *   - esgotado = saldo zerado ou negativo.
 */

export interface ProdutoDoRelatorioEstoque {
  id: string;
  nome: string;
  codigo: string;
  categoria: string;
  marca: string;
  ncm: string;
  codigoBarras: string;
  referencia: string;
  localizacao: string;
  quantidade: number;
  estoqueMinimo: number;
  /** Em reais, como gravado no cadastro. */
  precoVenda: number;
  precoCusto: number;
  /** `precoAVista ?? precos.aVista`; null quando o produto nao tem preco a vista. */
  precoAVista: number | null;
  unidadeMedidaSigla?: string;
  ativo: boolean;
  produtoRevenda: boolean;
  /** Data de CADASTRO do produto (createdAt); null quando nao foi gravada. */
  cadastradoEm: Date | null;
}

export interface FiltroRelatorioEstoque {
  /**
   * Posicao atual: ignora o periodo. Relatorio de estoque e' quanto tem HOJE;
   * o periodo filtra pela data de cadastro e so' vale quando desmarcado.
   */
  ignorarPeriodo: boolean;
  inicio: Date;
  fim: Date;
  categoria: string;
  ncm: string;
  texto: string;
  apenasAtivos: boolean;
}

/** Produtos que passam nos filtros da tela (antes dos desmarcados um a um). */
export const produtosDoRelatorioEstoque = (
  produtos: ProdutoDoRelatorioEstoque[],
  filtro: FiltroRelatorioEstoque,
): ProdutoDoRelatorioEstoque[] => {
  const termo = filtro.texto.trim().toLowerCase();
  const ncm = filtro.ncm.trim();
  const inicio = filtro.inicio.getTime();
  const fim = filtro.fim.getTime();
  return produtos.filter((produto) => {
    if (filtro.apenasAtivos && !produto.ativo) return false;
    if (!filtro.ignorarPeriodo && produto.cadastradoEm) {
      const quando = produto.cadastradoEm.getTime();
      if (quando < inicio || quando > fim) return false;
    }
    if (filtro.categoria && produto.categoria !== filtro.categoria) return false;
    if (ncm && !produto.ncm.includes(ncm)) return false;
    if (termo && !`${produto.nome} ${produto.codigo} ${produto.marca}`.toLowerCase().includes(termo)) return false;
    return true;
  });
};

/** Base do valor em estoque: custo; sem custo, o preco de venda. */
const valorUnitarioDeEstoque = (p: ProdutoDoRelatorioEstoque): number => p.precoCusto || p.precoVenda || 0;

/** Valor do item em estoque, em centavos (quantidade x custo). */
export const valorEmEstoqueCentavos = (p: ProdutoDoRelatorioEstoque): number => toCents(p.quantidade * valorUnitarioDeEstoque(p));

export interface ResumoRelatorioEstoque {
  total: number;
  valorEstoqueCentavos: number;
  estoqueBaixo: number;
  esgotados: number;
}

export const resumirRelatorioEstoque = (selecionados: ProdutoDoRelatorioEstoque[]): ResumoRelatorioEstoque => ({
  total: selecionados.length,
  valorEstoqueCentavos: selecionados.reduce((soma, p) => soma + valorEmEstoqueCentavos(p), 0),
  estoqueBaixo: selecionados.filter((p) => p.quantidade > 0 && p.estoqueMinimo > 0 && p.quantidade <= p.estoqueMinimo).length,
  esgotados: selecionados.filter((p) => p.quantidade <= 0).length,
});

/** Linha da secao de composicao: um componente da receita de um produto. */
export interface LinhaComposicaoEstoque {
  produtoId: string;
  produtoNome: string;
  produtoCodigo: string;
  produtoUnidade: string;
  componenteNome: string;
  origem: string;
  quantidade: number;
  unidade: string;
}

export const linhasDeComposicao = (
  selecionados: ProdutoDoRelatorioEstoque[],
  composicoes: Record<string, ComponenteComposicao[]>,
): LinhaComposicaoEstoque[] => selecionados.flatMap((p) => (composicoes[p.id] || []).map((item) => ({
  produtoId: p.id,
  produtoNome: p.nome,
  produtoCodigo: p.codigo,
  // Mesmo texto da tela antiga: receita "para 1 UN" quando o produto nao tem unidade.
  produtoUnidade: p.unidadeMedidaSigla || 'UN',
  componenteNome: item.componenteNome,
  origem: ROTULO_POR_ORIGEM[item.origem],
  quantidade: item.quantidade,
  unidade: item.unidade,
})));

/** Quantidade pode ser fracionada (KG, L): sai em pt-BR com ate 3 casas. */
export const formatarQuantidadeEstoque = (n: number): string => (
  new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(Number(n || 0))
);

const moeda = (valorCentavos: number): string => (
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valorCentavos / 100)
);

export interface EntradaDocumentoRelatorioEstoque {
  /** Resultado dos filtros da tela. */
  filtrados: ProdutoDoRelatorioEstoque[];
  /** Ids desmarcados um a um na tabela da tela. */
  desmarcados: Set<string>;
  composicoes: Record<string, ComponenteComposicao[]>;
  filtro: FiltroRelatorioEstoque;
  /** Momento da posicao (hoje), para o cabecalho. */
  agora: Date;
}

export interface DocumentoRelatorioEstoque {
  titulo: string;
  periodo: string;
  filtros: string[];
  indicadores: IndicadorRelatorio[];
  secoes: SecaoRelatorio[];
}

/** Monta o documento (sem empresa/geradoPor, que o RelatorioPreview acrescenta). */
export const montarDocumentoRelatorioEstoque = ({
  filtrados, desmarcados, composicoes, filtro, agora,
}: EntradaDocumentoRelatorioEstoque): DocumentoRelatorioEstoque => {
  const selecionados = filtrados.filter((p) => !desmarcados.has(p.id));
  const resumo = resumirRelatorioEstoque(selecionados);
  const quantidade = (n: number) => formatarQuantidadeEstoque(n);

  const colunasProdutos: ColunaRelatorio<ProdutoDoRelatorioEstoque>[] = [
    {
      id: 'produto', titulo: 'Produto', tipo: 'texto', largura: 62,
      valor: (p) => `${p.nome}${p.produtoRevenda ? '' : ' (uso interno)'}`,
    },
    { id: 'codigo', titulo: 'Código', tipo: 'texto', largura: 22, valor: (p) => p.codigo },
    // Texto porque o saldo pode ser fracionado; sem total (soma de KG com UN nao diz nada).
    { id: 'quantidade', titulo: 'Quantidade', tipo: 'texto', largura: 20, total: 'nenhum', valor: (p) => quantidade(p.quantidade) },
    { id: 'unidade', titulo: 'Unidade', tipo: 'texto', largura: 14, valor: (p) => p.unidadeMedidaSigla || '' },
    { id: 'categoria', titulo: 'Categoria', tipo: 'texto', largura: 30, valor: (p) => p.categoria },
    { id: 'marca', titulo: 'Marca', tipo: 'texto', largura: 26, padrao: false, valor: (p) => p.marca },
    { id: 'referencia', titulo: 'Referência', tipo: 'texto', largura: 24, padrao: false, valor: (p) => p.referencia },
    { id: 'localizacao', titulo: 'Localização', tipo: 'texto', largura: 24, padrao: false, valor: (p) => p.localizacao },
    { id: 'estoqueMinimo', titulo: 'Estoque mínimo', tipo: 'texto', largura: 18, total: 'nenhum', padrao: false, valor: (p) => quantidade(p.estoqueMinimo) },
    // Custo e precos sao por unidade: somar entre produtos nao faz sentido.
    { id: 'custo', titulo: 'Custo', tipo: 'moeda', total: 'nenhum', padrao: false, valor: (p) => toCents(p.precoCusto) },
    { id: 'preco', titulo: 'Preço de venda', tipo: 'moeda', total: 'nenhum', valor: (p) => toCents(p.precoVenda) },
    {
      id: 'precoAVista', titulo: 'Preço à vista', tipo: 'moeda', total: 'nenhum', padrao: false,
      valor: (p) => (p.precoAVista === null ? null : toCents(p.precoAVista)),
    },
    { id: 'valorTotal', titulo: 'Valor total', tipo: 'moeda', padrao: false, valor: valorEmEstoqueCentavos },
    { id: 'ncm', titulo: 'NCM', tipo: 'texto', largura: 20, padrao: false, valor: (p) => p.ncm },
    { id: 'codigoBarras', titulo: 'Código de barras', tipo: 'texto', largura: 30, padrao: false, valor: (p) => p.codigoBarras },
  ];

  const colunasComposicao: ColunaRelatorio<LinhaComposicaoEstoque>[] = [
    { id: 'componente', titulo: 'Componente', tipo: 'texto', largura: 70, valor: (l) => l.componenteNome },
    { id: 'origem', titulo: 'Origem', tipo: 'texto', largura: 26, valor: (l) => l.origem },
    { id: 'quantidade', titulo: 'Quantidade', tipo: 'texto', largura: 20, total: 'nenhum', valor: (l) => quantidade(l.quantidade) },
    { id: 'unidade', titulo: 'Unidade', tipo: 'texto', largura: 14, valor: (l) => l.unidade },
  ];

  const filtros: string[] = [];
  if (filtro.texto.trim()) filtros.push(`Busca: ${filtro.texto.trim()}`);
  if (filtro.categoria) filtros.push(`Categoria: ${filtro.categoria}`);
  if (filtro.ncm.trim()) filtros.push(`NCM: ${filtro.ncm.trim()}`);
  filtros.push(filtro.apenasAtivos ? 'Somente produtos ativos' : 'Produtos ativos e inativos');
  const foraDoRelatorio = filtrados.length - selecionados.length;
  if (foraDoRelatorio > 0) {
    filtros.push(`${foraDoRelatorio} ${foraDoRelatorio === 1 ? 'produto desmarcado' : 'produtos desmarcados'} na tela`);
  }

  return {
    titulo: 'Relatório de Estoque',
    periodo: filtro.ignorarPeriodo
      ? `Posição atual em ${formatarDataRelatorio(agora, true)}`
      : `Produtos cadastrados de ${formatarDataRelatorio(filtro.inicio)} a ${formatarDataRelatorio(filtro.fim)}`,
    filtros,
    indicadores: [
      { rotulo: 'Itens no relatório', valor: String(resumo.total) },
      { rotulo: 'Valor em estoque (quantidade × custo)', valor: moeda(resumo.valorEstoqueCentavos) },
      { rotulo: 'Estoque baixo', valor: String(resumo.estoqueBaixo) },
      { rotulo: 'Esgotados', valor: String(resumo.esgotados) },
    ],
    secoes: [
      {
        id: 'produtos', titulo: 'Posição do estoque', colunas: colunasProdutos, linhas: selecionados,
        unidade: ['produto', 'produtos'], mensagemVazia: 'Nenhum produto encontrado para os filtros selecionados.',
      } as SecaoRelatorio,
      {
        id: 'composicao', titulo: 'Composição (receita)', colunas: colunasComposicao,
        linhas: linhasDeComposicao(selecionados, composicoes),
        opcional: true, padrao: false, unidade: ['componente', 'componentes'],
        mensagemVazia: 'Nenhum produto do relatório tem composição cadastrada.',
        agruparPor: {
          chave: (l: LinhaComposicaoEstoque) => l.produtoId,
          rotulo: (l: LinhaComposicaoEstoque) => `${l.produtoNome}${l.produtoCodigo ? ` (${l.produtoCodigo})` : ''} — composição para 1 ${l.produtoUnidade}`,
        },
      } as SecaoRelatorio,
    ],
  };
};
