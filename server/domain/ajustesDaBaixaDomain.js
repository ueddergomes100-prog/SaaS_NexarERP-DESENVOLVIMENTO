"use strict";
/**
 * JUROS, MULTA E DESCONTO NA BAIXA (Contas a Receber e a Pagar, individual e
 * em lote) -- pedido do cliente de 15/10/2026. Regra pura: a tela e o servidor
 * (server/domain, gerado) usam a mesma.
 *
 * Decisoes do dono (15/10/2026):
 *  - tres campos separados, sempre visiveis: Juros, Multa e Desconto. Titulo
 *    vencido com as % da filial (Configuracoes da filial > Parametros de
 *    venda) ja' vem com juros e multa calculados (da' para mudar);
 *  - o titulo fica quitado pelo VALOR CHEIO (a venda/nota nao muda). Juros e
 *    multa viram um lancamento proprio "Juros e multa"; o desconto, outro
 *    ("Desconto concedido" no Receber, "Desconto obtido" no Pagar). O banco
 *    recebe/paga o liquido. O estorno da baixa desfaz os tres juntos;
 *  - desconto so' com a permissao propria PERMISSAO_DESCONTO_NA_BAIXA (dono e
 *    administrador ja' tem).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.temAjuste = exports.camposDosAjustes = exports.ajustesDoPedido = exports.descricaoDosAjustes = exports.erroDosAjustes = exports.valorPagoDaBaixa = exports.acrescimoDosAjustes = exports.textoDoCampo = exports.centavosDoCampo = exports.CATEGORIA_DO_DESCONTO = exports.CATEGORIA_DO_ACRESCIMO = exports.SEM_AJUSTES = exports.ROTULO_PERMISSAO_DESCONTO_NA_BAIXA = exports.PERMISSAO_DESCONTO_NA_BAIXA = void 0;
exports.PERMISSAO_DESCONTO_NA_BAIXA = 'financeiro.desconto_baixa';
exports.ROTULO_PERMISSAO_DESCONTO_NA_BAIXA = 'Financeiro: dar desconto na baixa (Contas a Receber e a Pagar)';
exports.SEM_AJUSTES = { jurosCentavos: 0, multaCentavos: 0, descontoCentavos: 0 };
/** Categorias dos lancamentos que a baixa cria (Fluxo de Caixa / DRE). */
exports.CATEGORIA_DO_ACRESCIMO = {
    entrada: 'Juros e multa recebidos',
    saida: 'Juros e multa pagos',
};
exports.CATEGORIA_DO_DESCONTO = {
    entrada: 'Descontos concedidos',
    saida: 'Descontos obtidos',
};
/** "12,50" / "1.234,56" / "12.5" -> centavos. Vazio = 0. Texto que nao e' valor = null. */
const centavosDoCampo = (texto) => {
    const limpo = String(texto ?? '').trim().replace(/^R\$\s*/i, '');
    if (!limpo)
        return 0;
    const normalizado = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo;
    if (!/^\d+(\.\d{0,2})?$/.test(normalizado))
        return null;
    return Math.round(Number(normalizado) * 100);
};
exports.centavosDoCampo = centavosDoCampo;
/** 1250 -> "12,50"; zero vira vazio (campo em branco). */
const textoDoCampo = (centavos) => (centavos > 0 ? (centavos / 100).toFixed(2).replace('.', ',') : '');
exports.textoDoCampo = textoDoCampo;
const inteiro = (valor) => Math.max(0, Math.round(Number(valor) || 0));
const acrescimoDosAjustes = (a) => inteiro(a.jurosCentavos) + inteiro(a.multaCentavos);
exports.acrescimoDosAjustes = acrescimoDosAjustes;
/** O que sai/entra de fato no banco ou no caixa: valor + juros + multa - desconto. */
const valorPagoDaBaixa = (valorCentavos, a) => (inteiro(valorCentavos) + (0, exports.acrescimoDosAjustes)(a) - inteiro(a.descontoCentavos));
exports.valorPagoDaBaixa = valorPagoDaBaixa;
/**
 * O que impede a baixa com esses ajustes, ou null. Frases para o usuario
 * final: dizem o que houve e o que fazer.
 */
const erroDosAjustes = (valorCentavos, a, opcoes) => {
    const campos = [['Juros', a.jurosCentavos], ['Multa', a.multaCentavos], ['Desconto', a.descontoCentavos]];
    const invalido = campos.find(([, v]) => !Number.isInteger(v) || v < 0);
    if (invalido)
        return `${invalido[0]}: informe um valor em reais maior ou igual a zero (ex.: 12,50).`;
    const valor = inteiro(valorCentavos);
    if (a.descontoCentavos > 0 && !opcoes.podeDescontar) {
        return `Para dar desconto na baixa, é preciso a permissão "${exports.ROTULO_PERMISSAO_DESCONTO_NA_BAIXA}". Peça ao administrador, ou deixe o desconto em branco.`;
    }
    if (a.descontoCentavos > 0 && a.descontoCentavos >= valor) {
        return 'O desconto não pode ser igual ou maior que o valor da conta. Para não cobrar a conta inteira, cancele a conta em vez de dar baixa.';
    }
    // Juros e multa acima de 2x o titulo (+ R$ 1.000) e' erro de digitacao.
    if ((0, exports.acrescimoDosAjustes)(a) > valor * 2 + 100000) {
        return 'Os juros e a multa estão muito acima do valor da conta. Confira o que foi digitado (em reais, com vírgula).';
    }
    return null;
};
exports.erroDosAjustes = erroDosAjustes;
const reais = (centavos) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(centavos / 100);
/** "juros R$ 2,00 + multa R$ 5,00 - desconto R$ 1,00" (vazio = sem ajuste). Para log e descricao. */
const descricaoDosAjustes = (a) => [
    a.jurosCentavos > 0 ? `juros ${reais(a.jurosCentavos)}` : '',
    a.multaCentavos > 0 ? `multa ${reais(a.multaCentavos)}` : '',
].filter(Boolean).join(' + ') + (a.descontoCentavos > 0 ? `${a.jurosCentavos + a.multaCentavos > 0 ? ' − ' : ''}desconto ${reais(a.descontoCentavos)}` : '');
exports.descricaoDosAjustes = descricaoDosAjustes;
/**
 * Pedido que chega no servidor: os tres campos (centavos inteiros >= 0). O
 * campo antigo `acrescimoCentavos` (tela de antes de 15/10/2026, so' Receber)
 * ainda e' aceito e vale como juros. Devolve `{ erro }` ou `{ ajustes }`.
 */
const ajustesDoPedido = (corpo) => {
    const ler = (campo) => {
        const v = corpo?.[campo];
        if (v === undefined || v === null || v === 0)
            return 0;
        return Number.isInteger(v) && v >= 0 ? v : null;
    };
    const juros = ler('jurosCentavos');
    const multa = ler('multaCentavos');
    const desconto = ler('descontoCentavos');
    const legado = ler('acrescimoCentavos');
    if (juros === null || multa === null || desconto === null || legado === null) {
        return { erro: 'Juros, multa e desconto: informe valores em reais maiores ou iguais a zero.', ajustes: exports.SEM_AJUSTES };
    }
    return { ajustes: { jurosCentavos: juros + (juros === 0 && multa === 0 ? legado : 0), multaCentavos: multa, descontoCentavos: desconto } };
};
exports.ajustesDoPedido = ajustesDoPedido;
/** So' os campos com valor, para mandar ao servidor sem chave `undefined`/zero. */
const camposDosAjustes = (a) => ({
    ...(a.jurosCentavos > 0 ? { jurosCentavos: a.jurosCentavos } : {}),
    ...(a.multaCentavos > 0 ? { multaCentavos: a.multaCentavos } : {}),
    ...(a.descontoCentavos > 0 ? { descontoCentavos: a.descontoCentavos } : {}),
});
exports.camposDosAjustes = camposDosAjustes;
const temAjuste = (a) => a.jurosCentavos > 0 || a.multaCentavos > 0 || a.descontoCentavos > 0;
exports.temAjuste = temAjuste;
