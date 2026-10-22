"use strict";
/**
 * CAIXAS E TRANSFERENCIAS ENTRE CONTAS (pedido do dono, 21/10/2026).
 *
 * "Todo ERP tem": transferir dinheiro do Sicoob para o Banco do Brasil, do
 * caixa para o banco (deposito), do banco para o caixa (suprimento), do caixa
 * para o cofre. Decisoes do dono (caixinhas, 21/10):
 *  - a empresa cadastra os caixas que quiser; por padrao o sistema cria o
 *    CAIXA (a gaveta da frente de caixa) e o COFRE;
 *  - o saldo do caixa nasce do saldo inicial + transferencias + lancamentos
 *    a mao (a venda em dinheiro NAO entra sozinha: o Fluxo de Caixa continua
 *    mostrando as vendas como hoje);
 *  - cheque recebido ganha o passo DEPOSITAR (fica "aguardando compensacao")
 *    antes de COMPENSAR, e DEVOLVIDO para o que volta;
 *  - a sangria do PDV "para deposito" escolhe o banco e credita o banco na hora.
 *
 * Caixa e' dinheiro fisico: nunca fica negativo (a transferencia e' recusada).
 * Banco pode (cheque especial), como a transferencia entre bancos ja' aceita.
 *
 * Regra pura: sem tela, sem Firestore. Compilada para o servidor.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.erroParaVoltarChequeParaCarteira = exports.erroParaDevolverCheque = exports.erroParaDepositarCheque = exports.situacaoDoCheque = exports.ROTULO_SITUACAO_CHEQUE_RECEBIDO = exports.lerSangriaParaDeposito = exports.MOTIVO_SANGRIA_DEPOSITO = exports.descricoesDaTransferencia = exports.erroDeSaldoDoCaixa = exports.lerPedidoDeTransferencia = exports.lerLancamentoDeCaixa = exports.lerCadastroDeCaixa = exports.mesmaConta = exports.formatarReais = exports.normalizarNomeCaixa = exports.EXTRATO_LIMITE = exports.DESCRICAO_MAX = exports.NOME_CAIXA_MAX = exports.CAIXAS_PADRAO = exports.ROTULO_TIPO_CONTA = void 0;
exports.ROTULO_TIPO_CONTA = { caixa: 'Caixa', banco: 'Banco' };
/** Criados na primeira vez que a empresa abre a tela (idempotente). */
exports.CAIXAS_PADRAO = [
    { nome: 'CAIXA', descricao: 'Gaveta da frente de caixa' },
    { nome: 'COFRE', descricao: 'Dinheiro guardado na loja' },
];
exports.NOME_CAIXA_MAX = 40;
exports.DESCRICAO_MAX = 120;
exports.EXTRATO_LIMITE = 300;
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const ID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;
const numero = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
};
const texto = (v, maximo) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, maximo);
const normalizarNomeCaixa = (v) => texto(v, exports.NOME_CAIXA_MAX).toUpperCase();
exports.normalizarNomeCaixa = normalizarNomeCaixa;
const formatarReais = (centavos) => `R$ ${(Number(centavos || 0) / 100).toFixed(2).replace('.', ',')}`;
exports.formatarReais = formatarReais;
const valorPositivo = (v) => {
    const n = numero(v);
    return Number.isInteger(n) && n > 0 ? n : null;
};
const dataValida = (v) => (typeof v === 'string' && DATA_ISO.test(v) ? v : null);
const contaRef = (v) => {
    const c = (v && typeof v === 'object' ? v : {});
    const tipo = c.tipo === 'caixa' || c.tipo === 'banco' ? c.tipo : null;
    const id = typeof c.id === 'string' && ID_VALIDO.test(c.id) ? c.id : null;
    return tipo && id ? { tipo, id } : null;
};
const mesmaConta = (a, b) => a.tipo === b.tipo && a.id === b.id;
exports.mesmaConta = mesmaConta;
const lerCadastroDeCaixa = (corpo) => {
    const c = (corpo && typeof corpo === 'object' ? corpo : {});
    const nome = (0, exports.normalizarNomeCaixa)(c.nome);
    if (!nome)
        return { erro: 'Informe o nome do caixa (ex.: CAIXA, COFRE).' };
    const saldo = c.saldoInicialCentavos === undefined || c.saldoInicialCentavos === null || c.saldoInicialCentavos === '' ? 0 : numero(c.saldoInicialCentavos);
    if (!Number.isInteger(saldo) || saldo < 0)
        return { erro: 'O saldo inicial precisa ser um valor igual ou maior que zero.' };
    return { caixa: { nome, descricao: texto(c.descricao, exports.DESCRICAO_MAX), saldoInicialCentavos: saldo, ativo: c.ativo !== false } };
};
exports.lerCadastroDeCaixa = lerCadastroDeCaixa;
const lerLancamentoDeCaixa = (corpo) => {
    const c = (corpo && typeof corpo === 'object' ? corpo : {});
    const direcao = c.direcao === 'credito' || c.direcao === 'debito' ? c.direcao : null;
    if (!direcao)
        return { erro: 'Escolha se é entrada ou saída do caixa.' };
    const valorCentavos = valorPositivo(c.valorCentavos);
    if (!valorCentavos)
        return { erro: 'Informe um valor maior que zero.' };
    const descricao = texto(c.descricao, exports.DESCRICAO_MAX);
    if (!descricao)
        return { erro: 'Informe uma descrição para o lançamento.' };
    const data = dataValida(c.data);
    if (!data)
        return { erro: 'Informe a data do lançamento.' };
    return { lancamento: { direcao, valorCentavos, descricao, data } };
};
exports.lerLancamentoDeCaixa = lerLancamentoDeCaixa;
const lerPedidoDeTransferencia = (corpo) => {
    const c = (corpo && typeof corpo === 'object' ? corpo : {});
    const origem = contaRef(c.origem);
    const destino = contaRef(c.destino);
    if (!origem)
        return { erro: 'Escolha de onde o dinheiro sai.' };
    if (!destino)
        return { erro: 'Escolha para onde o dinheiro vai.' };
    if ((0, exports.mesmaConta)(origem, destino))
        return { erro: 'Origem e destino são a mesma conta. Escolha contas diferentes.' };
    const valorCentavos = valorPositivo(c.valorCentavos);
    if (!valorCentavos)
        return { erro: 'Informe um valor maior que zero.' };
    const data = dataValida(c.data);
    if (!data)
        return { erro: 'Informe a data da transferência.' };
    return { pedido: { origem, destino, valorCentavos, data, descricao: texto(c.descricao, exports.DESCRICAO_MAX) } };
};
exports.lerPedidoDeTransferencia = lerPedidoDeTransferencia;
/** Caixa e' dinheiro fisico: nao sai mais do que tem. */
const erroDeSaldoDoCaixa = (nome, saldoCentavos, valorCentavos) => (valorCentavos > saldoCentavos
    ? `O ${nome} tem ${(0, exports.formatarReais)(saldoCentavos)}; não dá para tirar ${(0, exports.formatarReais)(valorCentavos)}. Confira o saldo ou lance a entrada que falta.`
    : null);
exports.erroDeSaldoDoCaixa = erroDeSaldoDoCaixa;
/** Texto de cada lado do par de lancamentos. */
const descricoesDaTransferencia = (nomeOrigem, nomeDestino, descricao) => ({
    saida: descricao || `Transferência para ${nomeDestino}`,
    entrada: descricao || `Transferência de ${nomeOrigem}`,
});
exports.descricoesDaTransferencia = descricoesDaTransferencia;
// ---------------------------------------------------------------------------
// SANGRIA DO PDV PARA DEPOSITO
// ---------------------------------------------------------------------------
exports.MOTIVO_SANGRIA_DEPOSITO = 'Sangria para depósito';
const lerSangriaParaDeposito = (corpo) => {
    const c = (corpo && typeof corpo === 'object' ? corpo : {});
    const bancoId = typeof c.bancoId === 'string' && ID_VALIDO.test(c.bancoId) ? c.bancoId : '';
    if (!bancoId)
        return { erro: 'Escolha em qual banco o dinheiro será depositado.' };
    const valorCentavos = valorPositivo(c.valorCentavos);
    if (!valorCentavos)
        return { erro: 'Informe um valor maior que zero.' };
    const sessaoId = typeof c.sessaoId === 'string' && ID_VALIDO.test(c.sessaoId) ? c.sessaoId : '';
    if (!sessaoId)
        return { erro: 'Caixa do PDV não identificado. Feche e abra o PDV e tente de novo.' };
    const data = dataValida(c.data);
    if (!data)
        return { erro: 'Informe a data da sangria.' };
    return { sangria: { bancoId, valorCentavos, sessaoId, data } };
};
exports.lerSangriaParaDeposito = lerSangriaParaDeposito;
exports.ROTULO_SITUACAO_CHEQUE_RECEBIDO = {
    em_carteira: 'Em carteira',
    depositado: 'Depositado — aguardando compensação',
    devolvido: 'Devolvido',
    compensado: 'Compensado',
};
const situacaoDoCheque = (t) => {
    if (t.status === 'Paga')
        return 'compensado';
    const s = t.cheque && typeof t.cheque === 'object' ? t.cheque.situacao : undefined;
    return s === 'depositado' || s === 'devolvido' ? s : 'em_carteira';
};
exports.situacaoDoCheque = situacaoDoCheque;
const erroBasico = (t) => {
    if (t.tipo === 'saida')
        return 'Este é um cheque emitido pela empresa; depositar e devolver valem só para cheque recebido.';
    if (t.status === 'Cancelada')
        return 'Este cheque está cancelado.';
    if (t.status === 'Paga')
        return 'Este cheque já foi compensado.';
    return null;
};
const erroParaDepositarCheque = (t) => {
    const basico = erroBasico(t);
    if (basico)
        return basico;
    if ((0, exports.situacaoDoCheque)(t) === 'depositado')
        return 'Este cheque já está depositado. Quando o banco confirmar, use "Confirmar compensação".';
    return null;
};
exports.erroParaDepositarCheque = erroParaDepositarCheque;
const erroParaDevolverCheque = (t) => {
    const basico = erroBasico(t);
    if (basico)
        return basico;
    if ((0, exports.situacaoDoCheque)(t) === 'devolvido')
        return 'Este cheque já está marcado como devolvido.';
    return null;
};
exports.erroParaDevolverCheque = erroParaDevolverCheque;
const erroParaVoltarChequeParaCarteira = (t) => {
    const basico = erroBasico(t);
    if (basico)
        return basico;
    if ((0, exports.situacaoDoCheque)(t) === 'em_carteira')
        return 'Este cheque já está na carteira.';
    return null;
};
exports.erroParaVoltarChequeParaCarteira = erroParaVoltarChequeParaCarteira;
