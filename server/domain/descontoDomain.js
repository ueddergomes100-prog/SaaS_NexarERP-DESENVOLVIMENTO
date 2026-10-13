"use strict";
// Funcoes puras de Desconto Maximo (OS, Pedido de Venda, Orcamento, PDV).
// Sem Firestore -- leitura/escrita fica nas telas que consomem isto.
//
// Dois niveis de checagem, deliberadamente distintos:
// 1) NIVEL PRODUTO (resolveLimiteItem): o campo descontoMaximoPercentual do
//    cadastro do produto -- existe desde sempre, nunca foi lido em lugar
//    nenhum ate esta feature. Quando presente, e' o piso que a loja definiu
//    produto a produto e SEMPRE bloqueia, nao segue o modo configurado --
//    e' a regra "mais importante" pedida pelo usuario.
// 2) NIVEL SISTEMA (checarLimiteTotal): o desconto TOTAL da venda/OS/
//    orcamento contra o limite configurado em Configuracoes pra aquela
//    tela, reagindo conforme o modo escolhido (bloquear/avisar/senha).
//
// Limite ausente/zero em qualquer nivel = sem checagem nenhuma -- preserva
// o comportamento de hoje (nenhum limite existe) em todo tenant que nao
// configurar nada.
Object.defineProperty(exports, "__esModule", { value: true });
exports.descontoDoClienteEmCents = exports.checarLimiteComCliente = exports.erroDoDescontoPadraoCliente = exports.parseDescontoPadraoCliente = exports.descontoPadraoDoCliente = exports.descontoInicial = exports.parseTipoDescontoPadrao = exports.DEFAULT_TIPO_DESCONTO_PADRAO = exports.parsePermitirDescontoPorItem = exports.DEFAULT_PERMITIR_DESCONTO_POR_ITEM = exports.parseModoLimiteDesconto = exports.parseLimiteDescontoConfig = exports.checarLimiteTotal = exports.excedeLimiteItem = exports.resolveLimiteItem = exports.calcularDescontoCents = exports.DEFAULT_MODO_LIMITE_DESCONTO = void 0;
exports.DEFAULT_MODO_LIMITE_DESCONTO = 'avisar';
const toFiniteNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};
/**
 * Converte o valor informado (percentual ou reais) em centavos de desconto,
 * contra uma base em centavos (subtotal/total antes do desconto). Mesma
 * logica que ja existia isolada em PDV/DiscountModal.tsx, generalizada pra
 * ser reusada em todas as telas.
 */
const calcularDescontoCents = (tipo, valorInformado, baseCents) => {
    const valor = toFiniteNumber(valorInformado);
    if (valor <= 0 || baseCents <= 0)
        return 0;
    const bruto = tipo === 'percentual'
        ? Math.round(baseCents * (valor / 100))
        : Math.round(valor * 100);
    return Math.min(Math.max(0, bruto), baseCents);
};
exports.calcularDescontoCents = calcularDescontoCents;
/** Limite do PRODUTO em percentual, ou null se o produto nao define um.
 * Sempre percentual -- e' assim que o campo sempre existiu no cadastro. */
const resolveLimiteItem = (produto) => {
    const limite = toFiniteNumber(produto?.descontoMaximoPercentual);
    return limite > 0 ? limite : null;
};
exports.resolveLimiteItem = resolveLimiteItem;
/** Confere um desconto de ITEM contra o limite do proprio produto (nivel 1).
 * `precoCheioCents` e' o preco do item ANTES do desconto (preco x quantidade). */
const excedeLimiteItem = (produto, descontoCents, precoCheioCents) => {
    const limite = (0, exports.resolveLimiteItem)(produto);
    if (limite === null || precoCheioCents <= 0)
        return false;
    const percentualAplicado = (descontoCents / precoCheioCents) * 100;
    return percentualAplicado > limite + 1e-6;
};
exports.excedeLimiteItem = excedeLimiteItem;
/** Confere o desconto TOTAL contra o limite da TELA, configurado em
 * Configuracoes (nivel 2). `limite` null/undefined/valor<=0 = sem limite
 * configurado, nunca excede -- e' o estado de todo tenant que nao mexeu
 * nesta configuracao. */
const checarLimiteTotal = (limite, baseCents, descontoCents) => {
    const percentualAplicado = baseCents > 0 ? (descontoCents / baseCents) * 100 : 0;
    if (!limite || limite.valor <= 0 || baseCents <= 0) {
        return { percentualAplicado, excedeu: false };
    }
    const limiteCents = limite.tipo === 'percentual'
        ? Math.round(baseCents * (limite.valor / 100))
        : Math.round(limite.valor * 100);
    return { percentualAplicado, excedeu: descontoCents > limiteCents + 1 };
};
exports.checarLimiteTotal = checarLimiteTotal;
/** Le um bloco de configuracao de limite salvo em `configuracoes/{tenantId}`.
 * Formato defensivo (Firestore): tipo invalido cai em 'percentual', valor
 * ausente/negativo vira 0 (== sem limite, via checarLimiteTotal). */
const parseLimiteDescontoConfig = (raw) => {
    const data = (raw && typeof raw === 'object') ? raw : {};
    const tipo = data.tipo === 'valor' ? 'valor' : 'percentual';
    return { tipo, valor: Math.max(0, toFiniteNumber(data.valor)) };
};
exports.parseLimiteDescontoConfig = parseLimiteDescontoConfig;
const parseModoLimiteDesconto = (raw) => (raw === 'bloquear' || raw === 'senha' ? raw : exports.DEFAULT_MODO_LIMITE_DESCONTO);
exports.parseModoLimiteDesconto = parseModoLimiteDesconto;
/**
 * DESCONTO POR ITEM APARECE NA TELA DE VENDA?
 *
 * Decisao de produto (2026-08-31). Nem toda loja quer o operador negociando
 * item a item: em muita delas o desconto e' um so, no fim da venda, e o campo
 * por item e' porta aberta pra erro -- desconto lancado no produto errado, ou
 * dado duas vezes (no item e no total) sem ninguem perceber.
 *
 * Desligado, o campo some da linha de lancamento. O desconto GERAL da venda
 * continua igual: e' ele que a maioria usa, e e ele que o limite de
 * Configuracoes sempre olhou.
 *
 * Nao mexe em venda ja gravada: item que tem desconto continua com ele, e o
 * total do pedido antigo nao muda. A opcao decide o que a tela OFERECE daqui
 * pra frente, nao reescreve historico.
 */
exports.DEFAULT_PERMITIR_DESCONTO_POR_ITEM = true;
/** So `false` explicito esconde. Empresa que nunca abriu a configuracao nao
 *  tem o campo gravado, e sumir com um campo que ela ja usa seria pior. */
const parsePermitirDescontoPorItem = (raw) => raw !== false;
exports.parsePermitirDescontoPorItem = parsePermitirDescontoPorItem;
/**
 * QUAL TIPO DE DESCONTO APARECE PRIMEIRO NA TELA.
 *
 * Decisao de produto (2026-09-01). O seletor de desconto (R$ / %) sempre
 * abria em R$, fixo no codigo. Mas isso e habito de loja, nao regra: ha quem
 * negocie sempre "10% pra voce" e ha quem negocie "tiro 5 reais". Quem
 * trabalha em percentual trocava o seletor em TODA venda -- um clique a toa
 * que se repete o dia inteiro.
 *
 * Vale pros dois campos, o do item e o da venda inteira: quem pensa em
 * percentual pensa em percentual nos dois.
 *
 * NAO muda desconto ja lancado nem o que ja foi gravado -- decide so' como o
 * campo VAZIO abre. Trocar o tipo na hora continua sendo um clique.
 */
exports.DEFAULT_TIPO_DESCONTO_PADRAO = 'valor';
const parseTipoDescontoPadrao = (raw) => (raw === 'percentual' ? 'percentual' : exports.DEFAULT_TIPO_DESCONTO_PADRAO);
exports.parseTipoDescontoPadrao = parseTipoDescontoPadrao;
/** Estado inicial (e o de "limpar") do campo de desconto. Uma funcao so pras
 *  quatro telas nao repetirem `{ tipo, valor: '' }` cada uma do seu jeito. */
const descontoInicial = (tipoPadrao) => ({ tipo: tipoPadrao, valor: '' });
exports.descontoInicial = descontoInicial;
/**
 * DESCONTO PADRAO DO CLIENTE (2026-09-21).
 *
 * Pedido do dono: "na tela do cliente tem desconto padrao. Esse cliente 10%
 * no cadastro dele, entao a prioridade e dele."
 *
 * A HIERARQUIA, com a decisao do dono de 21/09:
 *
 *   1. CLIENTE  -- o percentual do cadastro. Vem preenchido na venda e passa
 *                  DIRETO, sem avisar nem pedir senha: o dono ja autorizou
 *                  aquilo quando cadastrou. Pedir confirmacao em toda venda
 *                  seria atrapalhar o vendedor por uma decisao ja tomada.
 *   2. PRODUTO  -- `descontoMaximoPercentual` continua sendo TETO do item, e
 *                  o desconto do cliente NAO passa por cima dele: quem
 *                  confere o item e' excedeLimiteItem, que nem enxerga o
 *                  cliente. Atencao ao que 0 significa neste campo: hoje 0 e'
 *                  "campo em branco / sem teto proprio" (resolveLimiteItem
 *                  devolve null), NAO "produto que nao aceita desconto" --
 *                  esse segundo caso nao existe no sistema.
 *   3. SISTEMA  -- o limite da tela (Configuracoes). Vale para o que passar
 *                  do percentual do cliente, com o modo de sempre
 *                  (avisar/bloquear/senha).
 *
 * NAO existe nivel de VENDEDOR: o dono decidiu nao criar agora (21/09). A
 * hierarquia de 3 niveis com vendedor no meio e' a da COMISSAO
 * (resolveComissaoPercentual), nao a do desconto.
 *
 * ATENCAO, registrado de proposito: tudo isto e' conferido NA TELA. O
 * servidor nao valida desconto. Se algum dia esse limite precisar ser
 * inviolavel (regra "nada se altera pelo DevTools"), a checagem tem de subir
 * pro servidor -- e' mudanca maior, decisao a parte.
 */
/** Percentual do cadastro do cliente, ou 0 quando nao tem. Sempre entre 0 e 100. */
const descontoPadraoDoCliente = (cliente) => {
    const valor = toFiniteNumber(cliente?.descontoPadraoPercentual);
    if (!Number.isFinite(valor) || valor <= 0)
        return 0;
    return Math.min(100, valor);
};
exports.descontoPadraoDoCliente = descontoPadraoDoCliente;
/** Le o campo digitado no cadastro. Em branco vira 0 (== sem desconto). */
const parseDescontoPadraoCliente = (valor) => {
    const limpo = String(valor ?? '').trim().replace(',', '.');
    if (!limpo)
        return 0;
    const numero = Number(limpo);
    if (!Number.isFinite(numero) || numero <= 0)
        return 0;
    return Math.min(100, numero);
};
exports.parseDescontoPadraoCliente = parseDescontoPadraoCliente;
/** Erro em portugues do campo, ou null. */
const erroDoDescontoPadraoCliente = (valor) => {
    const limpo = String(valor ?? '').trim().replace(',', '.');
    if (!limpo)
        return null;
    const numero = Number(limpo);
    if (!Number.isFinite(numero))
        return 'Informe o desconto padrão em porcentagem (ex.: 10).';
    if (numero < 0)
        return 'O desconto padrão não pode ser negativo.';
    if (numero > 100)
        return 'O desconto padrão não pode passar de 100%.';
    return null;
};
exports.erroDoDescontoPadraoCliente = erroDoDescontoPadraoCliente;
/**
 * Confere o desconto TOTAL considerando o desconto do cliente.
 *
 * Ate o percentual do cliente, `excedeu` e' sempre false -- e' o que faz o
 * desconto dele passar direto. Acima disso, vale a regra da tela de sempre.
 *
 * Uma tolerancia de 1 centavo (a mesma de checarLimiteTotal) evita que
 * arredondamento de centavo dispare pedido de senha numa venda que esta
 * exatamente no limite.
 */
const checarLimiteComCliente = (limite, baseCents, descontoCents, percentualDoCliente) => {
    const base = (0, exports.checarLimiteTotal)(limite, baseCents, descontoCents);
    const percentualCliente = Math.max(0, Math.min(100, Number(percentualDoCliente) || 0));
    if (percentualCliente <= 0 || baseCents <= 0) {
        return { ...base, percentualDoCliente: percentualCliente, dentroDoDescontoDoCliente: false };
    }
    const tetoDoClienteCents = Math.round(baseCents * (percentualCliente / 100));
    const dentro = descontoCents <= tetoDoClienteCents + 1;
    return {
        percentualAplicado: base.percentualAplicado,
        excedeu: dentro ? false : base.excedeu,
        percentualDoCliente: percentualCliente,
        dentroDoDescontoDoCliente: dentro,
    };
};
exports.checarLimiteComCliente = checarLimiteComCliente;
/** Desconto em centavos que o cliente ja tem direito sobre uma base. */
const descontoDoClienteEmCents = (baseCents, percentualDoCliente) => {
    const percentual = Math.max(0, Math.min(100, Number(percentualDoCliente) || 0));
    if (percentual <= 0 || baseCents <= 0)
        return 0;
    return Math.round(baseCents * (percentual / 100));
};
exports.descontoDoClienteEmCents = descontoDoClienteEmCents;
