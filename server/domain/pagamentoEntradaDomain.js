"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.erroDoPagamentoAVista = exports.CATEGORIAS_DE_COMPRA = exports.formaDoPagamentoNaEntrada = exports.destinoDaParcelaPaga = exports.redistribuirValores = exports.trocarFormaPadrao = exports.formaDaParcela = exports.FORMA_CHEQUE = exports.FORMAS_DE_PAGAMENTO = exports.diasAteVencer = exports.conferirParcelas = exports.dividirEmParcelas = exports.parcelasIniciais = exports.PRAZO_PADRAO_DIAS = void 0;
const dateTime_1 = require("./dateTime");
const financeDomain_1 = require("./financeDomain");
exports.PRAZO_PADRAO_DIAS = 30;
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
/** Parcelas que a tela mostra ao abrir a nota: as duplicatas do XML, ou uma so' (emissao + 30 dias). */
const parcelasIniciais = (duplicatas, dataEmissao, totalDaNota) => {
    const validas = duplicatas.filter((d) => d.valor > 0);
    if (validas.length > 0) {
        return validas.map((d, indice) => ({
            numero: d.numero || String(indice + 1),
            vencimento: DATA_ISO.test(d.vencimento) ? d.vencimento : dataEmissao,
            valor: (0, financeDomain_1.fromCents)((0, financeDomain_1.toCents)(d.valor)),
        }));
    }
    return [{ numero: '1', vencimento: (0, dateTime_1.addDaysToDateInput)(dataEmissao, exports.PRAZO_PADRAO_DIAS), valor: (0, financeDomain_1.fromCents)((0, financeDomain_1.toCents)(totalDaNota)) }];
};
exports.parcelasIniciais = parcelasIniciais;
/**
 * Divide o total em N parcelas iguais (centavo que sobra vai para as primeiras),
 * a primeira vencendo em `primeiroVencimento` e as outras a cada `intervaloDias`.
 */
const dividirEmParcelas = (totalDaNota, quantidade, primeiroVencimento, intervaloDias = 30) => {
    const n = Math.max(1, Math.min(60, Math.floor(quantidade) || 1));
    const valores = (0, financeDomain_1.splitCents)((0, financeDomain_1.toCents)(totalDaNota), n);
    return valores.map((centavos, indice) => ({
        numero: String(indice + 1),
        vencimento: (0, dateTime_1.addDaysToDateInput)(primeiroVencimento, indice * intervaloDias) || primeiroVencimento,
        valor: (0, financeDomain_1.fromCents)(centavos),
    }));
};
exports.dividirEmParcelas = dividirEmParcelas;
const formatar = (valor) => valor.toFixed(2).replace('.', ',');
const conferirParcelas = (parcelas, totalDaNota) => {
    const soma = (0, financeDomain_1.fromCents)(parcelas.reduce((total, p) => total + (0, financeDomain_1.toCents)(p.valor), 0));
    const diferenca = (0, financeDomain_1.fromCents)((0, financeDomain_1.toCents)(soma) - (0, financeDomain_1.toCents)(totalDaNota));
    let erro = null;
    if (parcelas.length === 0)
        erro = 'Informe ao menos uma parcela.';
    else {
        const invalida = parcelas.findIndex((p) => !DATA_ISO.test(p.vencimento));
        if (invalida >= 0)
            erro = `A parcela ${invalida + 1} está sem data de vencimento válida.`;
        else {
            const semValor = parcelas.findIndex((p) => !((0, financeDomain_1.toCents)(p.valor) > 0));
            if (semValor >= 0)
                erro = `A parcela ${semValor + 1} precisa ter valor maior que zero.`;
        }
    }
    const aviso = !erro && diferenca !== 0
        ? `As parcelas somam R$ ${formatar(soma)}, mas a nota é de R$ ${formatar(totalDaNota)} (${diferenca > 0 ? 'sobram' : 'faltam'} R$ ${formatar(Math.abs(diferenca))}). Confira antes de lançar.`
        : null;
    return { soma, diferenca, ok: !erro && diferenca === 0, erro, aviso };
};
exports.conferirParcelas = conferirParcelas;
/** Dias entre a emissao da nota e o vencimento (para mostrar "30 dias"). */
const diasAteVencer = (emissao, vencimento) => {
    if (!DATA_ISO.test(emissao) || !DATA_ISO.test(vencimento))
        return null;
    const dias = Math.round((Date.parse(`${vencimento}T00:00:00Z`) - Date.parse(`${emissao}T00:00:00Z`)) / 86400000);
    return Number.isFinite(dias) ? dias : null;
};
exports.diasAteVencer = diasAteVencer;
exports.FORMAS_DE_PAGAMENTO = ['Boleto', 'Transferência', 'PIX', 'Dinheiro', 'Cheque', 'Cartão', 'Outros'];
exports.FORMA_CHEQUE = 'Cheque';
/*
 * FORMA POR PARCELA (pedido do dono, 24/11/2026): o cliente quer ver no Contas
 * a Pagar o que tem a pagar em boleto e o que tem em cheque, como lancou na
 * nota. Cada parcela tem a sua forma; a forma do topo do cartao vira a forma
 * PADRAO das parcelas.
 */
/** Forma efetiva da parcela: a dela, ou a padrao do cartao. */
const formaDaParcela = (parcela, formaPadrao) => (String(parcela.forma ?? '').trim() || formaPadrao);
exports.formaDaParcela = formaDaParcela;
/**
 * Trocar a forma padrao aplica a nova as parcelas que ainda estavam na
 * anterior; a parcela que a pessoa ja' mudou para outra forma fica como esta'.
 */
const trocarFormaPadrao = (parcelas, formaAnterior, formaNova) => (parcelas.map((parcela) => ((0, exports.formaDaParcela)(parcela, formaAnterior) === formaAnterior ? { ...parcela, forma: formaNova } : parcela)));
exports.trocarFormaPadrao = trocarFormaPadrao;
/** Reparte o total entre as parcelas que ja' existem (datas e formas ficam). */
const redistribuirValores = (parcelas, total) => {
    if (parcelas.length === 0)
        return parcelas;
    const valores = (0, financeDomain_1.splitCents)((0, financeDomain_1.toCents)(total), parcelas.length);
    return parcelas.map((parcela, indice) => ({ ...parcela, valor: (0, financeDomain_1.fromCents)(valores[indice]) }));
};
exports.redistribuirValores = redistribuirValores;
/** De onde saiu a parcela ja' paga: cheque, sempre do banco; dinheiro, do caixa (se nada foi escolhido); o resto, do banco. */
const destinoDaParcelaPaga = (parcela, formaPadrao) => {
    const forma = (0, exports.formaDaParcela)(parcela, formaPadrao);
    if (forma === exports.FORMA_CHEQUE)
        return 'banco';
    return parcela.destino || (forma === 'Dinheiro' ? 'caixa' : 'banco');
};
exports.destinoDaParcelaPaga = destinoDaParcelaPaga;
/**
 * Forma gravada no titulo que ja' nasce PAGO na entrada (a nota inteira a
 * vista, ou uma parcela marcada como ja' paga). A mesma regra de sempre do
 * "A vista (ja' paga na entrada)": saiu do caixa e' Dinheiro; saiu do banco e'
 * a forma escolhida (dinheiro tirado do banco vira Transferencia).
 */
const formaDoPagamentoNaEntrada = (destino, forma) => {
    if (destino !== 'banco')
        return 'Dinheiro';
    return forma === 'Dinheiro' ? 'Transferência' : forma;
};
exports.formaDoPagamentoNaEntrada = formaDoPagamentoNaEntrada;
/** Categorias de despesa oferecidas na entrada. A primeira e' a que sempre foi usada. */
exports.CATEGORIAS_DE_COMPRA = ['FORNECEDORES DE PEÇAS', 'MATÉRIA-PRIMA', 'MERCADORIA PARA REVENDA', 'MATERIAL DE CONSUMO', 'OUTROS'];
/** Erro em portugues de pagamento a vista sem banco escolhido, ou null. */
const erroDoPagamentoAVista = (dados) => (dados.destino === 'banco' && !dados.bancoId.trim()
    ? 'Escolha de qual banco saiu o pagamento, ou marque "Caixa" se foi em dinheiro.'
    : null);
exports.erroDoPagamentoAVista = erroDoPagamentoAVista;
