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
exports.embalagensComUnidadesAtuais = exports.margemSobreCusto = exports.custoDaEmbalagem = exports.unidadeDePrecoDaOpcao = exports.opcaoDoItemGravado = exports.opcaoDoItemDeOrigem = exports.opcaoNaUnidadeDoEstoque = exports.embalagemFracionaria = exports.camposDeUnidadeDoItem = exports.opcoesDeUnidadeDaTela = exports.toStockAdjustmentItems = exports.toBaseQuantity = exports.findOpcaoUnidadeVenda = exports.buildOpcoesUnidadeVenda = exports.normalizeEmbalagens = exports.formatFatorConversao = exports.DEFAULT_VENDER_POR_EMBALAGEM = void 0;
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
            precoCusto: Math.max(0, toFiniteNumber(entry.precoCusto)),
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
/**
 * As opcoes de unidade que a tela oferece: com "Vender por embalagem"
 * desligado nas Configuracoes, so' a unidade base (21/11/2026: mesma regra
 * do Pedido de Venda agora tambem no Orcamento, na OS e no app Vendas).
 */
const opcoesDeUnidadeDaTela = (produto, venderPorEmbalagem) => {
    const opcoes = (0, exports.buildOpcoesUnidadeVenda)(produto);
    return venderPorEmbalagem ? opcoes : opcoes.slice(0, 1);
};
exports.opcoesDeUnidadeDaTela = opcoesDeUnidadeDaTela;
/**
 * Campos de unidade do item lancado (venda, orcamento, OS, app). Na unidade
 * base o item nao ganha campo de embalagem nenhum -- fica igual ao que o
 * sistema sempre gravou. Na embalagem: a sigla e as casas dela, o id, o
 * fator e a quantidade ja' convertida para o estoque.
 */
const camposDeUnidadeDoItem = (opcao, quantidade) => ({
    unidadeMedidaSigla: opcao.sigla,
    unidadeMedidaCasasDecimais: opcao.casasDecimais,
    unidadeMedidaFracionado: opcao.permiteFracionado,
    ...(opcao.embalagemId
        ? { embalagemId: opcao.embalagemId, fatorConversao: opcao.fatorConversao, quantidadeBase: (0, exports.toBaseQuantity)(quantidade, opcao.fatorConversao) }
        : {}),
    ...(opcao.origem ? { embalagemDeOrigem: { ...opcao.origem } } : {}),
});
exports.camposDeUnidadeDoItem = camposDeUnidadeDoItem;
// ---------------------------------------------------------------------------
// EMBALAGEM FRACIONARIA ENTRA NA UNIDADE DO ESTOQUE (21/11/2026, pedido do
// dono: "a areia tem meio metro cadastrado; ao adicionar fica como se fosse
// 1 metro inteiro"). Embalagem MENOR que a unidade do estoque (fator < 1:
// meio metro = 0,5 M3, lata = 0,02 M3) nao e' um volume que existe sozinho
// -- e' um atalho de quantidade. O item entra na unidade do estoque: 1 meio
// metro a R$ 110 vira 0,5 M3 a R$ 220/M3 (total R$ 110), e a nota sai em M3.
// O preco da embalagem continua valendo: os precos proprios dela sao divididos
// pelo fator e viram a tabela do item (a conferencia de preco do servidor faz
// a mesma conta pelo `embalagemDeOrigem`). Embalagem de fator >= 1 (tubo, rolo,
// saco) segue como sempre: o item fica na embalagem.
// ---------------------------------------------------------------------------
/** Embalagem que e' uma fracao da unidade do estoque (fator entre 0 e 1). */
const embalagemFracionaria = (opcao) => {
    const fator = toFiniteNumber(opcao?.fatorConversao, 1);
    return Boolean(toTrimmedString(opcao?.embalagemId)) && fator > 0 && fator < 1;
};
exports.embalagemFracionaria = embalagemFracionaria;
/** Casas decimais de um numero (0,5 -> 1; 0,02 -> 2; 0,125 -> 3), ate' 6. */
const casasDoNumero = (valor) => {
    const texto = Number(valor.toFixed(BASE_QUANTITY_PRECISION)).toString();
    const ponto = texto.indexOf('.');
    return ponto < 0 ? 0 : Math.min(BASE_QUANTITY_PRECISION, texto.length - ponto - 1);
};
const precoPorUnidadeDoEstoque = (preco, fator) => (preco > 0 ? Number((preco / fator).toFixed(BASE_QUANTITY_PRECISION)) : 0);
/**
 * A opcao que a tela usa para LANCAR o item. Embalagem fracionaria vira a
 * unidade do estoque: sigla e casas do estoque (no minimo as do fator, para
 * caber 0,5), fracionado, fator 1, precos da embalagem divididos pelo fator e
 * `origem` dizendo de qual embalagem veio. Qualquer outra opcao volta igual.
 */
const opcaoNaUnidadeDoEstoque = (opcao, base) => {
    if (!(0, exports.embalagemFracionaria)(opcao))
        return opcao;
    const fator = opcao.fatorConversao;
    return {
        embalagemId: '',
        sigla: base.sigla,
        label: base.label,
        fatorConversao: 1,
        casasDecimais: Math.max(base.casasDecimais, casasDoNumero(fator)),
        permiteFracionado: true,
        precoVenda: precoPorUnidadeDoEstoque(opcao.precoVenda, fator),
        precoVendaProprio: precoPorUnidadeDoEstoque(opcao.precoVendaProprio, fator),
        precoAVistaProprio: precoPorUnidadeDoEstoque(opcao.precoAVistaProprio, fator),
        origem: { embalagemId: opcao.embalagemId, sigla: opcao.sigla, fatorConversao: fator },
    };
};
exports.opcaoNaUnidadeDoEstoque = opcaoNaUnidadeDoEstoque;
/**
 * A opcao de LANCAMENTO de um item ja' gravado que veio de embalagem
 * fracionaria (orcamento virando pedido, quantidade editada na grade). A
 * embalagem que sumiu do cadastro cai na unidade do estoque com o preco do
 * produto -- a quantidade do item ja' esta' na unidade do estoque.
 */
const opcaoDoItemDeOrigem = (produto, origem) => {
    if (!origem || typeof origem !== 'object')
        return null;
    const embalagemId = toTrimmedString(origem.embalagemId);
    if (!embalagemId)
        return null;
    const opcoes = (0, exports.buildOpcoesUnidadeVenda)(produto);
    const daEmbalagem = opcoes.find((opcao) => opcao.embalagemId === embalagemId);
    return daEmbalagem && (0, exports.embalagemFracionaria)(daEmbalagem)
        ? (0, exports.opcaoNaUnidadeDoEstoque)(daEmbalagem, opcoes[0])
        : { ...opcoes[0], permiteFracionado: true, casasDecimais: Math.max(opcoes[0].casasDecimais, 3) };
};
exports.opcaoDoItemDeOrigem = opcaoDoItemDeOrigem;
/**
 * A opcao de um item ja' gravado (orcamento virando pedido, item reaberto).
 * Diferente de findOpcaoUnidadeVenda, NAO cai na base quando a embalagem
 * sumiu: a quantidade estava em embalagem e viraria unidade base sem aviso
 * (1 rolo viraria 1 metro). Devolve null e quem chama avisa.
 */
const opcaoDoItemGravado = (produto, embalagemId) => {
    const opcoes = (0, exports.buildOpcoesUnidadeVenda)(produto);
    const alvo = toTrimmedString(embalagemId);
    if (!alvo)
        return opcoes[0];
    return opcoes.find((opcao) => opcao.embalagemId === alvo) || null;
};
exports.opcaoDoItemGravado = opcaoDoItemGravado;
/** A unidade para a tabela de preco (tabelaDoProduto / tabelaComPromocao): fator e os precos proprios da embalagem. */
const unidadeDePrecoDaOpcao = (opcao) => ({
    fatorConversao: opcao.fatorConversao,
    // Embalagem fracionaria na unidade do estoque (origem): os precos proprios ja' vem divididos pelo fator.
    precoProprio: opcao.embalagemId || opcao.origem ? Number(opcao.precoVendaProprio) || 0 : 0,
    precoAVistaProprio: opcao.embalagemId || opcao.origem ? Number(opcao.precoAVistaProprio) || 0 : 0,
});
exports.unidadeDePrecoDaOpcao = unidadeDePrecoDaOpcao;
/**
 * Custo da embalagem (21/11/2026): o proprio, quando cadastrado; senao o custo
 * do produto (unidade base) x fator. Ex.: metro a R$ 4, tubo de 6 m sem custo
 * proprio = R$ 24; com custo proprio de R$ 20, vale R$ 20.
 */
const custoDaEmbalagem = (embalagem, custoDaBase) => {
    const proprio = Math.max(0, toFiniteNumber(embalagem.precoCusto));
    if (proprio > 0)
        return proprio;
    const fator = toFiniteNumber(embalagem.fatorConversao, 1);
    return Math.round(Math.max(0, toFiniteNumber(custoDaBase)) * (fator > 0 ? fator : 1) * 100) / 100;
};
exports.custoDaEmbalagem = custoDaEmbalagem;
/** Margem sobre o custo, a mesma conta do cadastro do produto: (venda - custo) / custo. Sem custo = null. */
const margemSobreCusto = (preco, custo) => {
    const c = toFiniteNumber(custo);
    if (!(c > 0))
        return null;
    return ((toFiniteNumber(preco) - c) / c) * 100;
};
exports.margemSobreCusto = margemSobreCusto;
/**
 * Refaz a copia da unidade nas embalagens (21/11/2026). Caso real (Jomarly,
 * PREGO 10 X 10 vendido em G de 0,100 KG): a unidade G foi marcada como
 * "Fracionada" depois e a venda continuou recusando 0,5 G, porque a
 * embalagem guarda uma COPIA de "Fracionada" e das casas decimais feita ao
 * salvar o produto. `acharUnidade` diz a unidade atual de cada embalagem
 * (null = deixa como esta'). Os outros campos da embalagem ficam intactos.
 */
const embalagensComUnidadesAtuais = (embalagens, acharUnidade) => {
    if (!Array.isArray(embalagens))
        return { embalagens: [], alteradas: 0, travadas: 0 };
    let alteradas = 0;
    let travadas = 0;
    const novas = embalagens.map((raw) => {
        if (!raw || typeof raw !== 'object')
            return raw;
        const entry = raw;
        const unidade = acharUnidade({
            unidadeMedidaId: toTrimmedString(entry.unidadeMedidaId),
            unidadeMedidaSigla: toTrimmedString(entry.unidadeMedidaSigla).toUpperCase(),
        });
        if (!unidade)
            return raw;
        const fracionado = unidade.permiteFracionado === true;
        const casas = Math.max(0, Math.trunc(toFiniteNumber(unidade.casasDecimais)));
        const sigla = toTrimmedString(unidade.sigla).toUpperCase() || toTrimmedString(entry.unidadeMedidaSigla).toUpperCase() || 'UN';
        const mudou = (entry.unidadeMedidaFracionado === true) !== fracionado
            || toFiniteNumber(entry.unidadeMedidaCasasDecimais) !== casas
            || toTrimmedString(entry.unidadeMedidaSigla).toUpperCase() !== sigla;
        if (!mudou)
            return raw;
        alteradas += 1;
        // "Travada" = a unidade aceita fracao e a copia recusava (o caso da venda barrada).
        if (fracionado && entry.unidadeMedidaFracionado !== true)
            travadas += 1;
        return { ...entry, unidadeMedidaFracionado: fracionado, unidadeMedidaCasasDecimais: casas, unidadeMedidaSigla: sigla };
    });
    return { embalagens: novas, alteradas, travadas };
};
exports.embalagensComUnidadesAtuais = embalagensComUnidadesAtuais;
