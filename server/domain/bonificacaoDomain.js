"use strict";
/**
 * BONIFICACAO NO PEDIDO (pedido de cliente, 30/10/2026; decisoes do dono).
 *
 * Item bonificado = mercadoria que vai de brinde DENTRO do pedido:
 *  - para o cliente o item sai a PRECO ZERO (precoUnitario 0, subtotal 0): nao
 *    entra no total, na receita, nos titulos nem na comissao (que e' % sobre o
 *    subtotal);
 *  - o ESTOQUE baixa normalmente (a baixa e' por quantidade);
 *  - o preco cheio fica guardado em `precoReferencia` -- e' o valor que vai na
 *    NF-e (valor cheio + CFOP 5.910/6.910, imposto normal; a cobranca e' so' da
 *    parte vendida) e a base do limite;
 *  - so' sai em NF-e: a SEFAZ nao aceita CFOP de bonificacao na NFC-e.
 *
 * Controle: permissao "Pode bonificar" (vendas.bonificar) e a chave da empresa
 * em Configuracoes (por filial). Acima do limite (% do valor vendido no
 * pedido), o faturamento pede a liberacao de um responsavel.
 *
 * Arquivo puro (vai para o servidor por scripts/build-server-domain.mjs).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.cfopDaBonificacao = exports.parseTributacaoBonificacao = exports.DEFAULT_TRIBUTACAO_BONIFICACAO = exports.situacaoDoPedidoDeBonificacao = exports.situacaoDaBonificacao = exports.MENSAGEM_NFCE_COM_BONIFICACAO = exports.MENSAGEM_SO_BONIFICADO = exports.MENSAGEM_SEM_PERMISSAO_BONIFICAR = exports.MENSAGEM_BONIFICACAO_DESLIGADA = exports.parseConfigBonificacao = exports.DEFAULT_CONFIG_BONIFICACAO = exports.resumoDaBonificacao = exports.normalizarItemBonificado = exports.cobrarItem = exports.bonificarItem = exports.valorCheioDaLinhaBonificadaCentavos = exports.temItemBonificado = exports.ehBonificado = exports.separarItensDaBonificacao = exports.idDoPedidoDeBonificacao = exports.ehPedidoDeBonificacao = exports.ROTULO_PEDIDO_BONIFICACAO = exports.TIPO_PEDIDO_BONIFICACAO = exports.PERMISSAO_BONIFICAR = void 0;
exports.PERMISSAO_BONIFICAR = 'vendas.bonificar';
/*
 * PEDIDO DE BONIFICACAO (contador, 30/10/2026): venda e bonificacao sao NOTAS
 * DISTINTAS (CFOP e tributacao diferentes). O vendedor continua marcando o item
 * como "Bonificar" no pedido; ao enviar/gravar, o sistema SEPARA: o pedido de
 * venda leva so' o que e' cobrado e nasce um PEDIDO DE BONIFICACAO (tipoPedido
 * 'bonificacao') so' com os brindes, ligado a venda pelos ids. O pedido de
 * bonificacao fatura sem pagamento, sem titulo e sem comissao, baixa o estoque
 * e sai em NF-e propria (5.910/6.910) com a tributacao da bonificacao da empresa.
 */
exports.TIPO_PEDIDO_BONIFICACAO = 'bonificacao';
exports.ROTULO_PEDIDO_BONIFICACAO = 'Bonificação';
const ehPedidoDeBonificacao = (pedido) => (pedido?.tipoPedido === exports.TIPO_PEDIDO_BONIFICACAO);
exports.ehPedidoDeBonificacao = ehPedidoDeBonificacao;
/** Id do pedido de bonificacao que nasce da venda: fixo, para reenviar nao duplicar. */
const idDoPedidoDeBonificacao = (idDaVenda) => `${idDaVenda}b`;
exports.idDoPedidoDeBonificacao = idDoPedidoDeBonificacao;
/** Separa os itens cobrados (venda) dos brindes (pedido de bonificacao). */
const separarItensDaBonificacao = (itens) => ({
    cobrados: itens.filter((item) => !(0, exports.ehBonificado)(item)),
    brindes: itens.filter((item) => (0, exports.ehBonificado)(item)),
});
exports.separarItensDaBonificacao = separarItensDaBonificacao;
const centavos = (valor) => Math.round((Number(valor) || 0) * 100);
const positivo = (valor) => {
    const n = Number(valor);
    return Number.isFinite(n) && n > 0 ? n : 0;
};
const ehBonificado = (item) => item?.bonificado === true;
exports.ehBonificado = ehBonificado;
const temItemBonificado = (itens) => (Array.isArray(itens) && itens.some((item) => (0, exports.ehBonificado)(item)));
exports.temItemBonificado = temItemBonificado;
/** Valor cheio da linha bonificada, em centavos (preco de referencia x quantidade, arredondado por linha). */
const valorCheioDaLinhaBonificadaCentavos = (item) => (Math.max(0, Math.round(centavos(item.precoReferencia) * (Number(item.quantidade) || 0))));
exports.valorCheioDaLinhaBonificadaCentavos = valorCheioDaLinhaBonificadaCentavos;
/** Marca o item como bonificado: guarda o preco cheio e zera o que o cliente paga. */
const bonificarItem = (item) => ({
    ...item,
    bonificado: true,
    precoReferencia: (0, exports.ehBonificado)(item) ? positivo(item.precoReferencia) : positivo(item.precoUnitario),
    precoUnitario: 0,
    desconto: 0,
    subtotal: 0,
});
exports.bonificarItem = bonificarItem;
/** Volta o item a ser cobrado, pelo preco cheio que estava guardado. */
const cobrarItem = (item) => {
    if (!(0, exports.ehBonificado)(item))
        return item;
    const preco = positivo(item.precoReferencia);
    const resto = { ...item };
    delete resto.bonificado;
    delete resto.precoReferencia;
    return {
        ...resto,
        precoUnitario: preco,
        desconto: 0,
        subtotal: Math.max(0, Math.round(centavos(preco) * (Number(item.quantidade) || 0))) / 100,
    };
};
exports.cobrarItem = cobrarItem;
/** Item bonificado nunca leva preco nem desconto: o que vier da tela e' corrigido (preco 0, subtotal 0). */
const normalizarItemBonificado = (item) => ((0, exports.ehBonificado)(item)
    ? { ...item, precoUnitario: 0, desconto: 0, subtotal: 0, precoReferencia: positivo(item.precoReferencia) }
    : item);
exports.normalizarItemBonificado = normalizarItemBonificado;
const resumoDaBonificacao = (itens) => {
    let vendidoCentavos = 0;
    let bonificadoCentavos = 0;
    let quantidadeDeItens = 0;
    for (const item of itens) {
        if ((0, exports.ehBonificado)(item)) {
            bonificadoCentavos += (0, exports.valorCheioDaLinhaBonificadaCentavos)(item);
            quantidadeDeItens += 1;
        }
        else {
            vendidoCentavos += centavos(item.subtotal);
        }
    }
    return {
        vendidoCentavos,
        bonificadoCentavos,
        percentual: vendidoCentavos > 0 ? Math.round((bonificadoCentavos / vendidoCentavos) * 1000) / 10 : null,
        quantidadeDeItens,
    };
};
exports.resumoDaBonificacao = resumoDaBonificacao;
exports.DEFAULT_CONFIG_BONIFICACAO = { ativa: false, limitePercentual: 0 };
const parseConfigBonificacao = (valor) => {
    const v = (valor && typeof valor === 'object' ? valor : {});
    const limite = Number(v.limitePercentual);
    return {
        ativa: v.ativa === true,
        limitePercentual: Number.isFinite(limite) && limite > 0 ? Math.min(100, Math.round(limite * 100) / 100) : 0,
    };
};
exports.parseConfigBonificacao = parseConfigBonificacao;
const reais = (c) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;
exports.MENSAGEM_BONIFICACAO_DESLIGADA = 'Esta empresa não trabalha com bonificação. Volte o item para cobrado, ou peça ao administrador para ligar a bonificação em Configurações.';
exports.MENSAGEM_SEM_PERMISSAO_BONIFICAR = 'Você não tem a permissão "Vendas: Pode bonificar". Volte o item para cobrado, ou peça a quem pode bonificar.';
exports.MENSAGEM_SO_BONIFICADO = 'Este pedido só tem itens bonificados. Bonificação vai junto de uma venda: inclua pelo menos um item cobrado, ou volte um dos itens para cobrado.';
exports.MENSAGEM_NFCE_COM_BONIFICACAO = 'Este pedido tem item bonificado, e a SEFAZ não aceita bonificação em NFC-e (cupom). Emita uma NF-e para este pedido.';
/**
 * A bonificacao do pedido pode seguir? Sem item bonificado, sempre. Com:
 * a empresa precisa ter ligado, quem bonifica precisa da permissao, o pedido
 * precisa vender alguma coisa e, acima do limite, precisa de liberacao.
 */
const situacaoDaBonificacao = (args) => {
    const resumo = (0, exports.resumoDaBonificacao)(args.itens);
    if (resumo.quantidadeDeItens === 0)
        return { ok: true, precisaLiberacao: false };
    if (!args.config.ativa)
        return { ok: false, mensagem: exports.MENSAGEM_BONIFICACAO_DESLIGADA };
    if (!args.podeBonificar)
        return { ok: false, mensagem: exports.MENSAGEM_SEM_PERMISSAO_BONIFICAR };
    if (resumo.vendidoCentavos <= 0)
        return { ok: false, mensagem: exports.MENSAGEM_SO_BONIFICADO };
    const limiteCentavos = Math.floor(resumo.vendidoCentavos * (args.config.limitePercentual / 100));
    if (resumo.bonificadoCentavos <= limiteCentavos + 1)
        return { ok: true, precisaLiberacao: false };
    return {
        ok: true,
        precisaLiberacao: true,
        mensagem: `A bonificação deste pedido (${reais(resumo.bonificadoCentavos)}, ${String(resumo.percentual).replace('.', ',')}% do vendido) passa do limite da empresa (${String(args.config.limitePercentual).replace('.', ',')}%) e precisa da liberação de um responsável.`,
    };
};
exports.situacaoDaBonificacao = situacaoDaBonificacao;
/**
 * O PEDIDO DE BONIFICACAO pode faturar? Todos os itens tem de ser brinde; a empresa
 * precisa ter ligado e alguem com a permissao precisa ter bonificado. O limite % e'
 * sobre a VENDA DE ORIGEM (o que o cliente pagou no pedido ligado); sem venda ligada,
 * so' quem aprova desconto fatura.
 */
const situacaoDoPedidoDeBonificacao = (args) => {
    if (args.itens.length === 0)
        return { ok: false, mensagem: 'O pedido de bonificação está sem itens. Inclua os brindes ou cancele o pedido.' };
    if (args.itens.some((item) => !(0, exports.ehBonificado)(item))) {
        return { ok: false, mensagem: 'Pedido de bonificação só leva itens bonificados. Tire o item cobrado daqui e lance-o num pedido de venda.' };
    }
    if (!args.config.ativa)
        return { ok: false, mensagem: exports.MENSAGEM_BONIFICACAO_DESLIGADA };
    if (!args.podeBonificar)
        return { ok: false, mensagem: exports.MENSAGEM_SEM_PERMISSAO_BONIFICAR };
    const bonificado = (0, exports.resumoDaBonificacao)(args.itens).bonificadoCentavos;
    const venda = Math.max(0, Math.round(args.vendaDeOrigemCentavos) || 0);
    if (venda <= 0) {
        return { ok: true, precisaLiberacao: true, mensagem: `Esta bonificação (${reais(bonificado)}) não está ligada a uma venda e precisa da liberação de um responsável.` };
    }
    const limiteCentavos = Math.floor(venda * (args.config.limitePercentual / 100));
    if (bonificado <= limiteCentavos + 1)
        return { ok: true, precisaLiberacao: false };
    const percentual = Math.round((bonificado / venda) * 1000) / 10;
    return {
        ok: true,
        precisaLiberacao: true,
        mensagem: `A bonificação (${reais(bonificado)}, ${String(percentual).replace('.', ',')}% da venda ligada) passa do limite da empresa (${String(args.config.limitePercentual).replace('.', ',')}%) e precisa da liberação de um responsável.`,
    };
};
exports.situacaoDoPedidoDeBonificacao = situacaoDoPedidoDeBonificacao;
exports.DEFAULT_TRIBUTACAO_BONIFICACAO = { csosn: '400', cstIcms: '40', cstPis: '08', cstCofins: '08' };
const codigo = (valor, tamanho, padrao) => {
    const digitos = String(valor ?? '').replace(/\D/g, '');
    return digitos.length === tamanho ? digitos : padrao;
};
const parseTributacaoBonificacao = (valor) => {
    const v = (valor && typeof valor === 'object' ? valor : {});
    return {
        csosn: codigo(v.csosn, 3, exports.DEFAULT_TRIBUTACAO_BONIFICACAO.csosn),
        cstIcms: codigo(v.cstIcms, 2, exports.DEFAULT_TRIBUTACAO_BONIFICACAO.cstIcms),
        cstPis: codigo(v.cstPis, 2, exports.DEFAULT_TRIBUTACAO_BONIFICACAO.cstPis),
        cstCofins: codigo(v.cstCofins, 2, exports.DEFAULT_TRIBUTACAO_BONIFICACAO.cstCofins),
    };
};
exports.parseTributacaoBonificacao = parseTributacaoBonificacao;
// ---------------------------------------------------------------------------
// Nota fiscal
// ---------------------------------------------------------------------------
/** CFOP da bonificacao: 5.910 dentro do estado, 6.910 para fora. */
const cfopDaBonificacao = (interestadual) => (interestadual ? '6910' : '5910');
exports.cfopDaBonificacao = cfopDaBonificacao;
