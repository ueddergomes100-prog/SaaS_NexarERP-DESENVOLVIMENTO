/*
 * Regras PURAS da baixa/estorno no servidor (sem Firestore): validam o pedido
 * que vem do navegador e montam o resumo da venda/OS. Separadas de
 * baixaFinanceira.js para os testes rodarem sem iniciar o Firebase.
 * Contexto completo no cabecalho de services/baixaFinanceira.js.
 */
const {
  paymentRequiresBankAccount,
  summarizePayments,
} = require('../domain/financeDomain');
const {
  validarDataBaixa,
  validarMotivoEstorno,
} = require('../domain/baixaFinanceiraDomain');
const { ajustesDoPedido, camposDosAjustes } = require('../domain/ajustesDaBaixaDomain');

class ErroBaixa extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// As mesmas listas que as telas oferecem. Cheque no Receber NAO passa por
// aqui: fica Pendente ate' compensar (Financeiro > Cheques).
const FORMAS_PAGAR = ['Dinheiro', 'Pix', 'Cartão de Crédito', 'Cartão de Débito', 'Transferência', 'Boleto', 'Outros'];
const FORMAS_RECEBER = ['Dinheiro', 'Pix', 'Cartão de Crédito', 'Cartão de Débito', 'Transferência', 'Outros'];

const ID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;

const temPermissao = (user, permissao) => Boolean(
  user.isPlatformAdmin
  || user.isTenantManager
  || (Array.isArray(user.permissoes) && user.permissoes.includes(permissao)),
);

const PERMISSAO_DA_BAIXA = { saida: 'financeiro.pagar', entrada: 'financeiro.receber' };

/** Pagar: tudo que nao e' dinheiro sai de um banco (regra da tela). Receber: so' o que a forma exige. */
const exigeBanco = (tipo, forma) => (tipo === 'saida' ? forma !== 'Dinheiro' : paymentRequiresBankAccount(forma));

/**
 * Confere o pedido de baixa que veio do navegador. Puro (sem banco de dados).
 * Devolve `{ erro }` com a frase para o usuario, ou `{ pedido }` normalizado.
 */
const validarPedidoDeBaixa = (corpo, hoje) => {
  const tipo = corpo?.tipo;
  if (tipo !== 'entrada' && tipo !== 'saida') return { erro: 'Tipo de lançamento inválido. Atualize a tela e tente de novo.' };

  const transacaoId = String(corpo.transacaoId || '').trim();
  if (!ID_VALIDO.test(transacaoId)) return { erro: 'Lançamento inválido. Atualize a tela e tente de novo.' };

  const formaPagamento = String(corpo.formaPagamento || '').trim();
  const formas = tipo === 'saida' ? FORMAS_PAGAR : FORMAS_RECEBER;
  if (!formas.includes(formaPagamento)) {
    if (tipo === 'entrada' && formaPagamento === 'Cheque') {
      return { erro: 'Recebimento em cheque fica aguardando compensação: registre pela tela de Contas a Receber.' };
    }
    return { erro: tipo === 'saida' ? 'Escolha como foi pago antes de confirmar.' : 'Escolha como foi recebido antes de confirmar.' };
  }

  const erroData = validarDataBaixa(corpo.dataPagamento, hoje);
  if (erroData) return { erro: erroData };

  const precisaBanco = exigeBanco(tipo, formaPagamento);
  const bancoId = precisaBanco ? String(corpo.bancoId || '').trim() : '';
  if (precisaBanco && !ID_VALIDO.test(bancoId)) {
    return { erro: tipo === 'saida' ? 'Escolha de qual banco saiu o pagamento.' : 'Escolha em qual banco caiu o recebimento.' };
  }

  // Juros, multa e desconto (15/10/2026, Receber E Pagar): inteiros em
  // centavos, >= 0. O valor e' decisao de quem da' baixa (pode negociar); o
  // servico ainda confere contra o titulo (ajustesDaBaixaDomain.erroDosAjustes)
  // e a rota confere a permissao do desconto. `acrescimoCentavos` (tela antiga)
  // ainda e' aceito e vale como juros.
  const { erro: erroAjustes, ajustes } = ajustesDoPedido(corpo);
  if (erroAjustes) return { erro: erroAjustes };
  // Pagamento parcial (16/10/2026): quanto entrou/saiu de fato. Sem ele, quita a conta.
  const valorRecebido = corpo.valorRecebidoCentavos;
  if (valorRecebido !== undefined && valorRecebido !== null && (!Number.isInteger(valorRecebido) || valorRecebido <= 0)) {
    return { erro: tipo === 'saida' ? 'Informe o valor pago (maior que zero).' : 'Informe o valor recebido (maior que zero).' };
  }

  return {
    pedido: {
      tipo,
      transacaoId,
      formaPagamento,
      dataPagamento: String(corpo.dataPagamento).trim(),
      ...(bancoId ? { bancoId } : {}),
      ...camposDosAjustes(ajustes),
      ...(Number.isInteger(valorRecebido) ? { valorRecebidoCentavos: valorRecebido } : {}),
    },
  };
};

/**
 * BAIXA EM LOTE (2026-10-14): ate' este tanto de contas por vez. Cada uma e'
 * uma transacao propria, em sequencia (todas mexem no mesmo saldo de banco),
 * entao o limite segura o tempo da requisicao.
 */
const LIMITE_BAIXA_EM_LOTE = 50;

/**
 * Confere o pedido de baixa EM LOTE: a mesma forma, data e banco para todas
 * as contas; juros, multa e desconto por conta. Cada conta passa pela
 * MESMA validarPedidoDeBaixa da baixa individual -- o lote nao tem regra
 * propria. Qualquer problema recusa o lote inteiro antes de gravar nada.
 * Devolve `{ erro }` ou `{ pedidos }` (um pedido de baixa por conta).
 */
const validarPedidoDeBaixaEmLote = (corpo, hoje) => {
  const titulos = Array.isArray(corpo?.titulos) ? corpo.titulos : null;
  if (!titulos || titulos.length === 0) return { erro: 'Selecione ao menos uma conta para dar baixa.' };
  if (titulos.length > LIMITE_BAIXA_EM_LOTE) {
    return { erro: `Dê baixa em no máximo ${LIMITE_BAIXA_EM_LOTE} contas por vez. Desmarque algumas e faça em mais de uma etapa.` };
  }
  const vistos = new Set();
  const pedidos = [];
  for (const item of titulos) {
    const { erro, pedido } = validarPedidoDeBaixa({
      tipo: corpo.tipo,
      transacaoId: item?.transacaoId,
      formaPagamento: corpo.formaPagamento,
      dataPagamento: corpo.dataPagamento,
      bancoId: corpo.bancoId,
      acrescimoCentavos: item?.acrescimoCentavos,
      jurosCentavos: item?.jurosCentavos,
      multaCentavos: item?.multaCentavos,
      descontoCentavos: item?.descontoCentavos,
    }, hoje);
    if (erro) return { erro };
    if (vistos.has(pedido.transacaoId)) {
      return { erro: 'A mesma conta apareceu duas vezes na seleção. Atualize a tela e selecione de novo.' };
    }
    vistos.add(pedido.transacaoId);
    pedidos.push(pedido);
  }
  return { pedidos };
};

/** Confere o pedido de estorno. Puro. */
const validarPedidoDeEstorno = (corpo) => {
  const tipo = corpo?.tipo;
  if (tipo !== 'entrada' && tipo !== 'saida') return { erro: 'Tipo de lançamento inválido. Atualize a tela e tente de novo.' };
  const transacaoId = String(corpo.transacaoId || '').trim();
  if (!ID_VALIDO.test(transacaoId)) return { erro: 'Lançamento inválido. Atualize a tela e tente de novo.' };
  const erroMotivo = validarMotivoEstorno(corpo.motivo);
  if (erroMotivo) return { erro: erroMotivo };
  return { pedido: { tipo, transacaoId, motivo: String(corpo.motivo).trim() } };
};

/** Campos de resumo que a venda/OS de origem guarda depois de mexer nos pagamentos. */
const camposDoResumoDePagamentos = (pagamentos) => {
  const resumo = summarizePayments(pagamentos);
  return {
    pagamentos,
    totalRecebidoCentavos: resumo.receivedCents,
    totalRecebido: resumo.received,
    totalPendenteCentavos: resumo.pendingCents,
    totalPendente: resumo.pending,
    totalTaxasPagamentoCentavos: resumo.cardFeeCents,
    totalTaxasPagamento: resumo.cardFee,
    totalLiquidoFinanceiroCentavos: resumo.financialNetCents,
    totalLiquidoFinanceiro: resumo.financialNet,
    statusPagamento: resumo.pendingCents === 0
      ? 'Paga'
      : resumo.receivedCents > 0
        ? 'Parcial'
        : 'Pendente',
  };
};

module.exports = {
  ErroBaixa,
  FORMAS_PAGAR,
  FORMAS_RECEBER,
  PERMISSAO_DA_BAIXA,
  temPermissao,
  exigeBanco,
  validarPedidoDeBaixa,
  validarPedidoDeBaixaEmLote,
  LIMITE_BAIXA_EM_LOTE,
  validarPedidoDeEstorno,
  camposDoResumoDePagamentos,
};
