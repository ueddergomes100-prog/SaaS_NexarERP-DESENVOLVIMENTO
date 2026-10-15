"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nomeArquivoRelatorio = exports.secoesVisiveis = exports.colunasEscolhidas = exports.normalizarPreferencias = exports.preferenciasPadrao = exports.tamanhoFonteTabela = exports.escolherOrientacao = exports.larguraEstimadaColunas = exports.linhaTotalSecao = exports.contarUnidade = exports.somarColuna = exports.colunaSomada = exports.formatarCelulaRelatorio = exports.formatarDataRelatorio = exports.caixaAltaRelatorio = exports.LARGURA_UTIL_PAISAGEM_MM = exports.LARGURA_UTIL_RETRATO_MM = void 0;
/*
 * RELATORIO DO SISTEMA = PDF, COM COLUNAS ESCOLHIDAS POR CHECKBOX.
 *
 * Decisao do dono (2026-09-23): todo relatorio abre primeiro na tela, dentro
 * do sistema (igual minuta/pedido), ja paginado como vai sair no papel. Dali
 * a pessoa so' olha e fecha, imprime, salva o PDF ou -- em botao separado --
 * salva em Excel.
 *
 * Nenhuma coluna e' removida do sistema porque um cliente nao usa: cada
 * relatorio declara TODAS as colunas e o cliente marca o que quer no papel.
 * A escolha fica guardada no computador (localStorage), por relatorio.
 *
 * Este arquivo e' so' a parte pura (formato, total, orientacao, preferencia)
 * -- testavel sem navegador. O desenho do PDF mora em relatorioPdf.ts.
 */
const financeDomain_1 = require("./financeDomain");
/** A4 menos 12mm de margem de cada lado. */
exports.LARGURA_UTIL_RETRATO_MM = 210 - 24;
exports.LARGURA_UTIL_PAISAGEM_MM = 297 - 24;
const LARGURA_PADRAO_MM = {
    texto: 34,
    moeda: 24,
    inteiro: 14,
    data: 20,
    dataHora: 30,
};
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const inteiro = new Intl.NumberFormat('pt-BR');
/** Papel sai em caixa alta (decisao de 2026-08-31, impressaoMaiuscula.css). */
const caixaAltaRelatorio = (texto) => texto.toLocaleUpperCase('pt-BR');
exports.caixaAltaRelatorio = caixaAltaRelatorio;
const formatarDataRelatorio = (data, comHora = false) => {
    const partes = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).formatToParts(data);
    const parte = (tipo) => partes.find((p) => p.type === tipo)?.value || '';
    const dia = `${parte('day')}/${parte('month')}/${parte('year')}`;
    return comHora ? `${dia} ${parte('hour')}:${parte('minute')}` : dia;
};
exports.formatarDataRelatorio = formatarDataRelatorio;
const formatarCelulaRelatorio = (valor, tipo) => {
    if (valor === null || valor === undefined || valor === '')
        return '-';
    switch (tipo) {
        case 'moeda':
            return moeda.format((0, financeDomain_1.fromCents)(Number(valor) || 0));
        case 'inteiro':
            return inteiro.format(Number(valor) || 0);
        case 'data':
        case 'dataHora': {
            const data = valor instanceof Date ? valor : new Date(valor);
            if (Number.isNaN(data.getTime()))
                return '-';
            return (0, exports.formatarDataRelatorio)(data, tipo === 'dataHora');
        }
        default:
            return (0, exports.caixaAltaRelatorio)(String(valor));
    }
};
exports.formatarCelulaRelatorio = formatarCelulaRelatorio;
const colunaSomada = (coluna) => (Boolean(coluna.totalCalculado) || (coluna.total ? coluna.total === 'soma' : coluna.tipo === 'moeda' || coluna.tipo === 'inteiro'));
exports.colunaSomada = colunaSomada;
const somarColuna = (coluna, linhas) => (coluna.totalCalculado
    ? coluna.totalCalculado(linhas)
    : linhas.reduce((soma, linha) => soma + (Number(coluna.valor(linha)) || 0), 0));
exports.somarColuna = somarColuna;
const contarUnidade = (quantidade, unidade = ['registro', 'registros']) => (`${inteiro.format(quantidade)} ${quantidade === 1 ? unidade[0] : unidade[1]}`);
exports.contarUnidade = contarUnidade;
/**
 * Linha de total de uma secao, ja' formatada, na ordem das colunas escolhidas.
 * O rotulo ("TOTAL GERAL - 12 VENDAS") vai na primeira coluna que NAO soma --
 * nunca em cima de um valor. Se todas somam, o rotulo nao entra (a linha em
 * negrito no fim ja' diz o que e').
 */
const linhaTotalSecao = (colunas, linhas, rotulo) => {
    const indiceRotulo = colunas.findIndex((coluna) => !(0, exports.colunaSomada)(coluna));
    return colunas.map((coluna, indice) => {
        if ((0, exports.colunaSomada)(coluna))
            return (0, exports.formatarCelulaRelatorio)((0, exports.somarColuna)(coluna, linhas), coluna.tipo);
        return indice === indiceRotulo ? (0, exports.caixaAltaRelatorio)(rotulo) : '';
    });
};
exports.linhaTotalSecao = linhaTotalSecao;
const larguraEstimadaColunas = (colunas) => (colunas.reduce((soma, coluna) => soma + (coluna.largura ?? LARGURA_PADRAO_MM[coluna.tipo]), 0));
exports.larguraEstimadaColunas = larguraEstimadaColunas;
/** Retrato quando cabe; paisagem quando as colunas marcadas nao cabem em pe'. */
const escolherOrientacao = (secoesColunas) => (secoesColunas.some((colunas) => (0, exports.larguraEstimadaColunas)(colunas) > exports.LARGURA_UTIL_RETRATO_MM) ? 'landscape' : 'portrait');
exports.escolherOrientacao = escolherOrientacao;
/** Fonte da tabela: encolhe um pouco so' quando nem a paisagem comporta folgado. */
const tamanhoFonteTabela = (secoesColunas) => {
    const maior = Math.max(0, ...secoesColunas.map(exports.larguraEstimadaColunas));
    if (maior > exports.LARGURA_UTIL_PAISAGEM_MM * 1.15)
        return 6.5;
    if (maior > exports.LARGURA_UTIL_PAISAGEM_MM)
        return 7.5;
    return 8.5;
};
exports.tamanhoFonteTabela = tamanhoFonteTabela;
const preferenciasPadrao = (secoes) => ({
    indicadores: true,
    secoes: Object.fromEntries(secoes.map((secao) => [secao.id, {
            ativa: secao.opcional ? secao.padrao !== false : true,
            colunas: secao.colunas.filter((coluna) => coluna.padrao !== false).map((coluna) => coluna.id),
        }])),
});
exports.preferenciasPadrao = preferenciasPadrao;
/**
 * Junta o que estava salvo no computador com o relatorio de hoje: coluna que
 * deixou de existir some, secao nova entra no padrao. Assim uma atualizacao
 * do relatorio nunca quebra a escolha antiga de ninguem.
 */
const normalizarPreferencias = (salvas, secoes) => {
    const padrao = (0, exports.preferenciasPadrao)(secoes);
    if (!salvas || typeof salvas !== 'object')
        return padrao;
    const bruto = salvas;
    const secoesSalvas = (bruto.secoes && typeof bruto.secoes === 'object') ? bruto.secoes : {};
    return {
        indicadores: typeof bruto.indicadores === 'boolean' ? bruto.indicadores : padrao.indicadores,
        secoes: Object.fromEntries(secoes.map((secao) => {
            const salva = secoesSalvas[secao.id];
            if (!salva || !Array.isArray(salva.colunas))
                return [secao.id, padrao.secoes[secao.id]];
            const existentes = new Set(secao.colunas.map((coluna) => coluna.id));
            return [secao.id, {
                    ativa: secao.opcional ? salva.ativa !== false : true,
                    // Mantem a ORDEM do relatorio, nao a ordem em que a pessoa clicou.
                    colunas: secao.colunas.map((coluna) => coluna.id).filter((id) => existentes.has(id) && salva.colunas.includes(id)),
                }];
        })),
    };
};
exports.normalizarPreferencias = normalizarPreferencias;
const colunasEscolhidas = (secao, preferencias) => {
    const escolhidas = preferencias.secoes[secao.id]?.colunas || [];
    return secao.colunas.filter((coluna) => escolhidas.includes(coluna.id));
};
exports.colunasEscolhidas = colunasEscolhidas;
const secoesVisiveis = (secoes, preferencias) => (secoes.filter((secao) => (preferencias.secoes[secao.id]?.ativa ?? true) && (0, exports.colunasEscolhidas)(secao, preferencias).length > 0));
exports.secoesVisiveis = secoesVisiveis;
const semAcento = (texto) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '');
/** "Vendas por Vendedor" + 2026-09-01..2026-09-21 -> vendas-por-vendedor-01-09-2026-a-21-09-2026 */
const nomeArquivoRelatorio = (titulo, inicio, fim) => {
    const base = semAcento(titulo).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const data = (valor) => (valor && /^\d{4}-\d{2}-\d{2}$/.test(valor) ? valor.split('-').reverse().join('-') : '');
    const periodo = [data(inicio), data(fim)].filter(Boolean);
    if (periodo.length === 2 && periodo[0] === periodo[1])
        return `${base}-${periodo[0]}`;
    return periodo.length ? `${base}-${periodo.join('-a-')}` : base;
};
exports.nomeArquivoRelatorio = nomeArquivoRelatorio;
