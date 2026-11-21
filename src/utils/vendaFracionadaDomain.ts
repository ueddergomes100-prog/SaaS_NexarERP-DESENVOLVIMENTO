/**
 * VENDA FRACIONADA DO PRODUTO E A UNIDADE DE MEDIDA (21/11/2026).
 *
 * Caso real (Jomarly, produto 2923 AREIA METRO, unidade M3): a unidade estava
 * marcada como "Fracionada" na tela de Unidades, mas a venda de 0,5 m3 era
 * recusada com "a unidade M3 nao permite venda fracionada".
 *
 * Por que: cada produto guarda uma COPIA da configuracao da unidade
 * (`unidadeMedidaFracionado` e `unidadeMedidaCasasDecimais`), feita quando o
 * produto e' salvo ou importado. Mudar a unidade depois nao mexia nos
 * produtos que ja' a usavam -- a copia ficava velha e a venda lia a copia.
 *
 * A regra de quem pode vender fracionado continua a mesma do cadastro do
 * produto (EstoqueForm.tsx): a unidade precisa permitir E o produto precisa
 * estar marcado como "Produto fracionado" (uma unidade fracionavel como KG
 * nao obriga todo produto nela a vender fracionado).
 */

export interface ProdutoComUnidade {
  unidadeMedidaId?: unknown;
  unidadeMedidaSigla?: unknown;
  unidadeMedidaFracionado?: unknown;
  unidadeMedidaCasasDecimais?: unknown;
  produtoFracionado?: unknown;
  estoqueConfig?: unknown;
}

export interface UnidadeDeMedida {
  permiteFracionado?: unknown;
  casasDecimais?: unknown;
}

/**
 * A marca "Produto fracionado" do proprio produto. Mesma leitura do cadastro:
 * o campo do produto, senao o da configuracao de estoque; produto antigo sem
 * nenhum dos dois conta como fracionado se a copia da unidade dizia que sim.
 */
export const fracionadoProprioDoProduto = (produto: ProdutoComUnidade): boolean => {
  if (typeof produto.produtoFracionado === 'boolean') return produto.produtoFracionado;
  const config = produto.estoqueConfig && typeof produto.estoqueConfig === 'object'
    ? (produto.estoqueConfig as { fracionado?: unknown })
    : {};
  if (typeof config.fracionado === 'boolean') return config.fracionado;
  return produto.unidadeMedidaFracionado === true;
};

const casasDaUnidade = (unidade: UnidadeDeMedida): number => {
  const n = Math.trunc(Number(unidade.casasDecimais));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 6) : 0;
};

/**
 * O que muda na copia que o produto guarda quando a unidade dele muda.
 * Objeto vazio = nada a gravar.
 */
export const mudancasDoProdutoPelaUnidade = (
  produto: ProdutoComUnidade,
  unidade: UnidadeDeMedida,
): { unidadeMedidaFracionado?: boolean; unidadeMedidaCasasDecimais?: number } => {
  const mudancas: { unidadeMedidaFracionado?: boolean; unidadeMedidaCasasDecimais?: number } = {};
  const fracionado = unidade.permiteFracionado === true && fracionadoProprioDoProduto(produto);
  if ((produto.unidadeMedidaFracionado === true) !== fracionado) mudancas.unidadeMedidaFracionado = fracionado;
  const casas = casasDaUnidade(unidade);
  if (Number(produto.unidadeMedidaCasasDecimais) !== casas) mudancas.unidadeMedidaCasasDecimais = casas;
  return mudancas;
};

/** Mudou algo na unidade que os produtos copiam? */
export const unidadeMudouParaOsProdutos = (antes: UnidadeDeMedida | null | undefined, depois: UnidadeDeMedida): boolean => (
  !antes
  || (antes.permiteFracionado === true) !== (depois.permiteFracionado === true)
  || casasDaUnidade(antes) !== casasDaUnidade(depois)
);

/**
 * Mensagem da venda quando a quantidade quebrada e' recusada. Diz o que fazer
 * nos dois casos possiveis, porque a tela de venda nao sabe se o problema e' a
 * unidade ou a marca do produto.
 */
export const mensagemQuantidadeInteira = (nome: unknown, sigla: unknown): string => {
  const produto = String(nome ?? '').trim() || 'Este produto';
  const unidade = String(sigla ?? '').trim() || 'UN';
  return `${produto} não aceita quantidade quebrada na unidade ${unidade}. Use uma quantidade inteira. `
    + `Se ele é vendido fracionado, confira em Estoque › Unidades de Medida se ${unidade} está como "Fracionada" `
    + 'e, no cadastro do produto, marque "Produto fracionado" e salve.';
};
