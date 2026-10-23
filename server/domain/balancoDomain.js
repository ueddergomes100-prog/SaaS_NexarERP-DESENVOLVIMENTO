"use strict";
/*
 * BALANCO (INVENTARIO) -- pedido do dono, 21/10/2026.
 *
 * Decisoes do dono (caixinhas):
 *  - o que contar: todos os produtos, grupos (categorias), materia-prima ou
 *    produtos acabados E revenda (tudo que se vende: produzido ou comprado para
 *    revender; fica de fora o item de uso interno);
 *  - varias pessoas contando: o sistema DIVIDE sozinho em blocos, mantendo o
 *    mesmo grupo junto; cada um so' ve e so' conta a sua lista;
 *  - contagem CEGA: quem conta nao ve o saldo do sistema;
 *  - na abertura, opcao de TRAVAR: nada de finalizar venda/PDV nem fechar OS
 *    ate' o balanco acabar (pre-venda continua, porque so' reserva). Sem a
 *    trava, o ajuste e' pela diferenca do MOMENTO da contagem: venda depois da
 *    contagem continua descontando;
 *  - estoque negativo: no fechamento, para o balanco todo, "fica o que
 *    contou" (contou 100 -> 100) ou "desconta o negativo" (sistema -10,
 *    contou 100 -> 90: as 10 vendidas ainda estavam na prateleira);
 *  - item que ninguem contou ZERA no fechamento;
 *  - produto com lote e' contado lote por lote (da' para incluir lote novo);
 *  - sem recontagem.
 *
 * A reserva (pre-venda, OS, condicional) NUNCA e' mexida: o balanco ajusta so'
 * o estoque fisico (`quantidade`); a reserva sai dele quando o documento fecha.
 *
 * Regra pura (tela e servidor): sem Firestore, sem rede.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.bloqueioPorBalanco = exports.itensNegativos = exports.resumoDoFechamento = exports.ajusteDoItem = exports.totalContado = exports.novoTotalContado = exports.erroDaQuantidade = exports.moverItemEntreBlocos = exports.dividirEmBlocos = exports.produtoEntraNoEscopo = exports.grupoDoItem = exports.itemDeVenda = exports.lerPedidoDeAbertura = exports.PERMISSAO_BALANCO_CONTAR = exports.PERMISSAO_BALANCO_GERENCIAR = exports.MAXIMO_DE_CONTADORES = exports.SEM_GRUPO = exports.STATUS_BALANCO = exports.ROTULO_REGRA_NEGATIVO = exports.ROTULO_ESCOPO = void 0;
exports.ROTULO_ESCOPO = {
    todos: 'Todos os produtos',
    grupos: 'Grupos escolhidos',
    // 23/10/2026 (dono): os insumos (Producao > Insumos) contam junto com a materia-prima.
    materias_primas: 'Matéria-prima e insumos',
    // 21/10/2026 (dono): o que a loja VENDE -- produzido por ela ou comprado para revender.
    acabados: 'Produtos acabados e revenda',
};
exports.ROTULO_REGRA_NEGATIVO = {
    contado: 'Fica o que contou',
    descontar: 'Desconta o negativo',
};
/** 'fechando': o fechamento comecou (ajustes em andamento); ninguem conta mais e fechar de novo continua. */
exports.STATUS_BALANCO = { contando: 'contando', fechando: 'fechando', fechado: 'fechado', cancelado: 'cancelado' };
exports.SEM_GRUPO = 'SEM GRUPO';
exports.MAXIMO_DE_CONTADORES = 20;
exports.PERMISSAO_BALANCO_GERENCIAR = 'estoque.balanco_gerenciar';
exports.PERMISSAO_BALANCO_CONTAR = 'estoque.balanco_contar';
const arred = (v, casas = 6) => {
    const f = 10 ** casas;
    return Math.round((Number(v) + Number.EPSILON) * f) / f;
};
const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};
const texto = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const ID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;
const lerPedidoDeAbertura = (corpo) => {
    const c = (corpo && typeof corpo === 'object' ? corpo : {});
    const nome = texto(c.nome, 80);
    if (nome.length < 3)
        return { erro: 'Dê um nome ao balanço (mínimo 3 letras), ex.: "BALANÇO OUTUBRO".' };
    const e = (c.escopo && typeof c.escopo === 'object' ? c.escopo : {});
    const tipo = ['todos', 'grupos', 'materias_primas', 'acabados'].find((t) => t === e.tipo);
    if (!tipo)
        return { erro: 'Escolha o que vai ser contado.' };
    const categorias = Array.isArray(e.categorias)
        ? [...new Set(e.categorias.map((x) => texto(x, 120).toUpperCase()).filter(Boolean))]
        : [];
    if (tipo === 'grupos' && categorias.length === 0)
        return { erro: 'Escolha pelo menos um grupo para contar.' };
    if (!Array.isArray(c.contadores) || c.contadores.length === 0)
        return { erro: 'Escolha quem vai contar (pelo menos uma pessoa).' };
    const contadores = [...new Set(c.contadores.map((x) => String(x ?? '')))];
    if (contadores.some((u) => !ID_VALIDO.test(u)))
        return { erro: 'Uma das pessoas escolhidas é inválida. Atualize a tela.' };
    if (contadores.length > exports.MAXIMO_DE_CONTADORES)
        return { erro: `No máximo ${exports.MAXIMO_DE_CONTADORES} pessoas contando no mesmo balanço.` };
    return { pedido: { nome: nome.toUpperCase(), escopo: { tipo, categorias: tipo === 'grupos' ? categorias : [] }, contadores, travaVendas: c.travaVendas === true } };
};
exports.lerPedidoDeAbertura = lerPedidoDeAbertura;
/** O item e' vendido? (produtoRevenda desmarcado no cadastro = uso interno; cadastro antigo guardava em `avancado`.) */
const itemDeVenda = (p) => (p.produtoRevenda ?? p.avancado?.produtoRevenda ?? true) !== false;
exports.itemDeVenda = itemDeVenda;
/** Grupo (categoria) do item, normalizado; sem grupo = "SEM GRUPO". */
const grupoDoItem = (p) => texto(p.categoria, 120).toUpperCase() || exports.SEM_GRUPO;
exports.grupoDoItem = grupoDoItem;
/** Produto do `estoque` entra no balanco? (principal de grade nao tem estoque; inativo fica de fora.) */
const produtoEntraNoEscopo = (p, escopo) => {
    if (p.temGrade === true || p.ativo === false || p.statusAtivo === false)
        return false;
    if (escopo.tipo === 'grupos')
        return escopo.categorias.includes((0, exports.grupoDoItem)(p));
    // Acabados e revenda (21/10/2026): produzido ou comprado para revender -- tudo que se vende.
    if (escopo.tipo === 'acabados')
        return (0, exports.itemDeVenda)(p);
    return escopo.tipo === 'todos';
};
exports.produtoEntraNoEscopo = produtoEntraNoEscopo;
/**
 * Divide os itens em partes quase iguais mantendo o mesmo grupo junto: grupo
 * maior que a parte de cada um e' cortado (em ordem alfabetica) em pedacos do
 * tamanho da parte; os pedacos vao, do maior para o menor, para quem esta' com
 * menos itens. Sempre o mesmo resultado para a mesma entrada.
 */
const dividirEmBlocos = (itens, contadores) => {
    const porGrupo = new Map();
    itens.forEach((i) => porGrupo.set(i.grupo, [...(porGrupo.get(i.grupo) || []), i]));
    const parte = Math.max(1, Math.ceil(itens.length / Math.max(1, contadores.length)));
    const pedacos = [];
    [...porGrupo.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([grupo, lista]) => {
        const ordenada = [...lista].sort((a, b) => a.nome.localeCompare(b.nome) || a.chave.localeCompare(b.chave));
        for (let i = 0; i < ordenada.length; i += parte)
            pedacos.push({ grupo, itens: ordenada.slice(i, i + parte) });
    });
    pedacos.sort((a, b) => b.itens.length - a.itens.length || a.grupo.localeCompare(b.grupo));
    const carga = new Map(contadores.map((u) => [u, 0]));
    const blocos = new Map(contadores.map((u) => [u, { contadorUid: u, grupos: [], itens: 0 }]));
    const porItem = {};
    pedacos.forEach((p) => {
        const quem = [...carga.entries()].sort((a, b) => a[1] - b[1] || contadores.indexOf(a[0]) - contadores.indexOf(b[0]))[0][0];
        carga.set(quem, (carga.get(quem) || 0) + p.itens.length);
        const bloco = blocos.get(quem);
        const existente = bloco.grupos.find((g) => g.nome === p.grupo);
        if (existente)
            existente.itens += p.itens.length;
        else
            bloco.grupos.push({ nome: p.grupo, itens: p.itens.length });
        bloco.itens += p.itens.length;
        p.itens.forEach((i) => { porItem[i.chave] = quem; });
    });
    blocos.forEach((b) => b.grupos.sort((x, y) => x.nome.localeCompare(y.nome)));
    return { porItem, blocos: contadores.map((u) => blocos.get(u)) };
};
exports.dividirEmBlocos = dividirEmBlocos;
/**
 * Item bipado por quem NAO e' o dono dele (22/10/2026, pedido do dono no
 * cliente): o item passa para quem bipou e some da lista do outro. Esta funcao
 * so' ajusta as contagens dos blocos (o doc do balanco); o item em si e'
 * regravado pelo servidor. Quem recebe e nao tinha bloco ganha um.
 */
const moverItemEntreBlocos = (blocos, de, para, grupo) => {
    if (de === para)
        return blocos;
    const copia = blocos.map((b) => ({ ...b, grupos: b.grupos.map((g) => ({ ...g })) }));
    const origem = copia.find((b) => b.contadorUid === de);
    if (origem) {
        const g = origem.grupos.find((x) => x.nome === grupo);
        if (g) {
            g.itens = Math.max(0, g.itens - 1);
            if (g.itens === 0)
                origem.grupos = origem.grupos.filter((x) => x !== g);
        }
        origem.itens = Math.max(0, origem.itens - 1);
    }
    let destino = copia.find((b) => b.contadorUid === para);
    if (!destino) {
        destino = { contadorUid: para, grupos: [], itens: 0 };
        copia.push(destino);
    }
    const gd = destino.grupos.find((x) => x.nome === grupo);
    if (gd)
        gd.itens += 1;
    else
        destino.grupos.push({ nome: grupo, itens: 1 });
    destino.grupos.sort((x, y) => x.nome.localeCompare(y.nome));
    destino.itens += 1;
    return copia;
};
exports.moverItemEntreBlocos = moverItemEntreBlocos;
/** Quantidade informada vale para a unidade do item? (UN nao aceita fracao.) */
const erroDaQuantidade = (quantidade, unidade, nome) => {
    if (!Number.isFinite(quantidade) || quantidade < 0)
        return `${nome}: informe uma quantidade de zero para cima.`;
    if (!unidade.fracionado && !Number.isInteger(quantidade))
        return `${nome} é contado em ${unidade.sigla}, sem fração. Informe um número inteiro.`;
    if (unidade.fracionado && unidade.casas >= 0) {
        const f = 10 ** unidade.casas;
        if (Math.abs(quantidade * f - Math.round(quantidade * f)) > 1e-6)
            return `${nome}: use no máximo ${unidade.casas} casa(s) decimal(is).`;
    }
    return null;
};
exports.erroDaQuantidade = erroDaQuantidade;
/** 'somar' acrescenta ao que ja' foi contado (o item em dois lugares); 'definir' troca o total. */
const novoTotalContado = (atual, quantidade, modo) => (modo === 'somar' ? arred(num(atual) + quantidade) : arred(quantidade));
exports.novoTotalContado = novoTotalContado;
/** O total contado do item (soma dos lotes, no produto com lote). null = ninguem contou nada. */
const totalContado = (item) => {
    if (!item.controlaLote)
        return item.contado ?? null;
    const contados = item.lotes.filter((l) => l.contado !== null && l.contado !== undefined);
    return contados.length === 0 ? null : arred(contados.reduce((s, l) => s + num(l.contado), 0));
};
exports.totalContado = totalContado;
/**
 * Quanto o estoque vai ficar. Pela diferenca do MOMENTO da contagem:
 *   alvo = contado (ou contado + negativo, na regra "desconta o negativo");
 *   delta = alvo - saldo na contagem;  depois = saldo agora + delta.
 * Com a trava, saldo agora = saldo na contagem, entao depois = alvo. Nao contado
 * = contado 0 com o saldo de agora (zera).
 */
const ajusteDoItem = (item, saldoAgora, saldoDosLotesAgora, regra) => {
    const contado = (0, exports.totalContado)(item);
    const naoContado = contado === null;
    const base = naoContado || item.saldoNaContagem === null ? saldoAgora : num(item.saldoNaContagem);
    const alvo = naoContado ? 0 : (regra === 'descontar' && base < 0 ? arred(num(contado) + base) : num(contado));
    const delta = arred(alvo - base);
    const lotes = item.controlaLote ? item.lotes.map((l) => {
        const agoraLote = l.loteId ? num(saldoDosLotesAgora[l.loteId]) : 0;
        const baseLote = l.contado === null || l.saldoNaContagem === null ? agoraLote : num(l.saldoNaContagem);
        const alvoLote = l.contado === null ? 0 : num(l.contado);
        const d = arred(alvoLote - baseLote);
        return { loteId: l.loteId, lote: l.lote, validade: l.validade, antes: agoraLote, depois: arred(Math.max(0, agoraLote + d)), delta: d };
    }) : [];
    return { chave: item.chave, colecao: item.colecao, produtoId: item.produtoId, nome: item.nome, antes: saldoAgora, depois: arred(saldoAgora + delta), delta, naoContado, lotes };
};
exports.ajusteDoItem = ajusteDoItem;
/** Resumo da conferencia (o que o gestor ve antes de fechar). */
const resumoDoFechamento = (ajustes) => ({
    itens: ajustes.length,
    naoContados: ajustes.filter((a) => a.naoContado).length,
    comDiferenca: ajustes.filter((a) => Math.abs(a.delta) > 1e-9).length,
    sobras: ajustes.filter((a) => a.delta > 1e-9).length,
    faltas: ajustes.filter((a) => a.delta < -1e-9).length,
});
exports.resumoDoFechamento = resumoDoFechamento;
/** Itens com saldo negativo na contagem: a escolha "fica o que contou" x "desconta o negativo" muda o resultado deles. */
const itensNegativos = (itens) => (itens.filter((i) => (0, exports.totalContado)(i) !== null && i.saldoNaContagem !== null && num(i.saldoNaContagem) < 0));
exports.itensNegativos = itensNegativos;
/** Mensagem que bloqueia venda/PDV/OS quando ha' balanco com trava aberto; null = pode. */
const bloqueioPorBalanco = (trava, acao) => (trava && trava.travaVendas === true
    ? `O balanço "${texto(trava.nome, 80) || 'em andamento'}" está aberto com as vendas travadas: não dá para ${acao} até ele ser fechado ou cancelado em Estoque › Balanço. Pré-venda continua liberada.`
    : null);
exports.bloqueioPorBalanco = bloqueioPorBalanco;
