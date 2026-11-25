"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.camposDoTituloEmCheque = exports.erroDosCheques = exports.montarChequeDaParcela = exports.aplicarChequesNasParcelasEmCheque = exports.aplicarChequesNasParcelas = exports.numerarCheques = void 0;
const financeDomain_1 = require("./financeDomain");
const pagamentoEntradaDomain_1 = require("./pagamentoEntradaDomain");
/**
 * Numera os cheques em sequencia a partir do primeiro ("000123" -> "000123",
 * "000124"...), mantendo os zeros a esquerda. Numero nao numerico repete-se
 * com sufixo "-2", "-3"... para nao ficar tudo igual. Vazio -> todos vazios.
 */
const numerarCheques = (primeiroNumero, quantidade) => {
    const base = String(primeiroNumero ?? '').trim();
    const total = Math.max(0, Math.floor(quantidade));
    if (!base)
        return Array.from({ length: total }, () => '');
    if (/^\d+$/.test(base)) {
        const largura = base.length;
        const inicial = BigInt(base);
        return Array.from({ length: total }, (_, i) => (inicial + BigInt(i)).toString().padStart(largura, '0'));
    }
    return Array.from({ length: total }, (_, i) => (i === 0 ? base : `${base}-${i + 1}`));
};
exports.numerarCheques = numerarCheques;
/** Aplica numeracao e banco a todas as parcelas (o atalho "usar o mesmo banco / numerar a partir de"). */
const aplicarChequesNasParcelas = (parcelas, bancoId, primeiroNumero) => {
    const numeros = (0, exports.numerarCheques)(primeiroNumero, parcelas.length);
    return parcelas.map((parcela, indice) => ({
        ...parcela,
        ...(bancoId ? { bancoId } : {}),
        ...(numeros[indice] ? { numeroCheque: numeros[indice] } : {}),
    }));
};
exports.aplicarChequesNasParcelas = aplicarChequesNasParcelas;
/**
 * O mesmo atalho quando cada parcela tem a sua forma (24/11/2026): so' as
 * parcelas em cheque recebem o banco e a numeracao, em sequencia entre elas.
 */
const aplicarChequesNasParcelasEmCheque = (parcelas, formaPadrao, bancoId, primeiroNumero) => {
    const emCheque = parcelas.filter((parcela) => (0, pagamentoEntradaDomain_1.formaDaParcela)(parcela, formaPadrao) === pagamentoEntradaDomain_1.FORMA_CHEQUE);
    const aplicadas = (0, exports.aplicarChequesNasParcelas)(emCheque, bancoId, primeiroNumero);
    let proxima = 0;
    return parcelas.map((parcela) => ((0, pagamentoEntradaDomain_1.formaDaParcela)(parcela, formaPadrao) === pagamentoEntradaDomain_1.FORMA_CHEQUE ? aplicadas[proxima++] : parcela));
};
exports.aplicarChequesNasParcelasEmCheque = aplicarChequesNasParcelasEmCheque;
/**
 * Dados do cheque de UMA parcela, prontos para gravar no titulo. Erro em
 * portugues dizendo qual cheque e o que falta.
 */
const montarChequeDaParcela = (parcela, bancos) => {
    const posicao = `cheque da parcela ${parcela.numero}`;
    const banco = bancos.find((b) => b.id === parcela.bancoId);
    if (!parcela.bancoId || !banco)
        throw new Error(`Escolha o banco do ${posicao}.`);
    const numero = String(parcela.numeroCheque ?? '').trim();
    if (!numero)
        throw new Error(`Informe o número do ${posicao}.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(parcela.vencimento))
        throw new Error(`Informe a data de compensação do ${posicao}.`);
    return {
        bancoId: banco.id,
        bancoNome: banco.nome,
        cheque: (0, financeDomain_1.buildChequeDetails)({ bancoEmissor: banco.nome, numeroCheque: numero, dataCompensacao: parcela.vencimento }),
    };
};
exports.montarChequeDaParcela = montarChequeDaParcela;
/**
 * Primeiro problema dos cheques (banco, numero, data, numero repetido no mesmo
 * banco), em portugues, ou null se estiverem todos bons.
 */
const erroDosCheques = (parcelas, bancos) => {
    const vistos = new Set();
    for (const parcela of parcelas) {
        try {
            const montado = (0, exports.montarChequeDaParcela)(parcela, bancos);
            const chave = `${montado.bancoId}|${montado.cheque.numeroCheque}`;
            if (vistos.has(chave)) {
                return `O cheque nº ${montado.cheque.numeroCheque} do banco ${montado.bancoNome} aparece mais de uma vez. Cada cheque precisa de um número diferente.`;
            }
            vistos.add(chave);
        }
        catch (erro) {
            return erro.message;
        }
    }
    return null;
};
exports.erroDosCheques = erroDosCheques;
/** Campos do titulo (transacao de saida) de uma parcela paga em cheque. */
const camposDoTituloEmCheque = (parcela, bancos) => {
    const montado = (0, exports.montarChequeDaParcela)(parcela, bancos);
    return {
        // 'Cheque' na forma: a baixa no Contas a Pagar ja' abre em Cheque, com este
        // banco escolhido; o banco so' e' debitado nessa baixa (quando compensa).
        formaPagamento: 'Cheque',
        bancoId: montado.bancoId,
        bancoNome: montado.bancoNome,
        cheque: montado.cheque,
        dataPrevistaRecebimento: montado.cheque.dataCompensacao,
    };
};
exports.camposDoTituloEmCheque = camposDoTituloEmCheque;
