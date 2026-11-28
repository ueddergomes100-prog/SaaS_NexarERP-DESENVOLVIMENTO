"use strict";
/**
 * LANCAMENTOS AUTOMATICOS x PLANO DE CONTAS (28/11/2026, pedido do dono: "aqui
 * tinha que ter os ja' pre-definidos -- venda cartao, pix, dinheiro e todas as
 * formas de pagamento que a empresa usa, recebimento, pagamento, tudo 100%
 * vinculado em todas as telas do sistema que envolvem pagamento, recebimento e
 * lancamentos").
 *
 * Cada situacao em que o SISTEMA lanca dinheiro sozinho (venda em cada forma,
 * OS, juros, descontos, tarifa do banco, compra de mercadoria, frete, despesas
 * de rota...) tem um VINCULO com uma categoria do plano de contas. O padrao ja'
 * vem preenchido; o dono troca em Configuracoes Gerais > Plano de Contas >
 * Lancamentos automaticos. Toda tela que grava lancamento pergunta aqui
 * (`categoriaDoEvento`) -- nenhuma escreve o nome da categoria por conta.
 *
 * Decisoes do dono (28/11/2026):
 *  - uma categoria por forma na venda ("Venda no Pix", "Venda a Prazo"...);
 *  - titulo de venda recebido depois (boleto, a prazo) TROCA para a categoria
 *    da forma em que o cliente pagou (`categoriaNaBaixa`);
 *  - empresas que ja' usam ganham o que falta sem perder nada: o plano que as
 *    telas mostram e' o salvo + as categorias dos vinculos (`planoEfetivo`),
 *    sem precisar regravar nada no banco.
 *
 * Fora daqui, de proposito: Cancelamento de Venda/OS, Devolucao de Venda,
 * Renegociacao e "boleto pago de venda cancelada" -- o DRE usa esses nomes
 * para ABATER a receita (financeDomain: REVENUE_REVERSAL_CATEGORIES); trocar o
 * nome quebraria a conta. Aparecem na tela so' como informacao.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.situacoesDaCategoria = exports.conferirVinculos = exports.planoEfetivo = exports.categoriaNaBaixa = exports.ehCategoriaDeVenda = exports.categoriasDeVenda = exports.categoriaDaVenda = exports.categoriaDoEvento = exports.eventoDaVendaNaForma = exports.lerVinculos = exports.ehEventoFinanceiro = exports.CATEGORIA_ANTIGA_DE_VENDA = exports.CATEGORIAS_FIXAS_DO_SISTEMA = exports.ROTULO_DO_GRUPO = exports.EVENTOS_FINANCEIROS = exports.FORMAS_DO_PLANO = void 0;
/** Formas de pagamento (as mesmas de PaymentMethod em financeDomain.ts). */
exports.FORMAS_DO_PLANO = [
    'Dinheiro',
    'Pix',
    'Cartão de Crédito',
    'Cartão de Débito',
    'Transferência',
    'Boleto',
    'Cheque',
    'Pagamento a Prazo',
    'Crédito de Devolução',
    'Cashback',
    'Outros',
];
const CATEGORIA_DA_VENDA = {
    Dinheiro: 'Venda em Dinheiro',
    Pix: 'Venda no Pix',
    'Cartão de Crédito': 'Venda no Cartão de Crédito',
    'Cartão de Débito': 'Venda no Cartão de Débito',
    'Transferência': 'Venda por Transferência',
    Boleto: 'Venda no Boleto',
    Cheque: 'Venda no Cheque',
    'Pagamento a Prazo': 'Venda a Prazo',
    'Crédito de Devolução': 'Venda com Crédito de Devolução',
    Cashback: 'Venda com Cashback',
    Outros: 'Venda em Outras Formas',
};
const eventoDaVenda = (forma) => `venda:${forma}`;
/** Todas as situacoes, na ordem da tela. Nomes padrao iguais aos que o sistema ja' gravava. */
exports.EVENTOS_FINANCEIROS = [
    ...exports.FORMAS_DO_PLANO.map((forma) => ({
        evento: eventoDaVenda(forma),
        tipo: 'receita',
        rotulo: forma === 'Pagamento a Prazo' ? 'Venda a prazo' : forma === 'Outros' ? 'Venda em outras formas' : `Venda em ${forma}`,
        padrao: CATEGORIA_DA_VENDA[forma],
        grupo: 'vendas',
    })),
    { evento: 'os', tipo: 'receita', rotulo: 'Ordem de serviço', padrao: 'Serviços', grupo: 'vendas' },
    { evento: 'juros_recebidos', tipo: 'receita', rotulo: 'Juros e multa recebidos', padrao: 'Juros e multa recebidos', grupo: 'recebimentos' },
    { evento: 'descontos_concedidos', tipo: 'despesa', rotulo: 'Desconto dado na baixa', padrao: 'Descontos concedidos', grupo: 'recebimentos' },
    { evento: 'pago_a_mais', tipo: 'receita', rotulo: 'Boleto pago a mais', padrao: 'Valor pago a mais', grupo: 'recebimentos' },
    { evento: 'tarifa_bancaria', tipo: 'despesa', rotulo: 'Tarifa do banco (boleto)', padrao: 'Tarifas bancárias', grupo: 'recebimentos' },
    { evento: 'juros_pagos', tipo: 'despesa', rotulo: 'Juros e multa pagos', padrao: 'Juros e multa pagos', grupo: 'pagamentos' },
    { evento: 'descontos_obtidos', tipo: 'receita', rotulo: 'Desconto ganho no pagamento', padrao: 'Descontos obtidos', grupo: 'pagamentos' },
    { evento: 'despesas_rota', tipo: 'despesa', rotulo: 'Despesas de rota (romaneio)', padrao: 'Despesas de Rota', grupo: 'pagamentos' },
    { evento: 'compra_mercadoria', tipo: 'despesa', rotulo: 'Compra de mercadoria (nota de entrada, nota avulsa, cheque repassado)', padrao: 'Fornecedores de Peças', grupo: 'compras' },
    { evento: 'frete', tipo: 'despesa', rotulo: 'Frete da nota de entrada', padrao: 'Fretes', grupo: 'compras' },
    { evento: 'devolucao_compra', tipo: 'receita', rotulo: 'Devolução de compra ao fornecedor', padrao: 'Devolução de Compra', grupo: 'compras' },
];
exports.ROTULO_DO_GRUPO = {
    vendas: 'Vendas e serviços',
    recebimentos: 'Recebimentos',
    pagamentos: 'Pagamentos',
    compras: 'Compras',
};
/** Lancamentos que o sistema faz com nome fixo (abatem a receita no DRE). So' informacao na tela. */
exports.CATEGORIAS_FIXAS_DO_SISTEMA = [
    'Cancelamento de Venda',
    'Cancelamento de OS',
    'Devolução de Venda',
    'Renegociação',
];
/** Nome antigo de toda venda, antes das categorias por forma (o DRE e a baixa continuam reconhecendo). */
exports.CATEGORIA_ANTIGA_DE_VENDA = 'Venda de Peças';
const DEFINICAO = new Map(exports.EVENTOS_FINANCEIROS.map((d) => [d.evento, d]));
const limpar = (valor) => (typeof valor === 'string' ? valor.trim().replace(/\s+/g, ' ') : '');
const chave = (nome) => nome.toLocaleLowerCase('pt-BR');
const ehEventoFinanceiro = (valor) => typeof valor === 'string' && DEFINICAO.has(valor);
exports.ehEventoFinanceiro = ehEventoFinanceiro;
/** Le o que esta' gravado em configuracoes (campo `vinculosPlanoContas`): so' eventos conhecidos com nome. */
const lerVinculos = (valor) => {
    if (!valor || typeof valor !== 'object' || Array.isArray(valor))
        return {};
    const lidos = {};
    for (const [evento, categoria] of Object.entries(valor)) {
        const nome = limpar(categoria);
        if ((0, exports.ehEventoFinanceiro)(evento) && nome)
            lidos[evento] = nome.slice(0, 60);
    }
    return lidos;
};
exports.lerVinculos = lerVinculos;
/** Evento da venda para uma forma de pagamento; forma desconhecida cai em "Outros". */
const eventoDaVendaNaForma = (forma) => {
    const texto = limpar(forma);
    const conhecida = exports.FORMAS_DO_PLANO.find((f) => chave(f) === chave(texto));
    return eventoDaVenda(conhecida || 'Outros');
};
exports.eventoDaVendaNaForma = eventoDaVendaNaForma;
/**
 * A categoria em que o lancamento da situacao cai: o vinculo da empresa, ou o
 * padrao. `config` e' o documento `configuracoes/{filial}` (usa o campo `vinculosPlanoContas`).
 */
const categoriaDoEvento = (config, evento) => {
    const doc = (config && typeof config === 'object' ? config : {});
    const vinculos = (0, exports.lerVinculos)(doc.vinculosPlanoContas);
    return vinculos[evento] || DEFINICAO.get(evento)?.padrao || 'Outros';
};
exports.categoriaDoEvento = categoriaDoEvento;
/** Categoria da venda paga em `forma`. */
const categoriaDaVenda = (config, forma) => (0, exports.categoriaDoEvento)(config, (0, exports.eventoDaVendaNaForma)(forma));
exports.categoriaDaVenda = categoriaDaVenda;
/** Todas as categorias que valem como "venda" para esta empresa (DRE e baixa), mais o nome antigo. */
const categoriasDeVenda = (config) => {
    const nomes = exports.FORMAS_DO_PLANO.map((forma) => (0, exports.categoriaDaVenda)(config, forma));
    return [...new Set([exports.CATEGORIA_ANTIGA_DE_VENDA, ...nomes])];
};
exports.categoriasDeVenda = categoriasDeVenda;
const ehCategoriaDeVenda = (config, categoria) => {
    const nome = chave(limpar(categoria));
    return Boolean(nome) && (0, exports.categoriasDeVenda)(config).some((c) => chave(c) === nome);
};
exports.ehCategoriaDeVenda = ehCategoriaDeVenda;
/**
 * Baixa de titulo (decisao do dono, 28/11/2026): titulo de VENDA recebido numa
 * forma passa para a categoria da venda nessa forma (venda a prazo paga no Pix
 * vira "Venda no Pix"). Titulo que nao e' de venda (aluguel, servico, juros...)
 * fica com a categoria que tem. Devolve a categoria que o titulo deve ter.
 */
const categoriaNaBaixa = (config, categoriaAtual, formaPaga) => {
    const atual = limpar(categoriaAtual);
    if (!(0, exports.ehCategoriaDeVenda)(config, atual))
        return atual || null;
    if (!limpar(formaPaga))
        return atual;
    return (0, exports.categoriaDaVenda)(config, formaPaga);
};
exports.categoriaNaBaixa = categoriaNaBaixa;
/**
 * O plano que as telas mostram: o salvo mais as categorias dos vinculos que
 * faltam (cada uma na lista do tipo dela). Empresa que ja' usava o sistema
 * ganha as pre-definidas sem regravar nada; nada do que ela criou some.
 * Vendas das formas que a filial escondeu nao entram (nao vende nelas).
 */
const planoEfetivo = (config) => {
    const doc = (config && typeof config === 'object' ? config : {});
    const lista = (valor) => {
        const bruto = Array.isArray(valor) ? valor : typeof valor === 'string' ? valor.split('\n') : [];
        const vistos = new Set();
        const saida = [];
        bruto.forEach((item) => {
            const nome = limpar(item);
            if (nome && !vistos.has(chave(nome))) {
                vistos.add(chave(nome));
                saida.push(nome);
            }
        });
        return saida;
    };
    const receitas = lista(doc.planoContasReceitas);
    const despesas = lista(doc.planoContasDespesas);
    const ocultas = new Set(lista(doc.formasPagamentoOcultas).map(chave));
    const existe = new Set([...receitas, ...despesas].map(chave));
    exports.EVENTOS_FINANCEIROS.forEach((definicao) => {
        if (definicao.grupo === 'vendas' && definicao.evento.startsWith('venda:') && ocultas.has(chave(definicao.evento.slice(6))))
            return;
        const nome = (0, exports.categoriaDoEvento)(doc, definicao.evento);
        if (existe.has(chave(nome)))
            return;
        existe.add(chave(nome));
        (definicao.tipo === 'receita' ? receitas : despesas).push(nome);
    });
    return { receitas, despesas };
};
exports.planoEfetivo = planoEfetivo;
/**
 * Confere os vinculos que a tela mandou salvar contra o plano que vai ser
 * gravado: receita so' aponta para categoria que nao e' de despesa, e vice-versa.
 */
const conferirVinculos = (valor, plano) => {
    const vinculos = (0, exports.lerVinculos)(valor);
    const receitas = new Set(plano.receitas.map(chave));
    const despesas = new Set(plano.despesas.map(chave));
    for (const [evento, categoria] of Object.entries(vinculos)) {
        const definicao = DEFINICAO.get(evento);
        if (!definicao)
            continue;
        const errada = definicao.tipo === 'receita' ? despesas.has(chave(categoria)) && !receitas.has(chave(categoria)) : receitas.has(chave(categoria)) && !despesas.has(chave(categoria));
        if (errada) {
            return {
                ok: false,
                erro: `"${definicao.rotulo}" é ${definicao.tipo === 'receita' ? 'uma entrada de dinheiro' : 'uma saída de dinheiro'} e está ligada a "${categoria}", que é uma categoria de ${definicao.tipo === 'receita' ? 'despesa' : 'receita'}. Em Plano de Contas › Lançamentos automáticos, escolha uma categoria de ${definicao.tipo}.`,
            };
        }
    }
    // Grava so' o que difere do padrao (o padrao pode melhorar sem regravar a empresa).
    const soDiferentes = {};
    Object.entries(vinculos).forEach(([evento, categoria]) => {
        if (chave(categoria) !== chave(DEFINICAO.get(evento)?.padrao || ''))
            soDiferentes[evento] = categoria;
    });
    return { ok: true, vinculos: soDiferentes };
};
exports.conferirVinculos = conferirVinculos;
/** Categoria que esta' ligada a alguma situacao (nao pode ser excluida do plano sem trocar o vinculo). */
const situacoesDaCategoria = (config, categoria) => (exports.EVENTOS_FINANCEIROS
    .filter((d) => chave((0, exports.categoriaDoEvento)(config, d.evento)) === chave(categoria))
    .map((d) => d.rotulo));
exports.situacoesDaCategoria = situacoesDaCategoria;
