/**
 * Calculos puros do Modulo 4 (Producao) que nao dependem do Firestore --
 * a leitura/escrita de dados fica nos hooks/telas que chamam essas
 * funcoes (ex: src/hooks/useReservedRawMaterialStock.ts).
 */

/**
 * De onde vem um componente de composicao.
 *
 * O sistema tem DUAS colecoes com saldo proprio, e as duas podem entrar
 * numa receita:
 *
 * - `materia_prima` (colecao `materias_primas`): insumo puro -- entra
 *   comprado, sai consumido, nunca e' vendido.
 * - `estoque` (colecao `estoque`): item que tem saldo e pode ser vendido
 *   OU produzido. Inclui o semiacabado (marcado `produtoRevenda: false`,
 *   controlado mas fora da venda) e o granel que a empresa vende no
 *   varejo e tambem consome na propria producao.
 *
 * O caso que obrigou isso: granel do tipo "CORN SUGAR MASCAVO KG" e'
 * vendido no balcao e entra na granola. Duplicar o cadastro em
 * `materias_primas` daria dois saldos independentes pro mesmo produto
 * fisico -- estoque errado no primeiro mes. Com `origem`, o item
 * continua sendo UM cadastro com UM saldo.
 */
export type OrigemComponente = 'materia_prima' | 'estoque';

export const COLECAO_POR_ORIGEM: Record<OrigemComponente, string> = {
  materia_prima: 'materias_primas',
  estoque: 'estoque',
};

export const ROTULO_POR_ORIGEM: Record<OrigemComponente, string> = {
  materia_prima: 'Matéria-prima',
  estoque: 'Produto',
};

/** Um item da receita, como fica gravado em `produtos_composicao.itens[]`. */
export interface ComponenteComposicao {
  /** Id do documento na colecao indicada por `origem`. */
  componenteId: string;
  componenteNome: string;
  origem: OrigemComponente;
  unidade: string;
  /** Quantidade consumida por UNIDADE do produto acabado. */
  quantidade: number;
}

/**
 * Le um item gravado em `produtos_composicao.itens[]` ou em
 * `ordens_producao.itensConsumidos[]`, aceitando o formato antigo.
 *
 * Antes da composicao aceitar componente vindo do Estoque, todo item era
 * matéria-prima e os campos se chamavam `materiaPrimaId`/
 * `materiaPrimaNome`, sem `origem`. Documento antigo, portanto, le como
 * `origem: 'materia_prima'` -- nao ha nada a migrar, e receita gravada
 * antes desta mudanca continua funcionando igual.
 */
export const normalizarComponente = (item: any): ComponenteComposicao => ({
  componenteId: String(item?.componenteId ?? item?.materiaPrimaId ?? ''),
  componenteNome: String(item?.componenteNome ?? item?.materiaPrimaNome ?? ''),
  origem: item?.origem === 'estoque' ? 'estoque' : 'materia_prima',
  unidade: String(item?.unidade || 'UN'),
  quantidade: Number(item?.quantidade || 0),
});

/** Em qual colecao do Firestore esse componente tem saldo. */
export const colecaoDoComponente = (origem: OrigemComponente): string => COLECAO_POR_ORIGEM[origem];

/**
 * Chave unica de um componente. Id de `materias_primas` e id de `estoque`
 * vem de colecoes diferentes e podem coincidir -- somar os dois no mesmo
 * balde daria reserva errada, por isso a origem entra na chave.
 */
export const chaveComponente = (origem: OrigemComponente, componenteId: string): string => (
  `${origem}:${componenteId}`
);

export interface OrdemAtivaResumo {
  produtoId: string;
  quantidadePlanejada: number;
}

export interface ItemComposicaoResumo {
  componenteId: string;
  origem: OrigemComponente;
  /** Quantidade do componente consumida por UNIDADE do produto acabado. */
  quantidade: number;
}

/**
 * Soma, por componente, quanto esta reservado pelas ordens de producao
 * ATIVAS (status 'em_producao') que o consomem -- usa a quantidade
 * PLANEJADA de cada ordem, nao a produzida (que so existe na
 * finalizacao). "Reservado" aqui e uma estimativa de quanto vai ser
 * debitado quando essas ordens finalizarem, pra dar visibilidade de
 * "estoque previsto" no cadastro.
 *
 * O mapa e' indexado por `chaveComponente(origem, id)`, nao pelo id cru.
 */
export const computeReservedRawMaterialMap = (
  activeOrders: OrdemAtivaResumo[],
  compositionsByProdutoId: Record<string, ItemComposicaoResumo[]>,
): Map<string, number> => {
  const reservedMap = new Map<string, number>();

  for (const ordem of activeOrders) {
    const itensComposicao = compositionsByProdutoId[ordem.produtoId];
    if (!itensComposicao || itensComposicao.length === 0) continue;

    for (const item of itensComposicao) {
      const chave = chaveComponente(item.origem, item.componenteId);
      const reservadoParaEsteItem = item.quantidade * ordem.quantidadePlanejada;
      const acumulado = reservedMap.get(chave) || 0;
      reservedMap.set(chave, acumulado + reservadoParaEsteItem);
    }
  }

  return reservedMap;
};

/** Estoque previsto = estoque atual - reservado (nunca negativo na exibicao). */
export const computeEstoquePrevisto = (estoqueAtual: number, reservado: number): number => (
  Math.max(0, estoqueAtual - reservado)
);
