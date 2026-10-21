"use strict";
/**
 * PROMOCOES (pedido do dono, 2026-10-01; modelo: tela "Promocoes" do Uniplus
 * que o Shopping Rural usava).
 *
 * Uma promocao e' um cadastro proprio: nome, periodo (ou continua), dias da
 * semana, em que formas de pagamento vale ("so a vista" ou todas), limite de
 * unidades por venda e a lista de produtos. Cada produto tem o preco
 * promocional -- fixo (R$) ou % sobre o preco atual -- e a QUOTA: quantas
 * unidades podem sair no preco promocional (vendeu a quota, acabou pra ele).
 *
 * Na venda, o item entra no preco promocional sozinho enquanto a promocao vale
 * (precoVendaDomain.precoAutomatico). Promocao "so a vista" sai do item quando
 * o pagamento vira parcelado.
 *
 * A quota e' conferida contra o que ja saiu nas vendas (pedidos nao cancelados
 * que levaram a promocao) -- a promocao nao guarda contador, entao venda
 * cancelada devolve a quota sozinha.
 *
 * Regra pura: sem tela, sem Firestore.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.conflitosDaPromocao = exports.periodosSeCruzam = exports.resumoDoPeriodo = exports.quantidadeLiberadaNaPromocao = exports.promocaoDoProduto = exports.precoBaseDaPromocao = exports.promocaoParaGravar = exports.errosDaPromocao = exports.margemDaPromocao = exports.precoPromocionalDoItem = exports.promocaoValeNoDia = exports.statusDaPromocao = exports.diaDaSemana = exports.lerPromocao = exports.DIAS_DA_SEMANA = exports.ROTULO_STATUS_PROMOCAO = void 0;
exports.ROTULO_STATUS_PROMOCAO = {
    inativa: 'Inativa',
    agendada: 'Agendada',
    vigente: 'Valendo',
    encerrada: 'Encerrada',
};
exports.DIAS_DA_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const limpar = (texto) => String(texto ?? '').replace(/\s+/g, ' ').trim();
const positivoOuNulo = (v) => {
    if (v === null || v === undefined || v === '')
        return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
};
/** Promocao lida do Firestore, completa (documento parcial nao quebra a tela). */
const lerPromocao = (dados) => ({
    nome: limpar(dados.nome),
    individual: dados.individual === true,
    dataInicio: limpar(dados.dataInicio),
    dataFim: limpar(dados.dataFim),
    continua: dados.continua === true,
    inativa: dados.inativa === true,
    diasSemana: Array.isArray(dados.diasSemana) ? dados.diasSemana.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [],
    formas: dados.formas === 'vista' ? 'vista' : 'todas',
    limitePorVenda: positivoOuNulo(dados.limitePorVenda),
    observacao: limpar(dados.observacao),
    itens: Array.isArray(dados.itens)
        ? dados.itens.filter((i) => i && i.produtoId).map((i) => ({
            produtoId: String(i.produtoId),
            codigo: limpar(i.codigo),
            nome: limpar(i.nome),
            tipo: i.tipo === 'percentual' ? 'percentual' : 'valor',
            valor: Number(i.valor) || 0,
            quota: positivoOuNulo(i.quota),
        }))
        : [],
});
exports.lerPromocao = lerPromocao;
/** Dia da semana de uma data AAAA-MM-DD (0 = domingo), sem fuso. */
const diaDaSemana = (data) => {
    const [a, m, d] = data.split('-').map(Number);
    return new Date(Date.UTC(a, (m || 1) - 1, d || 1)).getUTCDay();
};
exports.diaDaSemana = diaDaSemana;
const statusDaPromocao = (p, hoje) => {
    if (p.inativa)
        return 'inativa';
    if (p.dataInicio && hoje < p.dataInicio)
        return 'agendada';
    if (!p.continua && p.dataFim && hoje > p.dataFim)
        return 'encerrada';
    return 'vigente';
};
exports.statusDaPromocao = statusDaPromocao;
/** A promocao vale HOJE (periodo + dia da semana)? */
const promocaoValeNoDia = (p, hoje) => ((0, exports.statusDaPromocao)(p, hoje) === 'vigente' && (p.diasSemana.length === 0 || p.diasSemana.includes((0, exports.diaDaSemana)(hoje))));
exports.promocaoValeNoDia = promocaoValeNoDia;
/** Preco promocional do item sobre o preco atual (ambos por unidade base). */
const precoPromocionalDoItem = (item, precoAtual) => {
    if (item.tipo === 'percentual') {
        const pct = Math.min(100, Math.max(0, Number(item.valor) || 0));
        return Math.round(precoAtual * (100 - pct)) / 100;
    }
    return Math.max(0, Math.round((Number(item.valor) || 0) * 100) / 100);
};
exports.precoPromocionalDoItem = precoPromocionalDoItem;
/** Margem do preco promocional sobre o custo -- pra ninguem por item abaixo do custo sem ver. */
const margemDaPromocao = (precoPromocional, custo) => {
    if (!(custo > 0))
        return { lucroPercentual: null, abaixoDoCusto: false };
    return {
        lucroPercentual: Math.round(((precoPromocional - custo) / custo) * 1000) / 10,
        abaixoDoCusto: precoPromocional < custo,
    };
};
exports.margemDaPromocao = margemDaPromocao;
/** Problemas que impedem salvar (em portugues), todos de uma vez. */
const errosDaPromocao = (p, precosAtuais = {}) => {
    const erros = [];
    if (limpar(p.nome).length < 3)
        erros.push('Dê um nome à promoção (mínimo 3 letras), ex.: "SEMANA DO PET".');
    if (!p.dataInicio)
        erros.push('Informe a data de início.');
    if (!p.continua && !p.dataFim)
        erros.push('Informe a data final, ou marque "Promoção contínua" (sem data para acabar).');
    if (!p.continua && p.dataInicio && p.dataFim && p.dataFim < p.dataInicio)
        erros.push('A data final está antes da data de início.');
    if (p.itens.length === 0)
        erros.push('Coloque pelo menos um produto na promoção.');
    p.itens.forEach((i) => {
        if (i.tipo === 'percentual' && !(i.valor > 0 && i.valor < 100))
            erros.push(`${i.nome}: o desconto precisa ficar entre 0% e 100%.`);
        if (i.tipo === 'valor' && !(i.valor > 0))
            erros.push(`${i.nome}: informe o preço promocional.`);
        const atual = precosAtuais[i.produtoId];
        if (i.tipo === 'valor' && atual > 0 && i.valor >= atual)
            erros.push(`${i.nome}: o preço promocional (R$ ${i.valor.toFixed(2)}) não é menor que o preço atual (R$ ${atual.toFixed(2)}).`);
    });
    const repetidos = p.itens.filter((i, idx) => p.itens.findIndex((x) => x.produtoId === i.produtoId) !== idx);
    if (repetidos.length > 0)
        erros.push(`Produto repetido na promoção: ${repetidos.map((r) => r.nome).join(', ')}.`);
    return erros;
};
exports.errosDaPromocao = errosDaPromocao;
/** Dados para gravar, sem nenhum `undefined` (o Firestore recusa). */
const promocaoParaGravar = (p) => ({
    nome: limpar(p.nome).toUpperCase(),
    individual: p.individual,
    dataInicio: p.dataInicio,
    dataFim: p.continua ? '' : p.dataFim,
    continua: p.continua,
    inativa: p.inativa,
    diasSemana: [...new Set(p.diasSemana)].sort(),
    formas: p.formas,
    limitePorVenda: p.limitePorVenda && p.limitePorVenda > 0 ? Math.floor(p.limitePorVenda) : null,
    observacao: limpar(p.observacao),
    itens: p.itens.map((i) => ({
        produtoId: i.produtoId,
        codigo: limpar(i.codigo),
        nome: limpar(i.nome),
        tipo: i.tipo,
        valor: Math.round((Number(i.valor) || 0) * 100) / 100,
        quota: i.quota && i.quota > 0 ? i.quota : null,
    })),
});
exports.promocaoParaGravar = promocaoParaGravar;
/**
 * Sobre que preco o desconto em % incide: promocao "so a vista" desconta do
 * preco a vista (quando cadastrado); "todas as formas", do preco de venda.
 */
const precoBaseDaPromocao = (formas, precos) => (formas === 'vista' && precos.vista > 0 ? precos.vista : precos.venda);
exports.precoBaseDaPromocao = precoBaseDaPromocao;
/**
 * A promocao que vale HOJE para o produto. Com mais de uma, fica a de menor
 * preco (o cliente nunca paga mais caro por existir uma segunda promocao).
 */
const promocaoDoProduto = (promocoes, produtoId, precos, hoje) => {
    let melhor = null;
    promocoes.forEach((p) => {
        if (!(0, exports.promocaoValeNoDia)(p, hoje))
            return;
        const item = p.itens.find((i) => i.produtoId === produtoId);
        if (!item)
            return;
        const preco = (0, exports.precoPromocionalDoItem)(item, (0, exports.precoBaseDaPromocao)(p.formas, precos));
        if (!(preco > 0))
            return;
        if (!melhor || preco < melhor.preco) {
            melhor = { promocaoId: p.id, nome: p.nome, preco, soAVista: p.formas === 'vista', quota: item.quota, limitePorVenda: p.limitePorVenda };
        }
    });
    return melhor;
};
exports.promocaoDoProduto = promocaoDoProduto;
/**
 * Quantas unidades ainda podem sair na promocao nesta venda: o menor entre o
 * que sobra da quota e o limite por venda. null = sem limite.
 */
const quantidadeLiberadaNaPromocao = (promo, jaVendido, jaNestaVenda) => {
    const restanteQuota = promo.quota === null ? null : Math.max(0, promo.quota - Math.max(0, jaVendido) - Math.max(0, jaNestaVenda));
    const restanteLimite = promo.limitePorVenda === null ? null : Math.max(0, promo.limitePorVenda - Math.max(0, jaNestaVenda));
    if (restanteQuota === null)
        return restanteLimite;
    if (restanteLimite === null)
        return restanteQuota;
    return Math.min(restanteQuota, restanteLimite);
};
exports.quantidadeLiberadaNaPromocao = quantidadeLiberadaNaPromocao;
/** Texto curto do periodo: "01/10 a 15/10", "a partir de 01/10", "só qua e sáb". */
const resumoDoPeriodo = (p) => {
    const br = (d) => (d ? d.split('-').reverse().join('/') : '');
    const periodo = p.continua || !p.dataFim ? `a partir de ${br(p.dataInicio)}` : `${br(p.dataInicio)} a ${br(p.dataFim)}`;
    const dias = p.diasSemana.length > 0 && p.diasSemana.length < 7 ? ` · só ${p.diasSemana.map((d) => exports.DIAS_DA_SEMANA[d].toLowerCase()).join(', ')}` : '';
    return `${periodo}${dias}`;
};
exports.resumoDoPeriodo = resumoDoPeriodo;
// ---------------------------------------------------------------------------
// UM PRODUTO, UMA PROMOCAO POR VEZ (decisao do dono, 2026-10-01)
// ---------------------------------------------------------------------------
//
// "Se definir um item em promocao na tela individual do produto e tentar criar
// de novo na tela de promocoes, nao pode dar -- tem que falar que ele ja esta
// com promocao no cadastro dele, e vice-versa." Vale entre duas promocoes da
// tela tambem: o mesmo produto nao fica em duas promocoes no mesmo periodo.
const fimEfetivo = (p) => (p.continua || !p.dataFim ? '9999-12-31' : p.dataFim);
const periodosSeCruzam = (a, b) => (a.dataInicio || '0000-00-00') <= fimEfetivo(b) && (b.dataInicio || '0000-00-00') <= fimEfetivo(a);
exports.periodosSeCruzam = periodosSeCruzam;
/**
 * Produtos da promocao `nova` que ja estao em OUTRA promocao ativa no mesmo
 * periodo -- uma mensagem por produto, dizendo onde ele esta. Promocao
 * inativa ou ja encerrada nao conta.
 */
const conflitosDaPromocao = (nova, existentes, hoje) => {
    if (nova.inativa)
        return [];
    const mensagens = [];
    existentes.forEach((outra) => {
        if (outra.id === nova.id || outra.inativa)
            return;
        if ((0, exports.statusDaPromocao)(outra, hoje) === 'encerrada')
            return;
        if (!(0, exports.periodosSeCruzam)(nova, outra))
            return;
        nova.itens.forEach((item) => {
            if (!outra.itens.some((i) => i.produtoId === item.produtoId))
                return;
            const onde = outra.individual
                ? 'em promoção individual, no cadastro do produto'
                : `na promoção "${outra.nome}" (tela Promoções)`;
            mensagens.push(`${item.nome} já está ${onde}, ${(0, exports.resumoDoPeriodo)(outra)}. Tire de lá ou ajuste as datas antes.`);
        });
    });
    return mensagens;
};
exports.conflitosDaPromocao = conflitosDaPromocao;
