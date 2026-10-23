"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.simularProduto = exports.lucroReal = exports.precoSebrae = exports.margemDoProduto = exports.resumirCustos = exports.situacaoDoBem = exports.depreciacaoNoMesCentavos = exports.periodoDosMeses = exports.mesesFechados = exports.lerConfigCustos = exports.CONFIG_CUSTOS_PADRAO = exports.LIMITE_DE_AJUSTES = exports.LIMITE_DE_BENS = exports.MESES_DA_MEDIA = exports.PERMISSAO_CUSTOS = void 0;
const financeDomain_1 = require("./financeDomain");
/*
 * CUSTOS E FORMACAO DE PRECO (item 6 da lista do dono, 23/10/2026).
 *
 * Decisoes do dono (caixinhas de 23/10):
 *  - Despesa fixa do mes = MEDIA dos ultimos 3 meses fechados do Contas a
 *    Pagar (so' as categorias marcadas como fixas, so' o que foi PAGO) +
 *    linhas lancadas a mao + DEPRECIACAO mensal dos bens.
 *  - Rateio como % do faturamento (metodo do Sebrae): despesa fixa / faturamento
 *    medio dos mesmos 3 meses (a mesma conta de receita do Dashboard).
 *  - Bens com depreciacao LINEAR: (valor - residual) / (vida util em meses),
 *    enquanto estiver dentro da vida util.
 *  - Imposto: aliquota efetiva digitada pelo empresario (o contador informa).
 *  - Margem: do produto, senao do grupo, senao a padrao da empresa.
 *  - Simulacao por produto: preco sugerido pelo Sebrae x preco atual e o
 *    lucro real do preco atual. NUNCA muda preco sozinho (regra de 08/09).
 *
 * Formula do Sebrae (markup divisor):
 *   preco = custo / (1 - (rateio% + imposto% + comissao% + taxas% + margem%) / 100)
 *
 * Puro: usado pela tela e pelo servidor (server/domain).
 */
exports.PERMISSAO_CUSTOS = 'financeiro.custos';
exports.MESES_DA_MEDIA = 3;
exports.LIMITE_DE_BENS = 300;
exports.LIMITE_DE_AJUSTES = 100;
exports.CONFIG_CUSTOS_PADRAO = {
    categoriasFixas: [],
    ajustes: [],
    bens: [],
    impostoPercentual: 0,
    comissaoPercentual: 0,
    taxasPercentual: 0,
    margemPadrao: 20,
    margensPorGrupo: {},
    margensPorProduto: {},
    faturamentoManualCentavos: null,
};
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const texto = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const numero = (v) => {
    const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
    return Number.isFinite(n) ? n : Number.NaN;
};
const percentual = (v) => {
    const n = numero(v);
    return Number.isFinite(n) ? Math.round(Math.min(100, Math.max(0, n)) * 100) / 100 : 0;
};
const centavos = (v) => {
    const n = numero(v);
    return Number.isFinite(n) ? Math.round(n) : 0;
};
const lerMapaDePercentuais = (v, chaveValida) => {
    const o = (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
    const saida = {};
    Object.entries(o).slice(0, 5000).forEach(([k, valor]) => {
        const chave = texto(k, 120);
        const n = numero(valor);
        if (chave && chaveValida(chave) && Number.isFinite(n) && n >= 0)
            saida[chave] = percentual(n);
    });
    return saida;
};
/** Le a configuracao (do banco ou do corpo da tela). Devolve o primeiro erro, em portugues. */
const lerConfigCustos = (corpo) => {
    const c = (corpo && typeof corpo === 'object' ? corpo : {});
    const categoriasFixas = [...new Set((Array.isArray(c.categoriasFixas) ? c.categoriasFixas : []).map((x) => texto(x, 120)).filter(Boolean))].slice(0, 300);
    const ajustesBrutos = Array.isArray(c.ajustes) ? c.ajustes : [];
    if (ajustesBrutos.length > exports.LIMITE_DE_AJUSTES)
        return { erro: `No máximo ${exports.LIMITE_DE_AJUSTES} linhas de despesa à mão.` };
    const ajustes = [];
    for (const bruto of ajustesBrutos) {
        const a = (bruto && typeof bruto === 'object' ? bruto : {});
        const descricao = texto(a.descricao, 120);
        const valor = centavos(a.valorCentavos);
        if (!descricao && !valor)
            continue;
        if (!descricao)
            return { erro: 'Dê um nome a cada despesa lançada à mão (ex.: "Pró-labore").' };
        ajustes.push({ descricao, valorCentavos: valor });
    }
    const bensBrutos = Array.isArray(c.bens) ? c.bens : [];
    if (bensBrutos.length > exports.LIMITE_DE_BENS)
        return { erro: `No máximo ${exports.LIMITE_DE_BENS} bens.` };
    const bens = [];
    for (const bruto of bensBrutos) {
        const b = (bruto && typeof bruto === 'object' ? bruto : {});
        const nome = texto(b.nome, 120);
        if (!nome)
            return { erro: 'Dê um nome a cada bem (ex.: "Caminhão baú").' };
        const valorCentavos = centavos(b.valorCentavos);
        const residualCentavos = centavos(b.residualCentavos);
        const vidaUtilAnos = numero(b.vidaUtilAnos);
        const dataCompra = String(b.dataCompra ?? '');
        if (!(valorCentavos > 0))
            return { erro: `${nome}: informe o valor do bem.` };
        if (!DATA.test(dataCompra))
            return { erro: `${nome}: informe a data de compra.` };
        if (!(vidaUtilAnos > 0 && vidaUtilAnos <= 100))
            return { erro: `${nome}: informe a vida útil em anos (ex.: veículo 5, máquina 10, móveis 10, computador 5).` };
        if (residualCentavos < 0 || residualCentavos >= valorCentavos)
            return { erro: `${nome}: o valor residual tem que ser menor que o valor do bem.` };
        const id = ID.test(String(b.id ?? '')) ? String(b.id) : `bem-${bens.length + 1}`;
        bens.push({ id, nome, valorCentavos, dataCompra, vidaUtilAnos: Math.round(vidaUtilAnos * 100) / 100, residualCentavos, ativo: b.ativo !== false });
    }
    const faturamentoManual = c.faturamentoManualCentavos === null || c.faturamentoManualCentavos === undefined || c.faturamentoManualCentavos === ''
        ? null
        : centavos(c.faturamentoManualCentavos);
    const config = {
        categoriasFixas,
        ajustes,
        bens,
        impostoPercentual: percentual(c.impostoPercentual),
        comissaoPercentual: percentual(c.comissaoPercentual),
        taxasPercentual: percentual(c.taxasPercentual),
        margemPadrao: c.margemPadrao === undefined ? exports.CONFIG_CUSTOS_PADRAO.margemPadrao : percentual(c.margemPadrao),
        margensPorGrupo: lerMapaDePercentuais(c.margensPorGrupo, () => true),
        margensPorProduto: lerMapaDePercentuais(c.margensPorProduto, (k) => ID.test(k)),
        faturamentoManualCentavos: faturamentoManual !== null && faturamentoManual > 0 ? faturamentoManual : null,
    };
    return { config };
};
exports.lerConfigCustos = lerConfigCustos;
// ---------------------------------------------------------------------------
// Meses e depreciacao
// ---------------------------------------------------------------------------
/** Os N meses FECHADOS antes do mes de hoje ("aaaa-mm"), do mais antigo ao mais novo. */
const mesesFechados = (hoje, quantidade = exports.MESES_DA_MEDIA) => {
    const [a, m] = hoje.split('-').map(Number);
    const meses = [];
    for (let i = quantidade; i >= 1; i -= 1) {
        const total = a * 12 + (m - 1) - i;
        meses.push(`${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`);
    }
    return meses;
};
exports.mesesFechados = mesesFechados;
/** Primeiro e ultimo dia do periodo dos meses ("aaaa-mm-dd"). */
const periodoDosMeses = (meses) => {
    const ultimo = meses[meses.length - 1];
    const [a, m] = ultimo.split('-').map(Number);
    const dias = new Date(Date.UTC(a, m, 0)).getUTCDate();
    return { de: `${meses[0]}-01`, ate: `${ultimo}-${String(dias).padStart(2, '0')}` };
};
exports.periodoDosMeses = periodoDosMeses;
const indiceDoMes = (aaaaMm) => {
    const [a, m] = aaaaMm.split('-').map(Number);
    return a * 12 + (m - 1);
};
/**
 * Depreciacao linear do bem no mes ("aaaa-mm"), em centavos. Comeca no mes
 * seguinte ao da compra e vai ate' completar a vida util; fora disso, zero.
 */
const depreciacaoNoMesCentavos = (bem, mes) => {
    if (!bem.ativo)
        return 0;
    const meses = Math.round(bem.vidaUtilAnos * 12);
    if (!(meses > 0))
        return 0;
    const decorridos = indiceDoMes(mes) - indiceDoMes(bem.dataCompra.slice(0, 7));
    if (decorridos < 1 || decorridos > meses)
        return 0;
    return Math.round((bem.valorCentavos - bem.residualCentavos) / meses);
};
exports.depreciacaoNoMesCentavos = depreciacaoNoMesCentavos;
/** Quanto o bem ja' depreciou ate' o mes (inclusive) e o valor que sobra nos livros. */
const situacaoDoBem = (bem, mes) => {
    const meses = Math.round(bem.vidaUtilAnos * 12);
    const decorridos = Math.max(0, Math.min(meses, indiceDoMes(mes) - indiceDoMes(bem.dataCompra.slice(0, 7))));
    const mensal = meses > 0 ? (bem.valorCentavos - bem.residualCentavos) / meses : 0;
    const depreciadoCentavos = Math.round(mensal * decorridos);
    return { depreciadoCentavos, valorAtualCentavos: bem.valorCentavos - depreciadoCentavos, mesesRestantes: Math.max(0, meses - decorridos) };
};
exports.situacaoDoBem = situacaoDoBem;
const mesDoLancamento = (t) => String(t.dataPagamento || t.data || '').slice(0, 7);
/**
 * Junta os lancamentos PAGOS dos meses (despesas e receitas) com a
 * configuracao. A receita e' a mesma conta do Dashboard (receitaDoConjunto).
 */
const resumirCustos = (lancamentos, config, meses) => {
    const fixas = new Set(config.categoriasFixas.map((c) => c.toUpperCase()));
    const despesaPorMes = Object.fromEntries(meses.map((m) => [m, 0]));
    const faturamentoPorMes = Object.fromEntries(meses.map((m) => [m, 0]));
    // Categoria sem diferenciar maiusculas ("Aluguel" do plano = "ALUGUEL" digitado no lancamento).
    const porCategoria = new Map();
    const porMes = new Map(meses.map((m) => [m, []]));
    lancamentos.forEach((t) => {
        const mes = mesDoLancamento(t);
        if (!porMes.has(mes))
            return;
        porMes.get(mes).push(t);
        if (t.tipo !== 'saida' || t.status !== 'Paga' || (0, financeDomain_1.lancamentoDesfeito)(t))
            return;
        const categoria = String(t.categoria || '').trim() || 'Sem categoria';
        if (['Cancelamento de OS', 'Cancelamento de Venda', 'Devolução de Venda'].includes(categoria))
            return;
        const valor = (0, financeDomain_1.transactionNetCents)(t);
        const chave = categoria.toUpperCase();
        const atual = porCategoria.get(chave);
        porCategoria.set(chave, { nome: atual ? atual.nome : categoria, total: (atual ? atual.total : 0) + valor });
        if (fixas.has(categoria.toUpperCase()))
            despesaPorMes[mes] += valor;
    });
    porMes.forEach((lista, mes) => { faturamentoPorMes[mes] = (0, financeDomain_1.receitaDoConjuntoCentavos)(lista); });
    const n = Math.max(1, meses.length);
    const media = (r) => Math.round(Object.values(r).reduce((s, v) => s + v, 0) / n);
    const mediaDespesaFixaCentavos = media(despesaPorMes);
    const ajustesCentavos = config.ajustes.reduce((s, a) => s + a.valorCentavos, 0);
    const mesAtualDaConta = meses[meses.length - 1];
    const depreciacaoMensalCentavos = config.bens.reduce((s, b) => s + (0, exports.depreciacaoNoMesCentavos)(b, mesAtualDaConta), 0);
    const despesaFixaMensalCentavos = Math.max(0, mediaDespesaFixaCentavos + ajustesCentavos + depreciacaoMensalCentavos);
    const faturamentoMedioCalculadoCentavos = media(faturamentoPorMes);
    const faturamentoMedioCentavos = config.faturamentoManualCentavos ?? faturamentoMedioCalculadoCentavos;
    const rateioPercentual = faturamentoMedioCentavos > 0 ? Math.round((despesaFixaMensalCentavos / faturamentoMedioCentavos) * 10000) / 100 : null;
    const variaveis = config.impostoPercentual + config.comissaoPercentual + config.taxasPercentual;
    return {
        meses,
        despesaPorMes,
        categorias: [...porCategoria.entries()]
            .map(([chave, c]) => ({ categoria: c.nome, mediaCentavos: Math.round(c.total / n), fixa: fixas.has(chave) }))
            .sort((a, b) => b.mediaCentavos - a.mediaCentavos),
        mediaDespesaFixaCentavos,
        ajustesCentavos,
        depreciacaoMensalCentavos,
        despesaFixaMensalCentavos,
        faturamentoPorMes,
        faturamentoMedioCalculadoCentavos,
        faturamentoMedioCentavos,
        rateioPercentual,
        pontoDeEquilibrioCentavos: variaveis < 100 ? Math.round(despesaFixaMensalCentavos / (1 - variaveis / 100)) : null,
    };
};
exports.resumirCustos = resumirCustos;
// ---------------------------------------------------------------------------
// Formacao de preco por produto
// ---------------------------------------------------------------------------
/** Margem desejada do produto: a dele, senao a do grupo, senao a padrao. */
const margemDoProduto = (config, produtoId, grupo) => {
    if (config.margensPorProduto[produtoId] !== undefined)
        return { margem: config.margensPorProduto[produtoId], origem: 'produto' };
    const g = String(grupo || '').trim().toUpperCase();
    const doGrupo = Object.entries(config.margensPorGrupo).find(([k]) => k.toUpperCase() === g);
    if (g && doGrupo)
        return { margem: doGrupo[1], origem: 'grupo' };
    return { margem: config.margemPadrao, origem: 'padrao' };
};
exports.margemDoProduto = margemDoProduto;
/** Preco pelo Sebrae (markup divisor). Erro quando os % somam 100 ou mais. */
const precoSebrae = (custo, p, margem) => {
    const soma = p.rateio + p.imposto + p.comissao + p.taxas + margem;
    if (soma >= 100)
        return { erro: `Despesas, impostos, comissão, taxas e margem somam ${soma.toFixed(1).replace('.', ',')}%: não há preço que cubra. Diminua a margem ou revise os percentuais.` };
    if (!(custo > 0))
        return { erro: 'Produto sem custo no cadastro.' };
    return { preco: Math.round((custo / (1 - soma / 100)) * 100) / 100 };
};
exports.precoSebrae = precoSebrae;
/** Quanto sobra de verdade numa venda pelo preco atual. */
const lucroReal = (preco, custo, p) => {
    if (!(preco > 0))
        return { lucro: 0, margemReal: 0 };
    const despesas = preco * (p.rateio + p.imposto + p.comissao + p.taxas) / 100;
    const lucro = Math.round((preco - custo - despesas) * 100) / 100;
    return { lucro, margemReal: Math.round((lucro / preco) * 10000) / 100 };
};
exports.lucroReal = lucroReal;
const simularProduto = (produto, config, rateioPercentual) => {
    const p = {
        rateio: rateioPercentual,
        imposto: config.impostoPercentual,
        comissao: produto.comissaoPercentual !== null && produto.comissaoPercentual !== undefined && produto.comissaoPercentual >= 0 ? produto.comissaoPercentual : config.comissaoPercentual,
        taxas: config.taxasPercentual,
    };
    const { margem, origem } = (0, exports.margemDoProduto)(config, produto.id, produto.grupo);
    const sugerido = (0, exports.precoSebrae)(produto.custo, p, margem);
    const real = (0, exports.lucroReal)(produto.preco, produto.custo, p);
    const precoSugerido = 'preco' in sugerido ? sugerido.preco : null;
    return {
        id: produto.id,
        nome: produto.nome,
        codigo: produto.codigo,
        grupo: produto.grupo,
        custo: produto.custo,
        precoAtual: produto.preco,
        margem,
        origemMargem: origem,
        precoSugerido,
        diferencaPercentual: precoSugerido && produto.preco > 0 ? Math.round(((produto.preco - precoSugerido) / precoSugerido) * 10000) / 100 : null,
        lucroAtual: real.lucro,
        margemRealAtual: real.margemReal,
        problema: 'erro' in sugerido ? sugerido.erro : '',
    };
};
exports.simularProduto = simularProduto;
