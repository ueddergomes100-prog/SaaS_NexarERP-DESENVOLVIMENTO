"use strict";
/**
 * ROTA NA PRE-VENDA (pedido do dono, 21/10/2026).
 *
 * Cliente que trabalha com duas ou mais rotas de entrega abertas ao mesmo
 * tempo quer que, ao gravar a pre-venda, o sistema pergunte "Rota 1 ou
 * Rota 2?" -- e que, depois que a Rota 1 e' liberada pro motorista, as
 * pre-vendas seguintes caiam sozinhas na Rota 2, sem perguntar.
 *
 * Configuracao POR FILIAL (`configuracoes/{empresa}.rotaNaPreVenda`), com
 * tres modos (o dono pediu as duas opcoes de quando o pedido entra):
 *
 *   nao          -> como sempre foi: a loja monta a rota depois, so' com
 *                   venda faturada (padrao).
 *   na_pre_venda -> pergunta ao gravar e a pre-venda JA' ENTRA na rota em
 *                   montagem. "Liberar" so' passa quando tudo estiver
 *                   faturado (o motorista nao sai com pre-venda).
 *   ao_faturar   -> pergunta ao gravar, anota a rota no pedido e ele entra
 *                   na rota QUANDO FOR FATURADO.
 *
 * Decisao de rota (vale pro computador e pro app): mais de uma rota em
 * montagem -> pergunta; so' uma -> entra nela sem perguntar; nenhuma ->
 * fica sem rota e a loja coloca depois. No ENVIO do app e no FATURAMENTO
 * ninguem pode perguntar (pode ser automatico, sem tela): vale a rota
 * escolhida antes, se ainda estiver em montagem; senao a unica aberta;
 * senao nenhuma.
 *
 * Regra pura: sem tela, sem Firestore. Compilada para o servidor.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.textoDaRotaEscolhida = exports.textoDoResultadoDaRota = exports.erroDePreVendaParaLiberar = exports.pedidosSemFaturar = exports.ordenarRotas = exports.rotaSemPerguntar = exports.decidirRota = exports.preVendaEntraNaRota = exports.perguntaRotaNaPreVenda = exports.parseModoRotaPreVenda = exports.ROTULO_MODO_ROTA_PRE_VENDA = exports.DEFAULT_MODO_ROTA_PRE_VENDA = exports.MODOS_ROTA_PRE_VENDA = void 0;
exports.MODOS_ROTA_PRE_VENDA = ['nao', 'na_pre_venda', 'ao_faturar'];
exports.DEFAULT_MODO_ROTA_PRE_VENDA = 'nao';
exports.ROTULO_MODO_ROTA_PRE_VENDA = {
    nao: 'Não perguntar: a loja monta a rota depois, só com venda faturada (como hoje)',
    na_pre_venda: 'Perguntar a rota ao gravar a pré-venda e colocá-la na rota na hora',
    ao_faturar: 'Perguntar a rota ao gravar a pré-venda e colocá-la na rota quando o pedido for faturado',
};
const parseModoRotaPreVenda = (raw) => (exports.MODOS_ROTA_PRE_VENDA.includes(String(raw)) ? raw : exports.DEFAULT_MODO_ROTA_PRE_VENDA);
exports.parseModoRotaPreVenda = parseModoRotaPreVenda;
/** A tela pergunta a rota ao gravar/enviar a pre-venda? */
const perguntaRotaNaPreVenda = (modo) => modo !== 'nao';
exports.perguntaRotaNaPreVenda = perguntaRotaNaPreVenda;
/** A pre-venda entra na rota em montagem na hora (true) ou so' quando faturar (false)? */
const preVendaEntraNaRota = (modo) => modo === 'na_pre_venda';
exports.preVendaEntraNaRota = preVendaEntraNaRota;
/**
 * Com as rotas em montagem e a rota escolhida antes (se houver), decide:
 * entra sozinha, pergunta, ou fica sem rota.
 */
const decidirRota = (abertas, escolhidaId) => {
    const escolhida = escolhidaId ? abertas.find((r) => r.id === escolhidaId) : undefined;
    if (escolhida)
        return { acao: 'automatica', rota: escolhida };
    if (abertas.length === 1)
        return { acao: 'automatica', rota: abertas[0] };
    if (abertas.length === 0)
        return { acao: 'sem_rota' };
    return { acao: 'perguntar', rotas: abertas };
};
exports.decidirRota = decidirRota;
/**
 * Onde ninguem pode perguntar (envio automatico do app, faturamento): a
 * escolhida antes, senao a unica aberta, senao nenhuma.
 */
const rotaSemPerguntar = (abertas, escolhidaId) => {
    const decisao = (0, exports.decidirRota)(abertas, escolhidaId);
    return decisao.acao === 'automatica' ? decisao.rota : null;
};
exports.rotaSemPerguntar = rotaSemPerguntar;
/** Ordem de apresentacao: pelo titulo ("Rota 01" antes de "Rota 02"). */
const ordenarRotas = (rotas) => ([...rotas].sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt-BR', { numeric: true })));
exports.ordenarRotas = ordenarRotas;
// ---------------------------------------------------------------------------
// LIBERAR A ROTA: so' com tudo faturado
// ---------------------------------------------------------------------------
/** Pedidos da rota que ainda nao estao faturados (numero de cada um), pela situacao lida AGORA. */
const pedidosSemFaturar = (entregas, statusPorPedido) => (entregas.filter((e) => String(statusPorPedido[e.pedidoId] ?? '') !== 'Finalizada').map((e) => e.numeroPedido || '?'));
exports.pedidosSemFaturar = pedidosSemFaturar;
const erroDePreVendaParaLiberar = (numeros) => {
    if (numeros.length === 0)
        return null;
    const lista = numeros.map((n) => `#${n}`).join(', ');
    return numeros.length === 1
        ? `A pré-venda ${lista} ainda não foi faturada. Fature o pedido (ou tire-o da rota) antes de liberar: o motorista só sai com venda faturada.`
        : `Ainda tem ${numeros.length} pré-vendas sem faturar nesta rota: ${lista}. Fature os pedidos (ou tire-os da rota) antes de liberar: o motorista só sai com venda faturada.`;
};
exports.erroDePreVendaParaLiberar = erroDePreVendaParaLiberar;
/** Complemento da mensagem de sucesso da pre-venda/venda; vazio quando nao ha' o que dizer. */
const textoDoResultadoDaRota = (r) => {
    if (!r || r.acao === 'desligado')
        return '';
    const titulo = r.rota?.titulo || '';
    switch (r.acao) {
        case 'colocado': return `Colocado na ${titulo}.`;
        case 'anotada': return `Vai para a ${titulo} quando for faturado.`;
        case 'ja_estava': return titulo ? `Já estava na ${titulo}.` : '';
        case 'sem_rota': return 'Nenhuma rota em montagem no momento: coloque o pedido na rota pelo Romaneio de Entrega.';
        case 'falhou': return `Não foi possível colocar na rota${r.erro ? `: ${r.erro}` : '.'} Coloque pelo Romaneio de Entrega.`;
        default: return '';
    }
};
exports.textoDoResultadoDaRota = textoDoResultadoDaRota;
/** Texto que o app/tela mostra ao marcar a rota escolhida antes de enviar. */
const textoDaRotaEscolhida = (rota, modo) => {
    if (!(0, exports.perguntaRotaNaPreVenda)(modo))
        return '';
    if (!rota)
        return 'Nenhuma rota em montagem agora: a loja coloca o pedido na rota depois.';
    return (0, exports.preVendaEntraNaRota)(modo) ? `Vai para a ${rota.titulo}.` : `Vai para a ${rota.titulo} quando for faturado.`;
};
exports.textoDaRotaEscolhida = textoDaRotaEscolhida;
