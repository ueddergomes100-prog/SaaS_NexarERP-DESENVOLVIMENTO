"use strict";
/*
 * CASHBACK (pedido do dono, 20/10/2026).
 *
 * A empresa escolhe o modelo nas Configuracoes da filial:
 *  - 'reais':  a venda PAGA gera saldo em R$ para o cliente, que entra como
 *              forma de pagamento na proxima venda (mesmo caminho do credito
 *              do cliente);
 *  - 'pontos': a venda PAGA gera pontos; nas proximas vendas o cliente troca
 *              os pontos por desconto, pelas faixas (X pontos = Y% de desconto).
 *
 * "Paga" e' a regra: a vista gera ao faturar; a prazo gera na baixa da ULTIMA
 * parcela (venda toda quitada). Cancelamento ou devolucao estorna o que a
 * venda gerou -- se o cliente ja' gastou, o saldo fica negativo e e' abatido
 * do proximo cashback.
 *
 * Quanto cada item gera: o produto precisa ter "Permitir cashback" marcado;
 * no modelo em R$ o produto pode ter percentual ou valor proprio, senao vale
 * o padrao da empresa; no modelo em pontos vale "pontos por real" da empresa.
 *
 * Este arquivo e' puro (sem Firestore): a tela calcula o que a venda vai
 * gerar para mostrar; o servidor calcula de novo na hora de gerar.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatarCashback = exports.parteProporcional = exports.abaterDoLote = exports.novoLoteComDivida = exports.resumoDosLotes = exports.loteVigente = exports.saldoDosMovimentos = exports.pontosParaProximaFaixa = exports.faixaAlcancada = exports.validadeDoCashback = exports.cashbackDaVenda = exports.lerConfigCashback = exports.lerFaixas = exports.parseConfigCashback = exports.ROTULO_MODELO_CASHBACK = exports.LIMITE_DE_FAIXAS = exports.DEFAULT_CONFIG_CASHBACK = void 0;
exports.DEFAULT_CONFIG_CASHBACK = {
    ativo: false,
    modelo: 'reais',
    tipoPadrao: 'percentual',
    valorPadrao: 0,
    validadeDias: null,
    pontosPorReal: 1,
    faixas: [],
};
exports.LIMITE_DE_FAIXAS = 10;
exports.ROTULO_MODELO_CASHBACK = {
    reais: 'Cashback em R$ (vira saldo para a próxima compra)',
    pontos: 'Pontos (troca por desconto pelas faixas)',
};
const numero = (v) => {
    const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
    return Number.isFinite(n) ? n : 0;
};
const inteiroPositivo = (v) => Math.max(0, Math.round(numero(v)));
const r2 = (v) => Math.round(v * 100) / 100;
/** Le a configuracao gravada em configuracoes/{filial}.cashback (ausente = desligado). */
const parseConfigCashback = (valor) => {
    if (!valor || typeof valor !== 'object')
        return exports.DEFAULT_CONFIG_CASHBACK;
    const c = valor;
    const validade = c.validadeDias === null || c.validadeDias === undefined || c.validadeDias === '' ? null : inteiroPositivo(c.validadeDias);
    return {
        ativo: c.ativo === true,
        modelo: c.modelo === 'pontos' ? 'pontos' : 'reais',
        tipoPadrao: c.tipoPadrao === 'valor' ? 'valor' : 'percentual',
        valorPadrao: Math.max(0, numero(c.valorPadrao)),
        validadeDias: validade && validade > 0 ? validade : null,
        pontosPorReal: Math.max(0, numero(c.pontosPorReal)) || exports.DEFAULT_CONFIG_CASHBACK.pontosPorReal,
        faixas: (0, exports.lerFaixas)(c.faixas).faixas,
    };
};
exports.parseConfigCashback = parseConfigCashback;
/** Faixas limpas e em ordem crescente de pontos; erro em portugues quando algo nao serve. */
const lerFaixas = (valor) => {
    const lista = Array.isArray(valor) ? valor : [];
    const faixas = [];
    for (const item of lista) {
        const f = (item && typeof item === 'object' ? item : {});
        const pontos = inteiroPositivo(f.pontos);
        const desconto = r2(numero(f.descontoPercentual));
        if (pontos <= 0 && desconto <= 0)
            continue;
        if (pontos <= 0)
            return { faixas: [], erro: 'Cada faixa precisa de uma quantidade de pontos maior que zero.' };
        if (desconto <= 0 || desconto > 100)
            return { faixas: [], erro: `A faixa de ${pontos} pontos precisa de um desconto entre 0,01% e 100%.` };
        faixas.push({ pontos, descontoPercentual: desconto });
    }
    faixas.sort((a, b) => a.pontos - b.pontos);
    for (let i = 1; i < faixas.length; i += 1) {
        if (faixas[i].pontos === faixas[i - 1].pontos)
            return { faixas: [], erro: `Há duas faixas com ${faixas[i].pontos} pontos. Cada faixa precisa de uma quantidade diferente.` };
        if (faixas[i].descontoPercentual <= faixas[i - 1].descontoPercentual) {
            return { faixas: [], erro: `A faixa de ${faixas[i].pontos} pontos dá ${faixas[i].descontoPercentual}% — menos que a de ${faixas[i - 1].pontos} pontos. Mais pontos, mais desconto.` };
        }
    }
    if (faixas.length > exports.LIMITE_DE_FAIXAS)
        return { faixas: [], erro: `O programa aceita até ${exports.LIMITE_DE_FAIXAS} faixas.` };
    return { faixas, erro: null };
};
exports.lerFaixas = lerFaixas;
/** Confere o que a tela de Configuracoes mandou salvar. */
const lerConfigCashback = (corpo) => {
    const c = (corpo && typeof corpo === 'object' ? corpo : {});
    const config = (0, exports.parseConfigCashback)(c);
    if (!config.ativo)
        return { ok: true, config: { ...config, ativo: false } };
    if (config.modelo === 'reais') {
        if (config.valorPadrao <= 0)
            return { ok: false, erro: 'Informe o cashback padrão (percentual ou valor por unidade) maior que zero.' };
        if (config.tipoPadrao === 'percentual' && config.valorPadrao > 100)
            return { ok: false, erro: 'O cashback padrão em percentual não pode passar de 100%.' };
    }
    else {
        if (config.pontosPorReal <= 0)
            return { ok: false, erro: 'Informe quantos pontos o cliente ganha por R$ 1,00.' };
        const faixas = (0, exports.lerFaixas)(c.faixas);
        if (faixas.erro)
            return { ok: false, erro: faixas.erro };
        if (faixas.faixas.length === 0)
            return { ok: false, erro: 'Cadastre pelo menos uma faixa (por exemplo, 100 pontos = 5% de desconto).' };
        config.faixas = faixas.faixas;
    }
    return { ok: true, config };
};
exports.lerConfigCashback = lerConfigCashback;
const regraDoProduto = (config, produto) => {
    if (!produto || produto.permitirCashback !== true)
        return null;
    const tipo = produto.cashbackTipo === 'percentual' || produto.cashbackTipo === 'valor' ? produto.cashbackTipo : null;
    const valor = Math.max(0, numero(produto.cashbackValor));
    if (tipo && valor > 0)
        return { tipo, valor };
    return { tipo: config.tipoPadrao, valor: config.valorPadrao };
};
/**
 * Quanto a venda gera, item a item. Desconto geral da venda (fora dos itens)
 * reduz proporcionalmente -- `fatorDoDescontoGeral` = total pago / soma dos itens.
 */
const cashbackDaVenda = (config, itens, fatorDoDescontoGeral = 1) => {
    const vazio = { modelo: config.modelo, centavos: 0, pontos: 0, porItem: [] };
    if (!config.ativo)
        return vazio;
    const fator = Number.isFinite(fatorDoDescontoGeral) && fatorDoDescontoGeral > 0 ? Math.min(1, fatorDoDescontoGeral) : 1;
    const porItem = [];
    for (const item of itens) {
        const regra = regraDoProduto(config, item.produto);
        if (!regra)
            continue;
        const total = Math.max(0, Math.round(item.totalCentavos * fator));
        if (config.modelo === 'pontos') {
            const pontos = Math.floor((total / 100) * config.pontosPorReal);
            if (pontos > 0)
                porItem.push({ produtoId: item.produtoId, nome: item.nome, centavos: 0, pontos });
            continue;
        }
        const centavos = regra.tipo === 'percentual'
            ? Math.round(total * (regra.valor / 100))
            : Math.round(regra.valor * 100 * Math.max(0, item.quantidade) * fator);
        if (centavos > 0)
            porItem.push({ produtoId: item.produtoId, nome: item.nome, centavos, pontos: 0 });
    }
    return {
        modelo: config.modelo,
        centavos: porItem.reduce((s, i) => s + i.centavos, 0),
        pontos: porItem.reduce((s, i) => s + i.pontos, 0),
        porItem,
    };
};
exports.cashbackDaVenda = cashbackDaVenda;
/** Data de validade (AAAA-MM-DD) do que foi gerado em `dataPagamento`; null = nao vence. */
const validadeDoCashback = (config, dataPagamento) => {
    if (!config.validadeDias)
        return null;
    const [a, m, d] = dataPagamento.split('-').map(Number);
    if (!a || !m || !d)
        return null;
    const data = new Date(Date.UTC(a, m - 1, d + config.validadeDias));
    return data.toISOString().slice(0, 10);
};
exports.validadeDoCashback = validadeDoCashback;
// ---------------------------------------------------------------------------
// Pontos: a faixa que o cliente alcanca
// ---------------------------------------------------------------------------
/** A melhor faixa que cabe no saldo (mais pontos = mais desconto), ou null. */
const faixaAlcancada = (faixas, saldoPontos) => ([...faixas].filter((f) => f.pontos <= saldoPontos).sort((a, b) => b.pontos - a.pontos)[0] ?? null);
exports.faixaAlcancada = faixaAlcancada;
/** Quantos pontos faltam para a proxima faixa (null = ja' esta na maior). */
const pontosParaProximaFaixa = (faixas, saldoPontos) => {
    const proxima = [...faixas].filter((f) => f.pontos > saldoPontos).sort((a, b) => a.pontos - b.pontos)[0];
    return proxima ? { faixa: proxima, faltam: proxima.pontos - saldoPontos } : null;
};
exports.pontosParaProximaFaixa = pontosParaProximaFaixa;
/**
 * Saldo a partir dos movimentos: gerado soma, usado/estornado/expirado
 * subtraem. Pode ficar negativo (venda cancelada depois de o cliente usar):
 * o proximo gerado abate.
 */
const saldoDosMovimentos = (movimentos) => (movimentos.reduce((s, m) => {
    const sinal = m.tipo === 'gerado' || m.tipo === 'ajuste' ? 1 : -1;
    return { centavos: s.centavos + sinal * Math.round(m.centavos || 0), pontos: s.pontos + sinal * Math.round(m.pontos || 0) };
}, { centavos: 0, pontos: 0 }));
exports.saldoDosMovimentos = saldoDosMovimentos;
const naoNegativo = (v) => Math.max(0, Math.round(v));
/** Lote que ainda vale: nao estornado, nao vencido e com algo sobrando. */
const loteVigente = (lote, hoje) => (lote.estornado !== true
    && (!lote.validade || lote.validade >= hoje)
    && (lote.restanteCentavos > 0 || lote.restantePontos > 0));
exports.loteVigente = loteVigente;
/** O que o cliente tem hoje: soma dos lotes vigentes menos a divida (venda cancelada depois de usar). */
const resumoDosLotes = (lotes, hoje, divida) => {
    const vigentes = lotes.filter((l) => (0, exports.loteVigente)(l, hoje));
    const vencimentos = vigentes.map((l) => l.validade).filter((v) => Boolean(v)).sort();
    return {
        saldoCentavos: vigentes.reduce((s, l) => s + l.restanteCentavos, 0) - naoNegativo(divida.centavos),
        saldoPontos: vigentes.reduce((s, l) => s + l.restantePontos, 0) - naoNegativo(divida.pontos),
        dividaCentavos: naoNegativo(divida.centavos),
        dividaPontos: naoNegativo(divida.pontos),
        proximoVencimento: vencimentos[0] ?? null,
    };
};
exports.resumoDosLotes = resumoDosLotes;
/** Lote novo abate a divida primeiro: o cliente so' volta a ter saldo depois de "pagar" o que ficou negativo. */
const novoLoteComDivida = (gerado, divida) => ({
    restanteCentavos: naoNegativo(gerado.centavos - naoNegativo(divida.centavos)),
    restantePontos: naoNegativo(gerado.pontos - naoNegativo(divida.pontos)),
    divida: {
        centavos: naoNegativo(naoNegativo(divida.centavos) - gerado.centavos),
        pontos: naoNegativo(naoNegativo(divida.pontos) - gerado.pontos),
    },
});
exports.novoLoteComDivida = novoLoteComDivida;
/**
 * Tira do lote `centavos`/`pontos` (estorno total ou parcial, devolucao). O que
 * o cliente ja' tinha gastado deste lote e nao da' mais para tirar vira divida.
 */
const abaterDoLote = (lote, centavos, pontos) => {
    const c = naoNegativo(centavos);
    const p = naoNegativo(pontos);
    return {
        restanteCentavos: naoNegativo(lote.restanteCentavos - c),
        restantePontos: naoNegativo(lote.restantePontos - p),
        dividaExtra: { centavos: naoNegativo(c - lote.restanteCentavos), pontos: naoNegativo(p - lote.restantePontos) },
    };
};
exports.abaterDoLote = abaterDoLote;
/** Parte de um lote que corresponde ao valor devolvido de uma venda (proporcional ao total da venda). */
const parteProporcional = (lote, valorDevolvidoCentavos, valorTotalCentavos) => {
    if (!(valorTotalCentavos > 0) || !(valorDevolvidoCentavos > 0))
        return { centavos: 0, pontos: 0 };
    const fator = Math.min(1, valorDevolvidoCentavos / valorTotalCentavos);
    return { centavos: Math.round(lote.centavos * fator), pontos: Math.round(lote.pontos * fator) };
};
exports.parteProporcional = parteProporcional;
const formatarCashback = (modelo, centavos, pontos) => (modelo === 'pontos'
    ? `${pontos.toLocaleString('pt-BR')} ponto(s)`
    : (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
exports.formatarCashback = formatarCashback;
