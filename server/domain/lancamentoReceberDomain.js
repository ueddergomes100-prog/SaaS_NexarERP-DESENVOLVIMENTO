"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nomeDoDevedor = exports.lerPedidoDeCancelamento = exports.mudancasDaEdicao = exports.lerPedidoDeEdicao = exports.bloqueioParaMexerNaConta = exports.ehContaAvulsa = exports.titulosDoLancamento = exports.idDoTituloLancado = exports.camposDoDevedor = exports.lerPedidoDeLancamento = exports.MENSAGEM_ESCOLHA_DEVEDOR = exports.MOTIVO_MINIMO_CANCELAR = exports.LIMITE_PARCELAS_LANCAMENTO = exports.CATEGORIA_SEM_ESCOLHA = exports.CATEGORIAS_RECEITA_PADRAO = exports.FORMAS_PREVISTAS_RECEBER = exports.ORIGEM_LANCAMENTO_MANUAL = void 0;
/*
 * CONTA A RECEBER LANCADA A MAO (19/10/2026, pedido do dono).
 *
 * Em Contas a Receber, "Lancar conta a receber" registra um valor que alguem
 * deve a empresa sem ter vindo de venda ou OS: de um CLIENTE ou de um
 * FORNECEDOR (devolucao em dinheiro, bonificacao, acerto...). Decisoes do dono:
 *  - a conta entra SO' EM ABERTO; o recebimento e' o "Dar baixa" de sempre,
 *    que ja' cuida de caixa/banco, data, juros e multa, recibo e estorno;
 *  - conta de fornecedor sai em boleto e recibo com o cadastro DELE.
 *
 * Grava pelo servidor (POST /api/financeiro/receber/lancar), com log de quem
 * lancou; editar e cancelar tambem (so' conta avulsa, em aberto, sem boleto,
 * cheque ou pagamento parcial). O valor nao muda na edicao: para isso existe
 * "Alterar valor", que pede motivo e fica no log.
 *
 * Funcoes puras, compiladas para o servidor (scripts/build-server-domain.mjs).
 */
const financeDomain_1 = require("./financeDomain");
exports.ORIGEM_LANCAMENTO_MANUAL = 'manual';
/** Como a conta deve ser paga (prevista; a forma de verdade e' a da baixa). Cartao fica fora: e' da tela Banco. */
exports.FORMAS_PREVISTAS_RECEBER = ['Boleto', 'Pix', 'Transferência', 'Dinheiro', 'Cheque', 'Outros'];
/** Mesmas categorias de receita padrao do Caixa (Configuracoes › Plano de Contas troca). */
exports.CATEGORIAS_RECEITA_PADRAO = ['Serviços', 'Venda de Peças', 'Outras Receitas'];
exports.CATEGORIA_SEM_ESCOLHA = 'OUTRAS RECEITAS';
exports.LIMITE_PARCELAS_LANCAMENTO = 60;
exports.MOTIVO_MINIMO_CANCELAR = 12;
const ID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;
const DATA_VALIDA = /^\d{4}-\d{2}-\d{2}$/;
const objeto = (v) => (v && typeof v === 'object' ? v : {});
const texto = (v, limite) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, limite);
const dataValida = (v) => {
    if (typeof v !== 'string' || !DATA_VALIDA.test(v))
        return false;
    const ano = Number(v.slice(0, 4));
    const d = new Date(`${v}T12:00:00Z`);
    return ano >= 2000 && ano <= 2100 && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
const lerDevedor = (v) => {
    const d = objeto(v);
    const tipo = d.tipo === 'cliente' || d.tipo === 'fornecedor' ? d.tipo : null;
    const id = String(d.id ?? '');
    return tipo && ID_VALIDO.test(id) ? { tipo, id } : null;
};
const lerForma = (v) => (exports.FORMAS_PREVISTAS_RECEBER.includes(String(v)) ? String(v) : null);
exports.MENSAGEM_ESCOLHA_DEVEDOR = 'Escolha quem vai pagar: busque o cliente ou o fornecedor e selecione na lista.';
/** POST /api/financeiro/receber/lancar. Valida antes de qualquer leitura no banco. */
const lerPedidoDeLancamento = (corpo) => {
    const c = objeto(corpo);
    const idLancamento = String(c.idLancamento ?? '');
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(idLancamento))
        return { erro: 'Lançamento inválido. Feche a janela e lance de novo.' };
    const devedor = lerDevedor(c.devedor);
    if (!devedor)
        return { erro: exports.MENSAGEM_ESCOLHA_DEVEDOR };
    const descricao = texto(c.descricao, 200);
    if (!descricao)
        return { erro: 'Informe a descrição: do que é este valor a receber.' };
    const formaPrevista = lerForma(c.formaPrevista);
    if (!formaPrevista)
        return { erro: 'Escolha a forma prevista de recebimento.' };
    if (!Array.isArray(c.parcelas) || c.parcelas.length === 0)
        return { erro: 'Informe o valor e o vencimento da conta.' };
    if (c.parcelas.length > exports.LIMITE_PARCELAS_LANCAMENTO)
        return { erro: `Lance no máximo ${exports.LIMITE_PARCELAS_LANCAMENTO} parcelas de uma vez.` };
    const parcelas = [];
    for (const [i, bruta] of c.parcelas.entries()) {
        const p = objeto(bruta);
        const rotulo = c.parcelas.length > 1 ? `Parcela ${i + 1}: ` : '';
        if (!dataValida(p.vencimento))
            return { erro: `${rotulo}informe uma data de vencimento válida.` };
        const valorCentavos = Number(p.valorCentavos);
        if (!Number.isInteger(valorCentavos) || valorCentavos <= 0)
            return { erro: `${rotulo}o valor deve ser maior que zero.` };
        parcelas.push({ vencimento: p.vencimento, valorCentavos });
    }
    return {
        pedido: {
            idLancamento,
            devedor,
            descricao,
            categoria: texto(c.categoria, 80),
            formaPrevista,
            documento: texto(c.documento, 60),
            observacao: texto(c.observacao, 500),
            parcelas,
        },
    };
};
exports.lerPedidoDeLancamento = lerPedidoDeLancamento;
/** Campos de quem deve. O outro par (cliente x fornecedor) nunca vai junto. */
const camposDoDevedor = (devedor, nome) => (devedor.tipo === 'cliente'
    ? { clienteId: devedor.id, clienteNome: nome }
    : { fornecedorId: devedor.id, fornecedorNome: nome });
exports.camposDoDevedor = camposDoDevedor;
const camposDaForma = (forma) => ({
    formaPagamento: forma,
    condicaoPagamento: 'aprazo',
    naturezaFinanceira: (0, financeDomain_1.financialNatureForPayment)(forma),
    movimentaCaixaFisico: false,
});
const camposDoVencimento = (vencimento) => ({ data: vencimento, dataVencimento: vencimento, dataPrevistaRecebimento: vencimento });
const idDoTituloLancado = (idLancamento, indice, total) => (total === 1 ? `lanc_${idLancamento}` : `lanc_${idLancamento}_p${indice + 1}`);
exports.idDoTituloLancado = idDoTituloLancado;
/**
 * Os titulos (um por parcela) como ficam em `transacoes` -- sem os carimbos de
 * data do servidor, que o servico acrescenta. Nada `undefined`.
 */
const titulosDoLancamento = (pedido, devedorNome, usuario) => {
    const total = pedido.parcelas.length;
    const descricaoBase = pedido.descricao.toUpperCase();
    return pedido.parcelas.map((parcela, i) => ({
        id: (0, exports.idDoTituloLancado)(pedido.idLancamento, i, total),
        campos: {
            tipo: 'entrada',
            status: 'Pendente',
            descricao: total > 1 ? `${descricaoBase} (Parcela ${i + 1}/${total})` : descricaoBase,
            categoria: (pedido.categoria || exports.CATEGORIA_SEM_ESCOLHA).toUpperCase(),
            valor: (0, financeDomain_1.fromCents)(parcela.valorCentavos),
            valorCentavos: parcela.valorCentavos,
            valorBruto: (0, financeDomain_1.fromCents)(parcela.valorCentavos),
            valorBrutoCentavos: parcela.valorCentavos,
            valorTaxa: 0,
            valorTaxaCentavos: 0,
            valorLiquido: (0, financeDomain_1.fromCents)(parcela.valorCentavos),
            valorLiquidoCentavos: parcela.valorCentavos,
            ...camposDaForma(pedido.formaPrevista),
            ...camposDoVencimento(parcela.vencimento),
            ...(0, exports.camposDoDevedor)(pedido.devedor, devedorNome),
            ...(pedido.documento ? { documento: pedido.documento } : {}),
            ...(pedido.observacao ? { observacao: pedido.observacao } : {}),
            ...(total > 1 ? { parcela: i + 1, totalParcelas: total } : {}),
            grupoLancamentoId: pedido.idLancamento,
            origemLancamento: exports.ORIGEM_LANCAMENTO_MANUAL,
            lancadoPor: usuario.uid,
            lancadoPorNome: usuario.nome,
            ...(usuario.email ? { lancadoPorEmail: usuario.email } : {}),
            idempotencyKey: `lancamento:${pedido.idLancamento}:parcela:${i + 1}`,
        },
    }));
};
exports.titulosDoLancamento = titulosDoLancamento;
/** Conta avulsa (lancada a mao ou importada), sem venda/OS por tras? */
const ehContaAvulsa = (t) => ((t.origemLancamento === exports.ORIGEM_LANCAMENTO_MANUAL || Boolean(t.origemImportacao))
    && !t.pedidoId && !t.osId && !t.sourceType && !t.renegociacao && !t.parcialDaTransacaoId);
exports.ehContaAvulsa = ehContaAvulsa;
/** Por que esta conta NAO pode ser editada/cancelada agora ('' = pode). A frase diz o que fazer. */
const bloqueioParaMexerNaConta = (t, acao) => {
    const verbo = acao === 'editar' ? 'editada' : 'cancelada';
    if (t.tipo && t.tipo !== 'entrada')
        return 'Só contas do Contas a Receber são mexidas aqui.';
    if (!(0, exports.ehContaAvulsa)(t)) {
        return `Só contas lançadas à mão ou importadas podem ser ${verbo}s aqui. Conta de venda ou OS muda pela própria venda/OS.`;
    }
    if (t.status === 'Paga')
        return `Esta conta já foi recebida. Para ela ser ${verbo}, estorne o recebimento antes (botão Estornar).`;
    if (t.status === 'Cancelada')
        return 'Esta conta já está cancelada.';
    if (t.status !== 'Pendente')
        return `Só contas em aberto podem ser ${verbo}s. Atualize a tela e tente de novo.`;
    if ((Number(t.pagoParcialCentavos) || 0) > 0) {
        return `Esta conta já recebeu pagamento parcial. Estorne os pagamentos parciais antes de ela ser ${verbo}.`;
    }
    if (t.boleto && t.boleto.status !== 'cancelado') {
        return `Esta conta tem boleto emitido. Desfaça a emissão em Financeiro › Boletos antes de ela ser ${verbo}.`;
    }
    if (t.cheque)
        return `Esta conta já tem cheque registrado e não pode ser ${verbo}. Estorne o recebimento antes.`;
    if (t.cartao)
        return 'Conta de cartão é conciliada na tela Banco.';
    return '';
};
exports.bloqueioParaMexerNaConta = bloqueioParaMexerNaConta;
/** POST /api/financeiro/receber/editar. */
const lerPedidoDeEdicao = (corpo) => {
    const c = objeto(corpo);
    const transacaoId = String(c.transacaoId ?? '');
    if (!ID_VALIDO.test(transacaoId))
        return { erro: 'Conta inválida. Atualize a tela e tente de novo.' };
    const devedor = lerDevedor(c.devedor);
    if (!devedor)
        return { erro: exports.MENSAGEM_ESCOLHA_DEVEDOR };
    const descricao = texto(c.descricao, 220);
    if (!descricao)
        return { erro: 'Informe a descrição: do que é este valor a receber.' };
    const formaPrevista = lerForma(c.formaPrevista);
    if (!formaPrevista)
        return { erro: 'Escolha a forma prevista de recebimento.' };
    if (!dataValida(c.vencimento))
        return { erro: 'Informe uma data de vencimento válida.' };
    return {
        pedido: {
            transacaoId,
            devedor,
            descricao,
            categoria: texto(c.categoria, 80),
            formaPrevista,
            documento: texto(c.documento, 60),
            observacao: texto(c.observacao, 500),
            vencimento: c.vencimento,
        },
    };
};
exports.lerPedidoDeEdicao = lerPedidoDeEdicao;
/**
 * O que muda na conta editada: `campos` a gravar, `remover` (chaves que saem --
 * troca de cliente para fornecedor, documento apagado) e `alteracoes` para o log.
 */
const mudancasDaEdicao = (atual, pedido, devedorNome) => {
    const campos = {};
    const remover = [];
    const alteracoes = [];
    const mudou = (campo, de, para) => {
        const antes = String(de ?? '');
        if (antes !== para)
            alteracoes.push({ campo, de: antes, para });
        return antes !== para;
    };
    // So' maiuscula/minuscula diferente (ex.: "(Parcela 1/2)") nao e' mudanca.
    const descricaoAtual = String(atual.descricao ?? '');
    const descricao = pedido.descricao.toUpperCase() === descricaoAtual.toUpperCase() ? descricaoAtual : pedido.descricao.toUpperCase();
    if (mudou('Descrição', descricaoAtual, descricao))
        campos.descricao = descricao;
    const categoria = (pedido.categoria || exports.CATEGORIA_SEM_ESCOLHA).toUpperCase();
    if (mudou('Categoria', atual.categoria, categoria))
        campos.categoria = categoria;
    if (mudou('Forma prevista', atual.formaPagamento, pedido.formaPrevista))
        Object.assign(campos, camposDaForma(pedido.formaPrevista));
    const vencimentoAtual = atual.dataVencimento || atual.data;
    if (mudou('Vencimento', vencimentoAtual, pedido.vencimento))
        Object.assign(campos, camposDoVencimento(pedido.vencimento));
    if (mudou('Nº do documento', atual.documento, pedido.documento)) {
        if (pedido.documento)
            campos.documento = pedido.documento;
        else
            remover.push('documento');
    }
    if (mudou('Observação', atual.observacao, pedido.observacao)) {
        if (pedido.observacao)
            campos.observacao = pedido.observacao;
        else
            remover.push('observacao');
    }
    const devedorAtual = atual.fornecedorId
        ? { tipo: 'fornecedor', id: String(atual.fornecedorId), nome: String(atual.fornecedorNome || '') }
        : { tipo: 'cliente', id: String(atual.clienteId || ''), nome: String(atual.clienteNome || '') };
    const rotulo = (tipo, nome) => `${tipo === 'fornecedor' ? 'Fornecedor' : 'Cliente'} ${nome}`.trim();
    if (devedorAtual.tipo !== pedido.devedor.tipo || devedorAtual.id !== pedido.devedor.id || devedorAtual.nome !== devedorNome) {
        alteracoes.push({ campo: 'Quem paga', de: rotulo(devedorAtual.tipo, devedorAtual.nome), para: rotulo(pedido.devedor.tipo, devedorNome) });
        Object.assign(campos, (0, exports.camposDoDevedor)(pedido.devedor, devedorNome));
        if (pedido.devedor.tipo === 'cliente') {
            if (atual.fornecedorId || atual.fornecedorNome)
                remover.push('fornecedorId', 'fornecedorNome');
        }
        else if (atual.clienteId || atual.clienteNome)
            remover.push('clienteId', 'clienteNome');
    }
    return { campos, remover, alteracoes };
};
exports.mudancasDaEdicao = mudancasDaEdicao;
/** POST /api/financeiro/receber/cancelar. */
const lerPedidoDeCancelamento = (corpo) => {
    const c = objeto(corpo);
    const transacaoId = String(c.transacaoId ?? '');
    if (!ID_VALIDO.test(transacaoId))
        return { erro: 'Conta inválida. Atualize a tela e tente de novo.' };
    const motivo = texto(c.motivo, 300);
    if (motivo.length < exports.MOTIVO_MINIMO_CANCELAR)
        return { erro: `Escreva o motivo do cancelamento (pelo menos ${exports.MOTIVO_MINIMO_CANCELAR} letras).` };
    return { pedido: { transacaoId, motivo } };
};
exports.lerPedidoDeCancelamento = lerPedidoDeCancelamento;
/** Nome de quem deve, para lista, recibo, boleto e WhatsApp: cliente ou fornecedor. */
const nomeDoDevedor = (t) => (String(t.clienteNome || t.fornecedorNome || '').trim());
exports.nomeDoDevedor = nomeDoDevedor;
