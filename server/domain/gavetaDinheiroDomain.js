"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.avisoDaAbertura = exports.aberturaConfereComAGaveta = exports.tituloAteODia = exports.diasParaFechar = exports.DIAS_PARA_FECHAR_ATRASADO = exports.planejarAcerto = exports.lerPedidoDeAcerto = exports.lerPedidoDeCofreNoFechamento = exports.erroDoTroco = exports.saldoNoFimDoDia = exports.composicaoDaSessao = exports.comporPorDia = exports.inicioDaComposicao = exports.DIAS_DA_COMPOSICAO = exports.resultadoDaContagem = exports.esperadoNoFechamento = exports.saldoDosMovimentos = exports.movimentoNoPeriodo = exports.movimentosDaSessao = exports.movimentoDoTitulo = exports.ROTULO_MOVIMENTO_GAVETA = exports.ehACaixaGaveta = exports.montarConfigGaveta = exports.lerConfigGaveta = exports.CAMPO_CONFIG_GAVETA = void 0;
/**
 * DINHEIRO DAS VENDAS NA GAVETA (pedido do dono, 23/11/2026, Embala Minas).
 *
 * Ate' aqui o CAIXA de Financeiro > Caixas e Transferencias so' somava saldo
 * inicial, transferencias e lancamentos a mao (decisao de 21/10): a venda em
 * dinheiro ficava so' no Fluxo de Caixa. O dono pediu a ligacao, com uma
 * chave por empresa:
 *
 *   "todas as vendas em dinheiro tem que contabilizar na gaveta da frente de
 *    caixa, e naquele extrato; na hora do fechamento tem que puxar tudo que
 *    e' dinheiro certinho para ele poder transferir para o cofre".
 *
 * Com a chave LIGADA (Configuracoes Gerais), o saldo e o extrato do CAIXA
 * passam a ser:
 *
 *   lancamentos do proprio caixa (saldo inicial, transferencias, a mao)
 *   + todo titulo PAGO EM DINHEIRO a partir da data em que a chave foi ligada
 *     (venda do PDV, pedido de venda, OS, conta recebida, conta paga, devolucao,
 *     lancamento do Fluxo de Caixa) -- e' o mesmo conjunto que o Fluxo de Caixa
 *     ja' mostra como caixa fisico
 *   - sangrias do PDV
 *   +- diferenca do fechamento do PDV (sobra/falta), quando o fechamento foi
 *     conferido contra a gaveta
 *
 * Nada e' gravado a mais na venda: o servidor MONTA a partir dos documentos
 * (como a Movimentacao de Produtos). Assim nenhum caminho de dinheiro fica de
 * fora -- sao mais de trinta pontos que gravam titulo em dinheiro.
 *
 * FECHAMENTO: com a chave ligada e um caixa so' aberto, o "saldo esperado" do
 * fechamento do PDV e' o saldo da gaveta (tudo que entrou e saiu em dinheiro,
 * no PDV ou fora dele). A diferenca contada vira sobra/falta no extrato, e o
 * saldo da gaveta passa a ser o dinheiro contado -- pronto para transferir ao
 * cofre. Com mais de um caixa aberto ao mesmo tempo nao da' para saber em qual
 * gaveta cada dinheiro esta': o fechamento segue a conta de sempre, por sessao,
 * e a diferenca fica so' na sessao.
 *
 * Regra pura: sem tela, sem Firestore. Compilada para o servidor.
 */
const dateTime_1 = require("./dateTime");
const financeDomain_1 = require("./financeDomain");
const contasDinheiroDomain_1 = require("./contasDinheiroDomain");
/** Campo em `configuracoes/{empresa}`. */
exports.CAMPO_CONFIG_GAVETA = 'gavetaDinheiro';
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
/** Le o campo da configuracao. Sem data valida, a chave vale como desligada. */
const lerConfigGaveta = (configuracao) => {
    const doc = (configuracao && typeof configuracao === 'object' ? configuracao : {});
    const campo = (doc[exports.CAMPO_CONFIG_GAVETA] && typeof doc[exports.CAMPO_CONFIG_GAVETA] === 'object' ? doc[exports.CAMPO_CONFIG_GAVETA] : {});
    const desde = typeof campo.desde === 'string' && DATA_ISO.test(campo.desde) ? campo.desde : '';
    return { ativo: campo.ativo === true && Boolean(desde), desde };
};
exports.lerConfigGaveta = lerConfigGaveta;
/**
 * O que gravar ao ligar/desligar. A data nasce no primeiro "ligar" e nunca
 * mais muda: desligar e ligar de novo nao apaga nem repete o que ja' contou.
 */
const montarConfigGaveta = (ligar, anterior, hoje) => ({
    ativo: ligar,
    desde: anterior.desde || (ligar ? hoje : ''),
});
exports.montarConfigGaveta = montarConfigGaveta;
/** A gaveta e' o CAIXA que o sistema cria sozinho (o primeiro dos padroes). */
const ehACaixaGaveta = (caixa) => (caixa.padrao === true && caixa.ativo !== false && String(caixa.nome || '') === contasDinheiroDomain_1.CAIXAS_PADRAO[0].nome);
exports.ehACaixaGaveta = ehACaixaGaveta;
exports.ROTULO_MOVIMENTO_GAVETA = {
    dinheiro_entrada: 'Dinheiro recebido',
    dinheiro_saida: 'Dinheiro pago',
    sangria_pdv: 'Sangria do PDV',
    diferenca_fechamento: 'Diferença no fechamento',
    diferenca_abertura: 'Diferença na abertura',
};
const dataIso = (v) => (typeof v === 'string' && DATA_ISO.test(v.slice(0, 10)) ? v.slice(0, 10) : '');
const inteiro = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : 0;
};
/**
 * Titulo pago em dinheiro vira movimento da gaveta; o resto devolve null.
 * A venda cancelada continua "Paga" e ganha um titulo de saida (estorno): os
 * dois entram e se anulam, como no Fluxo de Caixa.
 */
const movimentoDoTitulo = (id, t, criadoEmIso = '') => {
    if (t.status !== 'Paga')
        return null;
    if (t.tipo !== 'entrada' && t.tipo !== 'saida')
        return null;
    if (!(0, financeDomain_1.transactionMovesPhysicalCash)(t))
        return null;
    const valorCentavos = t.valorCentavos !== undefined && t.valorCentavos !== null && Number.isFinite(Number(t.valorCentavos))
        ? inteiro(t.valorCentavos)
        : (0, financeDomain_1.toCents)(Number(t.valor || 0));
    if (valorCentavos <= 0)
        return null;
    const data = dataIso(t.dataPagamento) || dataIso(t.data);
    if (!data)
        return null;
    const entrada = t.tipo === 'entrada';
    const clienteNome = String(t.clienteNome || '').trim();
    return {
        id: `titulo:${id}`,
        tipo: entrada ? 'dinheiro_entrada' : 'dinheiro_saida',
        direcao: entrada ? 'credito' : 'debito',
        valorCentavos,
        descricao: String(t.descricao || (entrada ? 'Recebimento em dinheiro' : 'Pagamento em dinheiro')),
        data,
        criadoEmIso,
        ...(clienteNome ? { clienteNome } : {}),
    };
};
exports.movimentoDoTitulo = movimentoDoTitulo;
const nomeDoCaixaDaSessao = (s) => ([String(s.terminalNome || '').trim(), String(s.operadorNome || '').trim()].filter(Boolean).join(' — '));
/**
 * Sangrias (sempre saem da gaveta) e a diferenca do fechamento (so' quando o
 * fechamento foi conferido contra a gaveta).
 */
const movimentosDaSessao = (id, s) => {
    const movimentos = [];
    const caixa = nomeDoCaixaDaSessao(s);
    const sufixo = caixa ? ` (${caixa})` : '';
    const naAbertura = inteiro(s.diferencaAberturaCentavos);
    if (s.aberturaPelaGaveta === true && naAbertura !== 0 && s.abertoEm instanceof Date && !Number.isNaN(s.abertoEm.getTime())) {
        movimentos.push({
            id: `abertura:${id}`,
            tipo: 'diferenca_abertura',
            direcao: naAbertura > 0 ? 'credito' : 'debito',
            valorCentavos: Math.abs(naAbertura),
            descricao: `${naAbertura > 0 ? 'Sobra' : 'Falta'} na abertura do caixa${sufixo}`,
            data: (0, dateTime_1.getDateInputInTimeZone)(s.abertoEm),
            criadoEmIso: s.abertoEm.toISOString(),
        });
    }
    (Array.isArray(s.sangrias) ? s.sangrias : []).forEach((bruta, indice) => {
        const g = (bruta && typeof bruta === 'object' ? bruta : {});
        const valorCentavos = inteiro(g.valorCentavos);
        const registradoEm = typeof g.registradoEm === 'string' ? new Date(g.registradoEm) : null;
        if (valorCentavos <= 0 || !registradoEm || Number.isNaN(registradoEm.getTime()))
            return;
        const motivo = String(g.motivo || '').trim();
        movimentos.push({
            id: `sangria:${id}:${String(g.id || indice)}`,
            tipo: 'sangria_pdv',
            direcao: 'debito',
            valorCentavos,
            descricao: `Sangria do PDV${motivo ? `: ${motivo}` : ''}${sufixo}`,
            data: (0, dateTime_1.getDateInputInTimeZone)(registradoEm),
            criadoEmIso: registradoEm.toISOString(),
        });
    });
    const diferenca = inteiro(s.diferencaCentavos);
    if (s.status === 'fechado' && s.fechamentoPelaGaveta === true && diferenca !== 0 && s.fechadoEm instanceof Date && !Number.isNaN(s.fechadoEm.getTime())) {
        movimentos.push({
            id: `fechamento:${id}`,
            tipo: 'diferenca_fechamento',
            direcao: diferenca > 0 ? 'credito' : 'debito',
            valorCentavos: Math.abs(diferenca),
            descricao: `${diferenca > 0 ? 'Sobra' : 'Falta'} no fechamento do caixa${sufixo}`,
            data: (0, dateTime_1.getDateInputInTimeZone)(s.fechadoEm),
            criadoEmIso: s.fechadoEm.toISOString(),
        });
    }
    return movimentos;
};
exports.movimentosDaSessao = movimentosDaSessao;
/** Dentro de [de, ate] (yyyy-mm-dd; vazio = sem limite daquele lado). */
const movimentoNoPeriodo = (m, de, ate = '') => ((!de || m.data >= de) && (!ate || m.data <= ate));
exports.movimentoNoPeriodo = movimentoNoPeriodo;
/** Entradas menos saidas. */
const saldoDosMovimentos = (movimentos) => (movimentos.reduce((soma, m) => soma + (m.direcao === 'credito' ? m.valorCentavos : -m.valorCentavos), 0));
exports.saldoDosMovimentos = saldoDosMovimentos;
/**
 * Saldo esperado em dinheiro no fechamento.
 *  - chave ligada e so' este caixa aberto: o saldo da gaveta (tudo em dinheiro,
 *    no PDV ou fora dele);
 *  - senao: a conta por sessao de sempre (saldo inicial + dinheiro das vendas
 *    desta sessao - sangrias).
 */
const esperadoNoFechamento = (args) => {
    const porSessao = inteiro(args.saldoInicialCentavos) + inteiro(args.dinheiroDaSessaoCentavos) - inteiro(args.totalSangriasCentavos);
    if (args.gavetaAtiva && args.saldoDaGavetaCentavos !== null && args.caixasAbertos <= 1) {
        return {
            modo: 'gaveta',
            saldoEsperadoCentavos: inteiro(args.saldoDaGavetaCentavos),
            explicacao: 'É o saldo da gaveta: todo o dinheiro que entrou e saiu, no caixa e nos pedidos de venda, menos sangrias e transferências.',
        };
    }
    return {
        modo: 'sessao',
        saldoEsperadoCentavos: porSessao,
        explicacao: args.gavetaAtiva && args.caixasAbertos > 1
            ? 'Há mais de um caixa aberto: a conta é só deste caixa (saldo inicial + vendas em dinheiro deste caixa − sangrias).'
            : 'Saldo inicial + vendas em dinheiro deste caixa − sangrias.',
    };
};
exports.esperadoNoFechamento = esperadoNoFechamento;
/** "Conferido", "Sobrou R$ X" ou "Faltou R$ X". */
const resultadoDaContagem = (diferencaCentavos) => {
    if (diferencaCentavos === 0)
        return 'Conferido: o valor contado bate com o esperado.';
    return diferencaCentavos > 0
        ? `Sobrou ${(0, contasDinheiroDomain_1.formatarReais)(diferencaCentavos)} em relação ao esperado.`
        : `Faltou ${(0, contasDinheiroDomain_1.formatarReais)(Math.abs(diferencaCentavos))} em relação ao esperado.`;
};
exports.resultadoDaContagem = resultadoDaContagem;
/** Ate' quantos dias para tras a composicao abre venda por venda. */
exports.DIAS_DA_COMPOSICAO = 31;
/**
 * Primeiro dia da composicao: o dia da ultima conferencia da gaveta (fechamento
 * pela gaveta ou acerto de um dia), senao o dia em que a chave foi ligada --
 * nunca mais de DIAS_DA_COMPOSICAO para tras.
 */
const inicioDaComposicao = (args) => {
    const limite = (0, dateTime_1.addDaysToDateInput)(args.hoje, -exports.DIAS_DA_COMPOSICAO);
    return [args.desde, limite, DATA_ISO.test(args.ultimaConferencia) ? args.ultimaConferencia : '']
        .filter(Boolean)
        .reduce((maior, d) => (d > maior ? d : maior), '');
};
exports.inicioDaComposicao = inicioDaComposicao;
/**
 * Agrupa por dia (mais antigo primeiro). Os movimentos de antes de `inicio`
 * viram o "saldo anterior" = saldo - soma do que foi listado, entao a soma das
 * linhas sempre bate com o saldo.
 */
const comporPorDia = (saldoCentavos, movimentos, inicio) => {
    const listados = movimentos
        .filter((m) => m.data >= inicio)
        .slice()
        .sort((a, b) => a.data.localeCompare(b.data) || a.criadoEmIso.localeCompare(b.criadoEmIso));
    const saldoAnteriorCentavos = inteiro(saldoCentavos) - (0, exports.saldoDosMovimentos)(listados);
    const porDia = new Map();
    listados.forEach((m) => porDia.set(m.data, [...(porDia.get(m.data) || []), m]));
    let acumulado = saldoAnteriorCentavos;
    const dias = [...porDia.entries()].map(([data, lista]) => {
        const entradasCentavos = lista.filter((m) => m.direcao === 'credito').reduce((s, m) => s + m.valorCentavos, 0);
        const saidasCentavos = lista.filter((m) => m.direcao === 'debito').reduce((s, m) => s + m.valorCentavos, 0);
        acumulado += entradasCentavos - saidasCentavos;
        return { data, entradasCentavos, saidasCentavos, liquidoCentavos: entradasCentavos - saidasCentavos, saldoNoFimCentavos: acumulado, movimentos: lista };
    });
    return { inicio, saldoAnteriorCentavos, dias, saldoCentavos: inteiro(saldoCentavos) };
};
exports.comporPorDia = comporPorDia;
/**
 * Caixa conferido POR SESSAO (chave desligada ou mais de um caixa aberto): o
 * esperado e' saldo inicial + vendas em dinheiro do caixa - sangrias. Mesmo
 * formato da composicao da gaveta, para a tela e o relatorio mostrarem igual.
 */
const composicaoDaSessao = (args) => {
    const valida = (d) => d instanceof Date && !Number.isNaN(d.getTime());
    const abertura = valida(args.abertoEm) ? args.abertoEm : new Date();
    const movimentos = [];
    if (inteiro(args.saldoInicialCentavos) !== 0) {
        movimentos.push({
            id: 'saldo_inicial', tipo: 'saldo_inicial', direcao: 'credito', valorCentavos: inteiro(args.saldoInicialCentavos),
            descricao: 'Saldo inicial (contado na abertura)', data: (0, dateTime_1.getDateInputInTimeZone)(abertura), criadoEmIso: abertura.toISOString(),
        });
    }
    args.lancamentosEmDinheiro.forEach((l) => {
        const quando = valida(l.criadoEm) ? l.criadoEm : abertura;
        const clienteNome = String(l.clienteNome || '').trim();
        movimentos.push({
            id: `titulo:${l.id}`, tipo: 'dinheiro_entrada', direcao: 'credito', valorCentavos: inteiro(l.valorCentavos),
            descricao: l.descricao || 'Venda em dinheiro', data: (0, dateTime_1.getDateInputInTimeZone)(quando), criadoEmIso: quando.toISOString(),
            ...(clienteNome ? { clienteNome } : {}),
        });
    });
    args.sangrias.forEach((g, i) => {
        const quando = g.registradoEm ? new Date(g.registradoEm) : null;
        const certo = valida(quando) ? quando : abertura;
        const motivo = String(g.motivo || '').trim();
        movimentos.push({
            id: `sangria:${g.id || i}`, tipo: 'sangria_pdv', direcao: 'debito', valorCentavos: inteiro(g.valorCentavos),
            descricao: `Sangria${motivo ? `: ${motivo}` : ''}`, data: (0, dateTime_1.getDateInputInTimeZone)(certo), criadoEmIso: certo.toISOString(),
        });
    });
    return (0, exports.comporPorDia)((0, exports.saldoDosMovimentos)(movimentos), movimentos, (0, dateTime_1.getDateInputInTimeZone)(abertura));
};
exports.composicaoDaSessao = composicaoDaSessao;
/** Saldo da gaveta no fim de `dia`: o de agora menos o que entrou/saiu depois. */
const saldoNoFimDoDia = (saldoAgoraCentavos, movimentosDepois, dia) => (inteiro(saldoAgoraCentavos) - (0, exports.saldoDosMovimentos)(movimentosDepois.filter((m) => m.data > dia)));
exports.saldoNoFimDoDia = saldoNoFimDoDia;
/** "R$ 1.060,68" (com ponto de milhar) para as mensagens do fechamento e da abertura. */
const reais = (centavos) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Math.round(Number(centavos) || 0) / 100);
// ---------------------------------------------------------------------------
// TROCO E COFRE NO FECHAMENTO; ACERTO DE UM DIA ANTERIOR (24/11/2026)
// ---------------------------------------------------------------------------
//
// Decisoes do dono: ao fechar, pergunta quanto fica de troco na gaveta e o
// resto vai para o COFRE na hora (transferencia CAIXA -> COFRE). Para o dia que
// ja' passou sem isso ("fechar o caixa de ontem"), o acerto conta o que ficou
// daquele dia: sobra/falta e a ida ao COFRE entram COM A DATA daquele dia.
const centavosNaoNegativos = (v) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 ? n : null;
};
/** O troco nao passa do que foi contado; o resto vai ao COFRE. */
const erroDoTroco = (contadoCentavos, trocoCentavos) => {
    if (!Number.isInteger(trocoCentavos) || trocoCentavos < 0)
        return 'Informe quanto fica de troco na gaveta (zero se for tudo para o COFRE).';
    if (trocoCentavos > contadoCentavos)
        return `O troco (${reais(trocoCentavos)}) não pode ser maior que o dinheiro contado (${reais(contadoCentavos)}).`;
    return '';
};
exports.erroDoTroco = erroDoTroco;
const ID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;
const lerPedidoDeCofreNoFechamento = (corpo) => {
    const c = (corpo && typeof corpo === 'object' ? corpo : {});
    const sessaoId = typeof c.sessaoId === 'string' && ID_VALIDO.test(c.sessaoId) ? c.sessaoId : '';
    if (!sessaoId)
        return { erro: 'Caixa inválido. Atualize a tela e tente de novo.' };
    const trocoCentavos = centavosNaoNegativos(c.trocoCentavos);
    if (trocoCentavos === null)
        return { erro: 'Informe quanto fica de troco na gaveta (zero se for tudo para o COFRE).' };
    return { pedido: { sessaoId, trocoCentavos } };
};
exports.lerPedidoDeCofreNoFechamento = lerPedidoDeCofreNoFechamento;
const lerPedidoDeAcerto = (corpo, hoje, desde) => {
    const c = (corpo && typeof corpo === 'object' ? corpo : {});
    const data = typeof c.data === 'string' && DATA_ISO.test(c.data) ? c.data : '';
    if (!data)
        return { erro: 'Escolha o dia que vai acertar.' };
    if (data >= hoje)
        return { erro: 'O acerto é de um dia que já passou. O dinheiro de hoje se confere no fechamento do caixa.' };
    if (desde && data < desde)
        return { erro: `A gaveta só soma as vendas desde ${desde.split('-').reverse().join('/')}. Escolha um dia a partir dessa data.` };
    const contadoCentavos = centavosNaoNegativos(c.contadoCentavos);
    if (contadoCentavos === null)
        return { erro: 'Informe quanto dinheiro havia na gaveta no fim daquele dia (zero se estava vazia).' };
    const trocoCentavos = centavosNaoNegativos(c.trocoCentavos);
    if (trocoCentavos === null)
        return { erro: 'Informe quanto ficou de troco na gaveta (zero se foi tudo para o COFRE).' };
    const erro = (0, exports.erroDoTroco)(contadoCentavos, trocoCentavos);
    if (erro)
        return { erro };
    return { pedido: { data, contadoCentavos, trocoCentavos } };
};
exports.lerPedidoDeAcerto = lerPedidoDeAcerto;
/** O que o acerto grava: a diferenca (sobra/falta) e quanto vai ao COFRE. */
const planejarAcerto = (saldoDoSistemaCentavos, contadoCentavos, trocoCentavos) => ({
    diferencaCentavos: contadoCentavos - inteiro(saldoDoSistemaCentavos),
    paraCofreCentavos: contadoCentavos - trocoCentavos,
});
exports.planejarAcerto = planejarAcerto;
// ---------------------------------------------------------------------------
// FECHAR COM A DATA DE UM DIA ANTERIOR (caixa esquecido aberto, 24/11/2026)
// ---------------------------------------------------------------------------
/** Ate' quantos dias para tras o caixa esquecido aberto pode ser fechado. */
exports.DIAS_PARA_FECHAR_ATRASADO = 7;
/**
 * Dias que podem ser a data do fechamento: do dia em que o caixa abriu ate'
 * hoje (no maximo DIAS_PARA_FECHAR_ATRASADO para tras). Caixa aberto hoje: so' hoje.
 */
const diasParaFechar = (diaDaAbertura, hoje) => {
    const primeiro = [diaDaAbertura, (0, dateTime_1.addDaysToDateInput)(hoje, -exports.DIAS_PARA_FECHAR_ATRASADO)].filter((d) => DATA_ISO.test(d)).reduce((maior, d) => (d > maior ? d : maior), '');
    if (!primeiro || primeiro >= hoje)
        return [hoje];
    const dias = [];
    for (let d = primeiro; d <= hoje && dias.length <= exports.DIAS_PARA_FECHAR_ATRASADO; d = (0, dateTime_1.addDaysToDateInput)(d, 1))
        dias.push(d);
    return dias;
};
exports.diasParaFechar = diasParaFechar;
/** Titulo da sessao entra no esperado de um fechamento com data `ate`? (pela data do pagamento). */
const tituloAteODia = (t, ate) => {
    const data = dataIso(t.dataPagamento) || dataIso(t.data);
    return !ate || !data || data <= ate;
};
exports.tituloAteODia = tituloAteODia;
// ---------------------------------------------------------------------------
// ABERTURA CONFERIDA CONTRA A GAVETA (24/11/2026)
// ---------------------------------------------------------------------------
//
// A Embala abriu com R$ 77,10 contados enquanto a gaveta dizia R$ 1.060,68.
// Decisao do dono: avisar e lancar a diferenca (sobra/falta no extrato do CAIXA,
// com o nome do operador); o esperado parte do valor contado.
/** Vale conferir a abertura contra a gaveta? (chave ligada e nenhum outro caixa aberto) */
const aberturaConfereComAGaveta = (gaveta) => (Boolean(gaveta && gaveta.ativo && gaveta.saldoCentavos !== null && gaveta.caixasAbertos === 0));
exports.aberturaConfereComAGaveta = aberturaConfereComAGaveta;
/** Texto do aviso quando o contado nao bate com a gaveta; vazio quando bate. */
const avisoDaAbertura = (saldoDaGavetaCentavos, contadoCentavos) => {
    const diferenca = contadoCentavos - saldoDaGavetaCentavos;
    if (diferenca === 0)
        return '';
    return `Pelo sistema, a gaveta tem ${reais(saldoDaGavetaCentavos)} e você contou ${reais(contadoCentavos)}: `
        + `${diferenca > 0 ? 'sobram' : 'faltam'} ${reais(Math.abs(diferenca))}. `
        + 'A diferença vai para o extrato do CAIXA em seu nome, e o caixa abre com o valor que você contou.';
};
exports.avisoDaAbertura = avisoDaAbertura;
