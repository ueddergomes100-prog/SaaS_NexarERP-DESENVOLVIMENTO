"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.explicacaoDaDiferenca = exports.conferirPrecos = void 0;
/*
 * PRECO DE CADA ITEM CONFERIDO (21/10/2026, auditoria "so' a tela protege").
 *
 * Ate' aqui o servidor refazia a conta da venda, mas o PRECO de cada item vinha
 * da tela: pelo DevTools dava para mandar o item mais barato sem passar pelo
 * limite de desconto. Decisoes do dono (21/10/2026, caixinhas):
 *
 *  - preco ABAIXO do preco do sistema (preco de venda, a vista ou a promocao
 *    que vale hoje, na unidade vendida) conta como DESCONTO: a diferenca soma
 *    no desconto do item e passa pelos mesmos limites (do produto, da tela,
 *    total e liberacao por senha). Preco acima do sistema e' livre;
 *  - pre-venda ou orcamento feito antes de o preco do cadastro subir mantem o
 *    preco combinado, e a diferenca conta como desconto (a mesma regra);
 *  - servico da OS (mao de obra) e item avulso: valor livre.
 *
 * O Pedido de Venda ja' fazia isso ao digitar (preco abaixo da tabela vira
 * desconto do item). Agora a tela e o servidor fazem a MESMA conta, aqui; o
 * servidor com o cadastro, as promocoes e as quotas lidos do banco.
 *
 * A promocao so' vale dentro da quota e do limite por venda (promocaoDomain):
 * a linha que passa do que a promocao ainda libera e' conferida pelo preco
 * normal.
 *
 * Regra pura: sem tela, sem Firestore.
 */
const financeDomain_1 = require("./financeDomain");
const embalagemDomain_1 = require("./embalagemDomain");
const precoVendaDomain_1 = require("./precoVendaDomain");
const promocaoDomain_1 = require("./promocaoDomain");
const positivo = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
};
/** Valor da linha em centavos, arredondado por linha (como brutoDaLinhaCentavos). */
const brutoDaLinha = (preco, quantidade) => (Math.max(0, Math.round((0, financeDomain_1.toCents)(preco) * quantidade)));
/** Unidade vendida, com os precos proprios da embalagem. Embalagem que sumiu do cadastro: preco base x fator do item. */
const unidadeDoItem = (produto, item) => {
    const embalagemId = typeof item.embalagemId === 'string' ? item.embalagemId.trim() : '';
    const opcao = (0, embalagemDomain_1.findOpcaoUnidadeVenda)((0, embalagemDomain_1.buildOpcoesUnidadeVenda)(produto), embalagemId);
    if (embalagemId && opcao.embalagemId !== embalagemId) {
        return { fatorConversao: positivo(item.fatorConversao) || 1, precoProprio: 0, precoAVistaProprio: 0 };
    }
    return { fatorConversao: opcao.fatorConversao, precoProprio: opcao.precoVendaProprio, precoAVistaProprio: opcao.precoAVistaProprio };
};
/**
 * Confere o preco de cada linha contra o do sistema. As linhas sao lidas na
 * ordem: a quota da promocao vai sendo gasta pelas linhas que pagaram o preco
 * promocional, e a que passa do que sobra e' conferida pelo preco normal.
 */
const conferirPrecos = (args) => {
    const restanteDaPromocao = new Map();
    let diferencaTotalCentavos = 0;
    const itens = args.itens.map((item) => {
        const cobrado = brutoDaLinha(item.precoUnitario, item.quantidade);
        const descontoDoItem = (0, financeDomain_1.toCents)(positivo(item.desconto));
        const produto = item.id && item.id !== 'avulso' ? args.produtos[item.id] : null;
        if (!produto)
            return { precoSistema: 0, brutoCentavos: cobrado, descontoCentavos: descontoDoItem, diferencaCentavos: 0 };
        const unidade = unidadeDoItem(produto, item);
        const tabela = (0, precoVendaDomain_1.tabelaDoProduto)(produto, unidade);
        const semPromocao = (0, precoVendaDomain_1.precoAutomatico)(tabela, args.condicao).preco;
        // Embalagem com preco proprio nao entra em promocao (precoComPromocaoDomain).
        let comPromocao = tabela;
        let chaveDaQuota = '';
        const quantidadeBase = (0, embalagemDomain_1.toBaseQuantity)(item.quantidade, unidade.fatorConversao);
        if (!(unidade.precoProprio > 0) && !(unidade.precoAVistaProprio > 0)) {
            const promo = (0, promocaoDomain_1.promocaoDoProduto)(args.promocoes, item.id, { venda: positivo(produto.precoVenda), vista: positivo(produto.precoAVista) }, args.hoje);
            if (promo) {
                chaveDaQuota = `${promo.promocaoId}|${item.id}`;
                if (!restanteDaPromocao.has(chaveDaQuota)) {
                    const vendido = args.vendidoPorPromocao?.[promo.promocaoId]?.[item.id] || 0;
                    restanteDaPromocao.set(chaveDaQuota, (0, promocaoDomain_1.quantidadeLiberadaNaPromocao)(promo, vendido, 0));
                }
                const restante = restanteDaPromocao.get(chaveDaQuota);
                if (restante === null || restante === undefined || quantidadeBase <= restante + 1e-9) {
                    const fator = unidade.fatorConversao || 1;
                    comPromocao = { ...tabela, promocao: { id: promo.promocaoId, nome: promo.nome, preco: Math.round(promo.preco * fator * 100) / 100, soAVista: promo.soAVista } };
                }
            }
        }
        const automatico = (0, precoVendaDomain_1.precoAutomatico)(comPromocao, args.condicao);
        // Gasta a quota so' a linha que pagou menos que o preco normal.
        if (automatico.origem === 'promocao' && (0, financeDomain_1.toCents)(item.precoUnitario) < (0, financeDomain_1.toCents)(semPromocao)) {
            const restante = restanteDaPromocao.get(chaveDaQuota);
            if (typeof restante === 'number')
                restanteDaPromocao.set(chaveDaQuota, Math.max(0, restante - quantidadeBase));
        }
        const precoSistema = automatico.preco;
        const diferenca = precoSistema > 0 && (0, financeDomain_1.toCents)(item.precoUnitario) < (0, financeDomain_1.toCents)(precoSistema)
            ? Math.max(0, brutoDaLinha(precoSistema, item.quantidade) - cobrado)
            : 0;
        diferencaTotalCentavos += diferenca;
        return { precoSistema, brutoCentavos: cobrado + diferenca, descontoCentavos: descontoDoItem + diferenca, diferencaCentavos: diferenca };
    });
    return { itens, diferencaTotalCentavos };
};
exports.conferirPrecos = conferirPrecos;
const reais = (centavos) => `R$ ${(centavos / 100).toFixed(2).replace('.', ',')}`;
/** Explica, antes do problema do desconto, que o preco abaixo do sistema virou desconto. */
const explicacaoDaDiferenca = (item, conferido) => (conferido.diferencaCentavos > 0
    ? `${item.nome} está a ${reais((0, financeDomain_1.toCents)(item.precoUnitario))}, abaixo do preço do sistema (${reais((0, financeDomain_1.toCents)(conferido.precoSistema))}): a diferença conta como desconto. `
    : '');
exports.explicacaoDaDiferenca = explicacaoDaDiferenca;
