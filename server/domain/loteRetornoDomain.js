"use strict";
/*
 * DEVOLVER AO MESMO LOTE (separado de loteDomain.ts em 19/10/2026).
 *
 * Cancelamento, devolucao e estorno devolvem ao MESMO lote de onde a venda
 * tirou. A regra mora aqui, sem dependencia nenhuma, para o servidor usar a
 * mesma conta da tela (server/domain, gerado por build-server-domain.mjs) sem
 * carregar o dominio inteiro de lotes. loteDomain.ts e loteBaixaService.ts
 * reexportam daqui: quem ja' importava de la continua igual.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.lotesQueVoltamNoCancelamento = exports.devolucaoTotalDosLotes = exports.somarLotesUsados = exports.distribuirRetornoAosLotes = void 0;
/**
 * Devolucao/estorno: devolve ao MESMO lote de onde a venda tirou. Considera as `jaDevolvida`
 * unidades que ja voltaram (na ordem em que foram tiradas) e devolve `quantidade` a partir dali.
 * A parte que a venda tirou do saldo sem lote volta para o saldo sem lote (fica so' no estoque).
 */
const distribuirRetornoAosLotes = (lotesDoItem, jaDevolvida, quantidade) => {
    let pular = Math.max(0, Number(jaDevolvida) || 0);
    let devolver = Math.max(0, Number(quantidade) || 0);
    const saida = [];
    for (const lote of lotesDoItem) {
        if (devolver <= 0)
            break;
        let disponivel = Number(lote.quantidade) || 0;
        if (pular > 0) {
            const descartado = Math.min(pular, disponivel);
            pular = Math.round((pular - descartado) * 10000) / 10000;
            disponivel = Math.round((disponivel - descartado) * 10000) / 10000;
        }
        if (disponivel <= 0)
            continue;
        const volta = Math.round(Math.min(devolver, disponivel) * 10000) / 10000;
        devolver = Math.round((devolver - volta) * 10000) / 10000;
        saida.push({ ...lote, quantidade: volta });
    }
    return saida;
};
exports.distribuirRetornoAosLotes = distribuirRetornoAosLotes;
/** Soma o que varias linhas tiraram do MESMO lote (uma escrita por lote na transacao). */
const somarLotesUsados = (listas) => {
    const mapa = new Map();
    listas.flat().forEach((l) => {
        const atual = mapa.get(l.loteId);
        mapa.set(l.loteId, atual ? { ...atual, quantidade: Math.round((atual.quantidade + l.quantidade) * 10000) / 10000 } : { ...l });
    });
    return [...mapa.values()];
};
exports.somarLotesUsados = somarLotesUsados;
/** Itens gravados de uma venda -> o que volta para cada lote quando a venda inteira e' cancelada. */
const devolucaoTotalDosLotes = (itensDaVenda) => ((Array.isArray(itensDaVenda) ? itensDaVenda : [])
    .filter((item) => Array.isArray(item?.lotes) && item.lotes.length > 0)
    .map((item) => ({
    lotes: item.lotes,
    jaDevolvido: 0,
    quantidade: item.lotes.reduce((soma, l) => soma + Number(l.quantidade || 0), 0),
})));
exports.devolucaoTotalDosLotes = devolucaoTotalDosLotes;
/** O que volta para cada lote no cancelamento total (uma entrada por lote). */
const lotesQueVoltamNoCancelamento = (itensDaVenda) => ((0, exports.somarLotesUsados)((0, exports.devolucaoTotalDosLotes)(itensDaVenda).map((d) => (0, exports.distribuirRetornoAosLotes)(d.lotes || [], d.jaDevolvido, d.quantidade))));
exports.lotesQueVoltamNoCancelamento = lotesQueVoltamNoCancelamento;
