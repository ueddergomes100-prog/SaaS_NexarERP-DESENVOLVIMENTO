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

  // Juros e multa (parametros de venda, fase A -- 2026-10-07): so' no Receber,
  // inteiro em centavos, >= 0. O valor em si e' decisao de quem recebe (pode
  // negociar); o servico ainda barra valor absurdo em relacao ao titulo.
  let acrescimoCentavos = 0;
  if (corpo.acrescimoCentavos !== undefined && corpo.acrescimoCentavos !== null && corpo.acrescimoCentavos !== 0) {
    if (tipo !== 'entrada') return { erro: 'Juros e multa só se aplicam a recebimentos.' };
    if (!Number.isInteger(corpo.acrescimoCentavos) || corpo.acrescimoCentavos < 0) {
      return { erro: 'Juros e multa: informe um valor em reais maior ou igual a zero.' };
    }
    acrescimoCentavos = corpo.acrescimoCentavos;
  }

  return {
    pedido: {
      tipo,
      transacaoId,
      formaPagamento,
      dataPagamento: String(corpo.dataPagamento).trim(),
      ...(bancoId ? { bancoId } : {}),
      ...(acrescimoCentavos > 0 ? { acrescimoCentavos } : {}),
    },
  };
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
  validarPedidoDeEstorno,
  camposDoResumoDePagamentos,
};
