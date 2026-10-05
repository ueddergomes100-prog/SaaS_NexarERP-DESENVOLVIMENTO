"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transactionFeeAmount = exports.transactionGrossAmount = exports.validateBankTransfer = exports.transactionNetCents = exports.transactionFeeCents = exports.transactionGrossCents = exports.transactionMovesPhysicalCash = exports.transactionDueDateInput = exports.cancelCommissionSnapshot = exports.recalculateCommissionAfterReturn = exports.buildServiceOrderCommissionSnapshot = exports.buildCommissionSnapshotFromItems = exports.buildCommissionSnapshot = exports.parseComissaoPercentualInput = exports.resolveComissaoPercentual = exports.reversePaymentReceipt = exports.legacyPaymentForTransaction = exports.asPaymentMethod = exports.applyPaymentReceipt = exports.tagPaymentAsChequeAwaitingClearance = exports.summarizePayments = exports.explodeInstallmentPaymentRecords = exports.normalizePayments = exports.createEmptyPaymentDraft = exports.buildChequeDetails = exports.formaPagamentoInicial = exports.parseExigirEscolhaFormaPagamento = exports.DEFAULT_EXIGIR_ESCOLHA_FORMA_PAGAMENTO = exports.buildCardDetails = exports.paymentIsImmediatelyConfirmed = exports.settledFinancialNatureForPayment = exports.financialNatureForPayment = exports.computeBankCreditsMap = exports.paymentRequiresBankAccount = exports.isPhysicalCashPayment = exports.resolveBancoPadraoSimplificado = exports.SIMPLIFIED_CARD_BANK_NAME = exports.parsePagamentoCartaoSimplificadoAtivo = exports.DEFAULT_PAGAMENTO_CARTAO_SIMPLIFICADO_ATIVO = exports.isCardPayment = exports.buildCardFeeSchedulesByBrand = exports.creditCardFeeForInstallments = exports.normalizeCreditCardFeeSchedule = exports.parseCreditTerms = exports.gerarParcelasAPrazo = exports.INTERVALO_PARCELAS_PADRAO = exports.MAX_PARCELAS_A_PRAZO = exports.splitCents = exports.fromCents = exports.toCents = void 0;
exports.isRevenueReversal = exports.REVENUE_REVERSAL_CATEGORIES = exports.transactionNetAmount = void 0;
const dateTime_1 = require("./dateTime");
const toCents = (value) => {
    if (typeof value === 'string') {
        const normalized = value.trim().replace(/\s/g, '').replace(',', '.');
        if (!normalized)
            return 0;
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
    }
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
};
exports.toCents = toCents;
const fromCents = (value) => Number((value / 100).toFixed(2));
exports.fromCents = fromCents;
const splitCents = (totalCents, installments) => {
    if (!Number.isInteger(installments) || installments < 1) {
        throw new Error('A quantidade de parcelas deve ser maior que zero.');
    }
    const base = Math.floor(totalCents / installments);
    const remainder = totalCents - (base * installments);
    return Array.from({ length: installments }, (_, index) => base + (index < remainder ? 1 : 0));
};
exports.splitCents = splitCents;
/** Quantas parcelas a tela aceita. Acima disso quase sempre e' engano de
 *  digitacao (o "30" que era pra ser o intervalo, nao a quantidade). */
exports.MAX_PARCELAS_A_PRAZO = 48;
/** Intervalo padrao entre parcelas, em dias. 30 e' o que a loja chama de
 *  "30/60/90". */
exports.INTERVALO_PARCELAS_PADRAO = 30;
/**
 * Monta as parcelas do pagamento a prazo: N parcelas espacadas de X dias a
 * partir da data da venda.
 *
 * - 3 parcelas de 30 dias => 30, 60 e 90 dias depois da venda;
 * - 3 parcelas de 15 dias => 15, 30 e 45.
 *
 * A PRIMEIRA parcela ja' cai no primeiro intervalo (nao na data da venda):
 * "3x sem entrada" e' o combinado normal do balcao. Quem quer entrada lanca a
 * entrada como outra forma de pagamento (dinheiro/Pix) e deixa a prazo so' o
 * que sobra.
 *
 * O valor e' dividido em CENTAVOS por `splitCents`, entao a soma das parcelas
 * e' sempre exatamente o total -- sem centavo sumido nem sobrando.
 */
const gerarParcelasAPrazo = (totalCents, quantidade, intervaloDias, dataVenda) => {
    const partes = Math.floor(Number(quantidade));
    const intervalo = Math.floor(Number(intervaloDias));
    if (!Number.isFinite(totalCents) || totalCents <= 0)
        return [];
    if (!Number.isInteger(partes) || partes < 1 || partes > exports.MAX_PARCELAS_A_PRAZO)
        return [];
    if (!Number.isInteger(intervalo) || intervalo < 1)
        return [];
    if (!dataVenda)
        return [];
    return (0, exports.splitCents)(Math.round(totalCents), partes).map((valorCentavos, indice) => ({
        numero: indice + 1,
        dataVencimento: (0, dateTime_1.addDaysToDateInput)(dataVenda, intervalo * (indice + 1)),
        valorCentavos,
    }));
};
exports.gerarParcelasAPrazo = gerarParcelasAPrazo;
const parseCreditTerms = (value) => {
    const terms = String(value ?? '')
        .split(/[;,\s]+/)
        .map((item) => Number.parseInt(item, 10))
        .filter((item) => Number.isInteger(item) && item > 0);
    return Array.from(new Set(terms)).sort((a, b) => a - b);
};
exports.parseCreditTerms = parseCreditTerms;
const normalizeCreditCardFeeSchedule = (value, fallbackFeePercent = 0) => {
    const source = value && typeof value === 'object'
        ? value
        : {};
    const fallback = Number.isFinite(Number(fallbackFeePercent))
        ? Math.max(0, Math.min(100, Number(fallbackFeePercent)))
        : 0;
    return Object.fromEntries(Array.from({ length: 12 }, (_, index) => {
        const installments = index + 1;
        const rawValue = source[String(installments)] ?? source[`${installments}x`] ?? fallback;
        const parsed = Number(String(rawValue ?? '').replace(',', '.'));
        const normalized = Number.isFinite(parsed)
            ? Math.max(0, Math.min(100, parsed))
            : fallback;
        return [String(installments), normalized];
    }));
};
exports.normalizeCreditCardFeeSchedule = normalizeCreditCardFeeSchedule;
const creditCardFeeForInstallments = (schedule, installments, fallbackFeePercent = 0) => {
    const normalizedInstallments = Math.max(1, Math.min(12, Number.parseInt(String(installments), 10) || 1));
    return (0, exports.normalizeCreditCardFeeSchedule)(schedule, fallbackFeePercent)[String(normalizedInstallments)];
};
exports.creditCardFeeForInstallments = creditCardFeeForInstallments;
/**
 * Constroi o mapa de taxas/prazos por bandeira (chave = nome da bandeira,
 * mesmo texto gravado em PaymentDraft.bandeira) a partir dos documentos
 * de bandeiras_cartao. Bandeiras sem nenhum campo de taxa proprio geram
 * uma entrada vazia -- o chamador deve tratar isso como "sem override",
 * caindo no fallback global (ver normalizePayments).
 */
const buildCardFeeSchedulesByBrand = (bandeiras) => (Object.fromEntries(bandeiras
    .map((bandeira) => bandeira.nome?.trim())
    .filter((nome) => Boolean(nome))
    .map((nome) => {
    const bandeira = bandeiras.find((item) => item.nome?.trim() === nome);
    const schedule = {};
    if (bandeira?.taxasCreditoPorParcela !== undefined) {
        schedule.creditFeePercentByInstallment = (0, exports.normalizeCreditCardFeeSchedule)(bandeira.taxasCreditoPorParcela);
    }
    if (bandeira?.taxaDebitoPercentual !== undefined) {
        const parsed = Number(bandeira.taxaDebitoPercentual);
        schedule.debitFeePercent = Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 0;
    }
    if (bandeira?.prazoRecebimentoCreditoDias !== undefined) {
        const parsed = Number(bandeira.prazoRecebimentoCreditoDias);
        schedule.creditSettlementDays = Number.isFinite(parsed) ? Math.max(0, parsed) : undefined;
    }
    if (bandeira?.prazoRecebimentoDebitoDias !== undefined) {
        const parsed = Number(bandeira.prazoRecebimentoDebitoDias);
        schedule.debitSettlementDays = Number.isFinite(parsed) ? Math.max(0, parsed) : undefined;
    }
    return [nome, schedule];
})));
exports.buildCardFeeSchedulesByBrand = buildCardFeeSchedulesByBrand;
const isCardPayment = (method) => (method === 'Cartão de Crédito' || method === 'Cartão de Débito');
exports.isCardPayment = isCardPayment;
exports.DEFAULT_PAGAMENTO_CARTAO_SIMPLIFICADO_ATIVO = false;
const parsePagamentoCartaoSimplificadoAtivo = (value) => value === true;
exports.parsePagamentoCartaoSimplificadoAtivo = parsePagamentoCartaoSimplificadoAtivo;
/**
 * Nome do banco padrao usado como destino automatico do cartao quando o
 * pagamento simplificado (Configuracoes) esta ligado -- o operador nao
 * escolhe banco nesse modo, entao precisa de um destino fixo e previsivel.
 */
exports.SIMPLIFIED_CARD_BANK_NAME = 'BANCO';
/**
 * Acha, entre os bancos ativos do tenant, o banco padrao do pagamento
 * simplificado (nome "BANCO", comparacao sem distincao de maiusculas/
 * espacos). Retorna null se ainda nao foi criado -- nesse caso
 * normalizePayments bloqueia com mensagem clara em vez de adivinhar um
 * destino.
 */
const resolveBancoPadraoSimplificado = (bancos) => {
    const match = bancos.find((banco) => (banco.ativo && banco.nome.trim().toLowerCase() === exports.SIMPLIFIED_CARD_BANK_NAME.toLowerCase()));
    return match ? { id: match.id, nome: match.nome } : null;
};
exports.resolveBancoPadraoSimplificado = resolveBancoPadraoSimplificado;
const isPhysicalCashPayment = (method) => method === 'Dinheiro';
exports.isPhysicalCashPayment = isPhysicalCashPayment;
/**
 * Pagamentos cujo destino e um banco cadastrado (Modulo Bancos, F18):
 * Pix/Transferencia liquidam na hora, cartao fica pendente ate a
 * conciliacao -- mas em ambos os casos o operador ja escolhe o banco na
 * venda. Boleto entrou em 2026-09-22: e' o banco de onde o titulo vai ser
 * emitido (precisa ter convenio de boleto configurado -- ver
 * boletoEmissaoDomain.ts), escolhido aqui pra EmitirBoletoModal nao ter
 * que perguntar de novo. Dinheiro (caixa fisico) e Pagamento a Prazo/Outros
 * (destino incerto ate a baixa) ficam de fora.
 */
const paymentRequiresBankAccount = (method) => (method === 'Pix' || method === 'Transferência' || method === 'Cheque' || method === 'Boleto' || (0, exports.isCardPayment)(method));
exports.paymentRequiresBankAccount = paymentRequiresBankAccount;
/**
 * Soma por banco quanto cada pagamento confirmado credita (venda/OS
 * finalizada) -- usada tanto pra aplicar o credito quanto, com o mesmo
 * mapa, pra reverte-lo (cancelamento, reabertura, exclusao). Ignora
 * pagamento sem banco escolhido ou ainda nao confirmado (Boleto/Prazo
 * pendente nunca chegou a creditar nada).
 *
 * Usa transactionNetCents, nao valorCentavos bruto: cartao credita o
 * banco pelo valor LIQUIDO da taxa da administradora (conciliado em
 * Banco.tsx, campo cartao.valorLiquidoCentavos), so pra Pix/Transferencia
 * o liquido e igual ao bruto. Usar o bruto aqui fazia a reversao (cancelar/
 * reabrir/excluir) subtrair a mais do que foi creditado de fato, deixando
 * o saldo do banco negativo pelo valor da taxa (achado em teste ao vivo).
 */
const computeBankCreditsMap = (payments) => {
    const creditsByBanco = new Map();
    payments.forEach((payment) => {
        if (payment.status === 'confirmado' && payment.bancoId) {
            const netCents = (0, exports.transactionNetCents)(payment);
            creditsByBanco.set(payment.bancoId, (creditsByBanco.get(payment.bancoId) || 0) + netCents);
        }
    });
    return creditsByBanco;
};
exports.computeBankCreditsMap = computeBankCreditsMap;
const financialNatureForPayment = (method) => {
    if (method === 'Dinheiro')
        return 'caixa_fisico';
    if (method === 'Pix' || method === 'Transferência')
        return 'bancario_digital';
    if (method === 'Crédito de Devolução')
        return 'credito_cliente';
    return 'contas_receber';
};
exports.financialNatureForPayment = financialNatureForPayment;
const settledFinancialNatureForPayment = (method) => {
    if (method === 'Dinheiro')
        return 'caixa_fisico';
    if (method === 'Crédito de Devolução')
        return 'credito_cliente';
    return 'bancario_digital';
};
exports.settledFinancialNatureForPayment = settledFinancialNatureForPayment;
/** Credito de devolucao entra aqui junto com Dinheiro/Pix/Transferencia: o
 * dinheiro ja esta com a loja desde a devolucao que gerou o credito, entao
 * a parte da venda paga com ele nasce quitada -- nunca vira conta a receber. */
const paymentIsImmediatelyConfirmed = (method) => (method === 'Dinheiro' || method === 'Pix' || method === 'Transferência'
    || method === 'Crédito de Devolução');
exports.paymentIsImmediatelyConfirmed = paymentIsImmediatelyConfirmed;
const buildCardDetails = (args) => {
    const installments = args.method === 'Cartão de Débito' ? 1 : args.installments;
    if (args.method === 'Cartão de Débito' && args.installments !== 1) {
        throw new Error('Cartão de débito não permite parcelamento.');
    }
    if (!Number.isInteger(installments) || installments < 1) {
        throw new Error('Informe uma quantidade válida de parcelas.');
    }
    if (!Number.isInteger(args.grossCents) || args.grossCents <= 0) {
        throw new Error('O valor bruto do cartão deve ser maior que zero.');
    }
    const feePercent = Number.isFinite(Number(args.feePercent))
        ? Math.max(0, Math.min(100, Number(args.feePercent)))
        : 0;
    const feeCents = Math.round(args.grossCents * (feePercent / 100));
    const netCents = Math.max(0, args.grossCents - feeCents);
    const grossInstallments = (0, exports.splitCents)(args.grossCents, installments);
    const netInstallments = (0, exports.splitCents)(netCents, installments);
    const firstDate = args.firstSettlementDate && (0, dateTime_1.parseDateInput)(args.firstSettlementDate)
        ? args.firstSettlementDate
        : '';
    const bandeira = args.bandeira?.trim();
    const operadora = args.operadora?.trim();
    const autorizacao = args.autorizacao?.trim();
    const details = {
        tipo: args.method === 'Cartão de Crédito' ? 'credito' : 'debito',
        ...(bandeira ? { bandeira } : {}),
        ...(operadora ? { operadora } : {}),
        ...(autorizacao ? { autorizacao } : {}),
        parcelas: installments,
        taxaPercentual: feePercent,
        valorBrutoCentavos: args.grossCents,
        valorBruto: (0, exports.fromCents)(args.grossCents),
        valorTaxaCentavos: feeCents,
        valorTaxa: (0, exports.fromCents)(feeCents),
        valorLiquidoCentavos: netCents,
        valorLiquido: (0, exports.fromCents)(netCents),
        ...(firstDate ? { dataPrevistaRecebimento: firstDate } : {}),
        detalhamentoParcelas: grossInstallments.map((amountCents, index) => ({
            numero: index + 1,
            valorCentavos: amountCents,
            valor: (0, exports.fromCents)(amountCents),
            valorLiquidoCentavos: netInstallments[index],
            valorLiquido: (0, exports.fromCents)(netInstallments[index]),
            ...(firstDate ? {
                dataPrevistaRecebimento: args.installmentIntervalDays !== undefined
                    ? (0, dateTime_1.addBusinessDaysToDateInput)(firstDate, args.installmentIntervalDays * index)
                    : (0, dateTime_1.addMonthsToDateInput)(firstDate, args.method === 'Cartão de Crédito' ? index : 0),
            } : {}),
        })),
    };
    return details;
};
exports.buildCardDetails = buildCardDetails;
/**
 * A TELA COMECA COM "SELECIONE" EM VEZ DE "DINHEIRO"?
 *
 * Decisao de produto (2026-09-01). O seletor vinha preenchido com Dinheiro, e
 * era comodo: quem vende no dinheiro nao mexia em nada. So que quem NAO vende
 * no dinheiro tambem nao mexia -- clicava em finalizar e a venda saia como
 * Dinheiro sem ninguem perceber, sujando o caixa e o relatorio.
 *
 * Ligada, a forma comeca vazia e finalizar sem escolher trava com recado
 * claro. Um clique a mais por venda, em troca de nao descobrir o erro no
 * fechamento do caixa.
 *
 * DESLIGADA por padrao: ligar mudaria o fluxo de quem ja vende hoje.
 */
exports.DEFAULT_EXIGIR_ESCOLHA_FORMA_PAGAMENTO = false;
const parseExigirEscolhaFormaPagamento = (raw) => raw === true;
exports.parseExigirEscolhaFormaPagamento = parseExigirEscolhaFormaPagamento;
/** Forma inicial do rascunho, conforme a empresa configurou. */
const formaPagamentoInicial = (exigirEscolha) => (exigirEscolha ? '' : 'Dinheiro');
exports.formaPagamentoInicial = formaPagamentoInicial;
/** Monta os dados do cheque a partir do que foi digitado no modal (ver
 * ChequeCaptureModal). Banco emissor, numero do cheque e data de
 * compensacao sao obrigatorios -- sem eles nao da pra conciliar o cheque
 * depois (regra 2 do CLAUDE.md: erro claro, em portugues, dizendo o que
 * falta). O resto e' complementar, omitido do objeto quando em branco. */
const buildChequeDetails = (args) => {
    const bancoEmissor = args.bancoEmissor?.trim();
    const numeroCheque = args.numeroCheque?.trim();
    if (!bancoEmissor)
        throw new Error('Informe o banco emissor do cheque.');
    if (!numeroCheque)
        throw new Error('Informe o número do cheque.');
    if (!args.dataCompensacao || !(0, dateTime_1.parseDateInput)(args.dataCompensacao)) {
        throw new Error('Informe a data de compensação do cheque.');
    }
    const agencia = args.agencia?.trim();
    const titular = args.titular?.trim();
    const emitente = args.emitente?.trim();
    const documentoEmitente = args.documentoEmitente?.replace(/\D/g, '');
    return {
        bancoEmissor,
        numeroCheque,
        dataCompensacao: args.dataCompensacao,
        ...(agencia ? { agencia } : {}),
        ...(titular ? { titular } : {}),
        ...(emitente ? { emitente } : {}),
        ...(documentoEmitente ? { documentoEmitente } : {}),
    };
};
exports.buildChequeDetails = buildChequeDetails;
const createEmptyPaymentDraft = (id, amountCents, defaultTermDays = 30, formaInicial = 'Dinheiro') => ({
    id,
    forma: formaInicial,
    valor: (0, exports.fromCents)(amountCents).toFixed(2),
    prazoDias: String(defaultTermDays),
    parcelasAPrazo: '1',
    dataVencimento: '',
    bandeira: '',
    operadora: '',
    autorizacao: '',
    parcelas: '1',
    dataPrevistaRecebimento: '',
    bancoId: '',
    bancoNome: '',
    chequeBancoEmissor: '',
    chequeAgencia: '',
    chequeTitular: '',
    chequeEmitente: '',
    chequeDocumentoEmitente: '',
    chequeNumero: '',
});
exports.createEmptyPaymentDraft = createEmptyPaymentDraft;
const normalizePayments = (totalCents, drafts, options = {}) => {
    const operationLabel = options.operationLabel?.trim() || 'venda';
    if (totalCents <= 0)
        throw new Error(`O total da ${operationLabel} deve ser maior que zero.`);
    if (drafts.length === 0)
        throw new Error('Informe pelo menos uma forma de pagamento.');
    const saleDate = options.saleDate || (0, dateTime_1.getDateInputInTimeZone)();
    if (!(0, dateTime_1.parseDateInput)(saleDate))
        throw new Error('A data da venda é inválida.');
    const records = drafts.map((draft, index) => {
        // Forma vazia so existe no rascunho da tela. Chegar aqui sem escolha e'
        // erro de operacao, e o recado tem que dizer QUAL pagamento -- numa venda
        // com duas formas, "escolha a forma" sozinho nao ajuda ninguem.
        if (!draft.forma) {
            throw new Error(drafts.length > 1
                ? `Escolha a forma do pagamento ${index + 1} antes de finalizar.`
                : 'Escolha a forma de pagamento antes de finalizar.');
        }
        const valueCents = (0, exports.toCents)(draft.valor);
        if (valueCents <= 0)
            throw new Error(`O valor do pagamento ${index + 1} deve ser maior que zero.`);
        // Pagamento simplificado (Configuracoes): cartao confirma na hora, sem
        // bandeira/autorizacao/parcelas, e usa o banco "BANCO" automaticamente
        // em vez do banco escolhido na tela -- ver SIMPLIFIED_CARD_BANK_NAME.
        const isSimplifiedCard = (0, exports.isCardPayment)(draft.forma) && options.pagamentoCartaoSimplificadoAtivo === true;
        let effectiveBancoId = draft.bancoId;
        let effectiveBancoNome = draft.bancoNome;
        if (isSimplifiedCard) {
            if (!options.bancoPadraoSimplificado) {
                throw new Error(`Nenhum banco padrão "${exports.SIMPLIFIED_CARD_BANK_NAME}" foi encontrado para o pagamento simplificado. `
                    + `Abra Financeiro → Bancos e cadastre um banco chamado "${exports.SIMPLIFIED_CARD_BANK_NAME}", `
                    + 'ou desligue o pagamento de cartão simplificado em Configurações.');
            }
            effectiveBancoId = options.bancoPadraoSimplificado.id;
            effectiveBancoNome = options.bancoPadraoSimplificado.nome;
        }
        if ((0, exports.paymentRequiresBankAccount)(draft.forma) && !effectiveBancoId?.trim()) {
            throw new Error(`Selecione o banco de destino do pagamento ${index + 1}.`);
        }
        const isTerm = draft.forma === 'Pagamento a Prazo';
        const nature = isSimplifiedCard ? 'bancario_digital' : (0, exports.financialNatureForPayment)(draft.forma);
        const record = {
            id: draft.id,
            indice: index + 1,
            formaPagamento: draft.forma,
            condicaoPagamento: isTerm ? 'aprazo' : 'avista',
            valorCentavos: valueCents,
            valor: (0, exports.fromCents)(valueCents),
            status: ((0, exports.paymentIsImmediatelyConfirmed)(draft.forma) || isSimplifiedCard) ? 'confirmado' : 'pendente',
            naturezaFinanceira: nature,
            movimentaCaixaFisico: draft.forma === 'Dinheiro',
        };
        if (effectiveBancoId?.trim()) {
            record.bancoId = effectiveBancoId.trim();
            record.bancoNome = effectiveBancoNome?.trim() || '';
        }
        if (isTerm) {
            const informedDays = Number.parseInt(draft.prazoDias, 10);
            const calculatedDueDate = Number.isInteger(informedDays) && informedDays > 0
                ? (0, dateTime_1.addDaysToDateInput)(saleDate, informedDays)
                : '';
            const dueDate = draft.dataVencimento || calculatedDueDate;
            const dueDays = (0, dateTime_1.differenceInCalendarDays)(saleDate, dueDate);
            if (!(0, dateTime_1.parseDateInput)(dueDate) || dueDays === null || dueDays < 1) {
                throw new Error('Pagamento a prazo exige uma data de vencimento válida.');
            }
            record.prazoDias = dueDays;
            record.dataVencimento = dueDate;
            // Parcelado: guarda quantas sao. Quem divide de fato em N titulos e'
            // explodeInstallmentPaymentRecords, na hora de salvar -- aqui o
            // registro ainda e' a linha inteira que a pessoa digitou.
            const parcelasPedidas = Number.parseInt(draft.parcelasAPrazo, 10);
            if (Number.isFinite(parcelasPedidas) && parcelasPedidas > 1) {
                if (parcelasPedidas > exports.MAX_PARCELAS_A_PRAZO) {
                    throw new Error(`O pagamento a prazo aceita no máximo ${exports.MAX_PARCELAS_A_PRAZO} parcelas.`);
                }
                if (!Number.isInteger(dueDays) || dueDays < 1) {
                    throw new Error('Informe de quantos em quantos dias cada parcela do pagamento a prazo vence.');
                }
                record.totalParcelasAPrazo = parcelasPedidas;
            }
        }
        if ((0, exports.isCardPayment)(draft.forma) && isSimplifiedCard) {
            record.dataPrevistaRecebimento = saleDate;
            record.cartao = (0, exports.buildCardDetails)({
                method: draft.forma,
                grossCents: valueCents,
                installments: 1,
                feePercent: 0,
                firstSettlementDate: saleDate,
            });
            // Parcelamento so pra constar no recibo. `installments: 1` acima
            // continua sendo a verdade financeira: uma transacao, valor integral.
            const parcelasInformadas = Number.parseInt(draft.parcelas, 10);
            if (draft.forma === 'Cartão de Crédito' && Number.isFinite(parcelasInformadas) && parcelasInformadas > 1) {
                record.parcelasExibicao = parcelasInformadas;
            }
        }
        else if ((0, exports.isCardPayment)(draft.forma)) {
            const installments = Number.parseInt(draft.parcelas, 10);
            if (draft.forma === 'Cartão de Crédito' &&
                options.maxCreditInstallments &&
                installments > options.maxCreditInstallments) {
                throw new Error(`O cartão de crédito permite no máximo ${options.maxCreditInstallments} parcelas.`);
            }
            const brandKey = draft.bandeira?.trim();
            const brandSchedule = brandKey ? options.cardFeeSchedulesByBrand?.[brandKey] : undefined;
            const effectiveCreditFeePercentByInstallment = brandSchedule?.creditFeePercentByInstallment
                ?? options.creditFeePercentByInstallment;
            const effectiveCreditFeePercent = brandSchedule?.creditFeePercent ?? options.creditFeePercent;
            const effectiveDebitFeePercent = brandSchedule?.debitFeePercent ?? options.debitFeePercent;
            const effectiveCreditSettlementDays = brandSchedule?.creditSettlementDays ?? options.creditSettlementDays;
            const effectiveDebitSettlementDays = brandSchedule?.debitSettlementDays ?? options.debitSettlementDays;
            let firstSettlementDate = draft.dataPrevistaRecebimento;
            if (!firstSettlementDate) {
                const configuredDays = draft.forma === 'Cartão de Crédito'
                    ? effectiveCreditSettlementDays
                    : effectiveDebitSettlementDays;
                if (Number.isInteger(configuredDays) && Number(configuredDays) >= 0) {
                    firstSettlementDate = draft.forma === 'Cartão de Crédito'
                        ? (0, dateTime_1.addBusinessDaysToDateInput)(saleDate, Number(configuredDays))
                        : (0, dateTime_1.addDaysToDateInput)(saleDate, Number(configuredDays));
                }
            }
            if (firstSettlementDate &&
                (!(0, dateTime_1.parseDateInput)(firstSettlementDate) ||
                    Number((0, dateTime_1.differenceInCalendarDays)(saleDate, firstSettlementDate)) < 0)) {
                throw new Error('A data prevista de recebimento do cartão é inválida.');
            }
            if (firstSettlementDate)
                record.dataPrevistaRecebimento = firstSettlementDate;
            const creditFeePercent = (0, exports.creditCardFeeForInstallments)(effectiveCreditFeePercentByInstallment, installments, effectiveCreditFeePercent);
            record.cartao = (0, exports.buildCardDetails)({
                method: draft.forma,
                grossCents: valueCents,
                installments,
                feePercent: draft.forma === 'Cartão de Crédito'
                    ? creditFeePercent
                    : effectiveDebitFeePercent,
                firstSettlementDate,
                installmentIntervalDays: draft.forma === 'Cartão de Crédito' ? effectiveCreditSettlementDays : undefined,
                bandeira: draft.bandeira,
                operadora: draft.operadora,
                autorizacao: draft.autorizacao,
            });
        }
        else if (draft.forma === 'Cheque') {
            // Compensacao reaproveita dataPrevistaRecebimento (mesmo campo que o
            // cartao usa pro "primeiro recebimento previsto") -- nunca antes da
            // data da venda, senao a data nao faz sentido pra compensar depois.
            const dataCompensacao = draft.dataPrevistaRecebimento;
            if (!dataCompensacao || !(0, dateTime_1.parseDateInput)(dataCompensacao)) {
                throw new Error(`Informe a data de compensação do cheque do pagamento ${index + 1}.`);
            }
            if (Number((0, dateTime_1.differenceInCalendarDays)(saleDate, dataCompensacao)) < 0) {
                throw new Error(`A data de compensação do cheque do pagamento ${index + 1} não pode ser anterior à data da venda.`);
            }
            record.dataPrevistaRecebimento = dataCompensacao;
            record.cheque = (0, exports.buildChequeDetails)({
                bancoEmissor: draft.chequeBancoEmissor,
                numeroCheque: draft.chequeNumero,
                dataCompensacao,
                agencia: draft.chequeAgencia,
                titular: draft.chequeTitular,
                emitente: draft.chequeEmitente,
                documentoEmitente: draft.chequeDocumentoEmitente,
            });
        }
        else if (draft.forma === 'Boleto') {
            // So a data de vencimento nasce aqui, mesmo campo que Cheque usa pra
            // compensacao -- a emissao de verdade (numero, linha digitavel,
            // codigo de barras) e' sempre um passo seguinte, feito em Financeiro
            // > Boletos ou no popup pos-venda (ver boletoEmissaoDomain.ts). Nunca
            // grava record.boleto aqui.
            // Boleto parcelado (2026-09-23): "Parcelas" + "dias" funcionam como no
            // pagamento a prazo -- 3x de 15 dias = 15/30/45. A data digitada e' a da
            // 1a parcela; sem ela, vem da venda + o intervalo.
            const intervaloBoleto = Number.parseInt(draft.prazoDias, 10);
            const qtdBoletosPedida = Number.parseInt(draft.parcelasAPrazo, 10);
            const listaPersonalizada = Array.isArray(draft.parcelasPersonalizadas)
                && qtdBoletosPedida > 1
                && draft.parcelasPersonalizadas.length === qtdBoletosPedida
                ? draft.parcelasPersonalizadas
                : null;
            // Com datas escolhidas boleto a boleto, a 1a delas e' o vencimento base.
            const vencimento = listaPersonalizada
                ? String(listaPersonalizada[0]?.vencimento || '')
                : draft.dataPrevistaRecebimento
                    || (Number.isInteger(intervaloBoleto) && intervaloBoleto > 0 ? (0, dateTime_1.addDaysToDateInput)(saleDate, intervaloBoleto) : '');
            if (!vencimento || !(0, dateTime_1.parseDateInput)(vencimento)) {
                throw new Error(`Informe a data de vencimento do boleto do pagamento ${index + 1}.`);
            }
            if (Number((0, dateTime_1.differenceInCalendarDays)(saleDate, vencimento)) < 0) {
                throw new Error(`A data de vencimento do boleto do pagamento ${index + 1} não pode ser anterior à data da venda.`);
            }
            record.dataPrevistaRecebimento = vencimento;
            record.dataVencimento = vencimento;
            const parcelasBoleto = Number.parseInt(draft.parcelasAPrazo, 10);
            if (Number.isFinite(parcelasBoleto) && parcelasBoleto > 1) {
                if (parcelasBoleto > exports.MAX_PARCELAS_A_PRAZO) {
                    throw new Error(`O boleto aceita no máximo ${exports.MAX_PARCELAS_A_PRAZO} parcelas.`);
                }
                if (listaPersonalizada) {
                    // Vencimento de cada boleto escolhido na mao (10/15/30 dias...).
                    const datas = listaPersonalizada.map((linha, posicao) => {
                        const data = String(linha.vencimento || '');
                        if (!(0, dateTime_1.parseDateInput)(data)) {
                            throw new Error(`Informe o vencimento do boleto ${posicao + 1} do pagamento ${index + 1}.`);
                        }
                        if (Number((0, dateTime_1.differenceInCalendarDays)(saleDate, data)) < 0) {
                            throw new Error(`O vencimento do boleto ${posicao + 1} do pagamento ${index + 1} não pode ser anterior à data da venda.`);
                        }
                        return data;
                    });
                    record.vencimentosParcelas = datas;
                    record.dataVencimento = datas[0];
                    record.dataPrevistaRecebimento = datas[0];
                    record.totalParcelasAPrazo = parcelasBoleto;
                }
                else {
                    if (!Number.isInteger(intervaloBoleto) || intervaloBoleto < 1) {
                        throw new Error(`Informe de quantos em quantos dias cada boleto do pagamento ${index + 1} vence.`);
                    }
                    record.prazoDias = intervaloBoleto;
                    record.totalParcelasAPrazo = parcelasBoleto;
                }
            }
        }
        return record;
    });
    const paymentTotal = records.reduce((sum, payment) => sum + payment.valorCentavos, 0);
    if (paymentTotal !== totalCents) {
        throw new Error(`A soma dos pagamentos deve corresponder ao total da ${operationLabel} (${(0, exports.fromCents)(totalCents).toFixed(2)}).`);
    }
    return records;
};
exports.normalizePayments = normalizePayments;
/**
 * Explode um pagamento parcelado em N registros independentes, um por
 * parcela, para que cada uma vire seu proprio titulo em Contas a Receber em
 * vez de um unico titulo com o valor cheio.
 *
 * Vale para dois casos:
 *   - CARTAO DE CREDITO parcelado, usando o detalhamento ja calculado por
 *     buildCardDetails/normalizePayments;
 *   - PAGAMENTO A PRAZO parcelado (2026-09-21), usando gerarParcelasAPrazo:
 *     3x de 30 em 30 dias viram tres titulos, 30/60/90.
 *
 * Debito, credito a vista e a prazo de parcela unica passam direto.
 *
 * cartao.parcelas fica 1 em cada registro explodido (mantem
 * applyPaymentReceipt/recebimento parcial funcionando sem mudanca, ja
 * que ele reusa esse campo para decidir quantas parcelas recalcular).
 * numero/totalParcelas guardam a posicao original para exibicao.
 */
const explodeInstallmentPaymentRecords = (records) => {
    const exploded = records.flatMap((record) => {
        // --- Pagamento a prazo parcelado -------------------------------------
        const totalAPrazo = record.totalParcelasAPrazo ?? 1;
        const ehBoleto = record.formaPagamento === 'Boleto';
        if ((record.formaPagamento === 'Pagamento a Prazo' || ehBoleto) && totalAPrazo > 1) {
            // As datas saem da data da 1a parcela, andando de `prazoDias` em
            // `prazoDias` -- o mesmo intervalo que a pessoa informou na tela.
            // Sem intervalo (datas personalizadas) o 1 serve so' pra gerar os valores.
            const intervalo = Math.max(1, Number(record.prazoDias) || 0);
            const primeira = String(record.dataVencimento || '');
            // A base do calculo e' "a venda", entao recua um intervalo: assim a
            // parcela 1 cai exatamente na data que ja estava no registro.
            const base = (0, dateTime_1.addDaysToDateInput)(primeira, -intervalo);
            const parcelas = (0, exports.gerarParcelasAPrazo)(record.valorCentavos, totalAPrazo, intervalo, base);
            if (parcelas.length !== totalAPrazo)
                return [record];
            // Datas escolhidas parcela a parcela (boleto) mandam sobre o intervalo fixo.
            const datasPersonalizadas = ehBoleto && record.vencimentosParcelas?.length === totalAPrazo
                ? record.vencimentosParcelas
                : null;
            return parcelas.map((parcela) => ({
                ...record,
                id: `${record.id}-parcela-${parcela.numero}`,
                valorCentavos: parcela.valorCentavos,
                valor: (0, exports.fromCents)(parcela.valorCentavos),
                dataVencimento: datasPersonalizadas ? datasPersonalizadas[parcela.numero - 1] : parcela.dataVencimento,
                // O boleto usa esta data como vencimento (o a prazo, dataVencimento).
                ...(ehBoleto ? { dataPrevistaRecebimento: datasPersonalizadas ? datasPersonalizadas[parcela.numero - 1] : parcela.dataVencimento } : {}),
                prazoDias: intervalo * parcela.numero,
                numeroParcelaAPrazo: parcela.numero,
                totalParcelasAPrazo: totalAPrazo,
            }));
        }
        // --- Cartao de credito parcelado --------------------------------------
        const totalParcelas = record.cartao?.parcelas ?? 1;
        if (record.formaPagamento !== 'Cartão de Crédito' || !record.cartao || totalParcelas <= 1) {
            return [record];
        }
        const cartao = record.cartao;
        return cartao.detalhamentoParcelas.map((installment) => {
            const feeCents = Math.max(0, installment.valorCentavos - installment.valorLiquidoCentavos);
            return {
                ...record,
                id: `${record.id}-parcela-${installment.numero}`,
                valorCentavos: installment.valorCentavos,
                valor: installment.valor,
                dataPrevistaRecebimento: installment.dataPrevistaRecebimento || record.dataPrevistaRecebimento,
                cartao: {
                    ...cartao,
                    parcelas: 1,
                    numero: installment.numero,
                    totalParcelas,
                    valorBrutoCentavos: installment.valorCentavos,
                    valorBruto: installment.valor,
                    valorTaxaCentavos: feeCents,
                    valorTaxa: (0, exports.fromCents)(feeCents),
                    valorLiquidoCentavos: installment.valorLiquidoCentavos,
                    valorLiquido: installment.valorLiquido,
                    ...(installment.dataPrevistaRecebimento ? { dataPrevistaRecebimento: installment.dataPrevistaRecebimento } : {}),
                    detalhamentoParcelas: [installment],
                },
            };
        });
    });
    return exploded.map((record, index) => ({ ...record, indice: index + 1 }));
};
exports.explodeInstallmentPaymentRecords = explodeInstallmentPaymentRecords;
const summarizePayments = (payments) => {
    const receivedCents = payments
        .filter((payment) => payment.status === 'confirmado')
        .reduce((sum, payment) => sum + payment.valorCentavos, 0);
    const pendingCents = payments
        .filter((payment) => payment.status === 'pendente')
        .reduce((sum, payment) => sum + payment.valorCentavos, 0);
    const forms = Array.from(new Set(payments.map((payment) => payment.formaPagamento)));
    const cardFeeCents = payments.reduce((sum, payment) => sum + Number(payment.cartao?.valorTaxaCentavos || 0), 0);
    const financialNetCents = payments.reduce((sum, payment) => sum + Number(payment.cartao?.valorLiquidoCentavos ?? payment.valorCentavos), 0);
    return {
        receivedCents,
        received: (0, exports.fromCents)(receivedCents),
        pendingCents,
        pending: (0, exports.fromCents)(pendingCents),
        cardFeeCents,
        cardFee: (0, exports.fromCents)(cardFeeCents),
        financialNetCents,
        financialNet: (0, exports.fromCents)(financialNetCents),
        paymentMethodLabel: forms.length === 1 ? forms[0] : 'Múltiplas',
        paymentCondition: payments.some((payment) => payment.condicaoPagamento === 'aprazo')
            ? 'aprazo'
            : 'avista',
    };
};
exports.summarizePayments = summarizePayments;
/**
 * Marca um PaymentRecord existente como Cheque aguardando compensação --
 * usado quando uma baixa em Contas a Receber é feita em cheque pra um
 * título que já estava pendente por outro motivo (ex: Pagamento a Prazo).
 * Ao contrário de applyPaymentReceipt, NÃO confirma o pagamento -- só troca
 * a forma e anexa os dados do cheque, mantendo status 'pendente' até a
 * compensação de verdade (ver Financeiro > Cheques). Mesma lógica de
 * localizar o pagamento-alvo que applyPaymentReceipt já usa.
 */
const tagPaymentAsChequeAwaitingClearance = (payments, args) => {
    const targetIndex = payments.findIndex((payment) => (payment.transactionId === args.transactionId ||
        (args.paymentIndex !== undefined &&
            payment.indice === args.paymentIndex &&
            payment.status !== 'confirmado')));
    if (targetIndex < 0) {
        throw new Error('O pagamento vinculado à conta a receber não foi encontrado na venda.');
    }
    return payments.map((payment, index) => (index === targetIndex ? {
        ...payment,
        formaPagamento: 'Cheque',
        cheque: args.cheque,
        dataPrevistaRecebimento: args.cheque.dataCompensacao,
        ...(args.bancoId ? { bancoId: args.bancoId, bancoNome: args.bancoNome || '' } : {}),
    } : payment));
};
exports.tagPaymentAsChequeAwaitingClearance = tagPaymentAsChequeAwaitingClearance;
const applyPaymentReceipt = (payments, args) => {
    if (!Number.isInteger(args.amountCents) || args.amountCents <= 0) {
        throw new Error('O valor recebido deve ser maior que zero.');
    }
    const targetIndex = payments.findIndex((payment) => (payment.transactionId === args.transactionId ||
        (args.paymentIndex !== undefined &&
            payment.indice === args.paymentIndex &&
            payment.status !== 'confirmado')));
    if (targetIndex < 0) {
        throw new Error('O pagamento vinculado à conta a receber não foi encontrado na venda.');
    }
    const target = payments[targetIndex];
    if (args.amountCents > target.valorCentavos) {
        throw new Error('O valor recebido é maior que o saldo do pagamento.');
    }
    const settlementNature = (0, exports.settledFinancialNatureForPayment)(args.method);
    if (args.amountCents === target.valorCentavos) {
        return payments.map((payment, index) => index === targetIndex ? {
            ...payment,
            status: 'confirmado',
            formaRecebimento: args.method,
            naturezaRecebimento: settlementNature,
            movimentaCaixaFisico: args.method === 'Dinheiro',
            recebidoEm: args.receivedAt,
        } : payment);
    }
    const remainingCents = target.valorCentavos - args.amountCents;
    const resizedCard = target.cartao
        ? (0, exports.buildCardDetails)({
            method: target.formaPagamento,
            grossCents: remainingCents,
            installments: target.cartao.parcelas,
            feePercent: target.cartao.taxaPercentual,
            firstSettlementDate: target.cartao.dataPrevistaRecebimento,
            bandeira: target.cartao.bandeira,
            operadora: target.cartao.operadora,
            autorizacao: target.cartao.autorizacao,
        })
        : undefined;
    const remainingPayment = {
        ...target,
        valorCentavos: remainingCents,
        valor: (0, exports.fromCents)(remainingCents),
        ...(resizedCard ? { cartao: resizedCard } : {}),
    };
    const receiptPayment = {
        id: args.receiptId,
        indice: Math.max(0, ...payments.map((payment) => Number(payment.indice || 0))) + 1,
        formaPagamento: args.method,
        condicaoPagamento: 'avista',
        valorCentavos: args.amountCents,
        valor: (0, exports.fromCents)(args.amountCents),
        status: 'confirmado',
        naturezaFinanceira: settlementNature,
        movimentaCaixaFisico: args.method === 'Dinheiro',
        transactionId: args.receiptId,
        formaRecebimento: args.method,
        naturezaRecebimento: settlementNature,
        recebidoEm: args.receivedAt,
        sourcePaymentTransactionId: args.transactionId,
    };
    return [
        ...payments.slice(0, targetIndex),
        remainingPayment,
        ...payments.slice(targetIndex + 1),
        receiptPayment,
    ];
};
exports.applyPaymentReceipt = applyPaymentReceipt;
const KNOWN_PAYMENT_METHODS = [
    'Dinheiro',
    'Pix',
    'Cartão de Crédito',
    'Cartão de Débito',
    'Transferência',
    'Cheque',
    'Boleto',
    'Pagamento a Prazo',
    'Crédito de Devolução',
    'Outros',
];
const asPaymentMethod = (value) => {
    const normalized = String(value || '');
    return KNOWN_PAYMENT_METHODS.includes(normalized)
        ? normalized
        : 'Outros';
};
exports.asPaymentMethod = asPaymentMethod;
/**
 * Pagamento "sintetico" de um titulo cuja venda/OS e' antiga e nao tem o
 * array `pagamentos`: permite baixar/estornar sem esse array.
 */
const legacyPaymentForTransaction = (transactionId, transactionData) => {
    const method = (0, exports.asPaymentMethod)(transactionData.formaPagamento);
    const valueCents = Number(transactionData.valorCentavos ?? (0, exports.toCents)(transactionData.valor));
    return {
        id: transactionId,
        indice: Number(transactionData.paymentIndex || 1),
        formaPagamento: method,
        condicaoPagamento: transactionData.condicaoPagamento === 'aprazo' || method === 'Pagamento a Prazo'
            ? 'aprazo'
            : 'avista',
        valorCentavos: valueCents,
        valor: (0, exports.fromCents)(valueCents),
        status: transactionData.status === 'Paga' ? 'confirmado' : 'pendente',
        naturezaFinanceira: (0, exports.financialNatureForPayment)(method),
        movimentaCaixaFisico: transactionData.status === 'Paga' && method === 'Dinheiro',
        transactionId,
    };
};
exports.legacyPaymentForTransaction = legacyPaymentForTransaction;
/**
 * Desfaz applyPaymentReceipt: o pagamento confirmado volta a pendente, sem
 * os dados do recebimento (forma, natureza, data). Usado no ESTORNO de baixa
 * de Contas a Receber -- a venda/OS de origem precisa voltar a mostrar o
 * pagamento como pendente, senao ela continua constando como paga.
 *
 * So' desfaz pagamento inteiro confirmado. O recibo parcial que o abatimento
 * com credito cria (sourcePaymentTransactionId) nao passa por aqui.
 */
const reversePaymentReceipt = (payments, args) => {
    const targetIndex = payments.findIndex((payment) => (payment.status === 'confirmado' && (payment.transactionId === args.transactionId ||
        (payment.transactionId === undefined &&
            args.paymentIndex !== undefined &&
            payment.indice === args.paymentIndex))));
    if (targetIndex < 0) {
        throw new Error('O pagamento desta conta não foi encontrado como recebido na venda. Atualize a tela e confira se ele já não foi estornado.');
    }
    return payments.map((payment, index) => {
        if (index !== targetIndex)
            return payment;
        // Tira as chaves do recebimento de verdade (nao deixa `undefined`: o
        // Firestore recusa o documento inteiro).
        const pendente = {
            ...payment,
            status: 'pendente',
            naturezaFinanceira: (0, exports.financialNatureForPayment)(payment.formaPagamento),
            movimentaCaixaFisico: false,
        };
        delete pendente.recebidoEm;
        delete pendente.formaRecebimento;
        delete pendente.naturezaRecebimento;
        return pendente;
    });
};
exports.reversePaymentReceipt = reversePaymentReceipt;
const clampPercentual = (valor) => Math.max(0, Math.min(100, valor));
/**
 * Resolve o percentual de comissao de UM item vendido, na ordem: produto/
 * servico (comissao propria, se configurada) > vendedor/mecanico (cadastro,
 * se "recebe comissao" = sim) > padrao do sistema (Configuracoes).
 *
 * "Configurado" = valor numerico presente (inclusive 0). Campo em branco no
 * formulario vira `undefined` no documento (ver parseComissaoPercentualInput
 * -- nunca gravamos 0 pra "nao preenchido", senao um vendedor que digitou
 * "0" de proposito ficaria indistinguivel de quem nunca mexeu no campo).
 *
 * `recebeComissao !== true` (false OU nunca configurado) sempre da 0% e
 * PARA -- nao cai pro sistema. Decisao explicita do dono do produto
 * (2026-08-27): todo cadastro de vendedor ja existente esta desmarcado
 * hoje, e isso tem que continuar dando 0%, nao passar a puxar um padrao
 * novo sem ninguem ter pedido.
 */
const resolveComissaoPercentual = (args) => {
    if (typeof args.itemPercentual === 'number')
        return clampPercentual(args.itemPercentual);
    if (args.recebeComissao !== true)
        return 0;
    if (typeof args.percentualVendedor === 'number')
        return clampPercentual(args.percentualVendedor);
    return clampPercentual(args.percentualPadraoSistema ?? 0);
};
exports.resolveComissaoPercentual = resolveComissaoPercentual;
/** Converte o texto digitado num campo de comissao (produto, servico ou
 * vendedor) pro numero a gravar -- ou `undefined` quando o campo ficou em
 * branco, pra o chamador OMITIR a chave no Firestore (nunca gravar
 * `undefined` direto, regra do projeto). Blank != 0: e o que permite a
 * hierarquia acima distinguir "configurado com zero" de "nunca configurado". */
const parseComissaoPercentualInput = (valor) => {
    const limpo = valor.trim();
    if (!limpo)
        return undefined;
    const numero = Number(limpo.replace(',', '.'));
    return Number.isFinite(numero) ? numero : undefined;
};
exports.parseComissaoPercentualInput = parseComissaoPercentualInput;
const buildCommissionSnapshot = (args) => {
    const enabled = args.profile?.recebeComissaoPecas === true;
    const percentage = enabled
        ? Math.max(0, Math.min(100, Number(args.profile?.comissaoPercentualPecas || 0)))
        : 0;
    const commissionCents = Math.round(args.baseCents * (percentage / 100));
    return {
        tipo: 'percentual_produtos',
        vendedorId: args.sellerId,
        vendedorNome: args.sellerName,
        baseOriginalCentavos: args.baseCents,
        baseOriginal: (0, exports.fromCents)(args.baseCents),
        baseAtualCentavos: args.baseCents,
        baseAtual: (0, exports.fromCents)(args.baseCents),
        percentual: percentage,
        valorOriginalCentavos: commissionCents,
        valorOriginal: (0, exports.fromCents)(commissionCents),
        valorAtualCentavos: commissionCents,
        valorAtual: (0, exports.fromCents)(commissionCents),
        status: percentage > 0 ? 'gerada' : 'nao_aplicavel',
        regraVersion: 1,
        geradaEm: args.generatedAt || new Date().toISOString(),
    };
};
exports.buildCommissionSnapshot = buildCommissionSnapshot;
const buildItensSnapshot = (itens) => itens.map((item) => {
    const valorCents = Math.round(item.baseCents * (item.percentual / 100));
    return {
        id: item.id,
        nome: item.nome,
        baseOriginalCentavos: item.baseCents,
        baseAtualCentavos: item.baseCents,
        percentual: item.percentual,
        valorOriginalCentavos: valorCents,
        valorAtualCentavos: valorCents,
    };
});
/**
 * Pedido de Venda (peças), com comissao por item -- substitui o unico
 * percentual flat de buildCommissionSnapshot por um percentual proprio por
 * item (produto com comissao propria vence; senao vendedor; senao sistema
 * -- ver resolveComissaoPercentual, resolvido pelo chamador ANTES de
 * montar `itens`). Guarda o detalhe por item no snapshot (`itens`) pra
 * recalculateCommissionAfterReturn poder devolver so o item certo depois,
 * sem precisar de um percentual medio.
 *
 * buildCommissionSnapshot (a antiga, flat) continua existindo e intocada
 * -- o PDV (src/pages/PDV/PDV.tsx) ainda a usa e nao faz parte desta
 * fatia.
 */
const buildCommissionSnapshotFromItems = (args) => {
    const itensSnapshot = buildItensSnapshot(args.itens);
    const baseCents = itensSnapshot.reduce((soma, item) => soma + item.baseOriginalCentavos, 0);
    const commissionCents = itensSnapshot.reduce((soma, item) => soma + item.valorOriginalCentavos, 0);
    const percentualMedio = baseCents > 0 ? Number(((commissionCents / baseCents) * 100).toFixed(4)) : 0;
    return {
        tipo: 'percentual_produtos',
        vendedorId: args.sellerId,
        vendedorNome: args.sellerName,
        baseOriginalCentavos: baseCents,
        baseOriginal: (0, exports.fromCents)(baseCents),
        baseAtualCentavos: baseCents,
        baseAtual: (0, exports.fromCents)(baseCents),
        percentual: percentualMedio,
        valorOriginalCentavos: commissionCents,
        valorOriginal: (0, exports.fromCents)(commissionCents),
        valorAtualCentavos: commissionCents,
        valorAtual: (0, exports.fromCents)(commissionCents),
        status: commissionCents > 0 ? 'gerada' : 'nao_aplicavel',
        regraVersion: 1,
        geradaEm: args.generatedAt || new Date().toISOString(),
        itens: itensSnapshot,
    };
};
exports.buildCommissionSnapshotFromItems = buildCommissionSnapshotFromItems;
/**
 * Ordem de Serviço (serviços + peças), com comissao por item -- mesma ideia
 * de buildCommissionSnapshotFromItems, so que em dois grupos separados
 * (serviço e peça tem percentuais resolvidos de fontes diferentes: cada um
 * olha o proprio catalogo, depois recebeComissaoServicos/Pecas do
 * mecanico, depois o padrao do sistema do respectivo tipo). OS nao tem
 * devolucao parcial (so cancelamento total, via cancelCommissionSnapshot),
 * entao os dois grupos aqui sao so pra somar certo o total -- nao precisam
 * do mesmo tratamento de "recalculo por item" que peças de Pedido de Venda.
 */
const buildServiceOrderCommissionSnapshot = (args) => {
    const itensServicosSnapshot = buildItensSnapshot(args.itensServicos);
    const itensPecasSnapshot = buildItensSnapshot(args.itensPecas);
    const baseServicosCentavos = itensServicosSnapshot.reduce((soma, item) => soma + item.baseOriginalCentavos, 0);
    const basePecasCentavos = itensPecasSnapshot.reduce((soma, item) => soma + item.baseOriginalCentavos, 0);
    const valorComissaoServicosCentavos = itensServicosSnapshot.reduce((soma, item) => soma + item.valorOriginalCentavos, 0);
    const valorComissaoPecasCentavos = itensPecasSnapshot.reduce((soma, item) => soma + item.valorOriginalCentavos, 0);
    const baseCents = baseServicosCentavos + basePecasCentavos;
    const commissionCents = valorComissaoServicosCentavos + valorComissaoPecasCentavos;
    return {
        tipo: 'percentual_servicos_produtos',
        vendedorId: args.sellerId,
        vendedorNome: args.sellerName,
        baseOriginalCentavos: baseCents,
        baseOriginal: (0, exports.fromCents)(baseCents),
        baseAtualCentavos: baseCents,
        baseAtual: (0, exports.fromCents)(baseCents),
        percentual: baseCents > 0 ? Number(((commissionCents / baseCents) * 100).toFixed(4)) : 0,
        baseServicosCentavos,
        baseServicos: (0, exports.fromCents)(baseServicosCentavos),
        basePecasCentavos,
        basePecas: (0, exports.fromCents)(basePecasCentavos),
        valorComissaoServicosCentavos,
        valorComissaoServicos: (0, exports.fromCents)(valorComissaoServicosCentavos),
        valorComissaoPecasCentavos,
        valorComissaoPecas: (0, exports.fromCents)(valorComissaoPecasCentavos),
        valorOriginalCentavos: commissionCents,
        valorOriginal: (0, exports.fromCents)(commissionCents),
        valorAtualCentavos: commissionCents,
        valorAtual: (0, exports.fromCents)(commissionCents),
        status: commissionCents > 0 ? 'gerada' : 'nao_aplicavel',
        regraVersion: 1,
        geradaEm: args.generatedAt || new Date().toISOString(),
        itensServicos: itensServicosSnapshot,
        itensPecas: itensPecasSnapshot,
    };
};
exports.buildServiceOrderCommissionSnapshot = buildServiceOrderCommissionSnapshot;
/**
 * Recalcula a comissao apos uma devolucao (parcial ou total).
 *
 * `itensDevolvidos` e' a lista dos itens devolvidos NESTA devolucao (bate
 * por id+nome, igual ao match que DevolucaoVendaModal.tsx ja faz contra os
 * itens da venda -- precisa dos dois porque item "avulso" sem produto no
 * catalogo usa id: 'avulso' repetido em varias linhas da mesma venda).
 *
 * Se o snapshot tem `itens` (venda gerada por buildCommissionSnapshotFromItems,
 * com comissao por item): recalcula CADA item devolvido com o percentual
 * PROPRIO dele e resoma os totais -- devolver so um produto de uma venda
 * com produtos de percentuais diferentes nao pode usar um percentual medio,
 * senao o resultado fica errado pros dois lados (sobra mais ou menos
 * comissao do que o item que ficou realmente vale).
 *
 * Senao (snapshot antigo, sem breakdown por item): mantem exatamente a
 * matematica de sempre -- percentual unico da venda x base agregada
 * reduzida. Zero mudanca de comportamento pra vendas ja existentes.
 */
const recalculateCommissionAfterReturn = (snapshot, itensDevolvidos) => {
    if (snapshot.itens && snapshot.itens.length > 0) {
        const itensAtualizados = snapshot.itens.map((item) => {
            const devolvido = itensDevolvidos.find((d) => d.id === item.id && d.nome === item.nome);
            if (!devolvido)
                return item;
            const baseAtual = Math.max(0, item.baseAtualCentavos - devolvido.baseCents);
            const valorAtual = Math.round(baseAtual * (item.percentual / 100));
            return { ...item, baseAtualCentavos: baseAtual, valorAtualCentavos: valorAtual };
        });
        const baseCents = itensAtualizados.reduce((soma, item) => soma + item.baseAtualCentavos, 0);
        const commissionCents = itensAtualizados.reduce((soma, item) => soma + item.valorAtualCentavos, 0);
        return {
            ...snapshot,
            baseAtualCentavos: baseCents,
            baseAtual: (0, exports.fromCents)(baseCents),
            valorAtualCentavos: commissionCents,
            valorAtual: (0, exports.fromCents)(commissionCents),
            status: commissionCents > 0 ? 'gerada' : 'nao_aplicavel',
            itens: itensAtualizados,
        };
    }
    const returnedBaseCents = itensDevolvidos.reduce((soma, item) => soma + item.baseCents, 0);
    const baseCents = Math.max(0, snapshot.baseAtualCentavos - returnedBaseCents);
    const commissionCents = Math.round(baseCents * (snapshot.percentual / 100));
    return {
        ...snapshot,
        baseAtualCentavos: baseCents,
        baseAtual: (0, exports.fromCents)(baseCents),
        valorAtualCentavos: commissionCents,
        valorAtual: (0, exports.fromCents)(commissionCents),
        status: snapshot.percentual > 0 ? 'gerada' : 'nao_aplicavel',
    };
};
exports.recalculateCommissionAfterReturn = recalculateCommissionAfterReturn;
const cancelCommissionSnapshot = (snapshot, cancelledAt = new Date().toISOString()) => ({
    ...snapshot,
    valorAtualCentavos: 0,
    valorAtual: 0,
    status: 'cancelada',
    canceladaEm: cancelledAt,
});
exports.cancelCommissionSnapshot = cancelCommissionSnapshot;
/**
 * Data em que o titulo VENCE (nao a da operacao que o gerou).
 *
 * Precedencia: vencimento explicito (prazo/boleto) > repasse previsto da
 * administradora (cartao) > `data` > vazio. Importa porque numa venda no
 * cartao `data` guarda a data da VENDA, e o dinheiro so entra em
 * dataPrevistaRecebimento (+30 dias, tipicamente) -- usar `data` marcava a
 * parcela como atrasada no dia seguinte a venda.
 *
 * Fonte unica pra ContasReceber.tsx e Dashboard.tsx, que antes tinham a
 * mesma regra escrita (e divergindo) em cada tela.
 */
const transactionDueDateInput = (transaction) => (transaction.dataVencimento || transaction.dataPrevistaRecebimento || transaction.data || '');
exports.transactionDueDateInput = transactionDueDateInput;
const transactionMovesPhysicalCash = (transaction) => {
    if (typeof transaction.movimentaCaixaFisico === 'boolean') {
        return transaction.movimentaCaixaFisico;
    }
    return transaction.formaPagamento === 'Dinheiro' || transaction.naturezaFinanceira === 'caixa_fisico';
};
exports.transactionMovesPhysicalCash = transactionMovesPhysicalCash;
const transactionOriginalGrossCents = (transaction) => (Number(transaction.valorBrutoCentavos
    ?? transaction.cartao?.valorBrutoCentavos
    ?? transaction.valorCentavos
    ?? (0, exports.toCents)(transaction.valorBruto ?? transaction.valor)));
const transactionGrossCents = (transaction) => (Number(transaction.valorCentavos
    ?? (transaction.valor !== undefined
        ? (0, exports.toCents)(transaction.valor)
        : transactionOriginalGrossCents(transaction))));
exports.transactionGrossCents = transactionGrossCents;
const transactionFeeCents = (transaction) => {
    const currentGrossCents = (0, exports.transactionGrossCents)(transaction);
    const originalGrossCents = transactionOriginalGrossCents(transaction);
    const originalFeeCents = Number(transaction.valorTaxaCentavos
        ?? transaction.cartao?.valorTaxaCentavos
        ?? (0, exports.toCents)(transaction.valorTaxa));
    if (originalGrossCents <= 0 || currentGrossCents === originalGrossCents) {
        return Math.max(0, originalFeeCents);
    }
    return Math.max(0, Math.round(currentGrossCents * (originalFeeCents / originalGrossCents)));
};
exports.transactionFeeCents = transactionFeeCents;
const transactionNetCents = (transaction) => {
    const currentGrossCents = (0, exports.transactionGrossCents)(transaction);
    const originalGrossCents = transactionOriginalGrossCents(transaction);
    const hasExplicitNet = transaction.valorLiquidoCentavos !== undefined
        || transaction.cartao?.valorLiquidoCentavos !== undefined
        || transaction.valorLiquido !== undefined;
    if (!hasExplicitNet) {
        return Math.max(0, currentGrossCents - (0, exports.transactionFeeCents)(transaction));
    }
    const originalNetCents = Number(transaction.valorLiquidoCentavos
        ?? transaction.cartao?.valorLiquidoCentavos
        ?? (0, exports.toCents)(transaction.valorLiquido));
    if (originalGrossCents <= 0 || currentGrossCents === originalGrossCents) {
        return Math.max(0, originalNetCents);
    }
    return Math.max(0, Math.round(currentGrossCents * (originalNetCents / originalGrossCents)));
};
exports.transactionNetCents = transactionNetCents;
/**
 * Valida uma transferencia manual entre dois bancos cadastrados (Modulo
 * Bancos, F18) antes de gravar o par de lancamentos_bancarios. Lanca erro
 * descritivo em vez de retornar boolean para reaproveitar o mesmo padrao
 * de showError(error.message) ja usado em todo o financeDomain.
 */
const validateBankTransfer = (args) => {
    if (!args.originId || !args.destinationId) {
        throw new Error('Selecione o banco de origem e o banco de destino.');
    }
    if (args.originId === args.destinationId) {
        throw new Error('O banco de origem deve ser diferente do banco de destino.');
    }
    if (!Number.isInteger(args.amountCents) || args.amountCents <= 0) {
        throw new Error('O valor da transferência deve ser maior que zero.');
    }
};
exports.validateBankTransfer = validateBankTransfer;
const transactionGrossAmount = (transaction) => (0, exports.fromCents)((0, exports.transactionGrossCents)(transaction));
exports.transactionGrossAmount = transactionGrossAmount;
const transactionFeeAmount = (transaction) => (0, exports.fromCents)((0, exports.transactionFeeCents)(transaction));
exports.transactionFeeAmount = transactionFeeAmount;
const transactionNetAmount = (transaction) => (0, exports.fromCents)((0, exports.transactionNetCents)(transaction));
exports.transactionNetAmount = transactionNetAmount;
/**
 * Categorias que o sistema grava quando ANULA uma receita ja lancada. O
 * cancelamento nao apaga a entrada original (isso preservaria o historico):
 * grava um lancamento de saida compensatorio -- ver OSForm.tsx
 * ("Cancelamento de OS"), PedidoVendaForm.tsx ("Cancelamento de Venda") e
 * DevolucaoVendaModal.tsx ("Devolucao de Venda").
 */
exports.REVENUE_REVERSAL_CATEGORIES = [
    'Cancelamento de OS',
    'Cancelamento de Venda',
    'Devolução de Venda',
];
/**
 * Identifica lancamentos que ANULAM receita, em vez de serem despesa real.
 *
 * Sem isso, uma OS cancelada aparecia duas vezes errada no mesmo painel: a
 * entrada original continuava somando na receita, e o estorno entrava como
 * "despesa" -- o saldo fechava, mas receita e despesa ficavam infladas.
 *
 * O `tipo === 'saida'` NAO e' redundante e nao pode ser removido: o
 * "estorno da devolucao" (PedidoVendaForm.tsx, `estorno_devolucao_*`) usa a
 * MESMA categoria 'Devolução de Venda' com `tipo: 'entrada'`, porque desfaz
 * a devolucao e traz a receita de volta. Sem essa guarda, essa receita
 * legitima seria anulada por engano.
 */
const isRevenueReversal = (transaction) => {
    if (transaction.tipo !== 'saida')
        return false;
    const categoria = String(transaction.categoria || '').trim();
    if (exports.REVENUE_REVERSAL_CATEGORIES.includes(categoria))
        return true;
    // Rede de seguranca pra estornos que venham sem categoria preenchida.
    return String(transaction.sourceType || '').startsWith('cancelamento_');
};
exports.isRevenueReversal = isRevenueReversal;
