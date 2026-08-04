/**
 * Calculos puros do Modulo 4 (Producao) que nao dependem do Firestore --
 * a leitura/escrita de dados fica nos hooks/telas que chamam essas
 * funcoes (ex: src/hooks/useReservedRawMaterialStock.ts).
 */

export interface OrdemAtivaResumo {
  produtoId: string;
  quantidadePlanejada: number;
}

export interface ItemComposicaoResumo {
  materiaPrimaId: string;
  /** Quantidade da materia-prima consumida por UNIDADE do produto acabado. */
  quantidade: number;
}

/**
 * Soma, por materia-prima, quanto esta reservado pelas ordens de
 * producao ATIVAS (status 'em_producao') que a consomem -- usa a
 * quantidade PLANEJADA de cada ordem, nao a produzida (que so existe na
 * finalizacao). "Reservado" aqui e uma estimativa de quanto vai ser
 * debitado quando essas ordens finalizarem, pra dar visibilidade de
 * "estoque previsto" no cadastro de materia-prima.
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
      const reservadoParaEsteItem = item.quantidade * ordem.quantidadePlanejada;
      const acumulado = reservedMap.get(item.materiaPrimaId) || 0;
      reservedMap.set(item.materiaPrimaId, acumulado + reservadoParaEsteItem);
    }
  }

  return reservedMap;
};

/** Estoque previsto = estoque atual - reservado (nunca negativo na exibicao). */
export const computeEstoquePrevisto = (estoqueAtual: number, reservado: number): number => (
  Math.max(0, estoqueAtual - reservado)
);
