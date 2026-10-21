"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lerPedidoDeAlteracaoDePagamento = exports.lerPedidoDeCancelamentoDaPreVenda = exports.lerPedidoDeCancelamento = exports.bloqueioDoCreditoNaAlteracao = exports.bloqueioParaAlterarPagamento = exports.estornoDosTitulosDaVenda = exports.estornoDosTitulos = exports.camposDoCreditoDevolvido = exports.idDoCreditoDevolvido = exports.creditoUsadoNaVenda = exports.FORMA_CREDITO_DEVOLUCAO = exports.erroDaRotaParaCancelar = exports.erroDoMotivoDoCancelamento = exports.MOTIVO_CANCELAMENTO_MAXIMO = exports.MOTIVO_CANCELAMENTO_MINIMO = void 0;
const financeDomain_1 = require("./financeDomain");
const cashbackDomain_1 = require("./cashbackDomain");
/*
 * CANCELAR VENDA E ALTERAR A FORMA DE PAGAMENTO (item 8, fatia 3b -- 19/10/2026).
 *
 * Regra pura usada pela tela (caminho de hoje, chave "Venda pelo servidor"
 * desligada) e pelo servidor (server/services/vendaCancelamento.js, chave
 * ligada): o sistema tem um comportamento so'.
 *
 * Decisoes do dono (19/10/2026, caixa de perguntas):
 *  - cancelar devolve ao cliente o credito de devolucao usado na venda (antes
 *    ele perdia o credito);
 *  - cancelar pede MOTIVO (gravado na venda e no log);
 *  - pedido numa rota de entrega em aberto so' cancela depois de sair da rota;
 *  - alterar a forma de pagamento fica bloqueado quando alguma parcela ja' foi
 *    recebida no Contas a Receber, tem recebimento parcial, cheque compensado
 *    ou boleto emitido (antes o recebimento era sobrescrito sem aviso).
 *
 * Sem tela, sem Firestore: os campos devolvidos aqui nao tem data do servidor
 * nem metadados -- quem grava acrescenta.
 */
// ---------------------------------------------------------------------------
// MOTIVO DO CANCELAMENTO
// ---------------------------------------------------------------------------
exports.MOTIVO_CANCELAMENTO_MINIMO = 5;
exports.MOTIVO_CANCELAMENTO_MAXIMO = 300;
/** Erro do motivo digitado (null = ok). */
const erroDoMotivoDoCancelamento = (motivo) => {
    const texto = String(motivo ?? '').trim();
    if (texto.length < exports.MOTIVO_CANCELAMENTO_MINIMO)
        return `Escreva o motivo do cancelamento (mínimo ${exports.MOTIVO_CANCELAMENTO_MINIMO} letras).`;
    if (texto.length > exports.MOTIVO_CANCELAMENTO_MAXIMO)
        return `O motivo pode ter no máximo ${exports.MOTIVO_CANCELAMENTO_MAXIMO} letras.`;
    return null;
};
exports.erroDoMotivoDoCancelamento = erroDoMotivoDoCancelamento;
/** Pedido numa rota em aberto nao cancela: a rota continuaria levando o pedido. */
const erroDaRotaParaCancelar = (trava, numeroPedido) => {
    if (!trava || !trava.romaneioId || trava.situacao !== 'em_romaneio')
        return null;
    const rota = String(trava.romaneioTitulo || '').trim() || 'uma rota de entrega';
    return `O pedido #${numeroPedido} está na rota "${rota}", que ainda não foi fechada. Tire o pedido da rota (Romaneio de Entrega) antes de cancelar a venda.`;
};
exports.erroDaRotaParaCancelar = erroDaRotaParaCancelar;
// ---------------------------------------------------------------------------
// CREDITO DE DEVOLUCAO USADO NA VENDA
// ---------------------------------------------------------------------------
exports.FORMA_CREDITO_DEVOLUCAO = 'Crédito de Devolução';
/** Quanto da venda foi pago com credito de devolucao (centavos). */
const creditoUsadoNaVenda = (pagamentos) => ((Array.isArray(pagamentos) ? pagamentos : [])
    .filter((p) => p && p.formaPagamento === exports.FORMA_CREDITO_DEVOLUCAO)
    .reduce((soma, p) => soma + Math.max(0, Number(p.valorCentavos ?? (0, financeDomain_1.toCents)(Number(p.valor || 0))) || 0), 0));
exports.creditoUsadoNaVenda = creditoUsadoNaVenda;
/** Id fixo: cancelar duas vezes nunca devolve o credito em dobro. */
const idDoCreditoDevolvido = (pedidoId) => `cancelamento_${pedidoId}`;
exports.idDoCreditoDevolvido = idDoCreditoDevolvido;
/**
 * Credito devolvido ao cliente no cancelamento. Mesmo formato do credito que a
 * Devolucao cria (DevolucaoVendaModal) -- e' pelo NOME do cliente que o Pedido
 * de Venda e o Contas a Receber procuram o credito.
 */
const camposDoCreditoDevolvido = (args) => ({
    clienteNome: String(args.clienteNome || '').trim().toUpperCase(),
    pedidoOrigemId: args.pedidoId,
    numeroPedidoOriginal: args.numeroPedido,
    valorOriginal: (0, financeDomain_1.fromCents)(args.valorCentavos),
    saldoDisponivel: (0, financeDomain_1.fromCents)(args.valorCentavos),
    saldoDisponivelCentavos: args.valorCentavos,
    status: 'disponivel',
    origem: 'cancelamento_venda',
    motivo: `Crédito usado na venda #${args.numeroPedido}, devolvido no cancelamento da venda.`,
    tenantId: args.tenantId,
});
exports.camposDoCreditoDevolvido = camposDoCreditoDevolvido;
const numero = (valor, padrao = 0) => {
    const n = Number(valor);
    return Number.isFinite(n) ? n : padrao;
};
/** O que muda entre o cancelamento da venda e o da OS (fatia 3d, 19/10/2026). */
const ROTULOS_DO_ESTORNO = {
    venda: {
        campoOrigem: 'pedidoId',
        sourceType: 'cancelamento_pedido_venda',
        categoria: 'Cancelamento de Venda',
        documento: 'da venda',
        notaEstornada: 'Estornada pelo cancelamento da venda',
        notaCancelada: 'Cancelada junto com a venda',
    },
    os: {
        campoOrigem: 'osId',
        sourceType: 'cancelamento_ordem_servico',
        categoria: 'Cancelamento de OS',
        documento: 'da OS',
        notaEstornada: 'Estornada pelo cancelamento da OS',
        notaCancelada: 'Cancelada junto com a OS',
    },
};
/**
 * Pago vira "estornado" + um lancamento de saida que devolve o dinheiro (mesma
 * forma de pagamento); o que estava em aberto e' so' cancelado. Mesmos campos
 * que o cancelamento pela tela sempre gravou. Lancamento ja' cancelado fica como
 * esta'. Serve a venda e a OS (`tipo`).
 */
const estornoDosTitulos = (titulos, args, tipo) => {
    const rotulos = ROTULOS_DO_ESTORNO[tipo];
    const escritas = { atualizar: [], criar: [] };
    titulos.forEach(({ id, dados }) => {
        if (dados.status === 'Cancelada')
            return;
        if (dados.status === 'Paga') {
            const cartao = (dados.cartao || null);
            const valorCentavos = numero(dados.valorCentavos ?? (0, financeDomain_1.toCents)(numero(dados.valor)));
            const movimentaCaixa = (0, financeDomain_1.transactionMovesPhysicalCash)(dados);
            escritas.atualizar.push({ id, campos: { estornada: true, statusOperacional: 'Cancelada' }, nota: rotulos.notaEstornada });
            escritas.criar.push({
                id: `estorno_cancelamento_${id}`,
                campos: {
                    descricao: `Estorno do cancelamento ${rotulos.documento} #${args.numero}`,
                    categoria: rotulos.categoria,
                    valor: numero(dados.valor),
                    valorCentavos,
                    valorBruto: numero(dados.valorBruto ?? dados.valor),
                    valorBrutoCentavos: numero(dados.valorBrutoCentavos ?? dados.valorCentavos ?? (0, financeDomain_1.toCents)(numero(dados.valor))),
                    valorTaxa: numero(dados.valorTaxa ?? cartao?.valorTaxa),
                    valorTaxaCentavos: numero(dados.valorTaxaCentavos ?? cartao?.valorTaxaCentavos),
                    valorLiquido: numero(dados.valorLiquido ?? cartao?.valorLiquido ?? dados.valor),
                    valorLiquidoCentavos: numero(dados.valorLiquidoCentavos ?? cartao?.valorLiquidoCentavos ?? dados.valorCentavos ?? (0, financeDomain_1.toCents)(numero(dados.valor))),
                    cartao: cartao || null,
                    tipo: 'saida',
                    formaPagamento: String(dados.formaPagamento || 'Outros'),
                    naturezaFinanceira: movimentaCaixa ? 'caixa_fisico' : String(dados.naturezaFinanceira || 'bancario_digital'),
                    movimentaCaixaFisico: movimentaCaixa,
                    status: 'Paga',
                    data: args.hoje,
                    [rotulos.campoOrigem]: args.documentoId,
                    sourceType: rotulos.sourceType,
                    sourceId: args.documentoId,
                    sourcePaymentTransactionId: id,
                    idempotencyKey: `cancelamento:${args.documentoId}:transacao:${id}`,
                    clienteNome: args.clienteNome,
                    usuarioResponsavelId: args.usuarioId,
                    tenantId: args.tenantId,
                },
            });
            return;
        }
        escritas.atualizar.push({ id, campos: { status: 'Cancelada', movimentaCaixaFisico: false }, nota: rotulos.notaCancelada });
    });
    return escritas;
};
exports.estornoDosTitulos = estornoDosTitulos;
const estornoDosTitulosDaVenda = (titulos, args) => (0, exports.estornoDosTitulos)(titulos, {
    documentoId: args.pedidoId,
    numero: args.numeroPedido,
    clienteNome: args.clienteNome,
    usuarioId: args.usuarioId,
    tenantId: args.tenantId,
    hoje: args.hoje,
}, 'venda');
exports.estornoDosTitulosDaVenda = estornoDosTitulosDaVenda;
// ---------------------------------------------------------------------------
// ALTERAR A FORMA DE PAGAMENTO
// ---------------------------------------------------------------------------
const dataBr = (dia) => {
    const texto = String(dia ?? '');
    return /^\d{4}-\d{2}-\d{2}/.test(texto) ? texto.slice(0, 10).split('-').reverse().join('/') : '';
};
const reais = (centavos) => `R$ ${(0, financeDomain_1.fromCents)(centavos).toFixed(2).replace('.', ',')}`;
/**
 * Parcela que ja' teve dinheiro recebido depois da venda (Dar Baixa, recebimento
 * parcial, cheque compensado) ou que tem boleto emitido: refazer as parcelas
 * apagaria isso sem ninguem perceber. Pagamento que JA' NASCEU pago (dinheiro,
 * Pix na hora) nao conta -- e' justamente o que a alteracao corrige.
 * `contexto` (fatia 3d): a OS usa a mesma regra para reabrir.
 */
const bloqueioParaAlterarPagamento = (titulos, contexto = {}) => {
    const documento = contexto.documento || 'venda';
    const fazer = contexto.acao || 'alterar a forma de pagamento';
    for (const t of titulos) {
        if (!t || t.status === 'Cancelada' || t.estornada === true)
            continue;
        const descricao = String(t.descricao || `da ${documento}`);
        const acao = `Estorne o recebimento em Contas a Receber antes de ${fazer}.`;
        if (t.parcialDaTransacaoId) {
            return `Esta ${documento} tem um recebimento parcial de ${reais(numero(t.valorCentavos))}${dataBr(t.dataPagamento) ? ` em ${dataBr(t.dataPagamento)}` : ''}. ${acao}`;
        }
        if (numero(t.pagoParcialCentavos) > 0) {
            return `A parcela "${descricao}" já tem ${reais(numero(t.pagoParcialCentavos))} recebidos por partes. ${acao}`;
        }
        const boleto = t.boleto;
        if (boleto && boleto.status !== 'cancelado') {
            return `A parcela "${descricao}" tem boleto emitido. Desfaça a emissão em Financeiro › Boletos antes de ${fazer}.`;
        }
        if (t.status === 'Paga' && (t.formaPagamento === 'Cheque' || t.cheque)) {
            return contexto.acao
                ? `O cheque da parcela "${descricao}" já foi compensado. Não é possível ${fazer} depois do cheque compensado.`
                : `O cheque da parcela "${descricao}" já foi compensado. A forma de pagamento não pode mais ser alterada por aqui.`;
        }
        if (t.status === 'Paga' && t.baixaManual) {
            return `A parcela "${descricao}" já foi recebida${dataBr(t.dataPagamento) ? ` em ${dataBr(t.dataPagamento)}` : ''} no Contas a Receber. ${acao}`;
        }
    }
    return null;
};
exports.bloqueioParaAlterarPagamento = bloqueioParaAlterarPagamento;
/** Crédito de devolução e cashback não se trocam por aqui: o saldo ja' foi consumido (ou nao) na venda. */
const bloqueioDoCreditoNaAlteracao = (pagamentosAntigos, pagamentosNovos) => {
    if ((0, exports.creditoUsadoNaVenda)(pagamentosAntigos) !== (0, exports.creditoUsadoNaVenda)(pagamentosNovos)) {
        return 'Venda paga com crédito de devolução não muda a parte do crédito por aqui. Para trocar, cancele a venda (o crédito volta para o cliente) e faça a venda de novo.';
    }
    if ((0, cashbackDomain_1.cashbackUsadoNaVenda)(pagamentosAntigos) !== (0, cashbackDomain_1.cashbackUsadoNaVenda)(pagamentosNovos)) {
        return 'Venda paga com cashback não muda a parte do cashback por aqui. Para trocar, cancele a venda (o cashback volta para o cliente) e faça a venda de novo.';
    }
    return null;
};
exports.bloqueioDoCreditoNaAlteracao = bloqueioDoCreditoNaAlteracao;
// ---------------------------------------------------------------------------
// O QUE A TELA MANDA AO SERVIDOR (POST /api/vendas/...)
// ---------------------------------------------------------------------------
const ID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;
const lerPedidoId = (c) => {
    const id = String(c.pedidoId ?? '');
    return ID_VALIDO.test(id) ? id : null;
};
/** POST /api/vendas/cancelar: { pedidoId, motivo }. */
const lerPedidoDeCancelamento = (corpo) => {
    const c = (corpo && typeof corpo === 'object' ? corpo : {});
    const pedidoId = lerPedidoId(c);
    if (!pedidoId)
        return { erro: 'Venda inválida. Atualize a tela e tente de novo.' };
    const erro = (0, exports.erroDoMotivoDoCancelamento)(c.motivo);
    if (erro)
        return { erro };
    return { pedidoId, motivo: String(c.motivo).trim() };
};
exports.lerPedidoDeCancelamento = lerPedidoDeCancelamento;
/** POST /api/vendas/cancelar-pre-venda: { pedidoId, nota? }. */
/**
 * `soDoVendedor` (app Vendas, 21/10/2026): o app so' cancela pre-venda do
 * proprio vendedor -- o servidor confere com o vendedor gravado no pedido.
 */
const lerPedidoDeCancelamentoDaPreVenda = (corpo) => {
    const c = (corpo && typeof corpo === 'object' ? corpo : {});
    const pedidoId = lerPedidoId(c);
    if (!pedidoId)
        return { erro: 'Pré-venda inválida. Atualize a tela e tente de novo.' };
    return { pedidoId, nota: String(c.nota ?? '').trim().slice(0, 200) || 'Pré-venda cancelada', soDoVendedor: c.soDoVendedor === true };
};
exports.lerPedidoDeCancelamentoDaPreVenda = lerPedidoDeCancelamentoDaPreVenda;
/** POST /api/vendas/alterar-pagamento: { pedidoId, pagamentos } (rascunhos, como no Finalizar). */
const lerPedidoDeAlteracaoDePagamento = (corpo) => {
    const c = (corpo && typeof corpo === 'object' ? corpo : {});
    const pedidoId = lerPedidoId(c);
    if (!pedidoId)
        return { erro: 'Venda inválida. Atualize a tela e tente de novo.' };
    if (!Array.isArray(c.pagamentos) || c.pagamentos.length === 0)
        return { erro: 'Informe a forma de pagamento.' };
    if (c.pagamentos.length > 60)
        return { erro: 'Pagamentos demais nesta venda. Junte os pagamentos da mesma forma.' };
    return { pedidoId, pagamentos: c.pagamentos.map((p) => (p && typeof p === 'object' ? p : {})) };
};
exports.lerPedidoDeAlteracaoDePagamento = lerPedidoDeAlteracaoDePagamento;
