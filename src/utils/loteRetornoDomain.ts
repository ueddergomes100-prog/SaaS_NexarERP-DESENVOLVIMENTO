/*
 * DEVOLVER AO MESMO LOTE (separado de loteDomain.ts em 19/10/2026).
 *
 * Cancelamento, devolucao e estorno devolvem ao MESMO lote de onde a venda
 * tirou. A regra mora aqui, sem dependencia nenhuma, para o servidor usar a
 * mesma conta da tela (server/domain, gerado por build-server-domain.mjs) sem
 * carregar o dominio inteiro de lotes. loteDomain.ts e loteBaixaService.ts
 * reexportam daqui: quem ja' importava de la continua igual.
 */

export interface LoteUsado {
  loteId: string;
  lote: string;
  validade: string | null;
  /** Unidade base do estoque. */
  quantidade: number;
}

/**
 * Devolucao/estorno: devolve ao MESMO lote de onde a venda tirou. Considera as `jaDevolvida`
 * unidades que ja voltaram (na ordem em que foram tiradas) e devolve `quantidade` a partir dali.
 * A parte que a venda tirou do saldo sem lote volta para o saldo sem lote (fica so' no estoque).
 */
export const distribuirRetornoAosLotes = (lotesDoItem: LoteUsado[], jaDevolvida: number, quantidade: number): LoteUsado[] => {
  let pular = Math.max(0, Number(jaDevolvida) || 0);
  let devolver = Math.max(0, Number(quantidade) || 0);
  const saida: LoteUsado[] = [];
  for (const lote of lotesDoItem) {
    if (devolver <= 0) break;
    let disponivel = Number(lote.quantidade) || 0;
    if (pular > 0) {
      const descartado = Math.min(pular, disponivel);
      pular = Math.round((pular - descartado) * 10000) / 10000;
      disponivel = Math.round((disponivel - descartado) * 10000) / 10000;
    }
    if (disponivel <= 0) continue;
    const volta = Math.round(Math.min(devolver, disponivel) * 10000) / 10000;
    devolver = Math.round((devolver - volta) * 10000) / 10000;
    saida.push({ ...lote, quantidade: volta });
  }
  return saida;
};

/** Soma o que varias linhas tiraram do MESMO lote (uma escrita por lote na transacao). */
export const somarLotesUsados = (listas: LoteUsado[][]): LoteUsado[] => {
  const mapa = new Map<string, LoteUsado>();
  listas.flat().forEach((l) => {
    const atual = mapa.get(l.loteId);
    mapa.set(l.loteId, atual ? { ...atual, quantidade: Math.round((atual.quantidade + l.quantidade) * 10000) / 10000 } : { ...l });
  });
  return [...mapa.values()];
};

/** Itens gravados de uma venda -> o que volta para cada lote quando a venda inteira e' cancelada. */
export const devolucaoTotalDosLotes = (itensDaVenda: unknown): Array<{ lotes?: LoteUsado[]; jaDevolvido: number; quantidade: number }> => (
  (Array.isArray(itensDaVenda) ? itensDaVenda : [])
    .filter((item) => Array.isArray(item?.lotes) && item.lotes.length > 0)
    .map((item) => ({
      lotes: item.lotes as LoteUsado[],
      jaDevolvido: 0,
      quantidade: (item.lotes as LoteUsado[]).reduce((soma, l) => soma + Number(l.quantidade || 0), 0),
    }))
);

/** O que volta para cada lote no cancelamento total (uma entrada por lote). */
export const lotesQueVoltamNoCancelamento = (itensDaVenda: unknown): LoteUsado[] => (
  somarLotesUsados(devolucaoTotalDosLotes(itensDaVenda).map((d) => distribuirRetornoAosLotes(d.lotes || [], d.jaDevolvido, d.quantidade)))
);
