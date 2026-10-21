"use strict";
/**
 * PRECO DO ITEM CONFORME A FORMA DE PAGAMENTO (pedido do dono, 2026-10-01).
 *
 * Dois precos no cadastro (decisao do dono, 2026-10-01): o "Preco de venda"
 * E' o preco a prazo (o padrao), e o "Preco a vista" vale so' pra pagamento a
 * vista. O antigo campo "Preco a prazo" (nunca usado na venda) saiu das telas.
 *
 *   - Pagamento A VISTA (dinheiro, Pix, debito, credito em 1x, transferencia)
 *       -> "Preco a vista"; em branco = "Preco de venda".
 *   - A PRAZO (credito em 2+ parcelas; boleto, crediario e cheque, mesmo em
 *     1 parcela, por nao serem a vista) -> "Preco de venda".
 *   - Empresa que nao preenche o preco a vista continua exatamente como antes.
 *
 * Venda com mais de uma forma: basta UMA parte a prazo para a venda inteira
 * ser a prazo (o preco e' do item, nao da parcela).
 *
 * A lista do que conta como a vista e' configuravel (Configuracoes).
 * PROMOCAO vem por cima: ver promocaoDomain.ts. Preco digitado a mao pelo
 * vendedor nunca e' trocado sozinho.
 *
 * Regra pura: sem tela, sem Firestore.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.reprecificarItens = exports.tabelaDoProduto = exports.precoAutomatico = exports.ROTULO_ORIGEM_PRECO = exports.ROTULO_CONDICAO = exports.condicaoDoPagamento = exports.parseFormasAVista = exports.FORMAS_CONFIGURAVEIS_A_VISTA = exports.FORMAS_A_VISTA_PADRAO = void 0;
/** Formas que contam como a vista quando a empresa nao configurou outra lista.
 *  Cartao de credito so' conta em 1x (ver condicaoDoPagamento). */
exports.FORMAS_A_VISTA_PADRAO = [
    'Dinheiro',
    'Pix',
    'Cartão de Débito',
    'Cartão de Crédito',
    'Transferência',
    'Crédito de Devolução',
    'Cashback',
];
/** Todas as formas que a tela de Configuracoes oferece marcar como a vista. */
exports.FORMAS_CONFIGURAVEIS_A_VISTA = [
    'Dinheiro', 'Pix', 'Cartão de Débito', 'Cartão de Crédito', 'Transferência', 'Crédito de Devolução', 'Cashback',
    'Boleto', 'Cheque', 'Pagamento a Prazo', 'Outros',
];
const parseFormasAVista = (raw) => {
    if (!Array.isArray(raw))
        return [...exports.FORMAS_A_VISTA_PADRAO];
    const lista = raw.filter((f) => typeof f === 'string' && exports.FORMAS_CONFIGURAVEIS_A_VISTA.includes(f));
    return lista.length > 0 ? [...new Set(lista)] : [...exports.FORMAS_A_VISTA_PADRAO];
};
exports.parseFormasAVista = parseFormasAVista;
const numeroDeParcelas = (valor) => {
    const n = Number.parseInt(String(valor ?? ''), 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
};
/**
 * A venda e' a vista ou a prazo? O PADRAO e' a prazo (decisao do dono,
 * 2026-10-02: "sempre puxar o preco a prazo primeiro, o a vista somente
 * depois de por a forma de pagamento"). So' vira a vista quando ha' ao menos
 * uma forma escolhida e nenhuma delas e' a prazo; linha de pagamento ainda
 * sem forma nao conta pra nenhum lado.
 */
const condicaoDoPagamento = (pagamentos, formasAVista = exports.FORMAS_A_VISTA_PADRAO) => {
    const escolhidos = pagamentos.filter((p) => Boolean(p.forma));
    if (escolhidos.length === 0)
        return 'prazo';
    const aPrazo = escolhidos.some((p) => {
        if (p.forma === 'Cartão de Crédito' && numeroDeParcelas(p.parcelas) >= 2)
            return true;
        if ((p.forma === 'Boleto' || p.forma === 'Pagamento a Prazo') && numeroDeParcelas(p.parcelasAPrazo) >= 2)
            return true;
        return !formasAVista.includes(p.forma);
    });
    return aPrazo ? 'prazo' : 'vista';
};
exports.condicaoDoPagamento = condicaoDoPagamento;
exports.ROTULO_CONDICAO = {
    vista: 'à vista',
    prazo: 'a prazo',
};
exports.ROTULO_ORIGEM_PRECO = {
    venda: 'Preço de venda',
    vista: 'Preço à vista',
    promocao: 'Promoção',
    manual: 'Preço digitado',
};
const positivo = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
};
/** O preco que o sistema poe sozinho, e de onde ele veio. */
const precoAutomatico = (tabela, condicao) => {
    const promo = tabela.promocao;
    if (promo && positivo(promo.preco) > 0 && (!promo.soAVista || condicao === 'vista')) {
        return { preco: positivo(promo.preco), origem: 'promocao' };
    }
    if (condicao === 'vista' && positivo(tabela.vista) > 0)
        return { preco: positivo(tabela.vista), origem: 'vista' };
    return { preco: positivo(tabela.venda), origem: 'venda' };
};
exports.precoAutomatico = precoAutomatico;
/**
 * Tabela do item na unidade vendida. Os precos do produto sao da unidade base
 * (o kg); a embalagem pode ter os DOIS precos proprios (pedido do dono,
 * 2026-10-02: "preco a vista do kg e o da embalagem"):
 *   - preco de venda proprio, ou preco de venda do kg x fator;
 *   - preco a vista proprio, ou preco a vista do kg x fator -- mas so' quando
 *     a embalagem tambem nao tem preco de venda proprio. Saco com preco de
 *     venda proprio e sem a vista proprio fica sem preco a vista (vale o de
 *     venda): o a vista do kg x fator poderia sair MAIS CARO que o preco
 *     negociado do saco.
 */
const tabelaDoProduto = (produto, unidade = {}) => {
    const proprio = positivo(unidade.precoProprio);
    const vistaPropria = positivo(unidade.precoAVistaProprio);
    const fator = positivo(unidade.fatorConversao) || 1;
    const arredonda = (v) => Math.round(v * fator * 100) / 100;
    return {
        venda: proprio > 0 ? proprio : arredonda(positivo(produto.precoVenda)),
        vista: vistaPropria > 0 ? vistaPropria : (proprio > 0 ? 0 : arredonda(positivo(produto.precoAVista))),
        promocao: null,
    };
};
exports.tabelaDoProduto = tabelaDoProduto;
/**
 * Troca o preco dos itens quando a condicao muda (a vista <-> a prazo).
 * Item sem tabela (avulso, venda antiga) e item com preco digitado ficam como
 * estao. O desconto do item (em R$) e' mantido; o subtotal e' refeito.
 */
const reprecificarItens = (itens, condicao) => {
    let alterados = 0;
    let diferenca = 0;
    const novos = itens.map((item) => {
        if (!item.tabelaPreco || item.origemPreco === 'manual')
            return item;
        const { preco, origem } = (0, exports.precoAutomatico)(item.tabelaPreco, condicao);
        if (Math.abs(preco - item.precoUnitario) < 0.0001 && origem === item.origemPreco)
            return item;
        if (Math.abs(preco - item.precoUnitario) >= 0.0001) {
            alterados += 1;
            diferenca += Math.round(preco * item.quantidade * 100) - Math.round(item.precoUnitario * item.quantidade * 100);
        }
        return {
            ...item,
            precoUnitario: preco,
            origemPreco: origem,
            subtotal: Math.max(0, preco * item.quantidade - item.desconto),
        };
    });
    return { itens: novos, alterados, diferencaCentavos: diferenca };
};
exports.reprecificarItens = reprecificarItens;
