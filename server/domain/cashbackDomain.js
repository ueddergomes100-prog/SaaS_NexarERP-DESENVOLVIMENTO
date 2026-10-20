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
exports.devolucaoDoUso = exports.planoDeUso = exports.ordenarLotesParaUso = exports.bloqueioDaTrocaDeModelo = exports.resumoPelosMovimentos = exports.movimentoNaTela = exports.ROTULO_MOVIMENTO_CASHBACK = exports.venceEmAte = exports.parteDoSaldoVenceu = exports.temSaldo = exports.temDivida = exports.textoDoSaldo = exports.conferirPagamentoComCashback = exports.valorSugeridoDoCashback = exports.cashbackDisponivelParaVenda = exports.faixasDisponiveis = exports.valorDaFaixa = exports.cashbackUsadoNaVenda = exports.lerResumoCashback = exports.FORMA_PAGAMENTO_CASHBACK = exports.formatarCashback = exports.parteProporcional = exports.abaterDoLote = exports.novoLoteComDivida = exports.resumoDosLotes = exports.loteVigente = exports.saldoDosMovimentos = exports.pontosParaProximaFaixa = exports.faixaAlcancada = exports.validadeDoCashback = exports.cashbackDaVenda = exports.lerConfigCashback = exports.lerFaixas = exports.parseConfigCashback = exports.ROTULO_MODELO_CASHBACK = exports.LIMITE_DE_FAIXAS = exports.DEFAULT_CONFIG_CASHBACK = void 0;
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
// ---------------------------------------------------------------------------
// Uso como forma de pagamento (fase 2, 20/10/2026)
// ---------------------------------------------------------------------------
/**
 * Forma de pagamento que gasta o saldo. So' a venda PELO SERVIDOR consome os
 * lotes (server/services/vendaFechamento.js): a tela nunca mexe no saldo, por
 * isso a forma so' aparece com a chave "Venda pelo servidor" ligada.
 */
exports.FORMA_PAGAMENTO_CASHBACK = 'Cashback';
const lerResumoCashback = (valor) => {
    if (!valor || typeof valor !== 'object')
        return null;
    const r = valor;
    return {
        modelo: r.modelo === 'pontos' ? 'pontos' : 'reais',
        saldoCentavos: Math.round(numero(r.saldoCentavos)),
        saldoPontos: Math.round(numero(r.saldoPontos)),
        dividaCentavos: naoNegativo(numero(r.dividaCentavos)),
        dividaPontos: naoNegativo(numero(r.dividaPontos)),
        proximoVencimento: typeof r.proximoVencimento === 'string' && r.proximoVencimento ? r.proximoVencimento : null,
    };
};
exports.lerResumoCashback = lerResumoCashback;
const pagamentosLidos = (pagamentos) => ((Array.isArray(pagamentos) ? pagamentos : []).filter((p) => Boolean(p) && typeof p === 'object'));
/** Quanto da venda foi pago com cashback (centavos), pelos pagamentos gravados ou normalizados. */
const cashbackUsadoNaVenda = (pagamentos) => (pagamentosLidos(pagamentos)
    .filter((p) => p.formaPagamento === exports.FORMA_PAGAMENTO_CASHBACK)
    .reduce((soma, p) => soma + naoNegativo(p.valorCentavos !== undefined && p.valorCentavos !== null ? numero(p.valorCentavos) : numero(p.valor) * 100), 0));
exports.cashbackUsadoNaVenda = cashbackUsadoNaVenda;
/** Modelo em pontos: usar a faixa abate Y% do total da venda. */
const valorDaFaixa = (faixa, totalCentavos) => (Math.round(Math.max(0, totalCentavos) * (faixa.descontoPercentual / 100)));
exports.valorDaFaixa = valorDaFaixa;
/** Faixas que cabem no saldo do cliente, da menor para a maior, com o valor que cada uma abate. */
const faixasDisponiveis = (faixas, saldoPontos, totalCentavos) => ([...faixas]
    .filter((f) => f.pontos <= saldoPontos)
    .sort((a, b) => a.pontos - b.pontos)
    .map((faixa) => ({ faixa, valorCentavos: (0, exports.valorDaFaixa)(faixa, totalCentavos) }))
    .filter((f) => f.valorCentavos > 0));
exports.faixasDisponiveis = faixasDisponiveis;
/** null = nada a oferecer (cashback desligado, cliente sem saldo, saldo de outro modelo). */
const cashbackDisponivelParaVenda = (config, resumo) => {
    if (!config.ativo || !resumo || resumo.modelo !== config.modelo)
        return null;
    if (config.modelo === 'reais' ? resumo.saldoCentavos <= 0 : resumo.saldoPontos <= 0)
        return null;
    return {
        modelo: config.modelo,
        saldoCentavos: Math.max(0, resumo.saldoCentavos),
        saldoPontos: Math.max(0, resumo.saldoPontos),
        faixas: config.faixas,
        proximoVencimento: resumo.proximoVencimento,
    };
};
exports.cashbackDisponivelParaVenda = cashbackDisponivelParaVenda;
/** Valor que a linha "Cashback" sugere ao ser escolhida: o saldo (ate' o que falta pagar) ou a maior faixa. */
const valorSugeridoDoCashback = (disponivel, totalCentavos, faltaPagarCentavos) => {
    if (disponivel.modelo === 'reais')
        return Math.max(0, Math.min(disponivel.saldoCentavos, faltaPagarCentavos));
    const faixas = (0, exports.faixasDisponiveis)(disponivel.faixas, disponivel.saldoPontos, totalCentavos);
    return faixas.length ? faixas[faixas.length - 1].valorCentavos : 0;
};
exports.valorSugeridoDoCashback = valorSugeridoDoCashback;
/**
 * Confere o pagamento "Cashback" contra o saldo: em R$ nao passa do saldo nem
 * do total; em pontos o valor tem de ser exatamente o de uma faixa que o
 * cliente alcanca. Devolve o que consumir (centavos ou pontos) ou o erro.
 */
const conferirPagamentoComCashback = (config, resumo, totalCentavos, valorCentavos) => {
    if (!(valorCentavos > 0))
        return { ok: false, erro: 'O valor pago com cashback precisa ser maior que zero.' };
    if (!config.ativo)
        return { ok: false, erro: 'O cashback está desligado nas Configurações. Troque a forma de pagamento.' };
    if (!resumo || resumo.modelo !== config.modelo)
        return { ok: false, erro: 'Este cliente não tem saldo de cashback para usar. Troque a forma de pagamento.' };
    if (valorCentavos > totalCentavos)
        return { ok: false, erro: 'O cashback não pode passar do total da venda. Diminua o valor.' };
    if (config.modelo === 'reais') {
        if (valorCentavos > resumo.saldoCentavos) {
            return { ok: false, erro: `O cliente tem ${(0, exports.formatarCashback)('reais', Math.max(0, resumo.saldoCentavos), 0)} de cashback, menos que o informado. Ajuste o valor.` };
        }
        return { ok: true, centavos: valorCentavos, pontos: 0 };
    }
    const faixa = (0, exports.faixasDisponiveis)(config.faixas, resumo.saldoPontos, totalCentavos).find((f) => f.valorCentavos === valorCentavos);
    if (!faixa)
        return { ok: false, erro: 'O valor do cashback não corresponde a nenhuma faixa de pontos que o cliente alcança. Escolha a faixa de novo.' };
    return { ok: true, centavos: 0, pontos: faixa.faixa.pontos };
};
exports.conferirPagamentoComCashback = conferirPagamentoComCashback;
// ---------------------------------------------------------------------------
// Tela Comercial > Cashback, cadastro do cliente e app (fase 3, 20/10/2026)
// ---------------------------------------------------------------------------
/** Saldo do resumo, no modelo em que foi gravado ("R$ 12,35" ou "244 ponto(s)"). */
const textoDoSaldo = (resumo) => ((0, exports.formatarCashback)(resumo.modelo, resumo.saldoCentavos, resumo.saldoPontos));
exports.textoDoSaldo = textoDoSaldo;
const temDivida = (resumo) => resumo.dividaCentavos > 0 || resumo.dividaPontos > 0;
exports.temDivida = temDivida;
const temSaldo = (resumo) => (resumo.modelo === 'pontos' ? resumo.saldoPontos > 0 : resumo.saldoCentavos > 0);
exports.temSaldo = temSaldo;
/**
 * O resumo e' regravado a cada venda/baixa do cliente. Se o lote mais proximo
 * venceu depois disso, o saldo mostrado ainda conta com ele ate a proxima
 * gravacao -- a tela avisa (o servidor sempre confere pelos lotes na venda).
 */
const parteDoSaldoVenceu = (resumo, hoje) => (Boolean(resumo.proximoVencimento && resumo.proximoVencimento < hoje));
exports.parteDoSaldoVenceu = parteDoSaldoVenceu;
/** Vence nos proximos `dias` (contando hoje). */
const venceEmAte = (resumo, hoje, dias) => {
    if (!resumo.proximoVencimento || resumo.proximoVencimento < hoje)
        return false;
    const [a, m, d] = hoje.split('-').map(Number);
    if (!a || !m || !d)
        return false;
    const limite = new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
    return resumo.proximoVencimento <= limite;
};
exports.venceEmAte = venceEmAte;
exports.ROTULO_MOVIMENTO_CASHBACK = {
    gerado: 'Gerado na venda',
    usado: 'Usado na venda',
    estornado: 'Estornado',
    ajuste: 'Devolvido (venda cancelada)',
    expirado: 'Venceu',
};
const TIPOS_MOVIMENTO = ['gerado', 'usado', 'estornado', 'ajuste', 'expirado'];
const movimentoNaTela = (id, dados) => {
    const tipo = TIPOS_MOVIMENTO.includes(dados.tipo) ? dados.tipo : 'ajuste';
    const criado = dados.createdAt;
    return {
        id,
        tipo,
        rotulo: exports.ROTULO_MOVIMENTO_CASHBACK[tipo],
        sinal: tipo === 'gerado' || tipo === 'ajuste' ? 1 : -1,
        modelo: dados.modelo === 'pontos' ? 'pontos' : 'reais',
        centavos: Math.round(numero(dados.centavos)),
        pontos: Math.round(numero(dados.pontos)),
        numeroPedido: String(dados.numeroPedido ?? ''),
        descricao: String(dados.descricao ?? ''),
        criadoEmMs: typeof criado?.toMillis === 'function' ? criado.toMillis() : (Number(criado?.seconds) || 0) * 1000,
        validade: typeof dados.validade === 'string' && dados.validade ? dados.validade : null,
        restanteCentavos: Math.round(numero(dados.restanteCentavos)),
        restantePontos: Math.round(numero(dados.restantePontos)),
        estornado: dados.estornado === true,
    };
};
exports.movimentoNaTela = movimentoNaTela;
/** Saldo de hoje pelos lotes (ja' sem os vencidos), para o detalhe do cliente. */
const resumoPelosMovimentos = (movimentos, hoje, divida) => (0, exports.resumoDosLotes)(movimentos.filter((m) => m.tipo === 'gerado').map((m) => ({
    centavos: m.centavos, pontos: m.pontos, restanteCentavos: m.restanteCentavos, restantePontos: m.restantePontos, validade: m.validade, estornado: m.estornado,
})), hoje, divida);
exports.resumoPelosMovimentos = resumoPelosMovimentos;
/**
 * Troca do modelo (R$ <-> pontos) com saldo em aberto: decisao do dono
 * (20/10/2026) -- bloqueia. O saldo do modelo antigo nao some nem e'
 * convertido: a empresa troca quando nenhum cliente tiver saldo nele.
 * `clientesComSaldo` = clientes com lote vigente do modelo antigo.
 */
const bloqueioDaTrocaDeModelo = (antigo, novo, clientesComSaldo) => {
    if (antigo.modelo === novo.modelo || clientesComSaldo <= 0)
        return null;
    const rotulo = antigo.modelo === 'pontos' ? 'pontos' : 'R$';
    return `${clientesComSaldo} cliente(s) ainda têm saldo de cashback em ${rotulo}. O modelo só pode ser trocado quando nenhum cliente tiver saldo em aberto: o saldo acaba quando é usado nas vendas ou quando vence. Veja quem tem saldo em Comercial › Cashback.`;
};
exports.bloqueioDaTrocaDeModelo = bloqueioDaTrocaDeModelo;
/** Vence antes, sai antes; sem validade sai por ultimo; empate pela ordem de criacao. */
const ordenarLotesParaUso = (lotes, hoje) => (lotes.filter((l) => (0, exports.loteVigente)(l, hoje)).sort((a, b) => {
    if (a.validade && b.validade && a.validade !== b.validade)
        return a.validade < b.validade ? -1 : 1;
    if (Boolean(a.validade) !== Boolean(b.validade))
        return a.validade ? -1 : 1;
    return a.ordem - b.ordem;
}));
exports.ordenarLotesParaUso = ordenarLotesParaUso;
const MENSAGEM_SALDO_MUDOU = 'O saldo de cashback deste cliente mudou desde que a venda foi montada. Refaça o pagamento com cashback.';
/**
 * Distribui o uso pelos lotes vigentes (vence antes, sai antes). A divida do
 * cliente ja' esta' descontada do saldo: nao se gasta o que ela cobre.
 */
const planoDeUso = (lotes, divida, uso, hoje) => {
    const ordenados = (0, exports.ordenarLotesParaUso)(lotes, hoje);
    const saldo = (0, exports.resumoDosLotes)(ordenados, hoje, divida);
    let faltaCentavos = naoNegativo(uso.centavos);
    let faltaPontos = naoNegativo(uso.pontos);
    if (faltaCentavos > saldo.saldoCentavos || faltaPontos > saldo.saldoPontos)
        return { ok: false, erro: MENSAGEM_SALDO_MUDOU };
    const consumos = [];
    for (const lote of ordenados) {
        if (faltaCentavos <= 0 && faltaPontos <= 0)
            break;
        const centavos = Math.min(faltaCentavos, lote.restanteCentavos);
        const pontos = Math.min(faltaPontos, lote.restantePontos);
        if (centavos <= 0 && pontos <= 0)
            continue;
        consumos.push({ id: lote.id, centavos, pontos });
        faltaCentavos -= centavos;
        faltaPontos -= pontos;
    }
    if (faltaCentavos > 0 || faltaPontos > 0)
        return { ok: false, erro: MENSAGEM_SALDO_MUDOU };
    return { ok: true, consumos };
};
exports.planoDeUso = planoDeUso;
/**
 * A venda que usou cashback foi cancelada: o que saiu de cada lote volta.
 * Lote ja' estornado (a venda que o gerou foi cancelada antes) nao recebe de
 * volta -- o uso dele tinha virado divida, e e' a divida que diminui. Lote
 * vencido recebe de volta, mas nao conta mais no saldo.
 */
const devolucaoDoUso = (lote, consumo, divida) => {
    const centavos = naoNegativo(consumo.centavos);
    const pontos = naoNegativo(consumo.pontos);
    const usado = { usadoCentavos: naoNegativo(lote.usadoCentavos - centavos), usadoPontos: naoNegativo(lote.usadoPontos - pontos) };
    if (lote.estornado === true) {
        return {
            lote: { restanteCentavos: naoNegativo(lote.restanteCentavos), restantePontos: naoNegativo(lote.restantePontos), ...usado },
            divida: { centavos: naoNegativo(naoNegativo(divida.centavos) - centavos), pontos: naoNegativo(naoNegativo(divida.pontos) - pontos) },
        };
    }
    return {
        lote: { restanteCentavos: naoNegativo(lote.restanteCentavos) + centavos, restantePontos: naoNegativo(lote.restantePontos) + pontos, ...usado },
        divida: { centavos: naoNegativo(divida.centavos), pontos: naoNegativo(divida.pontos) },
    };
};
exports.devolucaoDoUso = devolucaoDoUso;
