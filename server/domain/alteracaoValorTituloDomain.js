"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bloqueioParaRefazerParcelas = exports.centavosParaAOrigem = exports.resumoDaAlteracaoValor = exports.montarAlteracaoValor = exports.validarMotivoAlteracaoValor = exports.validarNovoValorDoTitulo = exports.bloqueioParaAlterarValor = exports.valorAlteradoAtivo = exports.centavosAtuaisDoTitulo = exports.MOTIVO_ALTERACAO_MAXIMO = exports.MOTIVO_ALTERACAO_MINIMO = exports.PERMISSAO_ALTERAR_VALOR = void 0;
/*
 * ALTERAR O VALOR DE UMA PARCELA A RECEBER (pedido do cliente, 15/10/2026).
 *
 * Caso real: a nota fiscal sai com o valor da venda, mas o boleto vai com
 * desconto (ou, menos comum, com um acrescimo combinado). Muda SO' o documento
 * de cobranca -- o titulo em `transacoes` --; a venda/OS e a nota continuam com
 * o valor cheio.
 *
 * Regras (decididas com o dono em 15/10/2026):
 *  - pode diminuir e aumentar; o motivo e' obrigatorio e fica gravado;
 *  - so' quem tem "financeiro.alterar_valor_documento" no cadastro do usuario
 *    (dono e administrador, sempre); quem confere e grava e' o servidor;
 *  - qualquer parcela EM ABERTO do Contas a Receber (venda, OS ou manual);
 *  - parcela com boleto emitido: bloqueia ate' desfazer a emissao; boleto que
 *    ja' foi para o banco (remessa) ou pago: bloqueia sempre;
 *  - cartao e cheque nao: o valor e' o que a operadora paga / o que esta'
 *    escrito no cheque.
 *
 * Venda/OS de origem: o pagamento ligado a parcela continua com o valor da
 * venda (e' dele que saem as duplicatas da nota). Quando a parcela alterada e'
 * quitada, o pagamento da venda e' quitado por INTEIRO -- a diferenca e'
 * desconto/acrescimo da cobranca, nao saldo em aberto. Sem isso a venda
 * ficaria "Parcial" para sempre (ver centavosParaAOrigem).
 *
 * Gravacao: so' `valor`/`valorCentavos` mudam. `valorBrutoCentavos` e
 * `valorLiquidoCentavos` ficam como nasceram -- transactionNetCents escala o
 * liquido pelo valor atual, o mesmo que o abatimento com credito ja' faz.
 */
const financeDomain_1 = require("./financeDomain");
const renegociacaoDomain_1 = require("./renegociacaoDomain");
exports.PERMISSAO_ALTERAR_VALOR = 'financeiro.alterar_valor_documento';
exports.MOTIVO_ALTERACAO_MINIMO = 5;
exports.MOTIVO_ALTERACAO_MAXIMO = 255;
const reais = (centavos) => ((centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const centavosAtuaisDoTitulo = (titulo) => (Number(titulo.valorCentavos ?? (0, financeDomain_1.toCents)(titulo.valor)));
exports.centavosAtuaisDoTitulo = centavosAtuaisDoTitulo;
/** A parcela esta' com valor diferente do que nasceu (por alteracao manual)? */
const valorAlteradoAtivo = (titulo) => (Number(titulo?.alteracaoValor?.diferencaCentavos || 0) !== 0);
exports.valorAlteradoAtivo = valorAlteradoAtivo;
/**
 * Por que esta parcela NAO pode ter o valor alterado agora ('' = pode).
 * A frase ja' diz o que fazer para resolver.
 */
const bloqueioParaAlterarValor = (titulo) => {
    if (titulo.tipo && titulo.tipo !== 'entrada') {
        return 'Só parcelas do Contas a Receber podem ter o valor alterado aqui.';
    }
    if (titulo.status === 'Paga') {
        return 'Esta parcela já foi recebida. Para mudar o valor, estorne o recebimento antes (botão Estornar).';
    }
    if (titulo.status === 'Cancelada') {
        return 'Esta parcela está cancelada e não pode ter o valor alterado.';
    }
    if (titulo.status === renegociacaoDomain_1.STATUS_RENEGOCIADA) {
        return 'Esta parcela foi renegociada. O valor a receber agora está nas parcelas da renegociação.';
    }
    if (titulo.status !== 'Pendente') {
        return 'Só parcelas em aberto podem ter o valor alterado. Atualize a tela e tente de novo.';
    }
    if ((0, financeDomain_1.isCardPayment)(String(titulo.formaPagamento || '')) || titulo.cartao) {
        return 'Parcela de cartão é paga pela operadora no valor da venda; o valor não pode ser alterado aqui.';
    }
    if (titulo.formaPagamento === 'Cheque' || titulo.cheque) {
        const numeroCheque = titulo.cheque?.numeroCheque;
        const numero = numeroCheque ? ` (nº ${numeroCheque})` : '';
        return `Esta parcela já tem um cheque registrado${numero}. O valor é o que está escrito no cheque e não pode ser alterado aqui.`;
    }
    if (titulo.boleto) {
        const { status, numeroRemessa, nossoNumero } = titulo.boleto;
        if (status === 'pago')
            return 'O boleto desta parcela já foi pago. O valor não pode mais ser alterado.';
        if (status === 'em_remessa' || numeroRemessa) {
            const remessa = numeroRemessa ? ` (remessa nº ${numeroRemessa})` : '';
            return `O boleto desta parcela já foi enviado ao banco${remessa}. Mudar o valor aqui não muda o boleto registrado no banco: peça ao banco a baixa do boleto, desfaça a emissão em Financeiro › Boletos e então altere o valor.`;
        }
        const numero = nossoNumero ? ` (nosso número ${nossoNumero})` : '';
        return `Esta parcela já tem boleto emitido${numero}. Para mudar o valor, desfaça a emissão em Financeiro › Boletos, altere o valor aqui e emita o boleto de novo.`;
    }
    return '';
};
exports.bloqueioParaAlterarValor = bloqueioParaAlterarValor;
/** Confere o novo valor (centavos) contra o atual. '' = valido. */
const validarNovoValorDoTitulo = (atualCentavos, novoCentavos) => {
    if (!Number.isInteger(novoCentavos) || novoCentavos <= 0) {
        return 'Informe o novo valor da parcela, em reais e maior que zero.';
    }
    if (novoCentavos === atualCentavos) {
        return 'O novo valor é igual ao valor atual da parcela. Nada foi alterado.';
    }
    // Muito acima do atual e' quase sempre erro de digitacao (virgula esquecida).
    if (novoCentavos > atualCentavos * 3 + 100000) {
        return `O novo valor (${reais(novoCentavos)}) está muito acima do valor atual da parcela (${reais(atualCentavos)}). Confira o valor digitado, em reais e com vírgula.`;
    }
    return '';
};
exports.validarNovoValorDoTitulo = validarNovoValorDoTitulo;
const validarMotivoAlteracaoValor = (motivo) => {
    const texto = String(motivo ?? '').trim();
    if (texto.length < exports.MOTIVO_ALTERACAO_MINIMO) {
        return `Escreva o motivo da alteração (mínimo ${exports.MOTIVO_ALTERACAO_MINIMO} letras). Ex.: "desconto combinado no boleto".`;
    }
    if (texto.length > exports.MOTIVO_ALTERACAO_MAXIMO) {
        return `O motivo pode ter no máximo ${exports.MOTIVO_ALTERACAO_MAXIMO} letras. Resuma o texto.`;
    }
    return '';
};
exports.validarMotivoAlteracaoValor = validarMotivoAlteracaoValor;
/** Registro que vai para o titulo. Sem chave undefined (o Firestore recusa). */
const montarAlteracaoValor = (a) => {
    const anterior = a.titulo.alteracaoValor || null;
    const atual = (0, exports.centavosAtuaisDoTitulo)(a.titulo);
    const original = Number.isInteger(anterior?.valorOriginalCentavos) ? Number(anterior?.valorOriginalCentavos) : atual;
    return {
        valorOriginalCentavos: original,
        valorAnteriorCentavos: atual,
        valorNovoCentavos: a.novoCentavos,
        diferencaCentavos: Number(anterior?.diferencaCentavos || 0) + (a.novoCentavos - atual),
        motivo: String(a.motivo).trim(),
        porUid: a.porUid,
        ...(a.porEmail ? { porEmail: a.porEmail } : {}),
        vezes: Number(anterior?.vezes || 0) + 1,
    };
};
exports.montarAlteracaoValor = montarAlteracaoValor;
/** "De R$ 100,00 para R$ 90,00. Motivo: ..." -- para a tela e o log. */
const resumoDaAlteracaoValor = (registro) => {
    if (!registro || !Number.isInteger(registro.valorAnteriorCentavos) || !Number.isInteger(registro.valorNovoCentavos))
        return '';
    const motivo = registro.motivo ? ` Motivo: ${registro.motivo}` : '';
    return `De ${reais(Number(registro.valorAnteriorCentavos))} para ${reais(Number(registro.valorNovoCentavos))}.${motivo}`;
};
exports.resumoDaAlteracaoValor = resumoDaAlteracaoValor;
/**
 * Quanto do pagamento da venda/OS um recebimento desta parcela quita.
 *  - parcela sem alteracao: o mesmo valor recebido (regra de sempre);
 *  - parcela alterada e QUITADA: o pagamento inteiro da venda;
 *  - parcela alterada e recebida em parte (abatimento com credito): o
 *    recebido, mas nunca o pagamento inteiro -- ele so' fecha junto com a
 *    parcela.
 */
const centavosParaAOrigem = (pagamentos, a) => {
    if (!(0, exports.valorAlteradoAtivo)(a.titulo))
        return a.recebidoCentavos;
    const pagamento = (0, financeDomain_1.pagamentoDoTitulo)(pagamentos, { transactionId: a.transactionId, paymentIndex: a.paymentIndex });
    const pagamentoCentavos = Number(pagamento?.valorCentavos || 0);
    if (!(pagamentoCentavos > 0))
        return a.recebidoCentavos;
    if (a.tituloQuitado)
        return pagamentoCentavos;
    return Math.max(1, Math.min(a.recebidoCentavos, pagamentoCentavos - 1));
};
exports.centavosParaAOrigem = centavosParaAOrigem;
/**
 * Telas que REFAZEM as parcelas de uma venda/OS (alterar forma de pagamento,
 * salvar a OS de novo) apagariam o valor alterado. '' = pode refazer.
 */
const bloqueioParaRefazerParcelas = (titulos, documento) => {
    const renegociada = (0, renegociacaoDomain_1.bloqueioPorParcelaRenegociada)(titulos, `mexer nas parcelas desta ${documento}`);
    if (renegociada)
        return renegociada;
    const alterado = titulos.find((t) => t.status !== 'Cancelada' && (0, exports.valorAlteradoAtivo)(t));
    if (!alterado)
        return '';
    const nome = alterado.descricao ? ` "${alterado.descricao}"` : '';
    const atual = (0, exports.centavosAtuaisDoTitulo)(alterado);
    const original = atual - Number(alterado.alteracaoValor?.diferencaCentavos || 0);
    return `A parcela${nome} desta ${documento} teve o valor alterado no Contas a Receber (de ${reais(original)} para ${reais(atual)}). Refazer as parcelas apagaria essa alteração. Para continuar, volte a parcela para ${reais(original)} em Financeiro › Contas a Receber (Alterar valor) e tente de novo.`;
};
exports.bloqueioParaRefazerParcelas = bloqueioParaRefazerParcelas;
