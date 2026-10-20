"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.textoDaSaidaComReserva = exports.analisarSaidaComReserva = exports.podeVenderSemEstoque = exports.quantidadeDoProdutoNosItens = exports.ROTULO_ORIGEM_RESERVA = exports.textoDaReserva = exports.resumoDeReserva = exports.computeReservationRelease = exports.computeReservationReturn = exports.computeReservationCommit = exports.computeReservationDelta = exports.computeAvailableStock = exports.DEFAULT_MOMENTO_BAIXA_ESTOQUE = exports.MOMENTO_BAIXA_ESTOQUE_OPTIONS = void 0;
exports.MOMENTO_BAIXA_ESTOQUE_OPTIONS = [
    { value: 'imediato', label: 'Baixar imediatamente (padrão)' },
    { value: 'pedido', label: 'Reservar no Pedido e na OS (baixa só ao finalizar)' },
    { value: 'caixa', label: 'Baixar no Caixa' },
    { value: 'nf', label: 'Baixar na NF' },
];
exports.DEFAULT_MOMENTO_BAIXA_ESTOQUE = 'imediato';
// Calculo puro do estoque disponivel (quantidade - reservada). Nao depende
// do Firestore.
const computeAvailableStock = (quantidade, quantidadeReservada) => {
    const qtd = Math.max(0, Number.isFinite(quantidade) ? quantidade : 0);
    const reservada = Math.max(0, Number.isFinite(quantidadeReservada) ? quantidadeReservada : 0);
    return Math.max(0, qtd - reservada);
};
exports.computeAvailableStock = computeAvailableStock;
const sumStockLineItemsById = (items) => {
    const byId = new Map();
    for (const item of items) {
        if (!item.id || item.id === 'avulso')
            continue;
        const quantity = Number(item.quantidade || 0);
        if (quantity <= 0)
            continue;
        const existing = byId.get(item.id);
        byId.set(item.id, {
            nome: existing?.nome || item.nome,
            quantidade: (existing?.quantidade || 0) + quantity,
        });
    }
    return byId;
};
// OS continua aberta -- reconcilia a reserva anterior com a lista atual de
// pecas. Delta simetrico, so mexe em quantidadeReservada (quantidadeDelta
// sempre 0 no resultado).
const computeReservationDelta = (previous, next) => {
    const previousMap = sumStockLineItemsById(previous);
    const nextMap = sumStockLineItemsById(next);
    const ids = new Set([...previousMap.keys(), ...nextMap.keys()]);
    const result = [];
    for (const id of ids) {
        const previousQuantity = previousMap.get(id)?.quantidade || 0;
        const nextQuantity = nextMap.get(id)?.quantidade || 0;
        const delta = nextQuantity - previousQuantity;
        if (delta === 0)
            continue;
        result.push({
            id,
            nome: nextMap.get(id)?.nome || previousMap.get(id)?.nome,
            quantidadeDelta: 0,
            quantidadeReservadaDelta: delta,
        });
    }
    return result;
};
exports.computeReservationDelta = computeReservationDelta;
// Libera 100% de "previous" e aplica "target" em quantidade, na direcao
// indicada por sign (-1 = debito real ao finalizar, +1 = devolucao real ao
// cancelar uma OS que ja tinha baixa). Helper interno -- use
// computeReservationCommit/computeReservationReturn.
const computeReservationSettle = (previous, target, sign) => {
    const previousMap = sumStockLineItemsById(previous);
    const targetMap = sumStockLineItemsById(target);
    const ids = new Set([...previousMap.keys(), ...targetMap.keys()]);
    const result = [];
    for (const id of ids) {
        const previousQuantity = previousMap.get(id)?.quantidade || 0;
        const targetQuantity = targetMap.get(id)?.quantidade || 0;
        if (previousQuantity === 0 && targetQuantity === 0)
            continue;
        result.push({
            id,
            nome: targetMap.get(id)?.nome || previousMap.get(id)?.nome,
            quantidadeDelta: sign * targetQuantity || 0,
            quantidadeReservadaDelta: -previousQuantity || 0,
        });
    }
    return result;
};
// Finalizando: libera 100% da reserva anterior e debita de verdade "commit"
// (podem divergir, se as pecas mudaram no mesmo save que finaliza).
const computeReservationCommit = (previous, commit) => computeReservationSettle(previous, commit, -1);
exports.computeReservationCommit = computeReservationCommit;
// Cancelando uma OS que ja tinha baixa REAL (nao so reserva): libera
// qualquer reserva remanescente e devolve o estoque de verdade.
const computeReservationReturn = (previous, returned) => computeReservationSettle(previous, returned, 1);
exports.computeReservationReturn = computeReservationReturn;
// So libera a reserva anterior, sem debitar nem devolver nada -- nomeada a
// parte de computeReservationCommit(previous, []) pra deixar claro no call
// site que e' so liberacao.
const computeReservationRelease = (previous) => (0, exports.computeReservationCommit)(previous, []);
exports.computeReservationRelease = computeReservationRelease;
const resumoDeReserva = (produto) => {
    const quantidade = Math.max(0, Number(produto?.quantidade) || 0);
    const reservada = Math.max(0, Number(produto?.quantidadeReservada) || 0);
    return {
        quantidade,
        reservada,
        disponivel: (0, exports.computeAvailableStock)(quantidade, reservada),
        temReserva: reservada > 0,
    };
};
exports.resumoDeReserva = resumoDeReserva;
const formatarQtd = (valor, casas, sigla) => `${valor.toFixed(Math.max(0, casas))} ${sigla || 'UN'}`;
/** "Reservado: 2 UN · Disponível: 8 UN" -- so' quando ha reserva; senao ''. */
const textoDaReserva = (produto) => {
    const r = (0, exports.resumoDeReserva)(produto);
    if (!r.temReserva)
        return '';
    const casas = produto?.unidadeMedidaCasasDecimais ?? 0;
    const sigla = produto?.unidadeMedidaSigla || 'UN';
    return `Reservado: ${formatarQtd(r.reservada, casas, sigla)} · Disponível: ${formatarQtd(r.disponivel, casas, sigla)}`;
};
exports.textoDaReserva = textoDaReserva;
exports.ROTULO_ORIGEM_RESERVA = {
    pre_venda: 'Pré-venda',
    ordem_de_servico: 'Ordem de Serviço',
    condicional: 'Condicional',
    troca: 'Troca',
};
/** Soma o que cada documento aberto segura de um produto (itens com o mesmo id somam). */
const quantidadeDoProdutoNosItens = (itens, produtoId) => {
    if (!Array.isArray(itens))
        return 0;
    return itens.reduce((total, item) => {
        const i = (item && typeof item === 'object' ? item : {});
        const id = i.id ?? i.produtoId ?? i.pecaId;
        if (id !== produtoId)
            return total;
        // Item vendido em embalagem (saco de 20 kg) reserva na unidade base: e' o
        // `quantidadeBase` que bate com o `quantidadeReservada` do produto.
        const qtd = Number(i.quantidadeBase ?? i.quantidade ?? i.qtd ?? 0);
        return total + (Number.isFinite(qtd) && qtd > 0 ? qtd : 0);
    }, 0);
};
exports.quantidadeDoProdutoNosItens = quantidadeDoProdutoNosItens;
const numeroOuZero = (valor) => {
    const n = Number(valor);
    return Number.isFinite(n) ? n : 0;
};
/**
 * `pedida` e' o TOTAL do produto no documento depois da mudanca (todas as
 * linhas, na unidade base). `reservadoPeloDocumento` e' o que este documento
 * ja' segura gravado (pre-venda ou OS aberta com reserva) -- ele nao conta
 * contra o proprio documento.
 */
/**
 * "Permitir venda sem estoque" e' da filial, mas o produto pode se trancar
 * ("Bloquear venda sem estoque" no cadastro, 20/10/2026): marcado, nao sai
 * sem saldo em nenhuma tela nem no servidor, mesmo com a chave ligada.
 */
const podeVenderSemEstoque = (permiteNaFilial, produto) => permiteNaFilial && produto?.bloquearVendaSemEstoque !== true;
exports.podeVenderSemEstoque = podeVenderSemEstoque;
const analisarSaidaComReserva = (args) => {
    const estoque = numeroOuZero(args.quantidade);
    const reservada = Math.max(0, numeroOuZero(args.quantidadeReservada));
    const propria = Math.max(0, numeroOuZero(args.reservadoPeloDocumento));
    const reservadoPorOutros = Math.max(0, reservada - propria);
    const disponivel = Math.max(0, Math.max(0, estoque) - reservadoPorOutros);
    const pedida = Math.max(0, numeroOuZero(args.pedida));
    const base = { estoque, reservadoPorOutros, disponivel };
    // Folga de arredondamento (quilo com 3 casas).
    if (pedida <= disponivel + 1e-9)
        return { situacao: 'ok', ...base };
    if (args.permiteVendaSemEstoque) {
        return { situacao: reservadoPorOutros > 0 ? 'avisar_reserva' : 'ok', ...base };
    }
    return { situacao: reservadoPorOutros > 0 ? 'bloquear_reserva' : 'bloquear_estoque', ...base };
};
exports.analisarSaidaComReserva = analisarSaidaComReserva;
const rotuloDaReserva = (r, formatar) => {
    const numero = r.numero ? ` #${r.numero}` : '';
    const cliente = r.cliente ? ` · ${r.cliente}` : '';
    return `${exports.ROTULO_ORIGEM_RESERVA[r.origem]}${numero}${cliente} (${formatar(r.quantidade)})`;
};
/**
 * Texto da mensagem: numeros do produto + quem segura a reserva. Lista no
 * maximo 5 documentos (o resto vira "e mais N") para a mensagem caber.
 */
const textoDaSaidaComReserva = (args) => {
    const casas = args.casas ?? 0;
    const sigla = args.sigla || 'UN';
    const fmt = (v) => formatarQtd(v, casas, sigla);
    const { analise } = args;
    const numeros = `Estoque ${fmt(analise.estoque)}, reservado ${fmt(analise.reservadoPorOutros)}, disponível ${fmt(analise.disponivel)}; nesta venda ${fmt(Math.max(0, args.pedida))}.`;
    if (args.reservas.length === 0)
        return numeros;
    const primeiras = args.reservas.slice(0, 5).map((r) => rotuloDaReserva(r, fmt));
    const resto = args.reservas.length > 5 ? ` e mais ${args.reservas.length - 5}` : '';
    return `${numeros} Reservado em: ${primeiras.join('; ')}${resto}.`;
};
exports.textoDaSaidaComReserva = textoDaSaidaComReserva;
