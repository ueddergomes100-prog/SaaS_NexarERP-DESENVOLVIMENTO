"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planoDoCancelamentoDaOs = exports.planoDaReaberturaDaOs = exports.titulosQueSaemNaFinalizacao = exports.planoDaFinalizacaoDaOs = exports.estornoDosTitulosDaOs = exports.idsDosTitulosGravados = exports.idDoTituloDaOs = exports.camposDoTituloDaOs = exports.lerPedidoDeReaberturaDaOs = exports.lerPedidoDeCancelamentoDaOs = exports.lerPedidoDeFinalizacaoDaOs = exports.novoSaldoDoProduto = exports.somarDeltasDeEstoque = exports.pecasQueSairamDoEstoque = exports.bloqueioParaReabrirOs = exports.mensagemOsCanceladaNaoReabre = exports.erroDasNotasParaCancelarOs = exports.classificarNotasDaOs = exports.camposDescritivosDaOs = exports.CAMPOS_DESCRITIVOS_DA_OS = exports.assinaturaDaCobrancaDaOs = exports.totaisDaOs = exports.corDoStatusDaOs = exports.STATUS_OS_EM_ABERTO = exports.STATUS_OS_REABERTA_PADRAO = exports.STATUS_OS_FINALIZADA = exports.STATUS_OS_CANCELADA = void 0;
const osServicePricing_1 = require("./osServicePricing");
const descontoDomain_1 = require("./descontoDomain");
const financeDomain_1 = require("./financeDomain");
const cancelamentoVendaDomain_1 = require("./cancelamentoVendaDomain");
const alteracaoValorTituloDomain_1 = require("./alteracaoValorTituloDomain");
const renegociacaoDomain_1 = require("./renegociacaoDomain");
const cancelamentoNotaVendaDomain_1 = require("./cancelamentoNotaVendaDomain");
const estoqueReservaDomain_1 = require("./estoqueReservaDomain");
const loteRetornoDomain_1 = require("./loteRetornoDomain");
const vendaFechamentoDomain_1 = require("./vendaFechamentoDomain");
const osCampoDomain_1 = require("./osCampoDomain");
Object.defineProperty(exports, "STATUS_OS_CANCELADA", { enumerable: true, get: function () { return osCampoDomain_1.STATUS_OS_CANCELADA; } });
Object.defineProperty(exports, "STATUS_OS_FINALIZADA", { enumerable: true, get: function () { return osCampoDomain_1.STATUS_OS_FINALIZADA; } });
/** Situacao em que a OS fica quando e' reaberta so' para refazer a cobranca. */
exports.STATUS_OS_REABERTA_PADRAO = 'Em Manutenção';
/** Situacoes de OS em aberto (as do select da tela). */
exports.STATUS_OS_EM_ABERTO = [
    'Orçamento Pendente',
    'Aguardando Peça',
    'Em Manutenção',
    osCampoDomain_1.STATUS_OS_EM_ATENDIMENTO,
    osCampoDomain_1.STATUS_OS_AGUARDANDO_CONFERENCIA,
];
/** Cor gravada em `statusColor` (lista de OS). */
const corDoStatusDaOs = (status) => {
    switch (status) {
        case osCampoDomain_1.STATUS_OS_FINALIZADA: return '#10b981';
        case 'Orçamento Pendente': return '#3b82f6';
        case 'Aguardando Peça': return '#f59e0b';
        case 'Em Manutenção': return '#8b5cf6';
        case osCampoDomain_1.STATUS_OS_CANCELADA: return '#ef4444';
        default: return osCampoDomain_1.CORES_STATUS_OS_CAMPO[String(status)] || '#6b7280';
    }
};
exports.corDoStatusDaOs = corDoStatusDaOs;
const listaDe = (valor) => (Array.isArray(valor) ? valor.filter((v) => v && typeof v === 'object') : []);
/** Servicos (preco x horas) + pecas (preco x quantidade) - desconto geral. */
const totaisDaOs = (os) => {
    const totalServicos = listaDe(os.servicos).reduce((acc, s) => acc + (0, osServicePricing_1.getServiceTotal)(s), 0);
    const totalPecas = listaDe(os.pecas).reduce((acc, p) => acc + Number(p.preco || 0) * Number(p.quantidade || 0), 0);
    const subtotal = totalServicos + totalPecas;
    const tipo = os.desconto?.tipo === 'percentual' ? 'percentual' : 'valor';
    const descontoCentavos = (0, descontoDomain_1.calcularDescontoCents)(tipo, os.desconto?.valorInformado, (0, financeDomain_1.toCents)(subtotal));
    const valorTotal = Math.max(0, subtotal - (0, financeDomain_1.fromCents)(descontoCentavos));
    return { totalServicos, totalPecas, subtotal, descontoCentavos, valorTotal, valorTotalCentavos: (0, financeDomain_1.toCents)(valorTotal) };
};
exports.totaisDaOs = totaisDaOs;
/**
 * Tudo o que ja' foi cobrado numa OS finalizada: se mudar, a OS precisa ser
 * reaberta e finalizada de novo (lancamentos, banco, estoque e comissao).
 */
const assinaturaDaCobrancaDaOs = (os) => {
    const totais = (0, exports.totaisDaOs)(os);
    return JSON.stringify({
        s: listaDe(os.servicos).map((s) => [String(s.id || ''), (0, financeDomain_1.toCents)(Number(s.preco || 0)), (0, osServicePricing_1.getServiceHours)(s)]),
        p: listaDe(os.pecas).map((p) => [String(p.id || ''), (0, financeDomain_1.toCents)(Number(p.preco || 0)), Number(p.quantidade || 0)]),
        d: totais.descontoCentavos,
        t: totais.valorTotalCentavos,
        c: String(os.clienteNome || '').trim().toUpperCase(),
        m: String(os.mecanicoId || ''),
        ds: String(os.dataSaida || ''),
    });
};
exports.assinaturaDaCobrancaDaOs = assinaturaDaCobrancaDaOs;
/**
 * Campos que nao mexem em dinheiro, estoque nem comissao: podem ser gravados
 * numa OS finalizada (ou cancelada) sem reabrir.
 */
exports.CAMPOS_DESCRITIVOS_DA_OS = [
    'clienteTelefone', 'placa', 'modelo', 'marca', 'ano', 'cor', 'renavam', 'quilometragem', 'combustivel',
    'frota', 'serie', 'horimetro', 'tipoEquipamento', 'dataEntrada', 'horaEntrada', 'horaSaida',
    'defeitoRelatado', 'relatorioTecnico', 'materiaisCliente', 'condicoesPagamento', 'observacoes',
];
const camposDescritivosDaOs = (dados) => {
    const campos = {};
    exports.CAMPOS_DESCRITIVOS_DA_OS.forEach((campo) => {
        if (dados[campo] !== undefined)
            campos[campo] = dados[campo];
    });
    return campos;
};
exports.camposDescritivosDaOs = camposDescritivosDaOs;
// ---------------------------------------------------------------------------
// NOTAS FISCAIS DA OS
// ---------------------------------------------------------------------------
const ehNotaDaOs = (nota) => ((nota.tipo === 'NF-e' || nota.tipo === 'NFC-e' || nota.tipo === 'NFS-e') && nota.finalidade !== 'devolucao');
const classificarNotasDaOs = (notas) => {
    const daOs = notas.filter(ehNotaDaOs);
    return {
        autorizadas: daOs.filter((nota) => nota.status === 'authorized'),
        emTransmissao: daOs.filter((nota) => cancelamentoNotaVendaDomain_1.STATUS_NOTA_EM_TRANSMISSAO.includes(String(nota.status))),
    };
};
exports.classificarNotasDaOs = classificarNotasDaOs;
/** Nota da OS autorizada ou sem resposta impede cancelar a OS (decisao do dono, 19/10/2026). */
const erroDasNotasParaCancelarOs = (notas, numeroOS) => {
    const { autorizadas, emTransmissao } = (0, exports.classificarNotasDaOs)(notas);
    if (emTransmissao.length > 0) {
        return `A ${(0, cancelamentoNotaVendaDomain_1.listaDeNotas)(emTransmissao)} da OS #${numeroOS} ainda está aguardando resposta. Espere a resposta (Notas Fiscais → Sincronizar Notas) antes de cancelar a OS.`;
    }
    if (autorizadas.length > 0) {
        return `A ${(0, cancelamentoNotaVendaDomain_1.listaDeNotas)(autorizadas)} da OS #${numeroOS} está autorizada. Cancele a nota em Notas Fiscais antes de cancelar a OS.`;
    }
    return null;
};
exports.erroDasNotasParaCancelarOs = erroDasNotasParaCancelarOs;
// ---------------------------------------------------------------------------
// BLOQUEIOS
// ---------------------------------------------------------------------------
/** OS cancelada nao volta a ser aberta: os lancamentos de estorno ja' existem. */
const mensagemOsCanceladaNaoReabre = (numeroOS) => (`A OS #${numeroOS} está cancelada. OS cancelada não volta a ser aberta: crie uma OS nova para este atendimento.`);
exports.mensagemOsCanceladaNaoReabre = mensagemOsCanceladaNaoReabre;
/** Reabrir (ou refazer a cobranca) de OS finalizada: nada recebido, renegociado nem com valor alterado. */
const bloqueioParaReabrirOs = (titulos) => ((0, renegociacaoDomain_1.bloqueioPorParcelaRenegociada)(titulos, 'reabrir a OS')
    || (0, alteracaoValorTituloDomain_1.bloqueioParaRefazerParcelas)(titulos, 'OS')
    || (0, cancelamentoVendaDomain_1.bloqueioParaAlterarPagamento)(titulos, { documento: 'OS', acao: 'reabrir a OS' })
    || null);
exports.bloqueioParaReabrirOs = bloqueioParaReabrirOs;
const linhasDeEstoque = (pecas) => (listaDe(pecas)
    .map((p) => ({ id: String(p.id || ''), nome: String(p.nome || ''), quantidade: Number(p.quantidade || 0) }))
    .filter((p) => p.id && p.id !== 'avulso' && p.quantidade > 0));
/** O que saiu do estoque na finalizacao. OS antiga (antes de 19/10/2026) nao guardava: vale a lista de pecas. */
const pecasQueSairamDoEstoque = (os) => (linhasDeEstoque(Array.isArray(os.pecasBaixadas) ? os.pecasBaixadas : os.pecas));
exports.pecasQueSairamDoEstoque = pecasQueSairamDoEstoque;
const lotesDaOs = (os) => listaDe(os.lotesBaixados).filter((l) => l.loteId && Number(l.quantidade) > 0);
/** Soma os deltas do mesmo produto (uma escrita por produto na transacao). */
const somarDeltasDeEstoque = (deltas) => {
    const porId = new Map();
    deltas.forEach((d) => {
        const atual = porId.get(d.id) || { id: d.id, nome: d.nome, quantidadeDelta: 0, quantidadeReservadaDelta: 0 };
        atual.quantidadeDelta += d.quantidadeDelta;
        atual.quantidadeReservadaDelta += d.quantidadeReservadaDelta;
        if (!atual.nome && d.nome)
            atual.nome = d.nome;
        porId.set(d.id, atual);
    });
    return [...porId.values()].filter((d) => d.quantidadeDelta !== 0 || d.quantidadeReservadaDelta !== 0);
};
exports.somarDeltasDeEstoque = somarDeltasDeEstoque;
/**
 * Novo saldo de um produto com a conferencia de estoque e de reserva (mesma
 * regra da venda). null = produto nao existe mais (pula, como a tela sempre fez).
 */
const novoSaldoDoProduto = (d, produto, permitirSemEstoque) => {
    if (!produto)
        return null;
    const estoqueAtual = Number(produto.quantidade || 0);
    const reservadaAtual = Number(produto.quantidadeReservada || 0);
    const proximo = estoqueAtual + d.quantidadeDelta;
    const reservadaDepois = Math.max(0, reservadaAtual + d.quantidadeReservadaDelta);
    const nome = d.nome || String(produto.nome || '') || 'peça';
    if (d.quantidadeDelta < 0 && !permitirSemEstoque) {
        if (proximo < -1e-9)
            return { erro: `Estoque insuficiente para ${nome}. Disponível: ${estoqueAtual}.` };
        if (proximo < reservadaDepois - 1e-9) {
            return {
                erro: `Estoque reservado: ${nome} tem ${estoqueAtual} em estoque e ${reservadaDepois} reservado em pré-venda, condicional, OS ou troca. `
                    + `Só ${Math.max(0, estoqueAtual - reservadaDepois)} está livre. Diminua a quantidade ou libere a reserva e finalize de novo.`,
            };
        }
    }
    return {
        quantidade: permitirSemEstoque || d.quantidadeDelta >= 0 ? proximo : Math.max(0, proximo),
        quantidadeReservada: reservadaDepois,
    };
};
exports.novoSaldoDoProduto = novoSaldoDoProduto;
/** Devolve as pecas que sairam (e solta reserva que tenha sobrado). */
const devolucaoDoEstoque = (os) => (0, exports.somarDeltasDeEstoque)((0, estoqueReservaDomain_1.computeReservationReturn)(os.estoqueReservado === true ? linhasDeEstoque(os.pecas) : [], (0, exports.pecasQueSairamDoEstoque)(os)));
// ---------------------------------------------------------------------------
// O QUE A TELA MANDA AO SERVIDOR (POST /api/os/...)
// ---------------------------------------------------------------------------
const ID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;
const DATA_VALIDA = /^\d{4}-\d{2}-\d{2}$/;
const objeto = (corpo) => (corpo && typeof corpo === 'object' ? corpo : {});
const lerOsId = (c) => {
    const id = String(c.osId ?? '');
    return ID_VALIDO.test(id) ? id : null;
};
/** POST /api/os/finalizar: { osId, dataSaida, pagamentos (rascunhos), lotes? }. */
const lerPedidoDeFinalizacaoDaOs = (corpo) => {
    const c = objeto(corpo);
    const osId = lerOsId(c);
    if (!osId)
        return { erro: 'OS inválida. Atualize a tela e tente de novo.' };
    const dataSaida = String(c.dataSaida ?? '');
    if (!DATA_VALIDA.test(dataSaida))
        return { erro: 'Informe a data de saída da OS.' };
    if (!Array.isArray(c.pagamentos) || c.pagamentos.length === 0)
        return { erro: 'Informe a forma de pagamento.' };
    if (c.pagamentos.length > 60)
        return { erro: 'Pagamentos demais nesta OS. Junte os pagamentos da mesma forma.' };
    const lotes = {};
    const brutos = objeto(c.lotes);
    for (const [chave, valor] of Object.entries(brutos)) {
        if (!/^\d{1,3}$/.test(chave))
            return { erro: 'Lote inválido. Escolha o lote de novo.' };
        const lidos = (0, vendaFechamentoDomain_1.lerLotes)(valor);
        if (lidos === null)
            return { erro: 'Lote inválido. Escolha o lote de novo.' };
        if (lidos.length > 0)
            lotes[chave] = lidos;
    }
    const comprovanteAprovacaoId = c.comprovanteAprovacaoId ? String(c.comprovanteAprovacaoId) : null;
    if (comprovanteAprovacaoId && !ID_VALIDO.test(comprovanteAprovacaoId))
        return { erro: 'Liberação do desconto inválida. Finalize de novo e peça a liberação.' };
    return {
        pedido: {
            osId,
            dataSaida,
            pagamentos: c.pagamentos.map((p) => (p && typeof p === 'object' ? p : {})),
            lotes,
            comprovanteAprovacaoId,
        },
    };
};
exports.lerPedidoDeFinalizacaoDaOs = lerPedidoDeFinalizacaoDaOs;
/** POST /api/os/cancelar: { osId, motivo, devolverEstoque }. */
const lerPedidoDeCancelamentoDaOs = (corpo) => {
    const c = objeto(corpo);
    const osId = lerOsId(c);
    if (!osId)
        return { erro: 'OS inválida. Atualize a tela e tente de novo.' };
    const erro = (0, cancelamentoVendaDomain_1.erroDoMotivoDoCancelamento)(c.motivo);
    if (erro)
        return { erro };
    return { osId, motivo: String(c.motivo).trim(), devolverEstoque: c.devolverEstoque === true };
};
exports.lerPedidoDeCancelamentoDaOs = lerPedidoDeCancelamentoDaOs;
/** POST /api/os/reabrir: { osId, status } -- status = uma das situacoes em aberto. */
const lerPedidoDeReaberturaDaOs = (corpo) => {
    const c = objeto(corpo);
    const osId = lerOsId(c);
    if (!osId)
        return { erro: 'OS inválida. Atualize a tela e tente de novo.' };
    const status = String(c.status ?? exports.STATUS_OS_REABERTA_PADRAO);
    if (!exports.STATUS_OS_EM_ABERTO.includes(status))
        return { erro: 'Escolha a situação em que a OS vai ficar ao ser reaberta.' };
    return { osId, status };
};
exports.lerPedidoDeReaberturaDaOs = lerPedidoDeReaberturaDaOs;
/** Mesmo lancamento que a tela sempre gravou para cada pagamento da OS (sem metadados). */
const camposDoTituloDaOs = (p, args) => {
    const parcela = p.cartao?.numero ? ` (Parcela ${p.cartao.numero}/${p.cartao.totalParcelas})` : '';
    return {
        descricao: `Recebimento OS #${args.numeroOS || args.osId.substring(0, 6).toUpperCase()} - ${p.formaPagamento}${parcela}`,
        categoria: 'Serviços',
        valor: p.valor,
        valorCentavos: p.valorCentavos,
        valorBruto: p.valor,
        valorBrutoCentavos: p.valorCentavos,
        valorTaxa: p.cartao?.valorTaxa || 0,
        valorTaxaCentavos: p.cartao?.valorTaxaCentavos || 0,
        valorLiquido: p.cartao?.valorLiquido ?? p.valor,
        valorLiquidoCentavos: p.cartao?.valorLiquidoCentavos ?? p.valorCentavos,
        tipo: 'entrada',
        formaPagamento: p.formaPagamento,
        condicaoPagamento: p.condicaoPagamento,
        status: p.status === 'confirmado' ? 'Paga' : 'Pendente',
        naturezaFinanceira: p.naturezaFinanceira,
        movimentaCaixaFisico: p.movimentaCaixaFisico,
        bancoId: p.bancoId || null,
        bancoNome: p.bancoNome || null,
        prazoDias: p.prazoDias || null,
        data: p.dataVencimento || args.dataSaida,
        dataVencimento: p.dataVencimento || null,
        dataPrevistaRecebimento: p.dataPrevistaRecebimento || null,
        cartao: p.cartao || null,
        ...(p.cheque ? { cheque: p.cheque } : {}),
        osId: args.osId,
        sourceType: 'ordem_servico',
        sourceId: args.osId,
        paymentIndex: p.indice,
        idempotencyKey: `os:${args.osId}:pagamento:${p.indice}`,
        clienteId: args.clienteId,
        clienteNome: args.clienteNome,
        usuarioResponsavelId: args.usuarioId,
        mecanicoId: args.mecanicoId,
        tenantId: args.tenantId,
    };
};
exports.camposDoTituloDaOs = camposDoTituloDaOs;
/** Ids dos lancamentos: o 1o pagamento tem o id da OS, os seguintes `<os>_pag_<n>`. */
const idDoTituloDaOs = (osId, indice) => (indice === 0 ? osId : `${osId}_pag_${indice + 1}`);
exports.idDoTituloDaOs = idDoTituloDaOs;
/** Ids que os pagamentos gravados na OS ja' usaram (para achar os lancamentos antigos). */
const idsDosTitulosGravados = (osId, pagamentos) => {
    const lista = Array.isArray(pagamentos) ? pagamentos : [];
    if (lista.length === 0)
        return [osId];
    return lista.map((p, indice) => (p && typeof p.transactionId === 'string' && p.transactionId ? p.transactionId : (0, exports.idDoTituloDaOs)(osId, indice)));
};
exports.idsDosTitulosGravados = idsDosTitulosGravados;
/** Cancelar a OS: pago vira estorno (lancamento de saida); em aberto e' so' cancelado. */
const estornoDosTitulosDaOs = (titulos, args) => (0, cancelamentoVendaDomain_1.estornoDosTitulos)(titulos, {
    documentoId: args.osId,
    numero: args.numeroOS,
    clienteNome: args.clienteNome,
    usuarioId: args.usuarioId,
    tenantId: args.tenantId,
    hoje: args.hoje,
}, 'os');
exports.estornoDosTitulosDaOs = estornoDosTitulosDaOs;
/**
 * Plano da finalizacao: a OS gravada vira receita. Comissao SEMPRE refeita
 * (decisao do dono: reabriu, finaliza de novo com o que estiver na OS).
 */
const planoDaFinalizacaoDaOs = (e) => {
    const numeroOS = String(e.os.numeroOS || '');
    if (e.os.status === osCampoDomain_1.STATUS_OS_FINALIZADA)
        return { erro: `A OS #${numeroOS} já está finalizada. Atualize a tela.` };
    if (e.os.status === osCampoDomain_1.STATUS_OS_CANCELADA)
        return { erro: (0, exports.mensagemOsCanceladaNaoReabre)(numeroOS) };
    if (e.pagamentos.some((p) => p.formaPagamento === 'Crédito de Devolução')) {
        return { erro: 'Crédito de devolução não pode ser usado em OS. Escolha outra forma de pagamento.' };
    }
    if (e.pagamentos.some((p) => p.formaPagamento === 'Cashback')) {
        return { erro: 'Cashback não pode ser usado em OS. Escolha outra forma de pagamento.' };
    }
    const totais = (0, exports.totaisDaOs)(e.os);
    const somaPagamentos = e.pagamentos.reduce((soma, p) => soma + p.valorCentavos, 0);
    if (somaPagamentos !== totais.valorTotalCentavos) {
        const reais = (centavos) => `R$ ${(0, financeDomain_1.fromCents)(centavos).toFixed(2).replace('.', ',')}`;
        return { erro: `Os pagamentos somam ${reais(somaPagamentos)}, mas a OS é de ${reais(totais.valorTotalCentavos)}. Atualize a tela e confira o pagamento.` };
    }
    const pagamentos = e.pagamentos.map((p, indice) => ({ ...p, transactionId: (0, exports.idDoTituloDaOs)(e.osId, indice) }));
    const resumo = (0, financeDomain_1.summarizePayments)(pagamentos);
    // Estoque: so' quem ainda nao baixou (OS reaberta antes de 19/10/2026 pode ter ficado baixada).
    const pecas = linhasDeEstoque(e.os.pecas);
    const jaBaixado = e.os.estoqueBaixado === true;
    const estoque = jaBaixado ? [] : (0, exports.somarDeltasDeEstoque)((0, estoqueReservaDomain_1.computeReservationCommit)(e.os.estoqueReservado === true ? pecas : [], pecas));
    const lotes = jaBaixado ? [] : (0, loteRetornoDomain_1.somarLotesUsados)(Object.values(e.lotesPorLinha));
    const servicos = listaDe(e.os.servicos);
    const pecasDaOs = listaDe(e.os.pecas);
    const mecanicoId = String(e.os.mecanicoId || '');
    const perfil = e.mecanico || {};
    const comissao = (0, financeDomain_1.buildServiceOrderCommissionSnapshot)({
        sellerId: mecanicoId,
        sellerName: String(e.os.mecanicoNome || perfil.nome || 'Não identificado'),
        itensServicos: servicos.map((s) => ({
            id: String(s.id || ''),
            nome: String(s.nome || ''),
            baseCents: (0, financeDomain_1.toCents)((0, osServicePricing_1.getServiceTotal)(s)),
            percentual: (0, financeDomain_1.resolveComissaoPercentual)({
                itemPercentual: e.percentualDoServico(String(s.id || '')),
                recebeComissao: perfil.recebeComissaoServicos,
                percentualVendedor: perfil.comissaoPercentualServicos,
                percentualPadraoSistema: e.comissaoPadraoServicos,
            }),
        })),
        itensPecas: pecasDaOs.map((p) => ({
            id: String(p.id || ''),
            nome: String(p.nome || ''),
            baseCents: (0, financeDomain_1.toCents)(Number(p.preco || 0) * Number(p.quantidade || 0)),
            percentual: (0, financeDomain_1.resolveComissaoPercentual)({
                itemPercentual: e.percentualDaPeca(String(p.id || '')),
                recebeComissao: perfil.recebeComissaoPecas,
                percentualVendedor: perfil.comissaoPercentualPecas,
                percentualPadraoSistema: e.comissaoPadraoPecas,
            }),
        })),
        generatedAt: e.agoraIso,
    });
    const statusPagamento = resumo.pendingCents === 0 ? 'Paga' : resumo.receivedCents > 0 ? 'Parcial' : 'Pendente';
    const clienteNome = String(e.os.clienteNome || '').trim().toUpperCase();
    const clienteId = e.os.clienteId ? String(e.os.clienteId) : null;
    const camposDaOs = {
        status: osCampoDomain_1.STATUS_OS_FINALIZADA,
        statusColor: (0, exports.corDoStatusDaOs)(osCampoDomain_1.STATUS_OS_FINALIZADA),
        valorTotal: totais.valorTotal,
        valorTotalCentavos: totais.valorTotalCentavos,
        formaPagamento: resumo.paymentMethodLabel,
        statusPagamento,
        dataSaida: e.dataSaida,
        dataPagamento: e.dataSaida,
        condicaoPagamento: resumo.paymentCondition,
        pagamentos,
        totalRecebido: resumo.received,
        totalRecebidoCentavos: resumo.receivedCents,
        totalPendente: resumo.pending,
        totalPendenteCentavos: resumo.pendingCents,
        totalTaxasPagamento: resumo.cardFee,
        totalTaxasPagamentoCentavos: resumo.cardFeeCents,
        totalLiquidoFinanceiro: resumo.financialNet,
        totalLiquidoFinanceiroCentavos: resumo.financialNetCents,
        estoqueBaixado: true,
        estoqueReservado: false,
        ...(jaBaixado ? {} : { lotesBaixados: lotes, pecasBaixadas: pecas }),
        comissao,
    };
    const dadosDoTitulo = {
        osId: e.osId,
        numeroOS,
        dataSaida: e.dataSaida,
        clienteId,
        clienteNome,
        mecanicoId,
        usuarioId: e.usuarioId,
        tenantId: e.tenantId,
    };
    return {
        plano: {
            totais,
            pagamentos,
            creditoPorBanco: (0, financeDomain_1.computeBankCreditsMap)(pagamentos),
            estoque,
            lotes,
            comissao,
            camposDaOs,
            titulos: pagamentos.map((p) => ({ id: p.transactionId, campos: (0, exports.camposDoTituloDaOs)(p, dadosDoTitulo) })),
            formaPagamento: resumo.paymentMethodLabel,
        },
    };
};
exports.planoDaFinalizacaoDaOs = planoDaFinalizacaoDaOs;
/** Lancamentos antigos da OS que nao fazem mais parte dos pagamentos (viram Cancelada). */
const titulosQueSaemNaFinalizacao = (existentes, idsNovos) => (existentes.filter((t) => !idsNovos.includes(t.id) && t.dados.status !== 'Cancelada').map((t) => t.id));
exports.titulosQueSaemNaFinalizacao = titulosQueSaemNaFinalizacao;
/** Desfaz a finalizacao inteira; finalizar de novo refaz com o que estiver na OS. */
const planoDaReaberturaDaOs = (args) => {
    const numeroOS = String(args.os.numeroOS || '');
    if (args.os.status === osCampoDomain_1.STATUS_OS_CANCELADA)
        return { erro: (0, exports.mensagemOsCanceladaNaoReabre)(numeroOS) };
    if (args.os.status !== osCampoDomain_1.STATUS_OS_FINALIZADA)
        return { erro: `A OS #${numeroOS} não está finalizada. Atualize a tela.` };
    const bloqueio = (0, exports.bloqueioParaReabrirOs)(args.titulos.map((t) => t.dados));
    if (bloqueio)
        return { erro: bloqueio };
    const baixado = args.os.estoqueBaixado === true;
    const comissao = args.os.comissao;
    return {
        plano: {
            debitoPorBanco: (0, financeDomain_1.computeBankCreditsMap)(listaDe(args.os.pagamentos)),
            estoque: baixado ? devolucaoDoEstoque(args.os) : [],
            lotes: baixado ? lotesDaOs(args.os) : [],
            titulosCancelados: args.titulos.filter((t) => t.dados.status !== 'Cancelada').map((t) => t.id),
            camposDaOs: {
                status: args.status,
                statusColor: (0, exports.corDoStatusDaOs)(args.status),
                statusPagamento: 'Pendente',
                estoqueBaixado: false,
                estoqueReservado: false,
                lotesBaixados: [],
                pecasBaixadas: [],
                ...(comissao && comissao.regraVersion ? { comissao: (0, financeDomain_1.reopenCommissionSnapshot)(comissao, args.agoraIso) } : {}),
            },
        },
    };
};
exports.planoDaReaberturaDaOs = planoDaReaberturaDaOs;
const planoDoCancelamentoDaOs = (args) => {
    const numeroOS = String(args.os.numeroOS || '');
    if (args.os.status === osCampoDomain_1.STATUS_OS_CANCELADA)
        return { erro: `A OS #${numeroOS} já foi cancelada.` };
    const bloqueio = (0, renegociacaoDomain_1.bloqueioPorParcelaRenegociada)(args.titulos.map((t) => t.dados), 'cancelar a OS');
    if (bloqueio)
        return { erro: bloqueio };
    const eraFinalizada = args.os.status === osCampoDomain_1.STATUS_OS_FINALIZADA;
    const baixado = args.os.estoqueBaixado === true;
    const devolve = baixado && args.devolverEstoque;
    let estoque = [];
    if (devolve)
        estoque = devolucaoDoEstoque(args.os);
    else if (args.os.estoqueReservado === true)
        estoque = (0, exports.somarDeltasDeEstoque)((0, estoqueReservaDomain_1.computeReservationRelease)(linhasDeEstoque(args.os.pecas)));
    const comissao = args.os.comissao;
    return {
        plano: {
            debitoPorBanco: eraFinalizada ? (0, financeDomain_1.computeBankCreditsMap)(listaDe(args.os.pagamentos)) : new Map(),
            estoque,
            lotes: devolve ? lotesDaOs(args.os) : [],
            titulos: (0, exports.estornoDosTitulosDaOs)(args.titulos, {
                osId: args.osId,
                numeroOS,
                clienteNome: String(args.os.clienteNome || '').trim().toUpperCase(),
                usuarioId: args.usuarioId,
                tenantId: args.tenantId,
                hoje: args.hoje,
            }),
            camposDaOs: {
                status: osCampoDomain_1.STATUS_OS_CANCELADA,
                statusColor: (0, exports.corDoStatusDaOs)(osCampoDomain_1.STATUS_OS_CANCELADA),
                statusPagamento: 'Cancelada',
                motivoCancelamento: args.motivo,
                canceladaPor: args.usuarioId,
                canceladaPorNome: args.usuarioNome,
                estoqueReservado: false,
                ...(devolve ? { estoqueBaixado: false, lotesBaixados: [], pecasBaixadas: [] } : {}),
                ...(comissao && comissao.regraVersion ? { comissao: (0, financeDomain_1.cancelCommissionSnapshot)(comissao, args.agoraIso) } : {}),
            },
            devolveuEstoque: devolve,
        },
    };
};
exports.planoDoCancelamentoDaOs = planoDoCancelamentoDaOs;
