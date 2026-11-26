"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.erroDaFormaDoVendedor = exports.parcelasDoBoleto = exports.MAX_PARCELAS_DO_BOLETO_NO_APP = exports.CAMPO_PARCELAS_DO_BOLETO = exports.formaDoVendedor = exports.CAMPO_FORMA_DO_VENDEDOR = exports.PERMISSAO_TROCAR_FORMA_DO_VENDEDOR = exports.erroDoAPrazoNoCaixa = exports.FORMA_A_PRAZO = exports.parseAPrazoNaFrenteDeCaixa = exports.parseVendaPeloServidor = exports.lerPedidoDeFechamento = exports.lerLotes = exports.LIMITE_DE_ITENS_NO_FECHAMENTO = exports.totaisDoFechamento = exports.subtotalDaLinha = exports.brutoDaLinhaCentavos = exports.configFinanceiraDaEmpresa = void 0;
/*
 * FECHAMENTO DA VENDA NO SERVIDOR (item 8 da auditoria, fatia 3 -- 13/10/2026).
 *
 * Regras puras do "Finalizar" do Pedido de Venda que precisam dar o MESMO
 * resultado na tela e no servidor (server/services/vendaFechamento.js usa a
 * versao compilada em server/domain/). Com a chave "Venda pelo servidor"
 * ligada para a empresa, a tela manda o que a pessoa escolheu (itens,
 * desconto geral, frete, encargos, pagamentos) e o servidor refaz as contas
 * daqui -- nao confia em total, saldo de banco nem status de pagamento vindos
 * do navegador.
 */
const financeDomain_1 = require("./financeDomain");
const descontoDomain_1 = require("./descontoDomain");
const transporteNotaDomain_1 = require("./transporteNotaDomain");
/** Mesma leitura que o Pedido de Venda faz de `configuracoes/{empresa}`. */
const configFinanceiraDaEmpresa = (config) => {
    const c = config || {};
    const prazos = (0, financeDomain_1.parseCreditTerms)(c.diasCrediario);
    const credito = c.prazoRecebimentoCartaoCreditoDias ?? 30;
    const debito = c.prazoRecebimentoCartaoDebitoDias ?? 1;
    return {
        defaultTermDays: prazos[0] || 30,
        maxCreditInstallments: Math.min(12, Math.max(1, Number(c.maxParcelasCartao ?? 12) || 12)),
        creditFeePercentByInstallment: (0, financeDomain_1.normalizeCreditCardFeeSchedule)(c.taxasCartaoCreditoPorParcela, Number(c.taxaCartaoCreditoPercentual) || 0),
        debitFeePercent: Math.max(0, Number(c.taxaCartaoDebitoPercentual || 0)),
        creditSettlementDays: credito === '' ? 30 : Math.max(0, Number(credito)),
        debitSettlementDays: debito === '' ? 1 : Math.max(0, Number(debito)),
    };
};
exports.configFinanceiraDaEmpresa = configFinanceiraDaEmpresa;
/**
 * Valor bruto da linha em centavos, ARREDONDADO POR LINHA (preco em centavos x
 * quantidade). E' a conta do PDV (cartLineGrossCents) e da NF-e. Desde a fatia
 * 3c (19/10/2026) o Pedido de Venda e o servidor somam assim tambem -- antes
 * somavam preco x quantidade sem arredondar e, com quantidade fracionada (kg),
 * o total podia diferir 1 centavo do PDV.
 */
const brutoDaLinhaCentavos = (linha) => (Math.max(0, Math.round((0, financeDomain_1.toCents)(linha.precoUnitario) * linha.quantidade)));
exports.brutoDaLinhaCentavos = brutoDaLinhaCentavos;
/** Subtotal da linha como a grade grava: preco x quantidade - desconto, nunca negativo. */
const subtotalDaLinha = (linha) => ((0, financeDomain_1.fromCents)(Math.max(0, (0, exports.brutoDaLinhaCentavos)(linha) - (0, financeDomain_1.toCents)(linha.desconto))));
exports.subtotalDaLinha = subtotalDaLinha;
/**
 * Mesma conta do Pedido de Venda: o desconto GERAL incide sobre o subtotal
 * ja' com os descontos de item (nao sobre frete/encargos, que sao acrescimos).
 */
const totaisDoFechamento = (args) => {
    const valorTotalItens = (0, financeDomain_1.fromCents)(args.itens.reduce((acc, i) => acc + (0, exports.brutoDaLinhaCentavos)(i), 0));
    const valorTotalDescontosItens = args.itens.reduce((acc, i) => acc + i.desconto, 0);
    const baseCentavos = (0, financeDomain_1.toCents)(Math.max(0, valorTotalItens - valorTotalDescontosItens));
    const descontoGeralCentavos = (0, descontoDomain_1.calcularDescontoCents)(args.descontoGeralTipo, args.descontoGeralValor, baseCentavos);
    const descontoGeral = (0, financeDomain_1.fromCents)(descontoGeralCentavos);
    const valorTotalDescontos = valorTotalDescontosItens + descontoGeral;
    const valorTotal = Math.max(0, valorTotalItens - valorTotalDescontos + Number(args.frete || 0) + Number(args.encargos || 0));
    return {
        valorTotalItens,
        valorTotalDescontosItens,
        descontoGeralCentavos,
        descontoGeral,
        valorTotalDescontos,
        valorTotal,
        valorTotalCentavos: (0, financeDomain_1.toCents)(valorTotal),
    };
};
exports.totaisDoFechamento = totaisDoFechamento;
const ID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;
const DATA_VALIDA = /^\d{4}-\d{2}-\d{2}$/;
exports.LIMITE_DE_ITENS_NO_FECHAMENTO = 500;
const numero = (valor) => {
    const n = typeof valor === 'string' ? Number(valor.replace(',', '.')) : Number(valor);
    return Number.isFinite(n) ? n : Number.NaN;
};
const texto = (valor, maximo) => String(valor ?? '').trim().slice(0, maximo);
/** Lotes de uma linha, como a tela manda (null = invalido). Tambem usado pela OS (osFechamentoDomain). */
const lerLotes = (valor) => {
    if (valor === undefined || valor === null)
        return [];
    if (!Array.isArray(valor) || valor.length > 50)
        return null;
    const lotes = [];
    for (const bruto of valor) {
        const l = (bruto && typeof bruto === 'object' ? bruto : {});
        const quantidade = numero(l.quantidade);
        if (!ID_VALIDO.test(String(l.loteId ?? '')) || !(quantidade > 0))
            return null;
        lotes.push({ loteId: String(l.loteId), lote: texto(l.lote, 60), validade: l.validade ? texto(l.validade, 10) : null, quantidade });
    }
    return lotes;
};
exports.lerLotes = lerLotes;
/** Valida e normaliza o corpo do POST. Devolve a primeira coisa errada, em portugues. */
const lerPedidoDeFechamento = (corpo) => {
    const c = (corpo && typeof corpo === 'object' ? corpo : {});
    const pedidoId = c.pedidoId ? String(c.pedidoId) : null;
    const idDocumento = c.idDocumento ? String(c.idDocumento) : null;
    if (pedidoId && !ID_VALIDO.test(pedidoId))
        return { erro: 'Pedido inválido. Atualize a tela e tente de novo.' };
    if (idDocumento && !ID_VALIDO.test(idDocumento))
        return { erro: 'Venda inválida. Atualize a tela e tente de novo.' };
    if (!pedidoId && !idDocumento)
        return { erro: 'Venda sem identificação. Atualize a tela e tente de novo.' };
    const dataVenda = String(c.dataVenda ?? '');
    if (!DATA_VALIDA.test(dataVenda))
        return { erro: 'Informe a data da venda.' };
    if (!Array.isArray(c.itens) || c.itens.length === 0)
        return { erro: 'Adicione pelo menos um item à venda.' };
    if (c.itens.length > exports.LIMITE_DE_ITENS_NO_FECHAMENTO)
        return { erro: `A venda pode ter no máximo ${exports.LIMITE_DE_ITENS_NO_FECHAMENTO} itens. Divida em duas vendas.` };
    const itens = [];
    for (const bruto of c.itens) {
        const i = (bruto && typeof bruto === 'object' ? bruto : {});
        const nome = texto(i.nome, 200) || 'item';
        const id = String(i.id ?? '');
        if (!id || (id !== 'avulso' && !ID_VALIDO.test(id)))
            return { erro: `${nome}: produto inválido. Remova o item e lance de novo.` };
        // Bonificacao (30/10/2026): item de brinde vai a preco zero, sem desconto; o preco cheio
        // (precoReferencia) so' serve para a NF-e e para o limite. Ver bonificacaoDomain.ts.
        const bonificado = i.bonificado === true;
        const precoReferencia = numero(i.precoReferencia);
        if (bonificado && !(precoReferencia >= 0))
            return { erro: `${nome}: valor da bonificação inválido. Volte o item para cobrado e bonifique de novo.` };
        const precoUnitario = bonificado ? 0 : numero(i.precoUnitario);
        const quantidade = numero(i.quantidade);
        const desconto = bonificado || i.desconto === undefined || i.desconto === null || i.desconto === '' ? 0 : numero(i.desconto);
        if (!(precoUnitario >= 0))
            return { erro: `${nome}: preço inválido.` };
        if (!(quantidade > 0))
            return { erro: `${nome}: a quantidade deve ser maior que zero.` };
        if (!(desconto >= 0))
            return { erro: `${nome}: desconto inválido.` };
        if (desconto > precoUnitario * quantidade + 0.005)
            return { erro: `${nome}: o desconto é maior que o valor do item.` };
        const lotes = (0, exports.lerLotes)(i.lotes);
        if (lotes === null)
            return { erro: `${nome}: lote inválido. Remova o item e lance de novo.` };
        const fator = i.fatorConversao === undefined || i.fatorConversao === null ? undefined : numero(i.fatorConversao);
        if (fator !== undefined && !(fator > 0))
            return { erro: `${nome}: unidade de venda inválida.` };
        const item = { ...i, id, nome, precoUnitario, quantidade, desconto, subtotal: 0 };
        item.subtotal = (0, exports.subtotalDaLinha)(item);
        if (bonificado) {
            item.bonificado = true;
            item.precoReferencia = precoReferencia;
        }
        else {
            delete item.bonificado;
            delete item.precoReferencia;
        }
        if (fator !== undefined)
            item.fatorConversao = fator;
        if (lotes.length > 0)
            item.lotes = lotes;
        else
            delete item.lotes;
        itens.push(item);
    }
    const dg = (c.descontoGeral && typeof c.descontoGeral === 'object' ? c.descontoGeral : {});
    const valorInformado = dg.valorInformado === undefined || dg.valorInformado === '' ? 0 : numero(dg.valorInformado);
    if (!(valorInformado >= 0))
        return { erro: 'Desconto geral inválido.' };
    const frete = c.frete === undefined || c.frete === '' ? 0 : numero(c.frete);
    const encargos = c.encargos === undefined || c.encargos === '' ? 0 : numero(c.encargos);
    if (!(frete >= 0))
        return { erro: 'Frete inválido.' };
    if (!(encargos >= 0))
        return { erro: 'Encargos inválidos.' };
    // Pedido de bonificacao (30/10/2026): sempre um pedido ja' gravado e sem pagamento.
    const ehBonificacao = c.tipoPedido === 'bonificacao';
    if (ehBonificacao && !pedidoId)
        return { erro: 'Bonificação sem pedido gravado. Atualize a tela e tente de novo.' };
    if (ehBonificacao && Array.isArray(c.pagamentos) && c.pagamentos.length > 0)
        return { erro: 'Bonificação não tem pagamento: é mercadoria sem cobrança.' };
    if (!ehBonificacao && (!Array.isArray(c.pagamentos) || c.pagamentos.length === 0))
        return { erro: 'Informe a forma de pagamento.' };
    const listaDePagamentos = Array.isArray(c.pagamentos) ? c.pagamentos : [];
    if (listaDePagamentos.length > 60)
        return { erro: 'Pagamentos demais nesta venda. Junte os pagamentos da mesma forma.' };
    const vendedorId = String(c.vendedorId ?? '');
    if (vendedorId && !ID_VALIDO.test(vendedorId))
        return { erro: 'Vendedor inválido. Escolha o vendedor de novo.' };
    const clienteId = c.clienteId ? String(c.clienteId) : null;
    if (clienteId && !ID_VALIDO.test(clienteId))
        return { erro: 'Cliente inválido. Escolha o cliente de novo.' };
    const orcamentoId = c.orcamentoId ? String(c.orcamentoId) : null;
    if (orcamentoId && !ID_VALIDO.test(orcamentoId))
        return { erro: 'Orçamento de origem inválido.' };
    const pdvSessionId = c.pdvSessionId ? String(c.pdvSessionId) : null;
    if (pdvSessionId && !ID_VALIDO.test(pdvSessionId))
        return { erro: 'Caixa do PDV inválido. Feche e abra o PDV de novo.' };
    const comprovanteVendedorId = c.comprovanteVendedorId ? String(c.comprovanteVendedorId) : null;
    if (comprovanteVendedorId && !ID_VALIDO.test(comprovanteVendedorId))
        return { erro: 'Identificação do vendedor inválida. Finalize de novo e digite o código e a senha.' };
    return {
        pedido: {
            pedidoId,
            idDocumento: pedidoId ? null : idDocumento,
            vendedorId,
            clienteId,
            clienteNome: texto(c.clienteNome, 200).toUpperCase() || 'CONSUMIDOR FINAL',
            observacao: texto(c.observacao, 2000),
            dataVenda,
            itens,
            descontoGeral: {
                tipo: dg.tipo === 'percentual' ? 'percentual' : 'valor',
                valorInformado,
                excedeuLimite: dg.excedeuLimite === true,
                ...(dg.aprovacao && typeof dg.aprovacao === 'object' ? { aprovacao: dg.aprovacao } : {}),
            },
            frete,
            encargos,
            transporte: (0, transporteNotaDomain_1.transporteParaGravar)((0, transporteNotaDomain_1.lerTransporte)(c.transporte)),
            pagamentos: listaDePagamentos.map((p) => (p && typeof p === 'object' ? p : {})),
            orcamentoId,
            pdvSessionId,
            comprovanteVendedorId,
            entregaFutura: c.entregaFutura === true,
            ehBonificacao,
            previsaoEntrega: DATA_VALIDA.test(String(c.previsaoEntrega ?? '')) ? String(c.previsaoEntrega) : '',
            comNotaFiscal: typeof c.comNotaFiscal === 'boolean' ? c.comNotaFiscal : null,
        },
    };
};
exports.lerPedidoDeFechamento = lerPedidoDeFechamento;
/** Chave da empresa: liga o fechamento pelo servidor (SuperAdmin, por empresa). */
const parseVendaPeloServidor = (valor) => valor === true;
exports.parseVendaPeloServidor = parseVendaPeloServidor;
/**
 * "Nota" (Pagamento a Prazo) na Frente de Caixa (25/11/2026, Jomarly).
 * Caixa de marcar da filial, desligada por padrao: o caixa so' tinha
 * dinheiro, Pix, cartao e cheque. Ligada, o pagamento ganha "Pagamento a
 * Prazo" com as mesmas regras do Pedido de Venda (cliente identificado,
 * limite de credito, bloqueio por atraso) e gera o titulo no Contas a Receber.
 */
const parseAPrazoNaFrenteDeCaixa = (valor) => valor === true;
exports.parseAPrazoNaFrenteDeCaixa = parseAPrazoNaFrenteDeCaixa;
exports.FORMA_A_PRAZO = 'Pagamento a Prazo';
/**
 * O que impede a venda a prazo no caixa, ou null. `clienteId` vazio ou o
 * cliente padrao (consumidor final) = sem cliente identificado.
 */
const erroDoAPrazoNoCaixa = (formas, opcoes) => {
    if (!formas.some((forma) => forma === exports.FORMA_A_PRAZO))
        return null;
    if (!opcoes.ativo) {
        return 'A venda a prazo não está liberada na Frente de Caixa desta filial. Para liberar, marque "Frente de Caixa: aceitar Pagamento a Prazo (nota)" em Configurações da Filial, ou faça a venda pelo Pedido de Venda.';
    }
    if (!String(opcoes.clienteId ?? '').trim() || opcoes.clienteEhPadrao) {
        return 'Venda a prazo precisa do cliente identificado. Escolha o cliente (F2) e abra o pagamento de novo.';
    }
    return null;
};
exports.erroDoAPrazoNoCaixa = erroDoAPrazoNoCaixa;
/**
 * FORMA DE PAGAMENTO ESCOLHIDA PELO VENDEDOR NO APP (25/11/2026, pedido do dono
 * pela Embala Minas). O vendedor escolhe a forma no pedido do app; a pre-venda
 * ja' nasce com ela (`formaPagamentoVendedor`). Decisao do dono: so' quem tem a
 * permissao "trocar a forma escolhida pelo vendedor" fatura com outra forma.
 * Credito de devolucao e cashback sao abatimento do cliente, nao troca de forma.
 */
exports.PERMISSAO_TROCAR_FORMA_DO_VENDEDOR = 'vendas.trocar_forma_do_vendedor';
exports.CAMPO_FORMA_DO_VENDEDOR = 'formaPagamentoVendedor';
const FORMAS_QUE_SO_ABATEM = ['Crédito de Devolução', 'Cashback'];
/** Forma escolhida pelo vendedor gravada no pedido ('' quando nao ha'). */
const formaDoVendedor = (pedido) => (typeof pedido?.[exports.CAMPO_FORMA_DO_VENDEDOR] === 'string' ? String(pedido[exports.CAMPO_FORMA_DO_VENDEDOR]).trim() : '');
exports.formaDoVendedor = formaDoVendedor;
/**
 * Parcelas do boleto escolhidas pelo vendedor no app (26/11/2026, pedido do dono:
 * "igual na tela de pedidos, pra ja' cair pre-definido na pre-venda"). So' com a
 * forma Boleto. A pre-venda abre com elas; o intervalo e' o prazo do boleto da loja.
 */
exports.CAMPO_PARCELAS_DO_BOLETO = 'parcelasBoleto';
exports.MAX_PARCELAS_DO_BOLETO_NO_APP = 12;
/** 1..12 quando valido; 0 = nao informado (a loja decide ao faturar). */
const parcelasDoBoleto = (valor) => {
    const n = typeof valor === 'number' ? valor : Number.parseInt(String(valor ?? ''), 10);
    return Number.isInteger(n) && n >= 1 && n <= exports.MAX_PARCELAS_DO_BOLETO_NO_APP ? n : 0;
};
exports.parcelasDoBoleto = parcelasDoBoleto;
/** Por que a venda nao pode sair com estas formas, ou null. */
const erroDaFormaDoVendedor = (args) => {
    const escolhida = String(args.formaDoVendedor || '').trim();
    if (!escolhida || args.podeTrocar)
        return null;
    const trocadas = args.formasDaVenda
        .map((f) => String(f ?? '').trim())
        .filter((f) => f && f !== escolhida && !FORMAS_QUE_SO_ABATEM.includes(f));
    if (trocadas.length === 0)
        return null;
    const numero = args.numeroPedido ? ` #${args.numeroPedido}` : '';
    return `O vendedor escolheu "${escolhida}" na pré-venda${numero}. Para receber em outra forma é preciso a permissão `
        + '"Vendas: Pré-venda — Trocar a forma de pagamento escolhida pelo vendedor" (Usuários). '
        + `Receba em ${escolhida} ou peça a um responsável.`;
};
exports.erroDaFormaDoVendedor = erroDaFormaDoVendedor;
