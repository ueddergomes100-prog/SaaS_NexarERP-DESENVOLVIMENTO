"use strict";
// Funcoes puras do cadastro de Unidades de Medida. Sem Firestore -- a
// leitura/escrita fica em UnidadesMedidaList.tsx.
//
// Duas responsabilidades: o catalogo padrao que todo tenant recebe, e a
// regra de quando uma unidade pode ser excluida.
Object.defineProperty(exports, "__esModule", { value: true });
exports.avisoUnidadeMedidaAusente = exports.resolverUnidadeDoCadastro = exports.temUnidadeMedidaCadastrada = exports.resolveUnidadeMedidaProduto = exports.UNIDADE_MEDIDA_FALLBACK = exports.findUnidadeEmUso = exports.isSiglaPadrao = exports.UNIDADES_MEDIDA_PADRAO = void 0;
const embalagemDomain_1 = require("./embalagemDomain");
/**
 * As 10 unidades que todo tenant recebe ja cadastradas. A lista atende os
 * tres perfis de cliente do sistema: oficina (CJ/PC pra jogo e kit de
 * pecas), distribuidora (CX/PC) e agro (SC/KG/G).
 *
 * UN, KG, LTS e MT mantem a sigla e as casas decimais que o antigo botao
 * "Carregar Padroes" ja usava -- trocar agora criaria uma segunda unidade
 * equivalente (ex: "L" ao lado de "LTS") em todo tenant que ja tinha as
 * antigas.
 */
exports.UNIDADES_MEDIDA_PADRAO = [
    { sigla: 'UN', nome: 'UNIDADE', casasDecimais: 0, permiteFracionado: false },
    { sigla: 'KG', nome: 'QUILOGRAMA', casasDecimais: 3, permiteFracionado: true },
    { sigla: 'G', nome: 'GRAMA', casasDecimais: 0, permiteFracionado: false },
    { sigla: 'LTS', nome: 'LITRO', casasDecimais: 2, permiteFracionado: true },
    { sigla: 'ML', nome: 'MILILITRO', casasDecimais: 0, permiteFracionado: false },
    { sigla: 'MT', nome: 'METRO', casasDecimais: 2, permiteFracionado: true },
    { sigla: 'CX', nome: 'CAIXA', casasDecimais: 0, permiteFracionado: false },
    { sigla: 'PC', nome: 'PACOTE', casasDecimais: 0, permiteFracionado: false },
    { sigla: 'SC', nome: 'SACO', casasDecimais: 0, permiteFracionado: false },
    { sigla: 'CJ', nome: 'CONJUNTO', casasDecimais: 0, permiteFracionado: false },
];
const normalizeSigla = (value) => String(value ?? '').trim().toUpperCase();
/** Uma unidade e' padrao pela SIGLA, nao pelo id: tenants antigos criaram
 * UN/KG/LTS/MT a mao (com ids aleatorios) antes de existir a flag isPadrao,
 * e essas tambem precisam ficar protegidas contra exclusao. */
const isSiglaPadrao = (sigla) => {
    const alvo = normalizeSigla(sigla);
    return exports.UNIDADES_MEDIDA_PADRAO.some((padrao) => padrao.sigla === alvo);
};
exports.isSiglaPadrao = isSiglaPadrao;
/**
 * Devolve o primeiro produto que usa esta unidade, ou null. Considera os
 * DOIS vinculos possiveis: a unidade principal do produto e a unidade de
 * qualquer embalagem cadastrada nele.
 *
 * Existe porque excluir uma unidade em uso deixa todo produto que a
 * referenciava orfao -- ele passa a cair no fallback 'UN'/0 casas, o que
 * silenciosamente quebra a venda fracionada de um produto vendido em quilo.
 */
const findUnidadeEmUso = (unidadeId, produtos) => {
    const alvo = String(unidadeId ?? '').trim();
    if (!alvo)
        return null;
    for (const produto of produtos) {
        const nome = produto.nome || 'produto sem nome';
        if (String(produto.unidadeMedidaId ?? '').trim() === alvo) {
            return { produtoNome: nome, origem: 'base' };
        }
        const usaEmEmbalagem = (0, embalagemDomain_1.normalizeEmbalagens)(produto.embalagens)
            .some((embalagem) => embalagem.unidadeMedidaId === alvo);
        if (usaEmEmbalagem) {
            return { produtoNome: nome, origem: 'embalagem' };
        }
    }
    return null;
};
exports.findUnidadeEmUso = findUnidadeEmUso;
/** Unidade atribuida a produto sem cadastro de unidade. Mesmos valores que
 * EstoqueForm.tsx grava quando nenhuma unidade e' selecionada. */
exports.UNIDADE_MEDIDA_FALLBACK = {
    unidadeMedidaSigla: 'UN',
    unidadeMedidaFracionado: false,
    unidadeMedidaCasasDecimais: 0,
};
/**
 * Le os tres campos de unidade de um produto/item e devolve todos preenchidos,
 * caindo em UNIDADE_MEDIDA_FALLBACK ('UN') no que faltar. Sempre devolve os
 * tres com valor concreto -- nunca `undefined`, que o Firestore recusa.
 *
 * Usar em TODO ponto onde produto do estoque vira item de venda/OS/orcamento
 * (leitura do catalogo e carga de documento antigo), pra que o item ja nasca
 * completo em vez de cada tela tratar o buraco do seu jeito.
 *
 * `fracionado` so fica true quando o cadastro diz explicitamente `true`:
 * campo ausente significa "nao fracionavel", mesma leitura que
 * isValidSaleQuantity() ja faz em saleQuantity.ts.
 */
const resolveUnidadeMedidaProduto = (fonte) => {
    const sigla = normalizeSigla(fonte?.unidadeMedidaSigla);
    const casasDecimais = Number(fonte?.unidadeMedidaCasasDecimais);
    return {
        unidadeMedidaSigla: sigla || exports.UNIDADE_MEDIDA_FALLBACK.unidadeMedidaSigla,
        unidadeMedidaFracionado: fonte?.unidadeMedidaFracionado === true,
        unidadeMedidaCasasDecimais: Number.isFinite(casasDecimais) && casasDecimais > 0
            ? casasDecimais
            : exports.UNIDADE_MEDIDA_FALLBACK.unidadeMedidaCasasDecimais,
    };
};
exports.resolveUnidadeMedidaProduto = resolveUnidadeMedidaProduto;
/**
 * True quando o produto TEM unidade de medida cadastrada de verdade.
 *
 * Existe pra separar as duas situacoes que resolveUnidadeMedidaProduto()
 * trata igual: produto cadastrado como 'UN' de propósito e produto que caiu
 * em 'UN' por falta de cadastro. A tela usa isso pra avisar o usuario --
 * em portugues, na hora -- que aquele item entrou com a unidade padrao e o
 * cadastro dele precisa ser corrigido no Estoque.
 *
 * So a sigla decide. Um produto com sigla mas sem casasDecimais/fracionado
 * (cadastro parcial de versao antiga) conta como cadastrado: os outros dois
 * campos tem padrao natural (0 casas, nao fracionavel) e nao mudam o que o
 * usuario ve na tela nem o que sai na nota.
 */
const temUnidadeMedidaCadastrada = (fonte) => normalizeSigla(fonte?.unidadeMedidaSigla).length > 0;
exports.temUnidadeMedidaCadastrada = temUnidadeMedidaCadastrada;
/**
 * Qual opcao do seletor "Unidade de medida" o cadastro do produto deve mostrar
 * marcada. Devolve o id de uma unidade QUE EXISTE na lista, ou '' (nenhuma
 * escolhida -- a tela mostra "Selecione...").
 *
 * Por que existe (2026-10-02): o produto novo comecava com o id fixo 'un',
 * que so' existe na lista de reserva. Com as unidades da empresa carregadas,
 * nenhuma opcao batia, o navegador mostrava a PRIMEIRA da lista (ex.: KG) e
 * o save gravava UN. Quem nao mexia no campo cadastrava em UN achando que
 * era KG.
 *
 * Ordem: o id gravado; senao a sigla gravada (cadastro antigo, unidade
 * recriada com outro id); senao ''. Produto novo passa sigla 'UN', o padrao
 * documentado (UNIDADE_MEDIDA_FALLBACK).
 */
const resolverUnidadeDoCadastro = (unidades, idSalvo, siglaSalva) => {
    const id = typeof idSalvo === 'string' ? idSalvo.trim() : '';
    if (id && unidades.some((u) => u.id === id))
        return id;
    const sigla = normalizeSigla(siglaSalva);
    if (!sigla)
        return '';
    return unidades.find((u) => normalizeSigla(u.sigla) === sigla)?.id || '';
};
exports.resolverUnidadeDoCadastro = resolverUnidadeDoCadastro;
/** Texto unico do aviso de unidade ausente, pra mensagem nao divergir entre
 * OS, Orcamento e demais telas que vendem produto. */
const avisoUnidadeMedidaAusente = (nomeProduto) => ({
    title: `"${nomeProduto}" está sem unidade de medida`,
    text: `Esta peça não tem unidade de medida cadastrada. Ela entrou como ${exports.UNIDADE_MEDIDA_FALLBACK.unidadeMedidaSigla} (unidade, sem venda fracionada). Para corrigir, edite o produto em Estoque e informe a unidade certa.`,
});
exports.avisoUnidadeMedidaAusente = avisoUnidadeMedidaAusente;
