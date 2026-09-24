/*
 * BAIXA COM DATA E ESTORNO DE BAIXA (Contas a Pagar / Contas a Receber).
 *
 * Pedido da Taiene (Shopping Rural), 24/09/2026:
 *  1. ao dar baixa, poder dizer em que DATA foi pago -- o sistema so' sabia
 *     "hoje", e boleto pago ontem ficava como pago hoje;
 *  2. poder ESTORNAR uma baixa errada e quitar de novo. Sem isso ela tinha
 *     medo de baixar qualquer titulo ("depois nao tem como voltar").
 *
 * Este arquivo e' so' a parte pura (regras e validacoes), testavel sem
 * navegador nem Firestore. A gravacao mora nas telas.
 *
 * O ESTORNO DESFAZ TUDO QUE A BAIXA FEZ -- nao so' o status:
 *  - o titulo volta a Pendente;
 *  - o saldo do banco volta ao que era (a baixa debitou/creditou um banco);
 *  - a venda/OS de origem volta a mostrar o pagamento como pendente.
 * O estorno que ja existia no Fluxo de Caixa so' trocava o status e deixava
 * o saldo do banco errado.
 *
 * SO' ESTORNA O QUE FOI BAIXADO POR "DAR BAIXA". Recebimento do balcao (PDV),
 * devolucao, nota avulsa etc. nascem pagos e tem o proprio ciclo de vida:
 * estornar por aqui deixaria a venda constando como paga sem o titulo.
 */
import {
  financialNatureForPayment,
  paymentRequiresBankAccount,
  toCents,
  type FinancialNature,
  type PaymentMethod,
} from './financeDomain';

export const MOTIVO_ESTORNO_MINIMO = 8;
const ANOS_MAXIMO_BAIXA_RETROATIVA = 3;

const FORMATO_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Data em que o titulo foi realmente pago/recebido. Devolve o texto do erro
 * (em portugues, pro usuario final) ou '' quando esta tudo certo.
 */
export const validarDataBaixa = (data: unknown, hoje: string): string => {
  const texto = String(data ?? '').trim();
  const partes = FORMATO_DATA.exec(texto);
  if (!partes) return 'Informe a data em que foi pago.';
  const ano = Number(partes[1]);
  const mes = Number(partes[2]);
  const dia = Number(partes[3]);
  const real = new Date(Date.UTC(ano, mes - 1, dia));
  // 31/02 vira 03/03 no Date: se o dia voltou diferente, a data nao existe.
  if (real.getUTCFullYear() !== ano || real.getUTCMonth() !== mes - 1 || real.getUTCDate() !== dia) {
    return 'Essa data não existe. Confira o dia e o mês.';
  }
  if (texto > hoje) {
    return 'A data do pagamento não pode ser no futuro. Se ainda não foi pago, não dê baixa.';
  }
  if (ano < Number(hoje.slice(0, 4)) - ANOS_MAXIMO_BAIXA_RETROATIVA) {
    return `A data está muito antiga (${ano}). Confira o ano digitado.`;
  }
  return '';
};

/** Motivo obrigatorio no estorno: fica no historico de quem revisar depois. */
export const validarMotivoEstorno = (motivo: unknown): string => {
  const texto = String(motivo ?? '').trim();
  if (texto.length < MOTIVO_ESTORNO_MINIMO) {
    return `Explique o motivo do estorno (mínimo ${MOTIVO_ESTORNO_MINIMO} letras). Ex.: "baixa na data errada".`;
  }
  return '';
};

/**
 * Marca gravada no titulo por "Dar Baixa": e' ela que diz que o titulo foi
 * baixado por esta tela e o que a baixa mexeu no banco. Sem chave `undefined`
 * (o Firestore recusa) -- so' entra o banco quando houve.
 */
export interface BaixaManualRegistro {
  origem: 'contas_pagar' | 'contas_receber';
  formaPagamento: string;
  dataPagamento: string;
  valorCentavos: number;
  bancoId?: string;
  /** Com sinal: negativo = a baixa DEBITOU o banco, positivo = CREDITOU. */
  movimentoBancoCentavos?: number;
}

export const montarBaixaManual = (args: {
  origem: BaixaManualRegistro['origem'];
  formaPagamento: string;
  dataPagamento: string;
  valorCentavos: number;
  bancoId?: string;
  movimentoBancoCentavos?: number;
}): BaixaManualRegistro => ({
  origem: args.origem,
  formaPagamento: args.formaPagamento,
  dataPagamento: args.dataPagamento,
  valorCentavos: args.valorCentavos,
  ...(args.bancoId
    ? { bancoId: args.bancoId, movimentoBancoCentavos: args.movimentoBancoCentavos ?? 0 }
    : {}),
});

/** O que a regra precisa saber do titulo (lancamento em `transacoes`). */
export interface TituloParaEstorno {
  status?: string;
  formaPagamento?: string;
  formaPagamentoOriginal?: string | null;
  valor?: number;
  valorCentavos?: number;
  bancoId?: string;
  dataPagamento?: string;
  naturezaFinanceira?: string;
  ultimaAlteracao?: string;
  baixaManual?: Partial<BaixaManualRegistro> | null;
  boleto?: { status?: string } | null;
  cheque?: unknown;
  sourcePaymentTransactionId?: string;
  notaAvulsaId?: string;
  devolucaoId?: string;
  pedidoOrigemId?: string;
  idempotencyKey?: string;
}

export interface PlanoEstorno {
  permitido: boolean;
  /** Mostrar o botao? Verdadeiro tambem quando bloqueia por um motivo que a
   *  pessoa precisa ler (boleto, cheque, credito). Falso quando o titulo
   *  simplesmente nao veio de uma baixa -- nao adianta poluir a linha. */
  mostrarBotao: boolean;
  /** Frase pronta pro usuario quando `permitido` e' falso. */
  bloqueio: string;
  bancoId?: string;
  /** Quanto o saldo do banco precisa mudar (com sinal) para desfazer a baixa. */
  ajusteBancoCentavos: number;
  /** Forma que o titulo tinha ANTES da baixa (Receber). */
  formaAnterior: string;
  naturezaAnterior: FinancialNature;
}

const centavosDoTitulo = (titulo: TituloParaEstorno): number => (
  Number(titulo.valorCentavos ?? toCents(titulo.valor))
);

const bloqueado = (bloqueio: string, mostrarBotao = true): PlanoEstorno => ({
  permitido: false,
  mostrarBotao,
  bloqueio,
  ajusteBancoCentavos: 0,
  formaAnterior: '',
  naturezaAnterior: 'contas_receber',
});

const ASPAS = (texto: string) => `"${texto}"`;

export const MENSAGEM_SO_PAGA = 'Só dá para estornar uma conta que já foi baixada.';

/** Contas a Pagar: baixa = despesa marcada como paga (debita o banco, se houve). */
export const planejarEstornoPagar = (titulo: TituloParaEstorno): PlanoEstorno => {
  if (titulo.status !== 'Paga') return bloqueado(MENSAGEM_SO_PAGA, false);

  const marca = titulo.baixaManual;
  const forma = String(titulo.formaPagamento || '');
  const base = {
    permitido: true,
    mostrarBotao: true,
    bloqueio: '',
    formaAnterior: forma,
    naturezaAnterior: 'contas_receber' as FinancialNature,
  };

  if (marca?.origem === 'contas_pagar') {
    if (marca.bancoId) {
      return { ...base, bancoId: marca.bancoId, ajusteBancoCentavos: -Number(marca.movimentoBancoCentavos || 0) };
    }
    return { ...base, ajusteBancoCentavos: 0 };
  }

  // Baixa feita antes desta marca existir: a tela debitava o banco na mesma
  // transacao e deixava esta frase como resumo da alteracao.
  if (titulo.ultimaAlteracao === 'Pagamento confirmado' && titulo.bancoId) {
    return { ...base, bancoId: titulo.bancoId, ajusteBancoCentavos: centavosDoTitulo(titulo) };
  }

  if (titulo.notaAvulsaId || titulo.devolucaoId || titulo.pedidoOrigemId || titulo.idempotencyKey) {
    return bloqueado(
      'Este pagamento nasceu junto com outra operação (nota avulsa, devolução ou venda) e não foi uma baixa. '
      + 'Para desfazer, cancele ou estorne a operação de origem.',
      false,
    );
  }

  if (titulo.bancoId) {
    return bloqueado(
      'Este pagamento tem um banco vinculado, mas não foi registrado por "Dar Baixa". '
      + 'Para não errar o saldo do banco, o ajuste deve ser feito em Financeiro > Bancos.',
    );
  }

  // Baixa antiga em dinheiro/sem banco: a tela gravava forma E data do
  // pagamento. Lancamento que nasceu ja' pago (despesa marcada como paga no
  // formulario, estorno de cancelamento de OS...) nao tem essas duas marcas e
  // nao foi baixado por ninguem -- nao mostra botao, senao viraria "conta a
  // pagar" de novo e desalinharia da operacao que o criou.
  if (titulo.dataPagamento && forma) {
    return { ...base, ajusteBancoCentavos: 0 };
  }
  return bloqueado(
    'Este lançamento já nasceu pago (não foi baixado por "Dar Baixa"), então não pode ser estornado por aqui.',
    false,
  );
};

/** Contas a Receber: baixa = recebimento confirmado (credita o banco, se houve, e atualiza a venda/OS). */
export const planejarEstornoReceber = (titulo: TituloParaEstorno): PlanoEstorno => {
  if (titulo.status !== 'Paga') return bloqueado(MENSAGEM_SO_PAGA, false);

  const forma = String(titulo.formaPagamento || '');

  if (
    forma === 'Crédito de Devolução'
    || titulo.naturezaFinanceira === 'credito_cliente'
    || titulo.sourcePaymentTransactionId
  ) {
    return bloqueado(
      `Este recebimento foi pago com crédito do cliente e não pode ser estornado por aqui, `
      + 'porque o crédito já foi consumido. Peça ajuda ao suporte para devolver o crédito.',
    );
  }

  if (forma === 'Boleto' || titulo.boleto?.status === 'pago') {
    return bloqueado(
      'Este boleto foi baixado pelo arquivo de retorno do banco e não pode ser estornado por aqui, '
      + 'para não ficar diferente do que o banco informou. Fale com o suporte se a baixa estiver errada.',
    );
  }

  if (titulo.cheque) {
    return bloqueado(
      'Este recebimento foi feito em cheque e já foi compensado. '
      + 'Não é possível estornar por aqui.',
    );
  }

  const marca = titulo.baixaManual;
  let bancoId: string | undefined;
  let ajusteBancoCentavos = 0;

  if (marca?.origem === 'contas_receber') {
    if (marca.bancoId) {
      bancoId = marca.bancoId;
      ajusteBancoCentavos = -Number(marca.movimentoBancoCentavos || 0);
    }
  } else if (titulo.ultimaAlteracao === 'Recebimento confirmado') {
    // Baixa anterior a marca: creditou o banco quando a forma exige banco.
    if (titulo.bancoId && paymentRequiresBankAccount(forma as PaymentMethod)) {
      bancoId = titulo.bancoId;
      ajusteBancoCentavos = -centavosDoTitulo(titulo);
    }
  } else {
    return bloqueado(
      `Este recebimento não foi feito por ${ASPAS('Dar Baixa')} (foi recebido no balcão ou veio de outra operação). `
      + 'Para desfazer, use a venda ou a devolução de origem.',
      false,
    );
  }

  const formaAnterior = String(titulo.formaPagamentoOriginal || titulo.formaPagamento || '');
  return {
    permitido: true,
    mostrarBotao: true,
    bloqueio: '',
    ...(bancoId ? { bancoId } : {}),
    ajusteBancoCentavos,
    formaAnterior,
    naturezaAnterior: financialNatureForPayment(formaAnterior as PaymentMethod),
  };
};

/** Data dd/mm/aaaa pra mensagem (entrada yyyy-mm-dd). */
export const dataBrasileira = (data?: string): string => (
  data && FORMATO_DATA.test(data) ? data.split('-').reverse().join('/') : ''
);
