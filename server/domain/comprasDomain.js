"use strict";
/**
 * COMPRAS: COTACAO E PEDIDO DE COMPRA (pedido do dono, 21/10/2026; decisoes
 * pelas caixinhas em 22/10):
 *  - a cotacao lista itens do ESTOQUE (so' produtos) com quantidade e vai a
 *    varios fornecedores; cada um recebe um LINK PUBLICO com codigo de
 *    acesso e preenche preco por item, prazo de entrega e condicao de
 *    pagamento. O link vale ate' "responder ate'" (padrao 7 dias);
 *  - o comparativo mostra, item a item, o melhor preco e o total por
 *    fornecedor; a loja escolhe o vencedor por item e o sistema gera um
 *    PEDIDO DE COMPRA por fornecedor;
 *  - o pedido de compra tambem nasce a mao (fornecedor, itens, precos) e sai
 *    em PDF; fecha a mao: Aberto -> Enviado -> Recebido (ou Cancelado). A
 *    entrada de NF-e ligada ao pedido fica para a fase 2.
 *
 * Regra pura: sem tela, sem Firestore. Compilada para o servidor.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.podeEditarPedido = exports.erroParaMudarStatus = exports.pedidosDasEscolhas = exports.lerPedidoDeCompra = exports.subtotalDoItem = exports.ROTULO_STATUS_PEDIDO_COMPRA = exports.lerEscolhas = exports.escolhasSugeridas = exports.montarComparativo = exports.codigoAcessoValido = exports.erroParaResponder = exports.lerRespostaDoFornecedor = exports.textoDoConvite = exports.linkDaCotacao = exports.cotacaoVencida = exports.responderAtePadrao = exports.lerPedidoDeCotacao = exports.ROTULO_STATUS_COTACAO = exports.formatarReais = exports.CODIGO_ACESSO_TAMANHO = exports.OBSERVACAO_MAX = exports.TEXTO_CURTO_MAX = exports.FORNECEDORES_MAXIMO = exports.ITENS_MAXIMO = exports.DIAS_PADRAO_PARA_RESPONDER = void 0;
exports.DIAS_PADRAO_PARA_RESPONDER = 7;
exports.ITENS_MAXIMO = 200;
exports.FORNECEDORES_MAXIMO = 20;
exports.TEXTO_CURTO_MAX = 120;
exports.OBSERVACAO_MAX = 500;
exports.CODIGO_ACESSO_TAMANHO = 6;
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const ID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;
const numero = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
};
const texto = (v, maximo) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, maximo);
const formatarReais = (centavos) => `R$ ${(Number(centavos || 0) / 100).toFixed(2).replace('.', ',')}`;
exports.formatarReais = formatarReais;
const quantidadeValida = (v) => {
    const n = numero(v);
    return n > 0 ? Math.round(n * 1000) / 1000 : null;
};
exports.ROTULO_STATUS_COTACAO = {
    aberta: 'Aberta — aguardando propostas',
    fechada: 'Fechada',
    cancelada: 'Cancelada',
};
const lerItens = (raw) => {
    const lista = Array.isArray(raw) ? raw : [];
    if (lista.length === 0)
        return { erro: 'Coloque pelo menos um item na cotação.' };
    if (lista.length > exports.ITENS_MAXIMO)
        return { erro: `A cotação aceita até ${exports.ITENS_MAXIMO} itens.` };
    const itens = [];
    const vistos = new Set();
    for (const bruto of lista) {
        const i = (bruto && typeof bruto === 'object' ? bruto : {});
        const produtoId = typeof i.produtoId === 'string' && ID_VALIDO.test(i.produtoId) ? i.produtoId : '';
        const nome = texto(i.nome, exports.TEXTO_CURTO_MAX);
        if (!produtoId || !nome)
            return { erro: 'Um dos itens está sem produto. Escolha o produto de novo.' };
        if (vistos.has(produtoId))
            return { erro: `O produto ${nome} está repetido na cotação. Junte as quantidades numa linha só.` };
        vistos.add(produtoId);
        const quantidade = quantidadeValida(i.quantidade);
        if (!quantidade)
            return { erro: `Informe a quantidade de ${nome}.` };
        itens.push({ produtoId, codigo: texto(i.codigo, 40), nome, unidade: texto(i.unidade, 10) || 'UN', quantidade, observacao: texto(i.observacao, exports.TEXTO_CURTO_MAX) });
    }
    return { itens };
};
const lerPedidoDeCotacao = (corpo) => {
    const c = (corpo && typeof corpo === 'object' ? corpo : {});
    const titulo = texto(c.titulo, exports.TEXTO_CURTO_MAX);
    if (!titulo)
        return { erro: 'Dê um nome à cotação (ex.: "Reposição de outubro").' };
    const itensLidos = lerItens(c.itens);
    if ('erro' in itensLidos)
        return itensLidos;
    const brutos = Array.isArray(c.fornecedores) ? c.fornecedores : [];
    if (brutos.length === 0)
        return { erro: 'Escolha pelo menos um fornecedor para receber a cotação.' };
    if (brutos.length > exports.FORNECEDORES_MAXIMO)
        return { erro: `A cotação vai para até ${exports.FORNECEDORES_MAXIMO} fornecedores.` };
    const fornecedores = [];
    const vistos = new Set();
    for (const bruto of brutos) {
        const f = (bruto && typeof bruto === 'object' ? bruto : {});
        const fornecedorId = typeof f.fornecedorId === 'string' && ID_VALIDO.test(f.fornecedorId) ? f.fornecedorId : '';
        const nome = texto(f.nome, exports.TEXTO_CURTO_MAX);
        if (!fornecedorId || !nome)
            return { erro: 'Um dos fornecedores está sem cadastro. Escolha o fornecedor de novo.' };
        if (vistos.has(fornecedorId))
            return { erro: `O fornecedor ${nome} está repetido.` };
        vistos.add(fornecedorId);
        fornecedores.push({ fornecedorId, nome, email: texto(f.email, exports.TEXTO_CURTO_MAX), celular: texto(f.celular, 30) });
    }
    const responderAte = typeof c.responderAte === 'string' && DATA_ISO.test(c.responderAte) ? c.responderAte : '';
    if (!responderAte)
        return { erro: 'Informe até quando os fornecedores podem responder.' };
    return { pedido: { titulo, itens: itensLidos.itens, fornecedores, responderAte, observacao: texto(c.observacao, exports.OBSERVACAO_MAX) } };
};
exports.lerPedidoDeCotacao = lerPedidoDeCotacao;
/** "Responder ate'" padrao: hoje + 7 dias (AAAA-MM-DD). */
const responderAtePadrao = (hojeIso, dias = exports.DIAS_PADRAO_PARA_RESPONDER) => {
    const d = new Date(`${hojeIso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
};
exports.responderAtePadrao = responderAtePadrao;
/** O link ainda aceita resposta? (ate' o fim do dia, no fuso da loja). */
const cotacaoVencida = (responderAte, hojeIso) => Boolean(responderAte) && hojeIso > responderAte;
exports.cotacaoVencida = cotacaoVencida;
const linkDaCotacao = (origem, token) => `${origem.replace(/\/$/, '')}/cotacao/${token}`;
exports.linkDaCotacao = linkDaCotacao;
/** Texto do convite (WhatsApp/e-mail) com o link e o codigo. */
const textoDoConvite = (args) => (`Olá! ${args.empresa} pede uma cotação: ${args.titulo}.\n`
    + `Acesse ${args.link} e informe o código ${args.codigoAcesso} para ver os itens e enviar seus preços.\n`
    + `Prazo para responder: ${args.responderAte.split('-').reverse().join('/')}.`);
exports.textoDoConvite = textoDoConvite;
const lerRespostaDoFornecedor = (corpo, itens) => {
    const c = (corpo && typeof corpo === 'object' ? corpo : {});
    const brutos = (c.precos && typeof c.precos === 'object' ? c.precos : {});
    const precos = {};
    for (const item of itens) {
        const v = brutos[item.produtoId];
        if (v === undefined || v === null || v === '')
            continue;
        const n = numero(v);
        if (!Number.isInteger(n) || n < 0)
            return { erro: `Preço inválido em ${item.nome}.` };
        if (n > 0)
            precos[item.produtoId] = n;
    }
    if (Object.keys(precos).length === 0)
        return { erro: 'Informe o preço de pelo menos um item.' };
    let prazoEntregaDias = null;
    if (c.prazoEntregaDias !== undefined && c.prazoEntregaDias !== null && c.prazoEntregaDias !== '') {
        const p = numero(c.prazoEntregaDias);
        if (!Number.isInteger(p) || p < 0 || p > 365)
            return { erro: 'Prazo de entrega inválido (dias).' };
        prazoEntregaDias = p;
    }
    return { resposta: { precos, prazoEntregaDias, condicaoPagamento: texto(c.condicaoPagamento, exports.TEXTO_CURTO_MAX), observacao: texto(c.observacao, exports.OBSERVACAO_MAX) } };
};
exports.lerRespostaDoFornecedor = lerRespostaDoFornecedor;
/** Por que o fornecedor nao pode (mais) responder; null = pode. */
const erroParaResponder = (cotacao, hojeIso) => {
    if (cotacao.status === 'cancelada')
        return 'Esta cotação foi cancelada pela empresa.';
    if (cotacao.status === 'fechada')
        return 'Esta cotação já foi fechada pela empresa. Obrigado pelo interesse.';
    if ((0, exports.cotacaoVencida)(cotacao.responderAte, hojeIso))
        return `O prazo para responder terminou em ${cotacao.responderAte.split('-').reverse().join('/')}.`;
    return null;
};
exports.erroParaResponder = erroParaResponder;
const codigoAcessoValido = (codigo) => /^\d{6}$/.test(String(codigo || '').trim());
exports.codigoAcessoValido = codigoAcessoValido;
const montarComparativo = (cotacao) => {
    const respondidos = cotacao.fornecedores.filter((f) => f.status === 'respondida');
    const linhas = cotacao.itens.map((item) => {
        const precos = {};
        respondidos.forEach((f) => { const p = f.precos[item.produtoId]; if (p > 0)
            precos[f.fornecedorId] = p; });
        const melhor = Object.entries(precos).sort((a, b) => a[1] - b[1])[0];
        return { produtoId: item.produtoId, nome: item.nome, codigo: item.codigo, unidade: item.unidade, quantidade: item.quantidade, precos, melhorFornecedorId: melhor ? melhor[0] : null };
    });
    const totais = cotacao.fornecedores.map((f) => {
        const cotados = cotacao.itens.filter((i) => f.precos[i.produtoId] > 0);
        return {
            fornecedorId: f.fornecedorId,
            nome: f.nome,
            status: f.status,
            itensCotados: cotados.length,
            totalCentavos: cotados.reduce((t, i) => t + Math.round(f.precos[i.produtoId] * i.quantidade), 0),
            completo: f.status === 'respondida' && cotados.length === cotacao.itens.length,
            prazoEntregaDias: f.prazoEntregaDias,
            condicaoPagamento: f.condicaoPagamento,
        };
    });
    return { linhas, totais };
};
exports.montarComparativo = montarComparativo;
/** Escolha sugerida: o melhor preco de cada item. */
const escolhasSugeridas = (linhas) => (Object.fromEntries(linhas.filter((l) => l.melhorFornecedorId).map((l) => [l.produtoId, l.melhorFornecedorId])));
exports.escolhasSugeridas = escolhasSugeridas;
const lerEscolhas = (corpo, cotacao) => {
    const c = (corpo && typeof corpo === 'object' ? corpo : {});
    const brutas = (c.escolhas && typeof c.escolhas === 'object' ? c.escolhas : {});
    const escolhas = {};
    for (const item of cotacao.itens) {
        const fornecedorId = brutas[item.produtoId];
        if (!fornecedorId)
            continue;
        const f = cotacao.fornecedores.find((x) => x.fornecedorId === fornecedorId);
        if (!f || f.status !== 'respondida' || !(f.precos[item.produtoId] > 0))
            return { erro: `${item.nome}: o fornecedor escolhido não cotou este item.` };
        escolhas[item.produtoId] = String(fornecedorId);
    }
    if (Object.keys(escolhas).length === 0)
        return { erro: 'Escolha o fornecedor de pelo menos um item.' };
    return { escolhas };
};
exports.lerEscolhas = lerEscolhas;
exports.ROTULO_STATUS_PEDIDO_COMPRA = {
    aberto: 'Aberto',
    enviado: 'Enviado ao fornecedor',
    recebido: 'Recebido',
    cancelado: 'Cancelado',
};
const subtotalDoItem = (quantidade, precoUnitarioCentavos) => Math.round(quantidade * precoUnitarioCentavos);
exports.subtotalDoItem = subtotalDoItem;
const lerPedidoDeCompra = (corpo) => {
    const c = (corpo && typeof corpo === 'object' ? corpo : {});
    const fornecedorId = typeof c.fornecedorId === 'string' && ID_VALIDO.test(c.fornecedorId) ? c.fornecedorId : '';
    const fornecedorNome = texto(c.fornecedorNome, exports.TEXTO_CURTO_MAX);
    if (!fornecedorId || !fornecedorNome)
        return { erro: 'Escolha o fornecedor do pedido.' };
    const lidos = lerItens(c.itens);
    if ('erro' in lidos)
        return lidos;
    const brutos = Array.isArray(c.itens) ? c.itens : [];
    const itens = lidos.itens.map((item, i) => {
        const preco = numero(brutos[i]?.precoUnitarioCentavos);
        return { produtoId: item.produtoId, codigo: item.codigo, nome: item.nome, unidade: item.unidade, quantidade: item.quantidade, precoUnitarioCentavos: Number.isInteger(preco) && preco >= 0 ? preco : -1, subtotalCentavos: 0 };
    });
    const semPreco = itens.find((i) => i.precoUnitarioCentavos < 0);
    if (semPreco)
        return { erro: `Informe o preço de ${semPreco.nome}.` };
    itens.forEach((i) => { i.subtotalCentavos = (0, exports.subtotalDoItem)(i.quantidade, i.precoUnitarioCentavos); });
    let prazoEntregaDias = null;
    if (c.prazoEntregaDias !== undefined && c.prazoEntregaDias !== null && c.prazoEntregaDias !== '') {
        const p = numero(c.prazoEntregaDias);
        if (!Number.isInteger(p) || p < 0 || p > 365)
            return { erro: 'Prazo de entrega inválido (dias).' };
        prazoEntregaDias = p;
    }
    return {
        pedido: {
            fornecedorId,
            fornecedorNome,
            itens,
            totalCentavos: itens.reduce((t, i) => t + i.subtotalCentavos, 0),
            prazoEntregaDias,
            condicaoPagamento: texto(c.condicaoPagamento, exports.TEXTO_CURTO_MAX),
            observacao: texto(c.observacao, exports.OBSERVACAO_MAX),
        },
    };
};
exports.lerPedidoDeCompra = lerPedidoDeCompra;
/** Um pedido por fornecedor vencedor, com os itens e precos da proposta dele. */
const pedidosDasEscolhas = (cotacao, escolhas) => {
    const porFornecedor = new Map();
    for (const item of cotacao.itens) {
        const fornecedorId = escolhas[item.produtoId];
        if (!fornecedorId)
            continue;
        const f = cotacao.fornecedores.find((x) => x.fornecedorId === fornecedorId);
        if (!f)
            continue;
        const preco = f.precos[item.produtoId];
        if (!(preco > 0))
            continue;
        const pedido = porFornecedor.get(fornecedorId) || {
            fornecedorId,
            fornecedorNome: f.nome,
            itens: [],
            totalCentavos: 0,
            prazoEntregaDias: f.prazoEntregaDias,
            condicaoPagamento: f.condicaoPagamento,
            observacao: '',
        };
        const subtotal = (0, exports.subtotalDoItem)(item.quantidade, preco);
        pedido.itens.push({ produtoId: item.produtoId, codigo: item.codigo, nome: item.nome, unidade: item.unidade, quantidade: item.quantidade, precoUnitarioCentavos: preco, subtotalCentavos: subtotal });
        pedido.totalCentavos += subtotal;
        porFornecedor.set(fornecedorId, pedido);
    }
    return [...porFornecedor.values()];
};
exports.pedidosDasEscolhas = pedidosDasEscolhas;
/** Transicoes do pedido de compra: aberto -> enviado -> recebido; cancelar antes de receber. */
const erroParaMudarStatus = (atual, novo) => {
    if (atual === novo)
        return null;
    if (atual === 'recebido')
        return 'Este pedido já foi recebido e não muda mais.';
    if (atual === 'cancelado')
        return 'Este pedido está cancelado.';
    if (novo === 'aberto')
        return 'O pedido não volta a Aberto.';
    if (novo === 'recebido' && atual !== 'enviado')
        return 'Marque o pedido como enviado ao fornecedor antes de receber.';
    return null;
};
exports.erroParaMudarStatus = erroParaMudarStatus;
const podeEditarPedido = (status) => status === 'aberto';
exports.podeEditarPedido = podeEditarPedido;
