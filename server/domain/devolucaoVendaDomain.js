"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lerMotivoDaRecusa = exports.lerPedidoDeDevolucaoDoApp = exports.LIMITE_MOTIVO_RECUSA = exports.LIMITE_OBSERVACAO_DEVOLUCAO = exports.parseConfigDevolucaoApp = exports.CONFIG_DEVOLUCAO_APP_PADRAO = exports.erroParaDevolverPeloApp = exports.ehPedidoDoAppVendas = exports.erroDoPedidoParaDevolucao = exports.erroParaDecidirDevolucao = exports.camposDaDevolucao = exports.saldoDoBancoAposDevolucao = exports.creditoDaDevolucao = exports.lancamentoDaDevolucao = exports.idDoDinheiroDaDevolucao = exports.comissaoAposDevolucao = exports.planoDaDevolucao = exports.montarItensDevolvidos = exports.disponivelParaDevolver = exports.quantidadesEmAguardo = exports.destinoDaDevolucao = exports.origemDaDevolucao = exports.devolucaoTeveEfeito = exports.situacaoDaDevolucao = exports.ROTULO_DESTINO_DEVOLUCAO = exports.FORMAS_BANCARIAS_DEVOLUCAO = exports.MOTIVOS_DEVOLUCAO = exports.ROTULO_ORIGEM_DEVOLUCAO = exports.ORIGEM_DEVOLUCAO = exports.ROTULO_SITUACAO_DEVOLUCAO = exports.STATUS_DEVOLUCAO = void 0;
/*
 * DEVOLUCAO DE VENDA -- regra num lugar so' (24/11/2026).
 *
 * A devolucao e' feita por dois caminhos que tem de dar o MESMO resultado:
 *  - pela tela do sistema (DevolucaoVendaModal e "Confirmar" na tela de
 *    Devolucoes), gravando pelo navegador: services/devolucaoVendaService.ts;
 *  - pelo app Vendas com "Devolucao do aplicativo ja' entra confirmada",
 *    gravando pelo servidor: server/services/devolucaoVenda.js.
 *
 * O que a devolucao faz (itens devolvidos, quantidade ja' devolvida no pedido,
 * estoque, lote, comissao, lancamento de caixa/banco, credito do cliente)
 * e' montado AQUI; os dois lados so' leem e gravam. Compilado para o servidor
 * por scripts/build-server-domain.mjs.
 *
 * Situacao (campo `status` da devolucao, o mesmo de sempre):
 *  - 'aguardando_confirmacao': pedida pelo app, nada mexeu ainda;
 *  - 'concluida': valeu (estoque, dinheiro, comissao);
 *  - 'recusada': o escritorio recusou, nada mexeu;
 *  - 'estornada': valeu e foi desfeita depois (tela do pedido).
 * Devolucao antiga sem o campo conta como concluida.
 */
const financeDomain_1 = require("./financeDomain");
const embalagemDomain_1 = require("./embalagemDomain");
const loteRetornoDomain_1 = require("./loteRetornoDomain");
const creditoDomain_1 = require("./creditoDomain");
const importacaoPedidosAnterioresDomain_1 = require("./importacaoPedidosAnterioresDomain");
exports.STATUS_DEVOLUCAO = {
    aguardando: 'aguardando_confirmacao',
    concluida: 'concluida',
    recusada: 'recusada',
    estornada: 'estornada',
};
exports.ROTULO_SITUACAO_DEVOLUCAO = {
    aguardando_confirmacao: 'Aguardando confirmação',
    concluida: 'Confirmada',
    recusada: 'Recusada',
    estornada: 'Estornada',
};
exports.ORIGEM_DEVOLUCAO = { sistema: 'sistema', app: 'app' };
exports.ROTULO_ORIGEM_DEVOLUCAO = { sistema: 'Sistema', app: 'Aplicativo' };
/** Lista fixa de motivos (a mesma do sistema desde sempre). */
exports.MOTIVOS_DEVOLUCAO = ['Cliente desistiu', 'Produto com defeito', 'Produto errado', 'Troca', 'Erro de Venda', 'Outro'];
/** Formas de devolucao que saem de conta bancaria (nao do caixa fisico). */
exports.FORMAS_BANCARIAS_DEVOLUCAO = ['Pix', 'Transferência'];
exports.ROTULO_DESTINO_DEVOLUCAO = {
    credito: 'Crédito do cliente',
    caixa: 'Caixa (dinheiro)',
    banco: 'Banco',
};
const STATUS_VALIDOS = Object.values(exports.STATUS_DEVOLUCAO);
const situacaoDaDevolucao = (d) => (typeof d?.status === 'string' && STATUS_VALIDOS.includes(d.status) ? d.status : exports.STATUS_DEVOLUCAO.concluida);
exports.situacaoDaDevolucao = situacaoDaDevolucao;
/** A devolucao mexeu (ou mexeu e foi estornada) em estoque e dinheiro? Aguardando e recusada: nao. */
const devolucaoTeveEfeito = (d) => {
    const s = (0, exports.situacaoDaDevolucao)(d);
    return s === exports.STATUS_DEVOLUCAO.concluida || s === exports.STATUS_DEVOLUCAO.estornada;
};
exports.devolucaoTeveEfeito = devolucaoTeveEfeito;
const origemDaDevolucao = (d) => (d?.origem === exports.ORIGEM_DEVOLUCAO.app ? exports.ORIGEM_DEVOLUCAO.app : exports.ORIGEM_DEVOLUCAO.sistema);
exports.origemDaDevolucao = origemDaDevolucao;
const destinoDaDevolucao = (valor) => (valor === 'caixa' || valor === 'banco' ? valor : 'credito');
exports.destinoDaDevolucao = destinoDaDevolucao;
const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};
const arred4 = (n) => Math.round(n * 10000) / 10000;
/** Quanto de cada linha esta' em devolucoes "Aguardando confirmacao" (por indice da linha). */
const quantidadesEmAguardo = (devolucoes, ignorarId = '') => {
    const mapa = new Map();
    devolucoes.forEach((d) => {
        if (ignorarId && d.id === ignorarId)
            return;
        if ((0, exports.situacaoDaDevolucao)(d) !== exports.STATUS_DEVOLUCAO.aguardando)
            return;
        (Array.isArray(d.itensDevolvidos) ? d.itensDevolvidos : []).forEach((item) => {
            const indice = Number(item?.indice);
            if (!Number.isInteger(indice) || indice < 0)
                return;
            mapa.set(indice, arred4((mapa.get(indice) || 0) + num(item?.quantidadeDevolvida)));
        });
    });
    return mapa;
};
exports.quantidadesEmAguardo = quantidadesEmAguardo;
/** Quanto ainda da' para devolver da linha: vendido - ja' devolvido - em aguardo. */
const disponivelParaDevolver = (item, emAguardo = 0) => (Math.max(0, arred4(num(item.quantidade) - num(item.quantidadeJaDevolvida) - num(emAguardo))));
exports.disponivelParaDevolver = disponivelParaDevolver;
/** Acha a linha do pedido: pelo indice (conferindo o produto) ou, nas antigas, pelo id + nome. */
const indiceDaLinha = (itens, ref) => {
    const i = Number(ref.indice);
    if (Number.isInteger(i) && i >= 0 && i < itens.length && itens[i]?.id === ref.id && itens[i]?.nome === ref.nome)
        return i;
    return itens.findIndex((item) => item.id === ref.id && item.nome === ref.nome);
};
/**
 * Confere a escolha contra o pedido e monta os itens devolvidos com o valor
 * (desconto do item abatido na proporcao, a mesma conta de sempre).
 */
const montarItensDevolvidos = (itensDoPedido, selecao, emAguardo = new Map()) => {
    const escolhidos = selecao.filter((s) => num(s.quantidade) > 0);
    if (escolhidos.length === 0)
        return { ok: false, erro: 'Escolha pelo menos um item e a quantidade a devolver.' };
    const usados = new Set();
    const itensDevolvidos = [];
    for (const s of escolhidos) {
        const indice = indiceDaLinha(itensDoPedido, s);
        const item = indice >= 0 ? itensDoPedido[indice] : null;
        if (!item)
            return { ok: false, erro: `${s.nome ? `O item ${s.nome}` : 'Um dos itens'} não está mais neste pedido. Abra o pedido de novo.` };
        if (usados.has(indice))
            return { ok: false, erro: `O item ${item.nome} apareceu duas vezes na devolução. Escolha de novo.` };
        usados.add(indice);
        const quantidade = arred4(num(s.quantidade));
        const disponivel = (0, exports.disponivelParaDevolver)(item, emAguardo.get(indice) || 0);
        if (quantidade > disponivel) {
            const aguardo = emAguardo.get(indice) || 0;
            return {
                ok: false,
                erro: disponivel <= 0
                    ? `${item.nome} não tem mais nada a devolver${aguardo > 0 ? ' (o restante já está numa devolução aguardando confirmação)' : ''}.`
                    : `${item.nome}: dá para devolver no máximo ${disponivel.toLocaleString('pt-BR')}${aguardo > 0 ? ` (${aguardo.toLocaleString('pt-BR')} já estão numa devolução aguardando confirmação)` : ''}.`,
            };
        }
        const vendido = num(item.quantidade);
        const descontoProporcional = vendido > 0 ? num(item.desconto) * (quantidade / vendido) : 0;
        const subtotal = (quantidade * num(item.precoUnitario)) - descontoProporcional;
        itensDevolvidos.push({
            id: item.id,
            nome: item.nome,
            precoUnitario: num(item.precoUnitario),
            quantidadeDevolvida: quantidade,
            descontoProporcional,
            subtotal,
            indice,
            // Preservado para o estorno saber reverter na mesma unidade (embalagem).
            ...(item.fatorConversao ? { fatorConversao: item.fatorConversao } : {}),
            ...(item.unidadeMedidaSigla ? { unidadeMedidaSigla: item.unidadeMedidaSigla } : {}),
        });
    }
    const valorTotal = itensDevolvidos.reduce((soma, i) => soma + i.subtotal, 0);
    if (!(valorTotal > 0))
        return { ok: false, erro: 'O valor da devolução ficou zerado. Confira os itens escolhidos.' };
    return { ok: true, itensDevolvidos, valorTotal };
};
exports.montarItensDevolvidos = montarItensDevolvidos;
/**
 * Lido o pedido GRAVADO (dentro da transacao), monta o que a devolucao muda.
 * A conta da quantidade disponivel e' refeita aqui: se outra devolucao entrou
 * no meio, recusa.
 */
const planoDaDevolucao = (itensGravados, itensDevolvidos) => {
    const itens = (Array.isArray(itensGravados) ? itensGravados : []);
    const atualizados = itens.map((i) => ({ ...i }));
    const retornos = [];
    for (const dev of itensDevolvidos) {
        const indice = indiceDaLinha(itens, dev);
        if (indice < 0)
            return { ok: false, erro: `O item ${dev.nome} não está mais no pedido. A devolução não pode ser feita.` };
        const linha = atualizados[indice];
        const jaDevolvido = num(linha.quantidadeJaDevolvida);
        const quantidade = num(dev.quantidadeDevolvida);
        if (quantidade <= 0 || quantidade > arred4(num(linha.quantidade) - jaDevolvido)) {
            return { ok: false, erro: `A quantidade disponível para devolução de ${linha.nome} foi alterada.` };
        }
        // Lote e Validade: o que a venda tirou de lote volta ao MESMO lote.
        if (Array.isArray(linha.lotes) && linha.lotes.length > 0) {
            retornos.push({
                lotes: linha.lotes,
                jaDevolvido: (0, embalagemDomain_1.toBaseQuantity)(jaDevolvido, linha.fatorConversao),
                quantidade: (0, embalagemDomain_1.toBaseQuantity)(quantidade, linha.fatorConversao),
            });
        }
        atualizados[indice] = { ...linha, quantidadeJaDevolvida: arred4(jaDevolvido + quantidade) };
    }
    const porProduto = new Map();
    (0, embalagemDomain_1.toStockAdjustmentItems)(itensDevolvidos.map((i) => ({ id: i.id, nome: i.nome, quantidade: i.quantidadeDevolvida, fatorConversao: i.fatorConversao })))
        .forEach((a) => {
        if (!a.id || a.id === 'avulso' || !(a.quantidade > 0))
            return;
        const atual = porProduto.get(a.id);
        porProduto.set(a.id, { id: a.id, nome: atual?.nome || a.nome, quantidade: arred4((atual?.quantidade || 0) + a.quantidade) });
    });
    return {
        ok: true,
        plano: {
            itensAtualizados: atualizados,
            estoqueQueVolta: [...porProduto.values()],
            lotesQueVoltam: (0, loteRetornoDomain_1.somarLotesUsados)(retornos.map((r) => (0, loteRetornoDomain_1.distribuirRetornoAosLotes)(r.lotes, r.jaDevolvido, r.quantidade))),
        },
    };
};
exports.planoDaDevolucao = planoDaDevolucao;
/** Comissao da venda refeita sem o que voltou (so' venda com a regra nova de comissao). */
const comissaoAposDevolucao = (comissao, itensDevolvidos) => {
    if (!comissao || !comissao.regraVersion)
        return null;
    return (0, financeDomain_1.recalculateCommissionAfterReturn)(comissao, itensDevolvidos.map((item) => ({ id: item.id, nome: item.nome, baseCents: (0, financeDomain_1.toCents)(item.subtotal) })));
};
exports.comissaoAposDevolucao = comissaoAposDevolucao;
/** Id fixo do lancamento e do credito: o estorno acha pelo id da devolucao. */
const idDoDinheiroDaDevolucao = (devolucaoId) => `devolucao_${devolucaoId}`;
exports.idDoDinheiroDaDevolucao = idDoDinheiroDaDevolucao;
/**
 * Saida de caixa ou banco (sem createdAt/metadados: quem grava poe). Plano de
 * contas: categoria "Devolucao de Venda", a mesma de sempre.
 */
const lancamentoDaDevolucao = (d) => {
    if (d.destino === 'caixa') {
        return {
            descricao: `Devolução Pedido #${d.numeroPedido} - Caixa`,
            categoria: 'Devolução de Venda',
            valor: d.valor,
            valorCentavos: (0, financeDomain_1.toCents)(d.valor),
            tipo: 'saida',
            formaPagamento: 'Dinheiro',
            naturezaFinanceira: 'caixa_fisico',
            movimentaCaixaFisico: true,
            status: 'Paga',
            data: d.hoje,
            clienteNome: d.clienteNome,
            pedidoOrigemId: d.pedidoId,
            devolucaoId: d.devolucaoId,
            idempotencyKey: `devolucao:${d.devolucaoId}:caixa`,
            tenantId: d.tenantId,
        };
    }
    if (d.destino === 'banco') {
        const forma = d.formaBancaria || 'Pix';
        const bancoNome = d.bancoNome || '';
        return {
            descricao: `Devolução Pedido #${d.numeroPedido} - ${forma}${bancoNome ? ` (${bancoNome})` : ''}`,
            categoria: 'Devolução de Venda',
            valor: d.valor,
            valorCentavos: (0, financeDomain_1.toCents)(d.valor),
            tipo: 'saida',
            formaPagamento: forma,
            naturezaFinanceira: 'bancario_digital',
            movimentaCaixaFisico: false,
            bancoId: d.bancoId || '',
            bancoNome,
            status: 'Paga',
            data: d.hoje,
            clienteNome: d.clienteNome,
            pedidoOrigemId: d.pedidoId,
            devolucaoId: d.devolucaoId,
            idempotencyKey: `devolucao:${d.devolucaoId}:banco`,
            tenantId: d.tenantId,
        };
    }
    return null;
};
exports.lancamentoDaDevolucao = lancamentoDaDevolucao;
/** Credito do cliente (sem createdAt/updatedAt/metadados: quem grava poe). */
const creditoDaDevolucao = (d) => {
    if (d.destino !== 'credito')
        return null;
    return {
        clienteNome: d.clienteNome,
        // Codigo do cliente da venda: o credito nao some se o cadastro for renomeado.
        ...(0, creditoDomain_1.campoDoClienteDoCredito)(d.clienteId),
        pedidoOrigemId: d.pedidoId,
        devolucaoId: d.devolucaoId,
        numeroPedidoOriginal: d.numeroPedido,
        valorOriginal: d.valor,
        saldoDisponivel: d.valor,
        status: 'disponivel',
        motivo: d.motivo,
        tenantId: d.tenantId,
    };
};
exports.creditoDaDevolucao = creditoDaDevolucao;
/** Saldo do banco depois da saida (centavos). */
const saldoDoBancoAposDevolucao = (saldoCentavos, valor) => num(saldoCentavos) - (0, financeDomain_1.toCents)(valor);
exports.saldoDoBancoAposDevolucao = saldoDoBancoAposDevolucao;
/** Campos do documento novo (sem createdAt e metadados: quem grava poe). Nunca undefined. */
const camposDaDevolucao = (d) => ({
    pedidoVendaId: d.pedidoId,
    numeroPedidoOriginal: d.numeroPedido,
    clienteNome: d.clienteNome,
    valorTotalDevolvido: d.valorTotal,
    valorTotalDevolvidoCentavos: (0, financeDomain_1.toCents)(d.valorTotal),
    destinoValor: d.destino,
    // Guardados pro estorno saber devolver o dinheiro pro mesmo banco.
    ...(d.destino === 'banco' ? {
        bancoId: d.bancoId || '',
        bancoNome: d.bancoNome || '',
        formaDevolucao: d.formaBancaria || 'Pix',
    } : {}),
    motivo: d.motivo,
    observacao: d.observacao || '',
    tenantId: d.tenantId,
    usuarioResponsavelId: d.usuarioId,
    status: d.status,
    origem: d.origem,
    idempotencyKey: `devolucao:${d.devolucaoId}`,
    itensDevolvidos: d.itensDevolvidos,
    ...(d.vendedorId ? { vendedorId: d.vendedorId } : {}),
    ...(d.vendedorNome ? { vendedorNome: d.vendedorNome } : {}),
    ...(d.solicitadoPorId ? { solicitadoPorId: d.solicitadoPorId } : {}),
    ...(d.solicitadoPorNome ? { solicitadoPorNome: d.solicitadoPorNome } : {}),
    ...(d.dataSolicitacao ? { dataSolicitacao: d.dataSolicitacao } : {}),
    ...(d.foraDoPrazo ? { foraDoPrazo: true } : {}),
});
exports.camposDaDevolucao = camposDaDevolucao;
/** So' devolucao "Aguardando confirmacao" pode ser confirmada ou recusada. */
const erroParaDecidirDevolucao = (d, acao) => {
    if (!d)
        return 'Esta devolução não existe mais. Atualize a lista.';
    const s = (0, exports.situacaoDaDevolucao)(d);
    if (s === exports.STATUS_DEVOLUCAO.aguardando)
        return null;
    return `Esta devolução já está "${exports.ROTULO_SITUACAO_DEVOLUCAO[s]}" e não pode mais ser ${acao === 'confirmar' ? 'confirmada' : 'recusada'}. Atualize a lista.`;
};
exports.erroParaDecidirDevolucao = erroParaDecidirDevolucao;
/** Pedido que pode receber devolucao (sistema ou app). */
const erroDoPedidoParaDevolucao = (pedido) => {
    if (!pedido)
        return 'A venda original não existe mais.';
    if ((0, importacaoPedidosAnterioresDomain_1.ehPedidoDoSistemaAnterior)(pedido))
        return (0, importacaoPedidosAnterioresDomain_1.mensagemPedidoDoSistemaAnterior)('devolvida');
    if (pedido.status === 'Cancelada')
        return 'Venda cancelada não pode receber nova devolução.';
    return null;
};
exports.erroDoPedidoParaDevolucao = erroDoPedidoParaDevolucao;
// ---------------------------------------------------------------------------
// App Vendas
// ---------------------------------------------------------------------------
/**
 * Pedido feito no app Vendas: o id do documento e' o id do rascunho do
 * aparelho (crypto.randomUUID sem tracos: 32 hexadecimais; a bonificacao
 * ligada leva um "b" no fim). Pedido do sistema tem o id automatico do
 * Firestore (20 letras e numeros). O id nunca muda ao faturar, entao a marca
 * sobrevive a finalizacao (que regrava o documento inteiro).
 */
const ehPedidoDoAppVendas = (pedidoId) => /^[0-9a-f]{32}b?$/.test(String(pedidoId || ''));
exports.ehPedidoDoAppVendas = ehPedidoDoAppVendas;
/** O vendedor pode devolver este pedido pelo app? Devolve o motivo do "nao", em portugues. */
const erroParaDevolverPeloApp = (pedidoId, pedido, usuarioId) => {
    if (!pedido)
        return 'Pedido não encontrado. Atualize a lista de pedidos.';
    if ((0, importacaoPedidosAnterioresDomain_1.ehPedidoDoSistemaAnterior)(pedido))
        return (0, importacaoPedidosAnterioresDomain_1.mensagemPedidoDoSistemaAnterior)('devolvida');
    if (!(0, exports.ehPedidoDoAppVendas)(pedidoId))
        return 'Pelo aplicativo só dá para devolver pedido feito no aplicativo. Para este pedido, peça a devolução à loja.';
    if (pedido.criadoPor !== usuarioId || pedido.vendedorId !== usuarioId)
        return 'Este pedido é de outro vendedor. Pelo aplicativo você só devolve os pedidos que você mesmo fez.';
    if (pedido.status === 'Cancelada')
        return 'Pedido cancelado não recebe devolução.';
    if (pedido.status !== 'Finalizada')
        return 'Este pedido ainda não foi faturado pela loja. A devolução pelo aplicativo vale só para pedido já faturado.';
    return null;
};
exports.erroParaDevolverPeloApp = erroParaDevolverPeloApp;
exports.CONFIG_DEVOLUCAO_APP_PADRAO = { permitida: false, jaConfirmada: false };
/** Le as duas chaves da filial (configuracoes/{filial}); nascem desligadas. */
const parseConfigDevolucaoApp = (config) => {
    const permitida = config?.appDevolucaoPermitida === true;
    return { permitida, jaConfirmada: permitida && config?.appDevolucaoJaConfirmada === true };
};
exports.parseConfigDevolucaoApp = parseConfigDevolucaoApp;
exports.LIMITE_OBSERVACAO_DEVOLUCAO = 300;
exports.LIMITE_MOTIVO_RECUSA = 300;
/** Le e confere o corpo que o app manda ao servidor. */
const lerPedidoDeDevolucaoDoApp = (corpo) => {
    const c = (corpo && typeof corpo === 'object' ? corpo : {});
    const pedidoId = String(c.pedidoId || '').trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(pedidoId))
        return { erro: 'Pedido não informado. Abra o pedido de novo.' };
    const brutos = Array.isArray(c.itens) ? c.itens : [];
    const itens = [];
    for (const bruto of brutos) {
        const b = (bruto && typeof bruto === 'object' ? bruto : {});
        const indice = Number(b.indice);
        const quantidade = Number(b.quantidade);
        if (!Number.isInteger(indice) || indice < 0 || indice > 999)
            return { erro: 'Item inválido na devolução. Abra o pedido de novo.' };
        if (!Number.isFinite(quantidade) || quantidade < 0)
            return { erro: 'Quantidade inválida na devolução. Confira os números.' };
        if (quantidade > 0)
            itens.push({ indice, quantidade: arred4(quantidade) });
    }
    if (itens.length === 0)
        return { erro: 'Escolha pelo menos um item e a quantidade a devolver.' };
    if (new Set(itens.map((i) => i.indice)).size !== itens.length)
        return { erro: 'Um item apareceu duas vezes na devolução. Escolha de novo.' };
    const motivo = String(c.motivo || '');
    if (!exports.MOTIVOS_DEVOLUCAO.includes(motivo))
        return { erro: 'Escolha o motivo da devolução.' };
    const destinoBruto = String(c.destino || '');
    if (!['credito', 'caixa', 'banco'].includes(destinoBruto))
        return { erro: 'Escolha para onde vai o valor: crédito do cliente, caixa ou banco.' };
    const destino = destinoBruto;
    const bancoId = destino === 'banco' ? String(c.bancoId || '').trim() : '';
    const formaBancaria = destino === 'banco' ? String(c.formaBancaria || 'Pix') : '';
    if (destino === 'banco') {
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(bancoId))
            return { erro: 'Escolha de qual banco o dinheiro sai.' };
        if (!exports.FORMAS_BANCARIAS_DEVOLUCAO.includes(formaBancaria))
            return { erro: 'Escolha a forma: Pix ou Transferência.' };
    }
    const observacao = String(c.observacao || '').trim().slice(0, exports.LIMITE_OBSERVACAO_DEVOLUCAO);
    const idDocumento = String(c.idDocumento || '').trim();
    if (idDocumento && !/^[A-Za-z0-9_-]{8,64}$/.test(idDocumento))
        return { erro: 'Identificador da devolução inválido. Abra a tela de novo e reenvie.' };
    return { pedidoId, itens, motivo, observacao, destino, bancoId, formaBancaria, idDocumento };
};
exports.lerPedidoDeDevolucaoDoApp = lerPedidoDeDevolucaoDoApp;
/** Motivo da recusa: obrigatorio, curto. */
const lerMotivoDaRecusa = (bruto) => {
    const motivo = String(bruto || '').trim().slice(0, exports.LIMITE_MOTIVO_RECUSA);
    if (motivo.length < 3)
        return { ok: false, erro: 'Escreva o motivo da recusa: o vendedor vê no aplicativo.' };
    return { ok: true, motivo };
};
exports.lerMotivoDaRecusa = lerMotivoDaRecusa;
