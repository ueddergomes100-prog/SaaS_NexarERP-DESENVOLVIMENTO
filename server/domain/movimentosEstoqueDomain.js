"use strict";
/**
 * MOVIMENTACAO DE PRODUTOS (26/10/2026, pedido do dono).
 *
 * "Uma tela onde consigo ver todas as movimentacoes de entrada e saida do
 * estoque, com filtros de materia-prima e item acabado." Decisoes (caixinhas):
 * - montada a partir dos documentos JA' gravados (mostra o passado tambem),
 *   sem um extrato novo -- cada origem abaixo vira linhas de movimento;
 * - "acabado" = produto que a fabrica produz (tem receita ou ja' saiu de uma
 *   ordem de producao); revenda, semiacabado, materia-prima e insumo a parte;
 * - filtros: periodo, produto, tipo do item, entrada/saida, origem, categoria;
 * - lista geral + extrato do produto com saldo antes/depois de cada movimento.
 *
 * Regra pura: o servidor (server/services/movimentosEstoque.js) le os documentos,
 * troca as datas do Firestore por milissegundos e chama os montadores daqui.
 *
 * Origens e de onde vem cada uma (levantamento de 26/10):
 * - venda / PDV: pedidos_venda finalizado (sem entrega futura), saida em dataVenda;
 *   cancelado depois de finalizado (tem canceladaEm): entrada em canceladaEm.
 * - devolucao de venda: devolucoes_venda (entrada em createdAt; estornada: saida em estornadaEm).
 * - OS: ordens_de_servico com estoqueBaixado, saida em finalizadaEm (ou dataSaida).
 *   Reabrir/cancelar devolvendo apaga o que saiu: so' a ultima baixa que vale aparece.
 * - entrega futura: entregas_futuras (saida em createdAt, quantidadeBase).
 * - compra (NF-e de entrada): notas_fiscais_entrada (entrada em createdAt; excluida:
 *   saida na ultima alteracao). Nota de transferencia fica de fora (ja' esta nos ajustes).
 * - nota avulsa: notas_avulsas (entrada em createdAt; cancelada: saida em canceladoEm).
 * - devolucao de compra: devolucoes_compra (saida em createdAt).
 * - producao: ordens_producao finalizada (consumo = saida dos componentes, producao =
 *   entrada do produto, em dataFim); estornada: o contrario em dataEstorno.
 * - ajustes_estoque: ajuste manual, balanco, transferencias, trocas e inativacao.
 * Reserva (pre-venda, condicional, OS aberta) nao mexe no estoque fisico: fica fora.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.extratoDoItem = exports.ordenarMovimentos = exports.resumirMovimentos = exports.filtrarMovimentos = exports.FILTROS_DA_TELA_VAZIOS = exports.lerFiltroDaConsulta = exports.PERIODO_MAXIMO_DIAS = exports.tipoDoProdutoDoEstoque = exports.movimentosDoAjuste = exports.movimentosDaProducao = exports.movimentosDaDevolucaoCompra = exports.movimentosDaNotaAvulsa = exports.movimentosDaNotaEntrada = exports.movimentosDaEntregaFutura = exports.movimentosDaOS = exports.movimentosDaDevolucaoVenda = exports.movimentosDoPedido = exports.quantidadeBase = exports.fimDoDiaMillis = exports.inicioDoDiaMillis = exports.millisDoDia = exports.chaveDoItem = exports.ROTULO_TIPO_ITEM = exports.ROTULO_ORIGEM = exports.ROTULO_GRUPO_ORIGEM = exports.GRUPO_DA_ORIGEM = exports.PERMISSAO_MOVIMENTACAO = void 0;
exports.PERMISSAO_MOVIMENTACAO = 'estoque.movimentacao';
exports.GRUPO_DA_ORIGEM = {
    venda: 'venda', venda_cancelada: 'venda', pdv: 'pdv',
    devolucao_venda: 'devolucao_venda', devolucao_venda_estornada: 'devolucao_venda',
    os: 'os', entrega_futura: 'entrega_futura',
    compra: 'compra', compra_excluida: 'compra',
    nota_avulsa: 'nota_avulsa', nota_avulsa_cancelada: 'nota_avulsa',
    devolucao_compra: 'devolucao_compra',
    producao_consumo: 'producao', producao_entrada: 'producao', producao_estorno: 'producao',
    ajuste: 'ajuste', balanco: 'balanco', transferencia: 'transferencia', troca: 'troca',
};
exports.ROTULO_GRUPO_ORIGEM = {
    venda: 'Venda (Pedido de Venda)',
    pdv: 'PDV / Frente de Caixa',
    os: 'Ordem de Serviço',
    entrega_futura: 'Entrega futura',
    compra: 'Compra (NF-e de entrada)',
    nota_avulsa: 'Nota avulsa',
    devolucao_venda: 'Devolução de venda',
    devolucao_compra: 'Devolução de compra',
    producao: 'Produção',
    ajuste: 'Ajuste manual',
    balanco: 'Balanço',
    transferencia: 'Transferência entre filiais',
    troca: 'Troca',
};
exports.ROTULO_ORIGEM = {
    venda: 'Venda',
    pdv: 'Venda no PDV',
    venda_cancelada: 'Venda cancelada (volta ao estoque)',
    devolucao_venda: 'Devolução de venda',
    devolucao_venda_estornada: 'Devolução estornada',
    os: 'Peça na OS',
    entrega_futura: 'Entrega futura',
    compra: 'Compra (NF-e)',
    compra_excluida: 'NF-e de entrada excluída',
    nota_avulsa: 'Nota avulsa',
    nota_avulsa_cancelada: 'Nota avulsa cancelada',
    devolucao_compra: 'Devolução ao fornecedor',
    producao_consumo: 'Consumo na produção',
    producao_entrada: 'Produção (entrada do produto)',
    producao_estorno: 'Estorno da produção',
    ajuste: 'Ajuste manual',
    balanco: 'Balanço',
    transferencia: 'Transferência',
    troca: 'Troca entregue',
};
exports.ROTULO_TIPO_ITEM = {
    acabado: 'Produto acabado',
    semiacabado: 'Semiacabado / uso interno',
    revenda: 'Revenda',
    materia_prima: 'Matéria-prima',
    insumo: 'Insumo',
};
const chaveDoItem = (colecao, id) => `${colecao}:${id}`;
exports.chaveDoItem = chaveDoItem;
// ---------------------------------------------------------------------------
// Datas e numeros
// ---------------------------------------------------------------------------
const YMD = /^\d{4}-\d{2}-\d{2}$/;
/** Dia (AAAA-MM-DD) -> meio-dia de Brasilia em ms (o documento so' tem o dia). */
const millisDoDia = (ymd) => {
    if (!YMD.test(String(ymd || '')))
        return null;
    const [a, m, d] = ymd.split('-').map(Number);
    return Date.UTC(a, m - 1, d, 15, 0, 0);
};
exports.millisDoDia = millisDoDia;
/** Inicio e fim do dia de Brasilia (UTC-3) em ms. */
const inicioDoDiaMillis = (ymd) => {
    const [a, m, d] = ymd.split('-').map(Number);
    return Date.UTC(a, m - 1, d, 3, 0, 0);
};
exports.inicioDoDiaMillis = inicioDoDiaMillis;
const fimDoDiaMillis = (ymd) => (0, exports.inicioDoDiaMillis)(ymd) + 24 * 60 * 60 * 1000 - 1;
exports.fimDoDiaMillis = fimDoDiaMillis;
const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};
/** Quantidade na unidade do estoque (mesma conta de embalagemDomain.toBaseQuantity). */
const quantidadeBase = (quantidade, fator) => {
    const f = num(fator) > 0 ? num(fator) : 1;
    return Math.round(num(quantidade) * f * 1e6) / 1e6;
};
exports.quantidadeBase = quantidadeBase;
const txt = (v) => (typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v));
const COLECAO_DO_TIPO_NOTA = { revenda: 'estoque', materia_prima: 'materias_primas', insumo: 'insumos' };
/** Venda/PDV: saida no dia da venda; cancelada depois de finalizada: entrada no cancelamento. */
const movimentosDoPedido = (p) => {
    if (p.entregaFutura === true)
        return []; // sai pelas entregas
    const finalizada = p.status === 'Finalizada';
    const canceladaDepoisDeVendida = p.status === 'Cancelada' && typeof p.canceladaEmMillis === 'number';
    if (!finalizada && !canceladaDepoisDeVendida)
        return [];
    const pdv = p.origem === 'pdv' || p.sourceOrigin === 'pdv';
    const doc = `${pdv ? 'Venda PDV' : 'Pedido'} #${txt(p.numeroPedido)}`;
    const dataVenda = (0, exports.millisDoDia)(txt(p.dataVenda));
    const linhas = [];
    (p.itens || []).forEach((item, i) => {
        const id = txt(item.id);
        if (!id || id === 'avulso')
            return;
        const quantidade = (0, exports.quantidadeBase)(item.quantidade, item.fatorConversao);
        if (quantidade <= 0)
            return;
        const base = { colecao: 'estoque', itemId: id, itemNome: txt(item.nome), documento: doc, rota: `/pedidos-venda/visualizar/${p.id}`, pessoa: txt(p.clienteNome) || undefined, quantidade };
        if (dataVenda !== null)
            linhas.push({ ...base, id: `pv:${p.id}:${i}:saida`, dataMillis: dataVenda, tipo: 'saida', origem: pdv ? 'pdv' : 'venda' });
        if (canceladaDepoisDeVendida)
            linhas.push({ ...base, id: `pv:${p.id}:${i}:cancel`, dataMillis: p.canceladaEmMillis, tipo: 'entrada', origem: 'venda_cancelada' });
    });
    return linhas;
};
exports.movimentosDoPedido = movimentosDoPedido;
const movimentosDaDevolucaoVenda = (d) => {
    const doc = `Devolução do pedido #${txt(d.numeroPedidoOriginal)}`;
    const linhas = [];
    (d.itensDevolvidos || []).forEach((item, i) => {
        const id = txt(item.id);
        const quantidade = (0, exports.quantidadeBase)(item.quantidadeDevolvida, item.fatorConversao);
        if (!id || id === 'avulso' || quantidade <= 0)
            return;
        const base = { colecao: 'estoque', itemId: id, itemNome: txt(item.nome), documento: doc, rota: d.pedidoVendaId ? `/pedidos-venda/visualizar/${txt(d.pedidoVendaId)}` : undefined, pessoa: txt(d.clienteNome) || undefined, quantidade };
        if (typeof d.createdAtMillis === 'number')
            linhas.push({ ...base, id: `dv:${d.id}:${i}:entrada`, dataMillis: d.createdAtMillis, tipo: 'entrada', origem: 'devolucao_venda' });
        if (d.status === 'estornada' && typeof d.estornadaEmMillis === 'number') {
            linhas.push({ ...base, id: `dv:${d.id}:${i}:estorno`, dataMillis: d.estornadaEmMillis, tipo: 'saida', origem: 'devolucao_venda_estornada' });
        }
    });
    return linhas;
};
exports.movimentosDaDevolucaoVenda = movimentosDaDevolucaoVenda;
/** OS: so' a baixa que esta valendo (reabrir/cancelar devolvendo apaga a lista do que saiu). */
const movimentosDaOS = (o) => {
    if (o.estoqueBaixado !== true)
        return [];
    const data = typeof o.finalizadaEmMillis === 'number' ? o.finalizadaEmMillis : (0, exports.millisDoDia)(txt(o.dataSaida));
    if (data === null)
        return [];
    const pecas = Array.isArray(o.pecasBaixadas) && o.pecasBaixadas.length > 0 ? o.pecasBaixadas : (o.pecas || []);
    return pecas.flatMap((item, i) => {
        const id = txt(item.id);
        const quantidade = num(item.quantidade); // OS nao tem fator de embalagem
        if (!id || id === 'avulso' || quantidade <= 0)
            return [];
        return [{ id: `os:${o.id}:${i}`, dataMillis: data, tipo: 'saida', quantidade, origem: 'os', colecao: 'estoque', itemId: id, itemNome: txt(item.nome), documento: `OS #${txt(o.numeroOS)}`, rota: `/os/editar/${o.id}`, pessoa: txt(o.clienteNome) || undefined }];
    });
};
exports.movimentosDaOS = movimentosDaOS;
const movimentosDaEntregaFutura = (e) => {
    if (typeof e.createdAtMillis !== 'number')
        return [];
    const doc = `Entrega ${txt(e.numero) || ''} do pedido #${txt(e.pedidoNumero)}`.replace('  ', ' ');
    return (e.itens || []).flatMap((item, i) => {
        const id = txt(item.id);
        const quantidade = item.quantidadeBase !== undefined ? num(item.quantidadeBase) : (0, exports.quantidadeBase)(item.quantidade, item.fatorConversao);
        if (!id || quantidade <= 0)
            return [];
        return [{ id: `ef:${e.id}:${i}`, dataMillis: e.createdAtMillis, tipo: 'saida', quantidade, origem: 'entrega_futura', colecao: 'estoque', itemId: id, itemNome: txt(item.nome), documento: doc, rota: e.pedidoId ? `/pedidos-venda/visualizar/${txt(e.pedidoId)}` : undefined, pessoa: txt(e.clienteNome) || undefined }];
    });
};
exports.movimentosDaEntregaFutura = movimentosDaEntregaFutura;
/** Compra pela NF-e de entrada. A nota da transferencia fica de fora (ja' esta' nos ajustes). */
const movimentosDaNotaEntrada = (n) => {
    if (txt(n.transferenciaId))
        return [];
    if (typeof n.createdAtMillis !== 'number')
        return [];
    const doc = `NF-e ${txt(n.numeroNF)}`.trim();
    const excluida = n.status === 'excluida';
    const linhas = [];
    (n.itens || []).forEach((item, i) => {
        const colecao = COLECAO_DO_TIPO_NOTA[txt(item.tipo)];
        const id = txt(item.itemId);
        if (!colecao || !id)
            return; // 'registro' nao mexe no estoque
        const quantidade = item.quantidadeEstoque !== undefined && item.quantidadeEstoque !== null ? num(item.quantidadeEstoque) : num(item.quantidade);
        if (quantidade <= 0)
            return;
        const base = { colecao, itemId: id, itemNome: txt(item.nome) || txt(item.descricao), documento: doc, rota: '/fiscal/entrada-nfe/historico', pessoa: txt(n.fornecedorNome) || undefined, quantidade };
        linhas.push({ ...base, id: `nfe:${n.id}:${i}:entrada`, dataMillis: n.createdAtMillis, tipo: 'entrada', origem: 'compra' });
        if (excluida && typeof n.alteradoEmMillis === 'number') {
            linhas.push({ ...base, id: `nfe:${n.id}:${i}:exclusao`, dataMillis: n.alteradoEmMillis, tipo: 'saida', origem: 'compra_excluida' });
        }
    });
    return linhas;
};
exports.movimentosDaNotaEntrada = movimentosDaNotaEntrada;
const movimentosDaNotaAvulsa = (n) => {
    if (typeof n.createdAtMillis !== 'number')
        return [];
    const doc = `Nota avulsa ${txt(n.numero)}`.trim();
    const linhas = [];
    (n.itens || []).forEach((item, i) => {
        const id = txt(item.produtoId);
        const quantidade = item.quantidadeBase !== undefined && item.quantidadeBase !== null ? num(item.quantidadeBase) : num(item.quantidade);
        if (!id || quantidade <= 0)
            return;
        const base = { colecao: 'estoque', itemId: id, itemNome: txt(item.produtoNome) || txt(item.nome), documento: doc, rota: '/estoque/notas-avulsas', pessoa: txt(n.fornecedorNome) || undefined, quantidade };
        linhas.push({ ...base, id: `na:${n.id}:${i}:entrada`, dataMillis: n.createdAtMillis, tipo: 'entrada', origem: 'nota_avulsa' });
        if (n.status === 'cancelada' && typeof n.canceladoEmMillis === 'number') {
            linhas.push({ ...base, id: `na:${n.id}:${i}:cancel`, dataMillis: n.canceladoEmMillis, tipo: 'saida', origem: 'nota_avulsa_cancelada' });
        }
    });
    return linhas;
};
exports.movimentosDaNotaAvulsa = movimentosDaNotaAvulsa;
const movimentosDaDevolucaoCompra = (d) => {
    if (typeof d.createdAtMillis !== 'number')
        return [];
    const doc = `Devolução da NF-e ${txt(d.notaNumero)}`.trim();
    return (d.itens || []).flatMap((item, i) => {
        const colecao = COLECAO_DO_TIPO_NOTA[txt(item.tipo)];
        const id = txt(item.itemId);
        const quantidade = item.quantidadeEstoque !== undefined && item.quantidadeEstoque !== null ? num(item.quantidadeEstoque) : num(item.quantidade);
        if (!colecao || !id || quantidade <= 0)
            return [];
        return [{ id: `dc:${d.id}:${i}`, dataMillis: d.createdAtMillis, tipo: 'saida', quantidade, origem: 'devolucao_compra', colecao, itemId: id, itemNome: txt(item.nome) || txt(item.descricao), documento: doc, pessoa: txt(d.fornecedorNome) || undefined }];
    });
};
exports.movimentosDaDevolucaoCompra = movimentosDaDevolucaoCompra;
/** Producao finalizada: componentes saem e o produto entra (dataFim). Estornada: o contrario (dataEstorno). */
const movimentosDaProducao = (o) => {
    const finalizou = o.status === 'finalizada' || o.status === 'estornada';
    if (!finalizou || typeof o.dataFimMillis !== 'number')
        return [];
    const doc = `Ordem de produção ${txt(o.numero)}`.trim();
    const rota = `/producao/ordens/editar/${o.id}`;
    const eventos = [{ quando: o.dataFimMillis, sufixo: 'fim', estorno: false }];
    if (o.status === 'estornada' && typeof o.dataEstornoMillis === 'number')
        eventos.push({ quando: o.dataEstornoMillis, sufixo: 'estorno', estorno: true });
    const linhas = [];
    eventos.forEach(({ quando, sufixo, estorno }) => {
        (o.itensConsumidos || []).forEach((c, i) => {
            const id = txt(c.componenteId);
            const quantidade = num(c.quantidadeConsumida);
            if (!id || quantidade <= 0)
                return;
            const colecao = c.origem === 'estoque' ? 'estoque' : 'materias_primas';
            linhas.push({ id: `op:${o.id}:c${i}:${sufixo}`, dataMillis: quando, tipo: estorno ? 'entrada' : 'saida', quantidade, origem: estorno ? 'producao_estorno' : 'producao_consumo', colecao, itemId: id, itemNome: txt(c.componenteNome), documento: doc, rota });
        });
        const produtoId = txt(o.produtoId);
        const produzida = num(o.quantidadeProduzida);
        if (produtoId && produzida > 0) {
            linhas.push({ id: `op:${o.id}:p:${sufixo}`, dataMillis: quando, tipo: estorno ? 'saida' : 'entrada', quantidade: produzida, origem: estorno ? 'producao_estorno' : 'producao_entrada', colecao: 'estoque', itemId: produtoId, itemNome: txt(o.produtoNome), documento: doc, rota });
        }
    });
    return linhas;
};
exports.movimentosDaProducao = movimentosDaProducao;
/** ajustes_estoque: ajuste manual, balanco, transferencias, trocas e inativacao. */
const movimentosDoAjuste = (a) => {
    const id = txt(a.produtoId);
    const quantidade = Math.abs(num(a.quantidade));
    if (!id || quantidade <= 0 || typeof a.createdAtMillis !== 'number')
        return [];
    const tipo = a.tipo === 'saida' ? 'saida' : 'entrada';
    const motivo = txt(a.motivo);
    const origem = motivo === 'balanco' ? 'balanco'
        : motivo.startsWith('transferencia') ? 'transferencia'
            : motivo === 'troca_cliente' ? 'troca'
                : 'ajuste';
    const colecao = a.origem === 'materia_prima' ? 'materias_primas' : a.origem === 'insumo' ? 'insumos' : 'estoque';
    const documento = origem === 'balanco' ? 'Balanço'
        : origem === 'troca' ? `Troca ${txt(a.numeroTroca)}`.trim()
            : origem === 'transferencia' ? (txt(a.observacao).match(/Transfer[eê]ncia n[ºo°]\s*\S+/i)?.[0] || 'Transferência')
                : 'Ajuste manual';
    return [{
            id: `aj:${a.id}`, dataMillis: a.createdAtMillis, tipo, quantidade, origem, colecao, itemId: id, itemNome: txt(a.produtoNome), documento,
            motivo: motivo || undefined, usuario: txt(a.usuarioNome) || undefined, lote: txt(a.lote) || undefined,
            pessoa: txt(a.observacao) || undefined,
        }];
};
exports.movimentosDoAjuste = movimentosDoAjuste;
// ---------------------------------------------------------------------------
// Tipo do item
// ---------------------------------------------------------------------------
/**
 * Produto do estoque: uso interno/semiacabado (produtoRevenda = false), acabado
 * (tem receita ou ja' foi produzido) ou revenda. Os campos podem estar dentro de
 * `avancado` (Configuracoes Avancadas do produto).
 */
const tipoDoProdutoDoEstoque = (produto, temReceita, saiuDeProducao = false) => {
    const avancado = (produto.avancado && typeof produto.avancado === 'object' ? produto.avancado : {});
    const revenda = produto.produtoRevenda ?? avancado.produtoRevenda;
    if (revenda === false)
        return 'semiacabado';
    const produzido = temReceita || saiuDeProducao || Boolean(txt(produto.ultimaProducaoData)) || (produto.produzidoInternamente ?? avancado.produzidoInternamente) === true;
    return produzido ? 'acabado' : 'revenda';
};
exports.tipoDoProdutoDoEstoque = tipoDoProdutoDoEstoque;
// ---------------------------------------------------------------------------
// Consulta, filtros, totais e extrato
// ---------------------------------------------------------------------------
exports.PERIODO_MAXIMO_DIAS = 366;
const lerFiltroDaConsulta = (corpo) => {
    const c = (corpo || {});
    const de = txt(c.de);
    const ate = txt(c.ate);
    if (!YMD.test(de) || !YMD.test(ate))
        return { erro: 'Informe o período (data inicial e final).' };
    if (de > ate)
        return { erro: 'A data inicial é depois da data final.' };
    const dias = ((0, exports.inicioDoDiaMillis)(ate) - (0, exports.inicioDoDiaMillis)(de)) / (24 * 60 * 60 * 1000);
    if (dias > exports.PERIODO_MAXIMO_DIAS)
        return { erro: 'O período pode ter no máximo um ano. Diminua o intervalo das datas.' };
    const itemId = txt(c.itemId);
    const colecao = txt(c.colecao);
    if (itemId) {
        if (itemId.length > 128 || itemId.includes('/'))
            return { erro: 'Produto inválido.' };
        if (!['estoque', 'materias_primas', 'insumos'].includes(colecao))
            return { erro: 'Informe de qual cadastro é o produto.' };
        return { filtro: { de, ate, itemId, colecao } };
    }
    return { filtro: { de, ate } };
};
exports.lerFiltroDaConsulta = lerFiltroDaConsulta;
exports.FILTROS_DA_TELA_VAZIOS = { tipoMovimento: 'todos', tiposDoItem: [], grupos: [], categoria: '', busca: '' };
const semAcento = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const filtrarMovimentos = (movimentos, itens, f) => {
    const termo = semAcento(f.busca.trim());
    return movimentos.filter((m) => {
        if (f.tipoMovimento !== 'todos' && m.tipo !== f.tipoMovimento)
            return false;
        if (f.grupos.length > 0 && !f.grupos.includes(exports.GRUPO_DA_ORIGEM[m.origem]))
            return false;
        const item = itens[(0, exports.chaveDoItem)(m.colecao, m.itemId)];
        if (f.tiposDoItem.length > 0 && !(item && f.tiposDoItem.includes(item.tipo)))
            return false;
        if (f.categoria && (item?.categoria || '') !== f.categoria)
            return false;
        if (termo) {
            const alvo = semAcento([item?.nome || m.itemNome, item?.codigo || '', m.documento, m.pessoa || ''].join(' '));
            if (!termo.split('+').every((parte) => alvo.includes(parte.trim())))
                return false;
        }
        return true;
    });
};
exports.filtrarMovimentos = filtrarMovimentos;
const resumirMovimentos = (movimentos) => ({
    total: movimentos.length,
    entradas: movimentos.filter((m) => m.tipo === 'entrada').length,
    saidas: movimentos.filter((m) => m.tipo === 'saida').length,
    itens: new Set(movimentos.map((m) => (0, exports.chaveDoItem)(m.colecao, m.itemId))).size,
});
exports.resumirMovimentos = resumirMovimentos;
/** Mais novos primeiro; no mesmo instante, a ordem de montagem. */
const ordenarMovimentos = (movimentos) => (movimentos.map((m, i) => ({ m, i })).sort((a, b) => b.m.dataMillis - a.m.dataMillis || a.i - b.i).map((x) => x.m));
exports.ordenarMovimentos = ordenarMovimentos;
const arred = (n) => Math.round(n * 1e6) / 1e6;
/**
 * Extrato de um item com saldo antes/depois, calculado de tras para frente a
 * partir do saldo ATUAL do cadastro: `movimentos` precisa trazer tudo do inicio
 * do periodo ate' hoje (o que passou de `ateMillis` so' entra na conta do saldo).
 * Mudanca de saldo sem documento (saldo inicial digitado no cadastro, importacao)
 * nao aparece como linha: o saldo inicial do periodo ja' a inclui.
 */
const extratoDoItem = (movimentos, saldoAtual, ateMillis) => {
    const cronologica = movimentos.map((m, i) => ({ m, i })).sort((a, b) => a.m.dataMillis - b.m.dataMillis || a.i - b.i).map((x) => x.m);
    const efeito = (m) => (m.tipo === 'entrada' ? m.quantidade : -m.quantidade);
    const somaTudo = cronologica.reduce((s, m) => s + efeito(m), 0);
    let saldo = arred(saldoAtual - somaTudo); // saldo no inicio do periodo
    const saldoInicial = saldo;
    const linhas = [];
    let totalEntradas = 0;
    let totalSaidas = 0;
    cronologica.forEach((m) => {
        const antes = saldo;
        saldo = arred(saldo + efeito(m));
        if (m.dataMillis > ateMillis)
            return;
        if (m.tipo === 'entrada')
            totalEntradas = arred(totalEntradas + m.quantidade);
        else
            totalSaidas = arred(totalSaidas + m.quantidade);
        linhas.push({ ...m, saldoAntes: antes, saldoDepois: saldo });
    });
    const saldoFinal = linhas.length > 0 ? linhas[linhas.length - 1].saldoDepois : saldoInicial;
    return { linhas, saldoInicial, saldoFinal, totalEntradas, totalSaidas };
};
exports.extratoDoItem = extratoDoItem;
