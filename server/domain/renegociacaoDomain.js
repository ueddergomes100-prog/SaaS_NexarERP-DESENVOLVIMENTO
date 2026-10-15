"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.origensDaRenegociacao = exports.reabrirPagamentosRenegociados = exports.quitarPagamentosRenegociados = exports.renegociacaoQuitadaComEsteRecebimento = exports.origemDoTitulo = exports.descricaoDaParcelaNova = exports.validarFormaRenegociacao = exports.validarMotivoRenegociacao = exports.validarParcelasNovas = exports.dividirEmParcelas = exports.somarDias = exports.validarTitulosParaRenegociar = exports.chaveDoClienteDoTitulo = exports.bloqueioPorParcelaRenegociada = exports.bloqueioParaRenegociar = exports.ehParcelaDeRenegociacao = exports.centavosDoTituloRenegociado = exports.FORMAS_RENEGOCIACAO = exports.MOTIVO_RENEGOCIACAO_MAXIMO = exports.MOTIVO_RENEGOCIACAO_MINIMO = exports.LIMITE_PARCELAS_RENEGOCIACAO = exports.LIMITE_TITULOS_RENEGOCIACAO = exports.STATUS_RENEGOCIADA = exports.PERMISSAO_RENEGOCIAR = void 0;
/*
 * RENEGOCIACAO DE PARCELAS A RECEBER (pedido do dono, 15/10/2026).
 *
 * Caso real: o cliente deve 3 parcelas de R$ 1.000 e, para quitar, fecha um
 * acordo de R$ 2.600 -- em um documento so' ou em algumas parcelas novas.
 *
 * Decisoes do dono (caixa de perguntas, 15/10/2026):
 *  - o documento novo pode ter 1 ou mais parcelas (total, vencimentos e forma
 *    escolhidos na hora);
 *  - as vendas/OS de onde vieram as parcelas antigas SO' ficam quitadas quando
 *    a renegociacao for paga (a ultima parcela nova recebida quita todas);
 *  - "Desfazer renegociacao" volta as parcelas antigas para em aberto e devolve
 *    o que as parcelas novas ja' tinham posto no caixa/banco;
 *  - permissao propria: "Financeiro: Renegociar Documentos".
 *
 * Como fica gravado (tudo pelo servidor):
 *  - parcelas antigas: status "Renegociada" (nem em aberto nem recebida -- nao
 *    entram em total nenhum), `renegociacaoId`;
 *  - parcelas novas: titulos de entrada comuns (sem venda/OS), com o mapa
 *    `renegociacao` (ids das antigas e das novas, motivo, quem, totais).
 * Nao existe colecao nova: tudo mora em `transacoes` (sem rules novas).
 */
const financeDomain_1 = require("./financeDomain");
exports.PERMISSAO_RENEGOCIAR = 'financeiro.renegociar';
exports.STATUS_RENEGOCIADA = 'Renegociada';
exports.LIMITE_TITULOS_RENEGOCIACAO = 50;
exports.LIMITE_PARCELAS_RENEGOCIACAO = 48;
exports.MOTIVO_RENEGOCIACAO_MINIMO = 5;
exports.MOTIVO_RENEGOCIACAO_MAXIMO = 255;
/** Formas que a parcela nova pode ter (todas ficam em aberto ate' a baixa). */
exports.FORMAS_RENEGOCIACAO = ['Boleto', 'Pagamento a Prazo', 'Pix', 'Transferência', 'Dinheiro'];
const reais = (centavos) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const centavosDoTituloRenegociado = (titulo) => (Number(titulo.valorCentavos ?? (0, financeDomain_1.toCents)(titulo.valor)));
exports.centavosDoTituloRenegociado = centavosDoTituloRenegociado;
/** E' uma parcela NOVA de renegociacao? */
const ehParcelaDeRenegociacao = (titulo) => (Boolean(titulo?.renegociacao && titulo.renegociacao.id));
exports.ehParcelaDeRenegociacao = ehParcelaDeRenegociacao;
/** Por que esta parcela NAO entra numa renegociacao agora ('' = entra). A frase completa
 *  a partir de "A parcela X ..." (ver validarTitulosParaRenegociar). */
const bloqueioParaRenegociar = (titulo) => {
    if (titulo.tipo && titulo.tipo !== 'entrada')
        return 'não é do Contas a Receber.';
    if (titulo.acrescimoDaTransacaoId)
        return 'é de juros e multa e não entra em renegociação.';
    if (titulo.status === 'Paga')
        return 'já foi recebida.';
    if (titulo.status === 'Cancelada')
        return 'está cancelada.';
    if (titulo.status === exports.STATUS_RENEGOCIADA)
        return 'já foi renegociada.';
    if (titulo.status !== 'Pendente')
        return 'não está em aberto. Atualize a tela e tente de novo.';
    if ((0, exports.ehParcelaDeRenegociacao)(titulo)) {
        return 'já é parcela de uma renegociação. Para renegociar de novo, desfaça a renegociação anterior (botão "Desfazer renegociação").';
    }
    if ((0, financeDomain_1.isCardPayment)(String(titulo.formaPagamento || '')) || titulo.cartao)
        return 'é de cartão (quem paga é a operadora).';
    if (titulo.formaPagamento === 'Cheque' || titulo.cheque)
        return 'já tem cheque registrado.';
    if (titulo.boleto) {
        const { status, numeroRemessa } = titulo.boleto;
        if (status === 'pago')
            return 'tem boleto pago.';
        if (status === 'em_remessa' || numeroRemessa) {
            return 'tem boleto já enviado ao banco. Peça a baixa do boleto ao banco e desfaça a emissão em Financeiro › Boletos antes.';
        }
        return 'tem boleto emitido. Desfaça a emissão em Financeiro › Boletos antes de renegociar.';
    }
    if (!((0, exports.centavosDoTituloRenegociado)(titulo) > 0))
        return 'está sem valor.';
    return '';
};
exports.bloqueioParaRenegociar = bloqueioParaRenegociar;
/**
 * Cancelar a venda/OS ou refazer as parcelas dela com parcela RENEGOCIADA
 * criaria a divida de novo (ou deixaria a renegociacao cobrando algo cancelado).
 * '' = pode seguir. `acao` completa a frase: "cancelar a venda", "refazer as parcelas".
 */
const bloqueioPorParcelaRenegociada = (titulos, acao) => {
    const renegociada = titulos.find((t) => t.status === exports.STATUS_RENEGOCIADA);
    if (!renegociada)
        return '';
    const nome = renegociada.descricao ? ` "${renegociada.descricao}"` : '';
    return `A parcela${nome} foi renegociada no Contas a Receber. Para ${acao}, desfaça a renegociação antes (Contas a Receber › parcela da renegociação › Desfazer renegociação).`;
};
exports.bloqueioPorParcelaRenegociada = bloqueioPorParcelaRenegociada;
/** Cliente da parcela, para conferir que a renegociacao e' de um cliente so'. */
const chaveDoClienteDoTitulo = (titulo) => {
    if (titulo.clienteId)
        return `id:${titulo.clienteId}`;
    const nome = String(titulo.clienteNome || '').trim().toUpperCase().replace(/\s+/g, ' ');
    return nome ? `nome:${nome}` : '';
};
exports.chaveDoClienteDoTitulo = chaveDoClienteDoTitulo;
/** Confere as parcelas escolhidas ('' = podem ser renegociadas juntas). */
const validarTitulosParaRenegociar = (titulos) => {
    if (titulos.length === 0)
        return 'Selecione as parcelas em aberto que vão ser renegociadas.';
    if (titulos.length > exports.LIMITE_TITULOS_RENEGOCIACAO) {
        return `Renegocie no máximo ${exports.LIMITE_TITULOS_RENEGOCIACAO} parcelas de uma vez.`;
    }
    const ids = new Set();
    for (const titulo of titulos) {
        if (titulo.id) {
            if (ids.has(titulo.id))
                return 'A mesma parcela apareceu duas vezes. Atualize a tela e selecione de novo.';
            ids.add(titulo.id);
        }
        const bloqueio = (0, exports.bloqueioParaRenegociar)(titulo);
        if (bloqueio)
            return `A parcela "${titulo.descricao || 'sem descrição'}" ${bloqueio}`;
    }
    const clientes = new Set(titulos.map(exports.chaveDoClienteDoTitulo));
    if (clientes.has(''))
        return 'Há parcela sem cliente identificado. Renegociação é sempre de um cliente só.';
    if (clientes.size > 1)
        return 'Renegociação é de um cliente só. Selecione apenas parcelas do mesmo cliente.';
    return '';
};
exports.validarTitulosParaRenegociar = validarTitulosParaRenegociar;
/** Soma 'dias' a uma data AAAA-MM-DD (sem fuso). */
const somarDias = (data, dias) => {
    const [a, m, d] = data.split('-').map(Number);
    const dt = new Date(Date.UTC(a, m - 1, d + dias));
    return dt.toISOString().slice(0, 10);
};
exports.somarDias = somarDias;
/**
 * Divide o total em parcelas iguais (os centavos que sobram vao na ultima),
 * a primeira no vencimento escolhido e as outras a cada `intervaloDias`.
 */
const dividirEmParcelas = (a) => {
    const quantidade = Math.max(1, Math.min(exports.LIMITE_PARCELAS_RENEGOCIACAO, Math.floor(a.quantidade) || 1));
    const total = Math.max(0, Math.round(a.totalCentavos));
    const base = Math.floor(total / quantidade);
    const intervalo = Math.max(1, Math.floor(a.intervaloDias) || 30);
    return Array.from({ length: quantidade }, (_, i) => ({
        valorCentavos: i === quantidade - 1 ? total - base * (quantidade - 1) : base,
        vencimento: DATA_ISO.test(a.primeiroVencimento) ? (0, exports.somarDias)(a.primeiroVencimento, i * intervalo) : '',
    }));
};
exports.dividirEmParcelas = dividirEmParcelas;
const dataExiste = (data) => DATA_ISO.test(data) && (0, exports.somarDias)(data, 0) === data;
/** Confere as parcelas novas ('' = validas). */
const validarParcelasNovas = (parcelas, totalOrigemCentavos, hoje) => {
    if (!Array.isArray(parcelas) || parcelas.length === 0)
        return 'Informe ao menos uma parcela nova.';
    if (parcelas.length > exports.LIMITE_PARCELAS_RENEGOCIACAO)
        return `A renegociação pode ter no máximo ${exports.LIMITE_PARCELAS_RENEGOCIACAO} parcelas.`;
    let total = 0;
    for (let i = 0; i < parcelas.length; i += 1) {
        const { valorCentavos, vencimento } = parcelas[i] || {};
        const rotulo = parcelas.length === 1 ? 'Documento novo' : `Parcela ${i + 1}`;
        if (!Number.isInteger(valorCentavos) || valorCentavos <= 0)
            return `${rotulo}: informe um valor maior que zero.`;
        if (!dataExiste(String(vencimento || '')))
            return `${rotulo}: informe o vencimento.`;
        if (vencimento < hoje)
            return `${rotulo}: o vencimento não pode ser antes de hoje.`;
        total += valorCentavos;
    }
    // Muito acima do que era devido e' quase sempre erro de digitacao.
    if (total > totalOrigemCentavos * 3 + 100000) {
        return `O total renegociado (${reais(total)}) está muito acima do que era devido (${reais(totalOrigemCentavos)}). Confira os valores digitados.`;
    }
    return '';
};
exports.validarParcelasNovas = validarParcelasNovas;
/** `para`: renegociar (padrao) ou desfazer a renegociacao -- muda so' o texto. */
const validarMotivoRenegociacao = (motivo, para = 'renegociar') => {
    const texto = String(motivo ?? '').trim();
    if (texto.length < exports.MOTIVO_RENEGOCIACAO_MINIMO) {
        return para === 'desfazer'
            ? `Escreva por que a renegociação está sendo desfeita (mínimo ${exports.MOTIVO_RENEGOCIACAO_MINIMO} letras). Ex.: "cliente não cumpriu o acordo".`
            : `Escreva o motivo da renegociação (mínimo ${exports.MOTIVO_RENEGOCIACAO_MINIMO} letras). Ex.: "acordo para quitar as 3 parcelas".`;
    }
    if (texto.length > exports.MOTIVO_RENEGOCIACAO_MAXIMO)
        return `O motivo pode ter no máximo ${exports.MOTIVO_RENEGOCIACAO_MAXIMO} letras. Resuma o texto.`;
    return '';
};
exports.validarMotivoRenegociacao = validarMotivoRenegociacao;
const validarFormaRenegociacao = (forma) => (exports.FORMAS_RENEGOCIACAO.includes(String(forma))
    ? ''
    : 'Escolha como as parcelas novas vão ser cobradas (boleto, a prazo, Pix, transferência ou dinheiro).');
exports.validarFormaRenegociacao = validarFormaRenegociacao;
/** "Renegociação — parcela 1/2" (ou "Renegociação" quando e' um documento so'). */
const descricaoDaParcelaNova = (parcela, totalParcelas) => (totalParcelas > 1 ? `Renegociação — parcela ${parcela}/${totalParcelas}` : 'Renegociação — documento único');
exports.descricaoDaParcelaNova = descricaoDaParcelaNova;
/** Parcela antiga como fica guardada nas novas (sem chave undefined). */
const origemDoTitulo = (id, titulo) => ({
    id,
    descricao: String(titulo.descricao || ''),
    valorCentavos: (0, exports.centavosDoTituloRenegociado)(titulo),
    ...(titulo.pedidoId ? { pedidoId: String(titulo.pedidoId) } : {}),
    ...(!titulo.pedidoId && titulo.osId ? { osId: String(titulo.osId) } : {}),
    ...(Number.isInteger(titulo.paymentIndex) ? { paymentIndex: Number(titulo.paymentIndex) } : {}),
});
exports.origemDoTitulo = origemDoTitulo;
/**
 * A renegociacao fica quitada com este recebimento? So' quando TODAS as
 * outras parcelas novas ja' estao recebidas.
 */
const renegociacaoQuitadaComEsteRecebimento = (outras) => (outras.every((t) => t.status === 'Paga'));
exports.renegociacaoQuitadaComEsteRecebimento = renegociacaoQuitadaComEsteRecebimento;
/**
 * Quita na venda/OS os pagamentos das parcelas antigas dela (renegociacao paga).
 * Cada pagamento sai confirmado por INTEIRO -- o que foi recebido de verdade
 * esta' nas parcelas novas; a diferenca e' desconto/acrescimo do acordo.
 */
const quitarPagamentosRenegociados = (pagamentos, titulos, recebidoEm) => titulos.reduce((atual, titulo) => {
    const alvo = (0, financeDomain_1.pagamentoDoTitulo)(atual, { transactionId: titulo.id, paymentIndex: titulo.paymentIndex });
    if (!alvo || alvo.status === 'confirmado' || !(alvo.valorCentavos > 0))
        return atual;
    return (0, financeDomain_1.applyPaymentReceipt)(atual, {
        transactionId: titulo.id,
        paymentIndex: titulo.paymentIndex,
        amountCents: alvo.valorCentavos,
        method: 'Outros',
        receiptId: titulo.id,
        receivedAt: recebidoEm,
    });
}, pagamentos);
exports.quitarPagamentosRenegociados = quitarPagamentosRenegociados;
/** Desfaz quitarPagamentosRenegociados (estorno de parcela nova ou desfazer a renegociacao). */
const reabrirPagamentosRenegociados = (pagamentos, titulos) => titulos.reduce((atual, titulo) => {
    const confirmado = atual.some((p) => p.status === 'confirmado' && (p.transactionId === titulo.id || (p.transactionId === undefined && titulo.paymentIndex !== undefined && p.indice === titulo.paymentIndex)));
    if (!confirmado)
        return atual;
    return (0, financeDomain_1.reversePaymentReceipt)(atual, { transactionId: titulo.id, paymentIndex: titulo.paymentIndex });
}, pagamentos);
exports.reabrirPagamentosRenegociados = reabrirPagamentosRenegociados;
/** Parcelas antigas agrupadas pela venda/OS de origem (as sem origem ficam de fora). */
const origensDaRenegociacao = (titulos) => {
    const mapa = new Map();
    titulos.forEach((t) => {
        const colecao = t.pedidoId ? 'pedidos_venda' : t.osId ? 'ordens_de_servico' : null;
        const id = t.pedidoId || t.osId;
        if (!colecao || !id)
            return;
        const chave = `${colecao}/${id}`;
        const atual = mapa.get(chave) ?? { colecao, id, titulos: [] };
        atual.titulos.push(t);
        mapa.set(chave, atual);
    });
    return Array.from(mapa.values());
};
exports.origensDaRenegociacao = origensDaRenegociacao;
