const { db } = require('../config/firebase');
const {
  isCardPayment,
  transactionDueDateInput,
  transactionNetCents,
} = require('../domain/financeDomain');
const { acrescimoPorAtraso, parseParametrosVenda } = require('../domain/parametrosVendaDomain');
const { ErroBaixa, registrarBaixa, validarPedidoDeBaixa, hojeNoBrasil } = require('./baixaFinanceira');
const { podePelasEfetivas } = require('./permissoesFinanceiro');

/*
 * RECEBER NOTINHA NA FRENTE DE CAIXA (28/11/2026, pedido do dono).
 *
 * "Tem cliente meu que quer receber notinha de cliente do contas a receber
 * direto no PDV". O operador do caixa escolhe o cliente, marca as contas em
 * aberto dele e recebe. A baixa e' a MESMA do Contas a Receber (registrarBaixa:
 * titulo, banco, venda/OS de origem, juros e multa), com duas diferencas:
 *  - juros e multa sempre no padrao da filial (o caixa nao negocia), sem
 *    desconto e sem pagamento parcial -- quita a conta;
 *  - o titulo guarda em qual caixa entrou o dinheiro (`recebidoNoCaixaId`), para
 *    o fechamento esperar esse dinheiro e os relatorios do caixa mostrarem.
 *
 * Quem pode: a permissao propria "Frente de Caixa: receber contas do cliente"
 * (nasce desmarcada; o dono marca), com o caixa ABERTO da propria pessoa. A
 * lista vem daqui (nao do navegador): quem so' opera o caixa nao le o
 * Contas a Receber inteiro.
 */

const PERMISSAO_RECEBER_NO_CAIXA = 'vendas.pdv_receber_contas';
const FORMAS_NO_CAIXA = ['Dinheiro', 'Pix', 'Cartão de Débito', 'Cartão de Crédito'];
const ID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;
const LIMITE_POR_VEZ = 30;

const exigirPermissao = (user) => {
  if (!podePelasEfetivas(user, PERMISSAO_RECEBER_NO_CAIXA)) {
    throw new ErroBaixa(403, 'Você não tem permissão para receber contas na Frente de Caixa. Peça ao dono liberar "Vendas: Frente de Caixa — receber contas do cliente" no seu cadastro de funcionário.');
  }
};

/** O caixa (sessao do PDV) tem de estar aberto e ser de quem esta' recebendo. */
const lerCaixaAberto = async (tenantId, user, sessaoId) => {
  if (!ID_VALIDO.test(String(sessaoId || ''))) throw new ErroBaixa(400, 'Abra o caixa antes de receber contas.');
  const snap = await db.collection('caixas_pdv').doc(String(sessaoId)).get();
  const caixa = snap.exists ? snap.data() : null;
  if (!caixa || caixa.tenantId !== tenantId) throw new ErroBaixa(404, 'Este caixa não foi encontrado. Feche a Frente de Caixa e abra de novo.');
  if (caixa.status !== 'aberto') throw new ErroBaixa(409, 'Este caixa já foi fechado. Abra um caixa novo para receber contas.');
  if (caixa.operadorId && caixa.operadorId !== user.uid) throw new ErroBaixa(403, 'Este caixa é de outro operador. Receba no seu próprio caixa.');
  return caixa;
};

/** Boleto registrado no banco (mesma regra do acerto com fornecedor): recebido no caixa, ficaria aberto no banco. */
const temBoletoEmitido = (t) => {
  const boleto = t.boleto && typeof t.boleto === 'object' ? t.boleto : null;
  return Boolean(boleto && boleto.nossoNumero && boleto.status !== 'cancelado');
};

/** Conta que o caixa pode receber: em aberto, sem cheque (compensacao), cartao (conciliacao) nem boleto emitido. */
const recebivelNoCaixa = (t) => (
  t.tipo === 'entrada'
  && t.status === 'Pendente'
  && String(t.formaPagamento || '') !== 'Cheque'
  && !isCardPayment(String(t.formaPagamento || ''))
  && !temBoletoEmitido(t)
);

const juroDoDia = (parametros, t, hoje) => (
  acrescimoPorAtraso(parametros, transactionNetCents(t), transactionDueDateInput(t), hoje) || { jurosCentavos: 0, multaCentavos: 0 }
);

/** Contas em aberto do cliente, com juros e multa de hoje (padrao da filial). */
const listarAbertasDoCliente = async ({ user, tenantId, corpo }) => {
  exigirPermissao(user);
  const clienteId = String((corpo && corpo.clienteId) || '').trim();
  if (!ID_VALIDO.test(clienteId)) throw new ErroBaixa(400, 'Escolha o cliente para ver as contas dele.');
  const hoje = hojeNoBrasil();
  const [snap, configSnap] = await Promise.all([
    db.collection('transacoes').where('tenantId', '==', tenantId).where('clienteId', '==', clienteId).where('status', '==', 'Pendente').get(),
    db.collection('configuracoes').doc(tenantId).get(),
  ]);
  const parametros = parseParametrosVenda(configSnap.exists ? (configSnap.data() || {}).parametrosVenda : undefined);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter(recebivelNoCaixa)
    .map((t) => {
      const ajuste = juroDoDia(parametros, t, hoje);
      const valorCentavos = transactionNetCents(t);
      return {
        transacaoId: t.id,
        descricao: String(t.descricao || ''),
        vencimento: transactionDueDateInput(t) || '',
        formaPagamento: String(t.formaPagamento || ''),
        valorCentavos,
        jurosCentavos: ajuste.jurosCentavos,
        multaCentavos: ajuste.multaCentavos,
        totalCentavos: valorCentavos + ajuste.jurosCentavos + ajuste.multaCentavos,
      };
    })
    .sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento)));
};

/**
 * Recebe as contas marcadas no caixa. Cada uma e' uma baixa completa e
 * independente (como a baixa em lote): a que falha nao desfaz as outras.
 */
const receberNoCaixa = async ({ user, tenantId, corpo }) => {
  exigirPermissao(user);
  const c = corpo || {};
  await lerCaixaAberto(tenantId, user, c.sessaoId);
  const formaPagamento = String(c.formaPagamento || '').trim();
  if (!FORMAS_NO_CAIXA.includes(formaPagamento)) throw new ErroBaixa(400, 'Escolha como o cliente pagou: dinheiro, Pix ou cartão.');
  const titulos = Array.isArray(c.titulos) ? c.titulos : [];
  if (titulos.length === 0) throw new ErroBaixa(400, 'Marque pelo menos uma conta para receber.');
  if (titulos.length > LIMITE_POR_VEZ) throw new ErroBaixa(400, `Receba até ${LIMITE_POR_VEZ} contas por vez.`);
  const hoje = hojeNoBrasil();
  const resultados = [];
  for (const t of titulos) {
    const transacaoId = String((t && t.transacaoId) || '');
    try {
      const { erro, pedido } = validarPedidoDeBaixa({
        tipo: 'entrada',
        transacaoId,
        formaPagamento,
        dataPagamento: hoje,
        bancoId: c.bancoId,
        jurosCentavos: t && t.jurosCentavos,
        multaCentavos: t && t.multaCentavos,
      }, hoje);
      if (erro) throw new ErroBaixa(400, erro);
      const lido = await db.collection('transacoes').doc(transacaoId).get();
      const dadosDoTitulo = lido.exists ? lido.data() : null;
      if (dadosDoTitulo && dadosDoTitulo.tenantId === tenantId && temBoletoEmitido(dadosDoTitulo)) {
        throw new ErroBaixa(409, `"${dadosDoTitulo.descricao || 'Esta conta'}" tem boleto emitido no banco. Receba pelo Financeiro › Boletos, para baixar o boleto no banco também.`);
      }
      // O caixa nao negocia: juros e multa no padrao (conferido dentro da baixa), sem desconto nem parcial.
      pedido.jurosNoPadrao = true;
      pedido.descontoCentavos = 0;
      delete pedido.valorRecebidoCentavos;
      pedido.recebidoNoCaixaId = String(c.sessaoId);
      const resumo = await registrarBaixa({ user, tenantId, pedido });
      resultados.push({
        transacaoId,
        ok: true,
        descricao: resumo.descricao,
        valorCentavos: resumo.valorCentavos,
        acrescimoCentavos: resumo.acrescimoCentavos || 0,
        bancoNome: resumo.bancoNome || null,
      });
    } catch (erroDaConta) {
      if (!(erroDaConta instanceof ErroBaixa)) console.error('[Caixa] erro ao receber conta no caixa:', erroDaConta);
      resultados.push({
        transacaoId,
        ok: false,
        erro: erroDaConta instanceof ErroBaixa ? erroDaConta.message : 'Não foi possível receber esta conta. Nada foi alterado nela. Tente de novo em instantes.',
      });
    }
  }
  return { formaPagamento, dataPagamento: hoje, resultados };
};

module.exports = {
  PERMISSAO_RECEBER_NO_CAIXA,
  FORMAS_NO_CAIXA,
  recebivelNoCaixa,
  listarAbertasDoCliente,
  receberNoCaixa,
};
