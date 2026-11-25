"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parcelaParaRegistro = exports.debitosDasParcelasPagas = exports.camposDoTituloDaParcela = exports.erroDasParcelasPorForma = exports.montarTitulosDaDespesa = exports.avisoDeSoma = exports.erroDaDespesa = void 0;
const financeDomain_1 = require("./financeDomain");
const chequeEmitidoDomain_1 = require("./chequeEmitidoDomain");
const pagamentoEntradaDomain_1 = require("./pagamentoEntradaDomain");
const FORMA_CHEQUE = 'Cheque';
/** Problema que IMPEDE lancar (em portugues, dizendo o que fazer), ou null. A soma que nao fecha e' tratada a parte. */
const erroDaDespesa = (dados, parcelas, totalDaDespesa, bancos) => {
    if (!dados.descricao.trim())
        return 'Informe a descrição da despesa.';
    if (!dados.categoria.trim())
        return 'Escolha a categoria da despesa.';
    if (!((0, financeDomain_1.toCents)(totalDaDespesa) > 0))
        return 'Informe o valor da despesa (maior que zero).';
    const conferencia = (0, pagamentoEntradaDomain_1.conferirParcelas)(parcelas, totalDaDespesa);
    if (conferencia.erro)
        return conferencia.erro;
    if (dados.forma === FORMA_CHEQUE)
        return (0, chequeEmitidoDomain_1.erroDosCheques)(parcelas, bancos);
    return null;
};
exports.erroDaDespesa = erroDaDespesa;
/** A soma das parcelas nao fecha com o total? (aviso, a tela pede confirmacao) */
const avisoDeSoma = (parcelas, totalDaDespesa) => ((0, pagamentoEntradaDomain_1.conferirParcelas)(parcelas, totalDaDespesa).aviso);
exports.avisoDeSoma = avisoDeSoma;
/**
 * Titulos da despesa, um por parcela. Com mais de uma parcela, a descricao ganha
 * "(Parcela i/n)" e todas levam o mesmo `grupoParcelasId` (para achar o
 * parcelamento inteiro depois).
 */
const montarTitulosDaDespesa = (dados, parcelas, bancos, grupoParcelasId) => {
    const total = parcelas.length;
    const descricaoBase = dados.descricao.toUpperCase().trim();
    const categoria = dados.categoria.toUpperCase().trim();
    return parcelas.map((parcela, indice) => {
        const cheque = dados.forma === FORMA_CHEQUE ? (0, chequeEmitidoDomain_1.camposDoTituloEmCheque)(parcela, bancos) : null;
        const centavos = (0, financeDomain_1.toCents)(parcela.valor);
        return {
            descricao: total > 1 ? `${descricaoBase} (Parcela ${indice + 1}/${total})` : descricaoBase,
            data: cheque ? cheque.cheque.dataCompensacao : parcela.vencimento,
            valor: (0, financeDomain_1.fromCents)(centavos),
            valorCentavos: centavos,
            categoria,
            status: 'Pendente',
            tipo: 'saida',
            formaPagamentoPrevista: dados.forma,
            ...(total > 1 ? { parcela: indice + 1, totalParcelas: total, grupoParcelasId } : {}),
            ...(dados.fornecedorId && dados.fornecedorNome ? { fornecedorId: dados.fornecedorId, fornecedorNome: dados.fornecedorNome } : {}),
            ...(dados.veiculoId ? { veiculoId: dados.veiculoId, veiculoNome: dados.veiculoNome || '', ...(dados.veiculoPlaca ? { veiculoPlaca: dados.veiculoPlaca } : {}) } : {}),
            ...(dados.motoristaId ? { motoristaId: dados.motoristaId, motoristaNome: dados.motoristaNome || '' } : {}),
            ...(cheque || {}),
        };
    });
};
exports.montarTitulosDaDespesa = montarTitulosDaDespesa;
/*
 * PARCELAS COM FORMA PROPRIA E PARCELA JA' PAGA (pedido do dono, 24/11/2026).
 *
 * Entrada de nota (XML e Nota Avulsa): cada parcela tem a sua forma (boleto,
 * cheque, PIX...) e pode nascer JA' PAGA -- "a parte ja' paga ja' tem que
 * debitar automatico onde ele escolher". A parcela paga vira titulo Pago com
 * os MESMOS campos do "A vista (ja' paga na entrada)" da nota inteira, e o
 * saldo do banco e' debitado na mesma gravacao da nota (debitosDasParcelasPagas).
 * Cheque pago = cheque a vista: sai do banco do cheque, e o numero fica no
 * titulo como informacao.
 */
const DATA_ISO_PARCELA = /^\d{4}-\d{2}-\d{2}$/;
/**
 * Primeiro problema das parcelas por forma (em portugues, dizendo o que
 * fazer), ou null. Soma e datas vazias ficam com conferirParcelas.
 */
const erroDasParcelasPorForma = (parcelas, opcoes) => {
    const { formaPadrao, bancos, hoje } = opcoes;
    for (const parcela of parcelas) {
        const forma = (0, pagamentoEntradaDomain_1.formaDaParcela)(parcela, formaPadrao);
        if (!pagamentoEntradaDomain_1.FORMAS_DE_PAGAMENTO.includes(forma))
            return `Escolha a forma de pagamento da parcela ${parcela.numero}.`;
        if (!parcela.jaPaga)
            continue;
        if (DATA_ISO_PARCELA.test(parcela.vencimento) && parcela.vencimento > hoje) {
            return `A parcela ${parcela.numero} está marcada como já paga, mas a data é futura. Informe o dia em que foi paga (hoje ou antes) ou desmarque "Já paga".`;
        }
        if ((0, pagamentoEntradaDomain_1.destinoDaParcelaPaga)(parcela, formaPadrao) === 'banco' && !bancos.some((b) => b.id === parcela.bancoId)) {
            return forma === pagamentoEntradaDomain_1.FORMA_CHEQUE
                ? `Escolha de qual banco saiu o cheque da parcela ${parcela.numero}.`
                : `Escolha de qual banco saiu o pagamento da parcela ${parcela.numero}, ou marque "Caixa" se foi em dinheiro.`;
        }
    }
    // Cheque a compensar: banco, numero e data obrigatorios (como sempre).
    const aCompensar = parcelas.filter((p) => !p.jaPaga && (0, pagamentoEntradaDomain_1.formaDaParcela)(p, formaPadrao) === pagamentoEntradaDomain_1.FORMA_CHEQUE);
    const erroCheques = (0, chequeEmitidoDomain_1.erroDosCheques)(aCompensar, bancos);
    if (erroCheques)
        return erroCheques;
    // Numero repetido no mesmo banco, contando tambem o cheque ja' pago.
    const vistos = new Set();
    for (const parcela of parcelas) {
        const numero = String(parcela.numeroCheque ?? '').trim();
        if ((0, pagamentoEntradaDomain_1.formaDaParcela)(parcela, formaPadrao) !== pagamentoEntradaDomain_1.FORMA_CHEQUE || !numero || !parcela.bancoId)
            continue;
        const chave = `${parcela.bancoId}|${numero}`;
        if (vistos.has(chave)) {
            const banco = bancos.find((b) => b.id === parcela.bancoId)?.nome || '';
            return `O cheque nº ${numero}${banco ? ` do banco ${banco}` : ''} aparece mais de uma vez. Cada cheque precisa de um número diferente.`;
        }
        vistos.add(chave);
    }
    return null;
};
exports.erroDasParcelasPorForma = erroDasParcelasPorForma;
/**
 * Campos do titulo de UMA parcela (forma, status, data, banco, cheque), sem
 * descricao, fornecedor e metadados -- que a tela acrescenta. Nunca `undefined`.
 *  - em aberto: Pendente, com a forma da parcela em `formaPagamento` e em
 *    `formaPagamentoPrevista` (cheque leva banco, numero e data de compensacao);
 *  - ja' paga: Paga na data informada, com a forma/natureza/banco do "A vista".
 */
const camposDoTituloDaParcela = (parcela, opcoes) => {
    const { formaPadrao, bancos } = opcoes;
    const forma = (0, pagamentoEntradaDomain_1.formaDaParcela)(parcela, formaPadrao);
    const valorCentavos = (0, financeDomain_1.toCents)(parcela.valor);
    const base = {
        data: parcela.vencimento,
        valor: (0, financeDomain_1.fromCents)(valorCentavos),
        valorCentavos,
        formaPagamentoPrevista: forma,
    };
    if (!parcela.jaPaga) {
        return forma === pagamentoEntradaDomain_1.FORMA_CHEQUE
            ? { ...base, status: 'Pendente', ...(0, chequeEmitidoDomain_1.camposDoTituloEmCheque)(parcela, bancos) }
            : { ...base, status: 'Pendente', formaPagamento: forma };
    }
    const destino = (0, pagamentoEntradaDomain_1.destinoDaParcelaPaga)(parcela, formaPadrao);
    const banco = destino === 'banco' ? bancos.find((b) => b.id === parcela.bancoId) : undefined;
    if (destino === 'banco' && !banco)
        throw new Error(`Escolha de qual banco saiu o pagamento da parcela ${parcela.numero}.`);
    const numeroCheque = String(parcela.numeroCheque ?? '').trim();
    return {
        ...base,
        status: 'Paga',
        dataPagamento: parcela.vencimento,
        formaPagamento: forma === pagamentoEntradaDomain_1.FORMA_CHEQUE ? pagamentoEntradaDomain_1.FORMA_CHEQUE : (0, pagamentoEntradaDomain_1.formaDoPagamentoNaEntrada)(destino, forma),
        naturezaFinanceira: destino === 'banco' ? 'bancario_digital' : 'caixa_fisico',
        movimentaCaixaFisico: destino === 'caixa',
        ...(banco ? { bancoId: banco.id, bancoNome: banco.nome } : {}),
        ...(forma === pagamentoEntradaDomain_1.FORMA_CHEQUE && banco && numeroCheque
            ? { cheque: (0, financeDomain_1.buildChequeDetails)({ bancoEmissor: banco.nome, numeroCheque, dataCompensacao: parcela.vencimento }) }
            : {}),
    };
};
exports.camposDoTituloDaParcela = camposDoTituloDaParcela;
/** Quanto sai de cada banco AGORA (parcelas ja' pagas pelo banco), em centavos. */
const debitosDasParcelasPagas = (parcelas, formaPadrao) => {
    const porBanco = new Map();
    parcelas.forEach((parcela) => {
        if (!parcela.jaPaga || (0, pagamentoEntradaDomain_1.destinoDaParcelaPaga)(parcela, formaPadrao) !== 'banco' || !parcela.bancoId)
            return;
        porBanco.set(parcela.bancoId, (porBanco.get(parcela.bancoId) || 0) + (0, financeDomain_1.toCents)(parcela.valor));
    });
    return [...porBanco.entries()].map(([bancoId, centavos]) => ({ bancoId, centavos }));
};
exports.debitosDasParcelasPagas = debitosDasParcelasPagas;
/** A parcela como fica guardada no registro da nota: so' o que existe (nunca `undefined`). */
const parcelaParaRegistro = (parcela, formaPadrao) => {
    const forma = (0, pagamentoEntradaDomain_1.formaDaParcela)(parcela, formaPadrao);
    const numeroCheque = String(parcela.numeroCheque ?? '').trim();
    const destino = parcela.jaPaga ? (0, pagamentoEntradaDomain_1.destinoDaParcelaPaga)(parcela, formaPadrao) : null;
    return {
        numero: parcela.numero,
        vencimento: parcela.vencimento,
        valor: (0, financeDomain_1.fromCents)((0, financeDomain_1.toCents)(parcela.valor)),
        forma,
        ...(destino ? { jaPaga: true, destino } : {}),
        ...((forma === pagamentoEntradaDomain_1.FORMA_CHEQUE || destino === 'banco') && parcela.bancoId ? { bancoId: parcela.bancoId } : {}),
        ...(forma === pagamentoEntradaDomain_1.FORMA_CHEQUE && numeroCheque ? { numeroCheque } : {}),
    };
};
exports.parcelaParaRegistro = parcelaParaRegistro;
