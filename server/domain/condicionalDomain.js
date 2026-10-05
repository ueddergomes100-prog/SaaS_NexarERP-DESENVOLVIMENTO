"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MENSAGEM_CONDICIONAL_DESLIGADO = exports.acoesDoCondicional = exports.resumirCondicional = exports.STATUS_DA_PRE_VENDA_GERADA = exports.itensQueFicaram = exports.planejarDevolucao = exports.planoDeLiberacao = exports.planoDeReserva = exports.montarItensDoCondicional = exports.validarItensDoPedido = exports.somarPorProduto = exports.estaVencido = exports.validarPrazoDevolucao = exports.prazoPadrao = exports.normalizarObservacao = exports.quantidadePendente = exports.OBSERVACAO_MAX = exports.MAX_ITENS = exports.PRAZO_MAXIMO_DIAS = exports.PRAZO_PADRAO_DIAS = exports.ROTULO_STATUS_CONDICIONAL = exports.produtoPermiteCondicional = exports.parseTrabalhaComCondicional = exports.DEFAULT_TRABALHA_COM_CONDICIONAL = exports.PERMISSAO_CONDICIONAL = void 0;
/*
 * CONDICIONAL -- o cliente leva mercadoria para provar em casa, devolve o que
 * nao quiser e o que fica vira venda. Pedido do dono em 2026-10-05.
 *
 * Regras de negocio (puras, sem Firestore). Usadas pela tela E pelo servidor:
 * este arquivo e' compilado para server/domain/ por
 * scripts/build-server-domain.mjs -- quem grava e' sempre o servidor
 * (server/routes/condicionais.routes.js), a tela so' le.
 *
 * Como o estoque anda (sem baixar duas vezes):
 *  - SAIDA: os itens ficam RESERVADOS (`quantidadeReservada`). A mercadoria
 *    continua sendo da loja, so' deixa de estar disponivel.
 *  - DEVOLUCAO: o que voltou tem a reserva liberada.
 *  - FECHAMENTO: o que ficou com o cliente vira uma PRE-VENDA ja' com a
 *    reserva (`estoqueReservado: true`). Dai' segue o fluxo normal da
 *    pre-venda (conferencia, se ligada, e Finalizar), que transforma a
 *    reserva em baixa uma unica vez.
 *  - CANCELAR: libera a reserva do que ainda estava com o cliente.
 *
 * So' funciona com "Trabalha com condicional" marcado em Configuracoes, e so'
 * para produto com "Permite condicional" marcado no cadastro.
 */
const unidadeMedidaDomain_1 = require("./unidadeMedidaDomain");
const preVendaDomain_1 = require("./preVendaDomain");
exports.PERMISSAO_CONDICIONAL = 'vendas.condicional';
exports.DEFAULT_TRABALHA_COM_CONDICIONAL = false;
const parseTrabalhaComCondicional = (valor) => valor === true;
exports.parseTrabalhaComCondicional = parseTrabalhaComCondicional;
/** Campo do cadastro do produto (aba Avançado). */
const produtoPermiteCondicional = (produto) => (produto?.permiteCondicional === true);
exports.produtoPermiteCondicional = produtoPermiteCondicional;
exports.ROTULO_STATUS_CONDICIONAL = {
    aberto: 'Com o cliente',
    finalizado: 'Virou pré-venda',
    devolvido: 'Tudo devolvido',
    cancelado: 'Cancelado',
};
exports.PRAZO_PADRAO_DIAS = 3;
exports.PRAZO_MAXIMO_DIAS = 60;
exports.MAX_ITENS = 100;
exports.OBSERVACAO_MAX = 500;
const PRECISAO = 6;
const arredondar = (valor, casas = PRECISAO) => {
    const fator = 10 ** casas;
    return Math.round(valor * fator) / fator;
};
const numero = (valor) => (Number.isFinite(Number(valor)) ? Number(valor) : 0);
/** Quanto ainda esta com o cliente. */
const quantidadePendente = (item) => (Math.max(0, arredondar(numero(item.quantidade) - numero(item.quantidadeDevolvida))));
exports.quantidadePendente = quantidadePendente;
const normalizarObservacao = (texto) => (String(texto ?? '').replace(/\s+/g, ' ').trim().slice(0, exports.OBSERVACAO_MAX));
exports.normalizarObservacao = normalizarObservacao;
const DATA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const somarDias = (dataIso, dias) => {
    const [ano, mes, dia] = dataIso.split('-').map(Number);
    const data = new Date(Date.UTC(ano, mes - 1, dia + dias));
    return data.toISOString().slice(0, 10);
};
const prazoPadrao = (hoje) => somarDias(hoje, exports.PRAZO_PADRAO_DIAS);
exports.prazoPadrao = prazoPadrao;
/** Data combinada para o cliente devolver. '' quando esta certa. */
const validarPrazoDevolucao = (prazo, hoje) => {
    const texto = String(prazo ?? '').trim();
    const partes = DATA_ISO.exec(texto);
    if (!partes)
        return 'Informe até quando o cliente vai devolver ou decidir.';
    const [ano, mes, dia] = [Number(partes[1]), Number(partes[2]), Number(partes[3])];
    const real = new Date(Date.UTC(ano, mes - 1, dia));
    if (real.getUTCFullYear() !== ano || real.getUTCMonth() !== mes - 1 || real.getUTCDate() !== dia) {
        return 'A data de devolução não existe. Confira o dia e o mês.';
    }
    if (texto < hoje)
        return 'A data de devolução não pode ser no passado.';
    if (texto > somarDias(hoje, exports.PRAZO_MAXIMO_DIAS)) {
        return `O prazo máximo de um condicional é de ${exports.PRAZO_MAXIMO_DIAS} dias.`;
    }
    return '';
};
exports.validarPrazoDevolucao = validarPrazoDevolucao;
const estaVencido = (condicional, hoje) => (condicional.status === 'aberto' && Boolean(condicional.prazoDevolucao) && String(condicional.prazoDevolucao) < hoje);
exports.estaVencido = estaVencido;
/** Junta linhas repetidas do mesmo produto (somando a quantidade). */
const somarPorProduto = (itens) => {
    const mapa = new Map();
    for (const item of itens) {
        mapa.set(item.id, arredondar((mapa.get(item.id) || 0) + numero(item.quantidade)));
    }
    return [...mapa.entries()].map(([id, quantidade]) => ({ id, quantidade }));
};
exports.somarPorProduto = somarPorProduto;
/** Confere a lista de itens que veio da tela (formato, quantidade). */
const validarItensDoPedido = (itens) => {
    if (!Array.isArray(itens) || itens.length === 0) {
        return { erros: ['Adicione pelo menos um produto ao condicional.'], itens: [] };
    }
    if (itens.length > exports.MAX_ITENS) {
        return { erros: [`Um condicional aceita até ${exports.MAX_ITENS} itens.`], itens: [] };
    }
    const erros = [];
    const lidos = [];
    for (const bruto of itens) {
        const id = String(bruto?.id || '').trim();
        const quantidade = Number(bruto?.quantidade);
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
            erros.push('Há um produto inválido na lista. Remova-o e adicione de novo.');
            continue;
        }
        if (!Number.isFinite(quantidade) || quantidade <= 0) {
            erros.push('Toda quantidade precisa ser maior que zero.');
            continue;
        }
        lidos.push({ id, quantidade: arredondar(quantidade) });
    }
    return { erros, itens: (0, exports.somarPorProduto)(lidos) };
};
exports.validarItensDoPedido = validarItensDoPedido;
const produtoAtivo = (produto) => produto.ativo !== false && produto.statusAtivo !== false;
/**
 * Monta os itens do condicional com os dados do CADASTRO (nome, codigo,
 * preco, unidade). Unidade ausente cai em UN (CLAUDE.md, regra 4) e volta em
 * `semUnidade` para a tela avisar.
 */
const montarItensDoCondicional = (args) => {
    const erros = [];
    const itens = [];
    const semUnidade = [];
    for (const pedido of args.itens) {
        const produto = args.produtosPorId[pedido.id];
        if (!produto) {
            erros.push('Um dos produtos não foi encontrado no cadastro. Atualize a tela.');
            continue;
        }
        const nome = String(produto.nome || 'Produto sem nome');
        if (!produtoAtivo(produto)) {
            erros.push(`"${nome}" está inativo e não pode sair em condicional.`);
            continue;
        }
        if (!(0, exports.produtoPermiteCondicional)(produto)) {
            erros.push(`"${nome}" não está liberado para condicional. Marque "Permite condicional" no cadastro do produto em Estoque.`);
            continue;
        }
        const unidade = (0, unidadeMedidaDomain_1.resolveUnidadeMedidaProduto)(produto);
        if (!String(produto.unidadeMedidaSigla ?? '').trim())
            semUnidade.push(nome);
        if (!unidade.unidadeMedidaFracionado && !Number.isInteger(pedido.quantidade)) {
            erros.push(`"${nome}" é contado em ${unidade.unidadeMedidaSigla}, que não aceita quantidade fracionada. Use um número inteiro.`);
            continue;
        }
        itens.push({
            id: pedido.id,
            nome,
            codigo: String(produto.codigo || ''),
            quantidade: pedido.quantidade,
            quantidadeDevolvida: 0,
            precoUnitario: Math.max(0, numero(produto.precoVenda)),
            ...unidade,
        });
    }
    return { erros, itens, semUnidade };
};
exports.montarItensDoCondicional = montarItensDoCondicional;
/**
 * SAIDA: confere o disponivel (quantidade - reservada) e diz quanto reservar.
 * A empresa (ou o produto) pode liberar sem estoque, como na venda.
 */
const planoDeReserva = (args) => {
    const erros = [];
    const reservas = [];
    for (const item of args.itens) {
        const produto = args.produtosPorId[item.id];
        if (!produto) {
            erros.push(`O produto "${item.nome}" não foi encontrado no cadastro.`);
            continue;
        }
        const reservada = numero(produto.quantidadeReservada);
        const disponivel = arredondar(numero(produto.quantidade) - reservada);
        const liberado = args.permiteSemEstoque || produto.permitirEstoqueNegativo === true;
        if (!liberado && disponivel < item.quantidade) {
            erros.push(`Estoque insuficiente para "${item.nome}": o condicional leva ${item.quantidade}, disponível ${Math.max(0, disponivel)}. Dê entrada do produto no Estoque ou ligue "Permitir venda sem estoque" em Configurações.`);
            continue;
        }
        reservas.push({ id: item.id, reservadaDepois: arredondar(reservada + item.quantidade) });
    }
    return { erros, reservas };
};
exports.planoDeReserva = planoDeReserva;
/** Libera reserva (devolucao ou cancelamento). Produto que sumiu nao tem o que liberar. */
const planoDeLiberacao = (args) => ((0, exports.somarPorProduto)(args.liberar).flatMap((linha) => {
    const produto = args.produtosPorId[linha.id];
    if (!produto || linha.quantidade <= 0)
        return [];
    return [{ id: linha.id, reservadaDepois: Math.max(0, arredondar(numero(produto.quantidadeReservada) - linha.quantidade)) }];
}));
exports.planoDeLiberacao = planoDeLiberacao;
/**
 * DEVOLUCAO (parcial ou total): soma o que voltou em cada item. Nao deixa
 * devolver mais do que esta com o cliente.
 */
const planejarDevolucao = (itens, devolucoes) => {
    const erros = [];
    const porId = new Map((0, exports.somarPorProduto)(devolucoes.filter((d) => numero(d.quantidade) > 0)).map((d) => [d.id, d.quantidade]));
    if (porId.size === 0)
        return { erros: ['Informe a quantidade devolvida de pelo menos um item.'], itens: [...itens], liberar: [], tudoDevolvido: false };
    const novos = itens.map((item) => {
        const volta = porId.get(item.id) || 0;
        if (volta <= 0)
            return item;
        const pendente = (0, exports.quantidadePendente)(item);
        if (volta > pendente) {
            erros.push(`"${item.nome}": devolvendo ${volta}, mas só ${pendente} está com o cliente.`);
            return item;
        }
        if (!item.unidadeMedidaFracionado && !Number.isInteger(volta)) {
            erros.push(`"${item.nome}" não aceita quantidade fracionada. Use um número inteiro.`);
            return item;
        }
        return { ...item, quantidadeDevolvida: arredondar(numero(item.quantidadeDevolvida) + volta) };
    });
    for (const id of porId.keys()) {
        if (!itens.some((item) => item.id === id))
            erros.push('Um dos itens devolvidos não faz parte deste condicional. Atualize a tela.');
    }
    const liberar = [...porId.entries()].map(([id, quantidade]) => ({ id, quantidade }));
    const tudoDevolvido = novos.every((item) => (0, exports.quantidadePendente)(item) === 0);
    return { erros, itens: erros.length ? [...itens] : novos, liberar: erros.length ? [] : liberar, tudoDevolvido };
};
exports.planejarDevolucao = planejarDevolucao;
/** FECHAMENTO: o que ficou com o cliente vira os itens da pre-venda. */
const itensQueFicaram = (itens) => (itens
    .map((item) => ({ item, quantidade: (0, exports.quantidadePendente)(item) }))
    .filter(({ quantidade }) => quantidade > 0)
    .map(({ item, quantidade }) => ({
    id: item.id,
    nome: item.nome,
    codigo: item.codigo,
    precoUnitario: item.precoUnitario,
    quantidade,
    desconto: 0,
    subtotal: arredondar(item.precoUnitario * quantidade, 2),
    unidadeMedidaSigla: item.unidadeMedidaSigla,
    unidadeMedidaFracionado: item.unidadeMedidaFracionado,
    unidadeMedidaCasasDecimais: item.unidadeMedidaCasasDecimais,
})));
exports.itensQueFicaram = itensQueFicaram;
exports.STATUS_DA_PRE_VENDA_GERADA = preVendaDomain_1.STATUS_PRE_VENDA;
const resumirCondicional = (itens) => {
    let pecasLevadas = 0;
    let pecasDevolvidas = 0;
    let valorLevado = 0;
    let valorComCliente = 0;
    for (const item of itens) {
        pecasLevadas += numero(item.quantidade);
        pecasDevolvidas += numero(item.quantidadeDevolvida);
        valorLevado += numero(item.quantidade) * numero(item.precoUnitario);
        valorComCliente += (0, exports.quantidadePendente)(item) * numero(item.precoUnitario);
    }
    return {
        pecasLevadas: arredondar(pecasLevadas),
        pecasDevolvidas: arredondar(pecasDevolvidas),
        pecasComCliente: arredondar(pecasLevadas - pecasDevolvidas),
        valorLevado: arredondar(valorLevado, 2),
        valorComCliente: arredondar(valorComCliente, 2),
    };
};
exports.resumirCondicional = resumirCondicional;
/** Quais acoes a tela mostra para cada situacao. */
const acoesDoCondicional = (status) => {
    const aberto = status === 'aberto';
    return { devolver: aberto, fechar: aberto, cancelar: aberto };
};
exports.acoesDoCondicional = acoesDoCondicional;
/**
 * Mensagem quando a empresa ainda nao liga o condicional. A tela e o servidor
 * usam a mesma frase (CLAUDE.md, regra 1: bloquear com mensagem clara).
 */
exports.MENSAGEM_CONDICIONAL_DESLIGADO = 'O condicional está desligado nesta empresa. Marque "Trabalha com condicional" em Configurações > Configurações Gerais para usar.';
