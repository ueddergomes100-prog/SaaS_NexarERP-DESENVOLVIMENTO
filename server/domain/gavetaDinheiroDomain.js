"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resultadoDaContagem = exports.esperadoNoFechamento = exports.saldoDosMovimentos = exports.movimentoNoPeriodo = exports.movimentosDaSessao = exports.movimentoDoTitulo = exports.ROTULO_MOVIMENTO_GAVETA = exports.ehACaixaGaveta = exports.montarConfigGaveta = exports.lerConfigGaveta = exports.CAMPO_CONFIG_GAVETA = void 0;
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
    return {
        id: `titulo:${id}`,
        tipo: entrada ? 'dinheiro_entrada' : 'dinheiro_saida',
        direcao: entrada ? 'credito' : 'debito',
        valorCentavos,
        descricao: String(t.descricao || (entrada ? 'Recebimento em dinheiro' : 'Pagamento em dinheiro')),
        data,
        criadoEmIso,
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
