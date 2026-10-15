"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.camposParaCobrarEmBoleto = exports.vencimentoSugeridoDoBoleto = exports.validarVencimentoDoBoleto = exports.bloqueioParaCobrarEmBoleto = exports.FORMA_BOLETO = void 0;
/*
 * COBRAR UMA PARCELA EM BOLETO PELO "DAR BAIXA" (pedido do dono, 15/10/2026).
 *
 * "A prazo" e' a condicao (crediario); boleto e' uma das formas de receber.
 * No "Dar Baixa" do Contas a Receber, quando a empresa tem banco preparado
 * para boleto, aparece a forma "Boleto": em vez de dar baixa, o sistema pede o
 * vencimento e EMITE o boleto na hora. Dali segue o caminho de qualquer
 * boleto: remessa e baixa automatica pelo retorno do banco. Sem atalho na
 * linha e sem volta para "a prazo" (decisoes do dono).
 *
 * Grava na parcela so' a forma (Boleto) e o vencimento escolhido; a venda nao
 * muda. De proposito NAO usa `formaPagamentoOriginal`: esse campo e' o que o
 * estorno de uma baixa usa para devolver a forma de antes, e ali tem de
 * voltar "Boleto".
 */
const financeDomain_1 = require("./financeDomain");
exports.FORMA_BOLETO = 'Boleto';
/** Por que a parcela NAO pode ser cobrada em boleto agora ('' = pode). */
const bloqueioParaCobrarEmBoleto = (titulo) => {
    if (titulo.tipo && titulo.tipo !== 'entrada')
        return 'Só parcelas do Contas a Receber são cobradas em boleto.';
    if (titulo.acrescimoDaTransacaoId)
        return 'Lançamento de juros e multa não é cobrado em boleto.';
    if (titulo.status === 'Paga')
        return 'Esta parcela já foi recebida.';
    if (titulo.status === 'Cancelada')
        return 'Esta parcela está cancelada.';
    if (titulo.status === 'Renegociada')
        return 'Esta parcela foi renegociada. O boleto sai pelas parcelas da renegociação.';
    if (titulo.status !== 'Pendente')
        return 'Só parcelas em aberto são cobradas em boleto. Atualize a tela e tente de novo.';
    if (titulo.boleto)
        return 'Esta parcela já tem boleto emitido. Veja em Financeiro › Boletos.';
    if ((0, financeDomain_1.isCardPayment)(String(titulo.formaPagamento || '')) || titulo.cartao)
        return 'Parcela de cartão é paga pela operadora e não vira boleto.';
    if (titulo.formaPagamento === 'Cheque' || titulo.cheque)
        return 'Esta parcela já tem cheque registrado e não vira boleto.';
    return '';
};
exports.bloqueioParaCobrarEmBoleto = bloqueioParaCobrarEmBoleto;
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const dataExiste = (data) => {
    if (!DATA_ISO.test(data))
        return false;
    const [a, m, d] = data.split('-').map(Number);
    const dt = new Date(Date.UTC(a, m - 1, d));
    return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};
/** Vencimento do boleto: data valida, de hoje em diante ('' = valido). */
const validarVencimentoDoBoleto = (vencimento, hoje) => {
    const data = String(vencimento ?? '').trim();
    if (!dataExiste(data))
        return 'Informe o vencimento do boleto.';
    if (data < hoje)
        return 'O vencimento do boleto não pode ser antes de hoje.';
    return '';
};
exports.validarVencimentoDoBoleto = validarVencimentoDoBoleto;
/** Vencimento sugerido: o da parcela; se ja' passou (ou nao tem), hoje. */
const vencimentoSugeridoDoBoleto = (vencimentoDaParcela, hoje) => {
    const data = String(vencimentoDaParcela || '');
    return dataExiste(data) && data >= hoje ? data : hoje;
};
exports.vencimentoSugeridoDoBoleto = vencimentoSugeridoDoBoleto;
/** Campos gravados na parcela antes de emitir: forma Boleto e o vencimento escolhido. */
const camposParaCobrarEmBoleto = (vencimento) => ({
    formaPagamento: exports.FORMA_BOLETO,
    naturezaFinanceira: (0, financeDomain_1.financialNatureForPayment)(exports.FORMA_BOLETO),
    data: vencimento,
    dataVencimento: vencimento,
    dataPrevistaRecebimento: vencimento,
});
exports.camposParaCobrarEmBoleto = camposParaCobrarEmBoleto;
