"use strict";
// Funcoes puras de Embalagem (vender o mesmo produto em KG, UN ou SC).
// Sem Firestore -- leitura/escrita fica nas telas (EstoqueForm, PedidoVendaForm,
// PDV). Ver o plano da feature para as decisoes de arquitetura.
//
// Principio central: o estoque do produto continua SEMPRE na unidade base
// (estoque/{id}.quantidade). Embalagem e uma forma de VENDER, nao um segundo
// saldo. Um saco de 20kg nao tem estoque proprio -- ele consome 20 do saldo em
// quilo. Por isso a conversao acontece so na hora de mexer no estoque
// (toStockAdjustmentItems), nunca no valor financeiro do item.
Object.defineProperty(exports, "__esModule", { value: true });
exports.toStockAdjustmentItems = exports.toBaseQuantity = exports.findOpcaoUnidadeVenda = exports.buildOpcoesUnidadeVenda = exports.normalizeEmbalagens = exports.formatFatorConversao = exports.DEFAULT_VENDER_POR_EMBALAGEM = void 0;
/** Casas decimais usadas ao converter para a unidade base. Existe so pra
 * absorver o erro de ponto flutuante de quantidade fracionada x fator (ex:
 * 0.1 * 3), nao pra limitar o que o usuario pode digitar -- esse limite e da
 * unidade de medida (casasDecimais), aplicado por isValidSaleQuantity. */
const BASE_QUANTITY_PRECISION = 6;
exports.DEFAULT_VENDER_POR_EMBALAGEM = false;
const toFiniteNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};
const toTrimmedString = (value) => (typeof value === 'string' ? value.trim() : '');
/** Formata o fator do jeito que aparece no seletor: 20 -> '20,000'. */
const formatFatorConversao = (fator) => (toFiniteNumber(fator, 1).toFixed(3).replace('.', ','));
exports.formatFatorConversao = formatFatorConversao;
/** Le o campo `embalagens` de um documento de estoque de forma defensiva.
 * O array vem do Firestore, entao pode ter sido gravado por uma versao antiga
 * do app ou por integracao externa -- qualquer entrada sem id ou com fator
 * invalido e descartada em vez de virar uma embalagem que baixa estoque errado. */
const normalizeEmbalagens = (value) => {
    if (!Array.isArray(value))
        return [];
    return value.reduce((embalagens, raw) => {
        if (!raw || typeof raw !== 'object')
            return embalagens;
        const entry = raw;
        const id = toTrimmedString(entry.id);
        const fatorConversao = toFiniteNumber(entry.fatorConversao);
        if (!id || fatorConversao <= 0)
            return embalagens;
        embalagens.push({
            id,
            unidadeMedidaId: toTrimmedString(entry.unidadeMedidaId),
            unidadeMedidaSigla: toTrimmedString(entry.unidadeMedidaSigla).toUpperCase() || 'UN',
            unidadeMedidaCasasDecimais: Math.max(0, toFiniteNumber(entry.unidadeMedidaCasasDecimais)),
            unidadeMedidaFracionado: entry.unidadeMedidaFracionado === true,
            descricao: toTrimmedString(entry.descricao),
            fatorConversao,
            precoVenda: Math.max(0, toFiniteNumber(entry.precoVenda)),
            precoAVista: Math.max(0, toFiniteNumber(entry.precoAVista)),
            codigoBarras: toTrimmedString(entry.codigoBarras),
            ativo: entry.ativo !== false,
        });
        return embalagens;
    }, []);
};
exports.normalizeEmbalagens = normalizeEmbalagens;
/** Monta as opcoes do seletor de unidade: a base primeiro, depois as
 * embalagens ativas. Produto sem embalagem devolve so a base -- que e
 * exatamente o comportamento de hoje, por isso a tela nao precisa saber se o
 * produto tem embalagem ou nao. */
const buildOpcoesUnidadeVenda = (produto) => {
    const precoBase = Math.max(0, toFiniteNumber(produto?.precoVenda));
    const base = {
        embalagemId: '',
        sigla: toTrimmedString(produto?.unidadeMedidaSigla).toUpperCase() || 'UN',
        label: toTrimmedString(produto?.unidadeMedidaSigla).toUpperCase() || 'UN',
        fatorConversao: 1,
        casasDecimais: Math.max(0, toFiniteNumber(produto?.unidadeMedidaCasasDecimais)),
        permiteFracionado: produto?.unidadeMedidaFracionado === true,
        precoVenda: precoBase,
        precoVendaProprio: 0,
        precoAVistaProprio: 0,
    };
    const embalagens = (0, exports.normalizeEmbalagens)(produto?.embalagens)
        .filter((embalagem) => embalagem.ativo)
        .map((embalagem) => ({
        embalagemId: embalagem.id,
        sigla: embalagem.unidadeMedidaSigla,
        label: `${embalagem.unidadeMedidaSigla}(${(0, exports.formatFatorConversao)(embalagem.fatorConversao)})`,
        fatorConversao: embalagem.fatorConversao,
        casasDecimais: embalagem.unidadeMedidaCasasDecimais,
        permiteFracionado: embalagem.unidadeMedidaFracionado,
        // Preco proprio quando cadastrado; senao deriva do preco base. Cadastrar
        // a embalagem sem preco nao pode zerar a venda.
        precoVenda: embalagem.precoVenda > 0
            ? embalagem.precoVenda
            : precoBase * embalagem.fatorConversao,
        precoVendaProprio: embalagem.precoVenda,
        precoAVistaProprio: embalagem.precoAVista,
    }));
    return [base, ...embalagens];
};
exports.buildOpcoesUnidadeVenda = buildOpcoesUnidadeVenda;
/** Acha a opcao escolhida; cai na base quando o id nao existe mais (embalagem
 * excluida/desativada depois que o item ja estava no carrinho). */
const findOpcaoUnidadeVenda = (opcoes, embalagemId) => {
    const alvo = toTrimmedString(embalagemId);
    if (!alvo)
        return opcoes[0];
    return opcoes.find((opcao) => opcao.embalagemId === alvo) || opcoes[0];
};
exports.findOpcaoUnidadeVenda = findOpcaoUnidadeVenda;
/** Converte a quantidade digitada (na embalagem) para a unidade base do
 * estoque. Fator ausente/invalido = 1, que preserva todo item ja gravado
 * antes desta feature. */
const toBaseQuantity = (quantidade, fatorConversao) => {
    const qtd = toFiniteNumber(quantidade);
    const fator = toFiniteNumber(fatorConversao, 1);
    const fatorValido = fator > 0 ? fator : 1;
    const base = qtd * fatorValido;
    return Number(base.toFixed(BASE_QUANTITY_PRECISION));
};
exports.toBaseQuantity = toBaseQuantity;
/** Mapeia itens de venda para o formato de applyStockAdjustments, convertendo
 * para a unidade base. Substitui os `.map(item => ({ id, nome, quantidade }))`
 * espalhados por PDV/Pedido/Devolucao -- sem ela, vender 1 saco baixaria 1 kg. */
const toStockAdjustmentItems = (itens) => (itens.map((item) => ({
    id: item.id,
    nome: item.nome,
    quantidade: (0, exports.toBaseQuantity)(item.quantidade, item.fatorConversao),
})));
exports.toStockAdjustmentItems = toStockAdjustmentItems;
