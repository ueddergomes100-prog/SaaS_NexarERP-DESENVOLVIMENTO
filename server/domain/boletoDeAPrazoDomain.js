"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.camposAoVoltarAPrazo = exports.camposAoGerarBoleto = exports.bloqueioParaVoltarAPrazo = exports.bloqueioParaGerarBoleto = exports.FORMA_A_PRAZO = void 0;
/*
 * BOLETO PARA PARCELA "PAGAMENTO A PRAZO" (pedido do dono, 15/10/2026).
 *
 * A tela de Boletos so' lista titulo com forma "Boleto"; a parcela de uma
 * venda a prazo nao tinha como virar boleto. "Gerar boleto" (Contas a Receber)
 * troca a forma da PARCELA para Boleto -- ela entra em Financeiro > Boletos,
 * aba "Aguardando emissao" -- e marca `boletoDeAPrazo`, para poder voltar:
 * "Voltar a prazo" (sem boleto emitido) ou "Desfazer emissao" em Boletos.
 *
 * A venda nao muda (a condicao dela continua a prazo). De proposito NAO usa
 * `formaPagamentoOriginal`: esse campo e' o que o estorno de uma baixa usa
 * para devolver a forma de antes, e ali tem de voltar "Boleto".
 */
const financeDomain_1 = require("./financeDomain");
exports.FORMA_A_PRAZO = 'Pagamento a Prazo';
/** Por que a parcela NAO pode virar boleto agora ('' = pode). */
const bloqueioParaGerarBoleto = (titulo) => {
    if (titulo.tipo && titulo.tipo !== 'entrada')
        return 'Só parcelas do Contas a Receber viram boleto.';
    if (titulo.status === 'Paga')
        return 'Esta parcela já foi recebida.';
    if (titulo.status === 'Cancelada')
        return 'Esta parcela está cancelada.';
    if (titulo.status === 'Renegociada')
        return 'Esta parcela foi renegociada. O boleto sai pelas parcelas da renegociação.';
    if (titulo.status !== 'Pendente')
        return 'Só parcelas em aberto viram boleto. Atualize a tela e tente de novo.';
    if (titulo.boleto)
        return 'Esta parcela já tem boleto emitido. Veja em Financeiro › Boletos.';
    if (titulo.formaPagamento === 'Boleto')
        return 'Esta parcela já é cobrada em boleto. Emita em Financeiro › Boletos, aba "Aguardando emissão".';
    if (titulo.formaPagamento !== exports.FORMA_A_PRAZO) {
        return `Só parcela "${exports.FORMA_A_PRAZO}" vira boleto por aqui. Esta é "${titulo.formaPagamento || 'sem forma'}".`;
    }
    if (!(titulo.dataVencimento || titulo.dataPrevistaRecebimento)) {
        return 'Esta parcela está sem data de vencimento, e o boleto precisa dela. Confira a venda de origem.';
    }
    return '';
};
exports.bloqueioParaGerarBoleto = bloqueioParaGerarBoleto;
/** Por que a parcela NAO pode voltar a ser "a prazo" agora ('' = pode). */
const bloqueioParaVoltarAPrazo = (titulo) => {
    if (!titulo.boletoDeAPrazo)
        return 'Esta parcela não foi convertida de "a prazo" para boleto.';
    if (titulo.status !== 'Pendente')
        return 'Só parcelas em aberto voltam a ser "a prazo".';
    if (titulo.boleto)
        return 'O boleto desta parcela já foi emitido. Desfaça a emissão em Financeiro › Boletos: ela volta a ser "a prazo" sozinha.';
    return '';
};
exports.bloqueioParaVoltarAPrazo = bloqueioParaVoltarAPrazo;
/** Campos gravados no titulo ao gerar o boleto. */
const camposAoGerarBoleto = () => ({
    formaPagamento: 'Boleto',
    naturezaFinanceira: (0, financeDomain_1.financialNatureForPayment)('Boleto'),
    boletoDeAPrazo: true,
});
exports.camposAoGerarBoleto = camposAoGerarBoleto;
/** Campos gravados ao voltar a ser "a prazo" (a marca `boletoDeAPrazo` sai em separado). */
const camposAoVoltarAPrazo = () => ({
    formaPagamento: exports.FORMA_A_PRAZO,
    naturezaFinanceira: (0, financeDomain_1.financialNatureForPayment)(exports.FORMA_A_PRAZO),
});
exports.camposAoVoltarAPrazo = camposAoVoltarAPrazo;
