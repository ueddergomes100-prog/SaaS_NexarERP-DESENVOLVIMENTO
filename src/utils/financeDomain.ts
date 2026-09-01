import {
  addBusinessDaysToDateInput,
  addDaysToDateInput,
  addMonthsToDateInput,
  differenceInCalendarDays,
  getDateInputInTimeZone,
  parseDateInput,
} from './dateTime';

export type PaymentMethod =
  | 'Dinheiro'
  | 'Pix'
  | 'Cartão de Crédito'
  | 'Cartão de Débito'
  | 'Transferência'
  | 'Boleto'
  | 'Pagamento a Prazo'
  | 'Crédito de Devolução'
  | 'Outros';

export type FinancialNature = 'caixa_fisico' | 'bancario_digital' | 'contas_receber' | 'credito_cliente';

export interface PaymentDraft {
  id: string;
  forma: PaymentMethod;
  valor: string;
  prazoDias: string;
  dataVencimento: string;
  bandeira: string;
  operadora: string;
  autorizacao: string;
  parcelas: string;
  dataPrevistaRecebimento: string;
  /** Banco de destino (Modulo Bancos, F18) -- exigido para Pix/Transferencia/Cartao. */
  bancoId: string;
  bancoNome: string;
}

export interface CardInstallment {
  numero: number;
  valorCentavos: number;
  valor: number;
  valorLiquidoCentavos: number;
  valorLiquido: number;
  dataPrevistaRecebimento?: string;
}

export interface CardPaymentDetails {
  tipo: 'credito' | 'debito';
  bandeira?: string;
  operadora?: string;
  autorizacao?: string;
  parcelas: number;
  taxaPercentual: number;
  valorBrutoCentavos: number;
  valorBruto: number;
  valorTaxaCentavos: number;
  valorTaxa: number;
  valorLiquidoCentavos: number;
  valorLiquido: number;
  dataPrevistaRecebimento?: string;
  detalhamentoParcelas: CardInstallment[];
  /** Posicao desta parcela (1-based) apos explodeInstallmentPaymentRecords. */
  numero?: number;
  /** Total de parcelas da venda original, preservado apos a explosao. */
  totalParcelas?: number;
}

export interface PaymentRecord {
  id: string;
  indice: number;
  formaPagamento: PaymentMethod;
  condicaoPagamento: 'avista' | 'aprazo';
  valorCentavos: number;
  valor: number;
  status: 'confirmado' | 'pendente';
  naturezaFinanceira: FinancialNature;
  movimentaCaixaFisico: boolean;
  prazoDias?: number;
  dataVencimento?: string;
  dataPrevistaRecebimento?: string;
  cartao?: CardPaymentDetails;
  transactionId?: string;
  formaRecebimento?: PaymentMethod;
  naturezaRecebimento?: FinancialNature;
  recebidoEm?: string;
  sourcePaymentTransactionId?: string;
  /** Banco de destino escolhido na venda (Modulo Bancos, F18). */
  bancoId?: string;
  bancoNome?: string;
  /**
   * Em quantas vezes o cliente parcelou na maquininha, APENAS pra sair no
   * recibo. Nao gera transacao, nao mexe em saldo, nao vira conta a receber:
   * o cartao simplificado continua entrando integral, numa transacao so.
   *
   * Proposital que NAO seja `cartao.parcelas` -- aquele comanda o financeiro
   * de verdade (explode em N transacoes, aplica taxa por parcela, agenda
   * recebimento). Ver src/utils/parcelasExibicaoDomain.ts.
   */
  parcelasExibicao?: number;
}

export interface PaymentValidationOptions {
  saleDate?: string;
  operationLabel?: string;
  maxCreditInstallments?: number;
  creditFeePercent?: number;
  creditFeePercentByInstallment?: CreditCardFeeSchedule;
  debitFeePercent?: number;
  creditSettlementDays?: number;
  debitSettlementDays?: number;
  cardFeeSchedulesByBrand?: Record<string, CardFeeSchedule>;
  /** Pagamento de cartão simplificado (Configurações) -- ver resolveBancoPadraoSimplificado. */
  pagamentoCartaoSimplificadoAtivo?: boolean;
  bancoPadraoSimplificado?: { id: string; nome: string } | null;
}

export interface CardFeeSchedule {
  creditFeePercentByInstallment?: CreditCardFeeSchedule;
  creditFeePercent?: number;
  debitFeePercent?: number;
  creditSettlementDays?: number;
  debitSettlementDays?: number;
}

export type CreditCardFeeSchedule = Record<string, number>;

export interface CommissionProfile {
  recebeComissaoPecas?: boolean;
  comissaoPercentualPecas?: number;
}

/** Comissão de UM item da venda -- guardado no snapshot pra devolucao
 * parcial poder recalcular exatamente o item devolvido, em vez de aplicar
 * um percentual medio quando os itens da venda tem percentuais diferentes
 * (produto com comissao propria vs. resto da venda pelo percentual do
 * vendedor). Ver resolveComissaoPercentual. */
export interface CommissionItemSnapshot {
  id: string;
  nome: string;
  baseOriginalCentavos: number;
  baseAtualCentavos: number;
  percentual: number;
  valorOriginalCentavos: number;
  valorAtualCentavos: number;
}

export interface CommissionSnapshot {
  tipo: 'percentual_produtos';
  vendedorId: string;
  vendedorNome: string;
  baseOriginalCentavos: number;
  baseOriginal: number;
  baseAtualCentavos: number;
  baseAtual: number;
  percentual: number;
  valorOriginalCentavos: number;
  valorOriginal: number;
  valorAtualCentavos: number;
  valorAtual: number;
  status: 'gerada' | 'nao_aplicavel' | 'cancelada';
  regraVersion: 1;
  geradaEm: string;
  canceladaEm?: string;
  pagaEm?: string;
  /** Presente so em vendas geradas por buildCommissionSnapshotFromItems.
   * Ausente = snapshot antigo (flat) -- recalculateCommissionAfterReturn
   * cai pro calculo antigo (percentual unico x base agregada) nesse caso. */
  itens?: CommissionItemSnapshot[];
}

export const toCents = (value: number | string | null | undefined) => {
  if (typeof value === 'string') {
    const normalized = value.trim().replace(/\s/g, '').replace(',', '.');
    if (!normalized) return 0;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
  }

  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
};

export const fromCents = (value: number) => Number((value / 100).toFixed(2));

export const splitCents = (totalCents: number, installments: number) => {
  if (!Number.isInteger(installments) || installments < 1) {
    throw new Error('A quantidade de parcelas deve ser maior que zero.');
  }

  const base = Math.floor(totalCents / installments);
  const remainder = totalCents - (base * installments);
  return Array.from({ length: installments }, (_, index) => base + (index < remainder ? 1 : 0));
};

export const parseCreditTerms = (value: unknown) => {
  const terms = String(value ?? '')
    .split(/[;,\s]+/)
    .map((item) => Number.parseInt(item, 10))
    .filter((item) => Number.isInteger(item) && item > 0);
  return Array.from(new Set(terms)).sort((a, b) => a - b);
};

export const normalizeCreditCardFeeSchedule = (
  value: unknown,
  fallbackFeePercent = 0,
): CreditCardFeeSchedule => {
  const source = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  const fallback = Number.isFinite(Number(fallbackFeePercent))
    ? Math.max(0, Math.min(100, Number(fallbackFeePercent)))
    : 0;

  return Object.fromEntries(
    Array.from({ length: 12 }, (_, index) => {
      const installments = index + 1;
      const rawValue = source[String(installments)] ?? source[`${installments}x`] ?? fallback;
      const parsed = Number(String(rawValue ?? '').replace(',', '.'));
      const normalized = Number.isFinite(parsed)
        ? Math.max(0, Math.min(100, parsed))
        : fallback;
      return [String(installments), normalized];
    }),
  );
};

export const creditCardFeeForInstallments = (
  schedule: CreditCardFeeSchedule | undefined,
  installments: number,
  fallbackFeePercent = 0,
) => {
  const normalizedInstallments = Math.max(1, Math.min(12, Number.parseInt(String(installments), 10) || 1));
  return normalizeCreditCardFeeSchedule(schedule, fallbackFeePercent)[String(normalizedInstallments)];
};

/**
 * Constroi o mapa de taxas/prazos por bandeira (chave = nome da bandeira,
 * mesmo texto gravado em PaymentDraft.bandeira) a partir dos documentos
 * de bandeiras_cartao. Bandeiras sem nenhum campo de taxa proprio geram
 * uma entrada vazia -- o chamador deve tratar isso como "sem override",
 * caindo no fallback global (ver normalizePayments).
 */
export const buildCardFeeSchedulesByBrand = (
  bandeiras: Array<{
    nome: string;
    taxaDebitoPercentual?: unknown;
    taxasCreditoPorParcela?: unknown;
    prazoRecebimentoCreditoDias?: unknown;
    prazoRecebimentoDebitoDias?: unknown;
  }>,
): Record<string, CardFeeSchedule> => (
  Object.fromEntries(
    bandeiras
      .map((bandeira) => bandeira.nome?.trim())
      .filter((nome): nome is string => Boolean(nome))
      .map((nome) => {
        const bandeira = bandeiras.find((item) => item.nome?.trim() === nome);
        const schedule: CardFeeSchedule = {};
        if (bandeira?.taxasCreditoPorParcela !== undefined) {
          schedule.creditFeePercentByInstallment = normalizeCreditCardFeeSchedule(bandeira.taxasCreditoPorParcela);
        }
        if (bandeira?.taxaDebitoPercentual !== undefined) {
          const parsed = Number(bandeira.taxaDebitoPercentual);
          schedule.debitFeePercent = Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 0;
        }
        if (bandeira?.prazoRecebimentoCreditoDias !== undefined) {
          const parsed = Number(bandeira.prazoRecebimentoCreditoDias);
          schedule.creditSettlementDays = Number.isFinite(parsed) ? Math.max(0, parsed) : undefined;
        }
        if (bandeira?.prazoRecebimentoDebitoDias !== undefined) {
          const parsed = Number(bandeira.prazoRecebimentoDebitoDias);
          schedule.debitSettlementDays = Number.isFinite(parsed) ? Math.max(0, parsed) : undefined;
        }
        return [nome, schedule];
      }),
  )
);

export const isCardPayment = (method: string) => (
  method === 'Cartão de Crédito' || method === 'Cartão de Débito'
);

export const DEFAULT_PAGAMENTO_CARTAO_SIMPLIFICADO_ATIVO = false;

export const parsePagamentoCartaoSimplificadoAtivo = (value: unknown): boolean => value === true;

/**
 * Nome do banco padrao usado como destino automatico do cartao quando o
 * pagamento simplificado (Configuracoes) esta ligado -- o operador nao
 * escolhe banco nesse modo, entao precisa de um destino fixo e previsivel.
 */
export const SIMPLIFIED_CARD_BANK_NAME = 'BANCO';

/**
 * Acha, entre os bancos ativos do tenant, o banco padrao do pagamento
 * simplificado (nome "BANCO", comparacao sem distincao de maiusculas/
 * espacos). Retorna null se ainda nao foi criado -- nesse caso
 * normalizePayments bloqueia com mensagem clara em vez de adivinhar um
 * destino.
 */
export const resolveBancoPadraoSimplificado = (
  bancos: Array<{ id: string; nome: string; ativo: boolean }>,
): { id: string; nome: string } | null => {
  const match = bancos.find((banco) => (
    banco.ativo && banco.nome.trim().toLowerCase() === SIMPLIFIED_CARD_BANK_NAME.toLowerCase()
  ));
  return match ? { id: match.id, nome: match.nome } : null;
};

export const isPhysicalCashPayment = (method?: string) => method === 'Dinheiro';

/**
 * Pagamentos cujo destino e um banco cadastrado (Modulo Bancos, F18):
 * Pix/Transferencia liquidam na hora, cartao fica pendente ate a
 * conciliacao -- mas em ambos os casos o operador ja escolhe o banco na
 * venda. Dinheiro (caixa fisico) e Boleto/Pagamento a Prazo/Outros (destino
 * incerto ate a baixa) ficam de fora.
 */
export const paymentRequiresBankAccount = (method: PaymentMethod) => (
  method === 'Pix' || method === 'Transferência' || isCardPayment(method)
);

/**
 * Soma por banco quanto cada pagamento confirmado credita (venda/OS
 * finalizada) -- usada tanto pra aplicar o credito quanto, com o mesmo
 * mapa, pra reverte-lo (cancelamento, reabertura, exclusao). Ignora
 * pagamento sem banco escolhido ou ainda nao confirmado (Boleto/Prazo
 * pendente nunca chegou a creditar nada).
 *
 * Usa transactionNetCents, nao valorCentavos bruto: cartao credita o
 * banco pelo valor LIQUIDO da taxa da administradora (conciliado em
 * Banco.tsx, campo cartao.valorLiquidoCentavos), so pra Pix/Transferencia
 * o liquido e igual ao bruto. Usar o bruto aqui fazia a reversao (cancelar/
 * reabrir/excluir) subtrair a mais do que foi creditado de fato, deixando
 * o saldo do banco negativo pelo valor da taxa (achado em teste ao vivo).
 */
export const computeBankCreditsMap = (
  payments: Array<Pick<PaymentRecord, 'status' | 'bancoId' | 'valorCentavos' | 'cartao'>>,
): Map<string, number> => {
  const creditsByBanco = new Map<string, number>();
  payments.forEach((payment) => {
    if (payment.status === 'confirmado' && payment.bancoId) {
      const netCents = transactionNetCents(payment);
      creditsByBanco.set(payment.bancoId, (creditsByBanco.get(payment.bancoId) || 0) + netCents);
    }
  });
  return creditsByBanco;
};

export const financialNatureForPayment = (method: PaymentMethod): FinancialNature => {
  if (method === 'Dinheiro') return 'caixa_fisico';
  if (method === 'Pix' || method === 'Transferência') return 'bancario_digital';
  if (method === 'Crédito de Devolução') return 'credito_cliente';
  return 'contas_receber';
};

export const settledFinancialNatureForPayment = (method: PaymentMethod): FinancialNature => {
  if (method === 'Dinheiro') return 'caixa_fisico';
  if (method === 'Crédito de Devolução') return 'credito_cliente';
  return 'bancario_digital';
};

/** Credito de devolucao entra aqui junto com Dinheiro/Pix/Transferencia: o
 * dinheiro ja esta com a loja desde a devolucao que gerou o credito, entao
 * a parte da venda paga com ele nasce quitada -- nunca vira conta a receber. */
export const paymentIsImmediatelyConfirmed = (method: PaymentMethod) => (
  method === 'Dinheiro' || method === 'Pix' || method === 'Transferência'
  || method === 'Crédito de Devolução'
);

export const buildCardDetails = (args: {
  method: 'Cartão de Crédito' | 'Cartão de Débito';
  grossCents: number;
  installments: number;
  feePercent?: number;
  firstSettlementDate?: string;
  installmentIntervalDays?: number;
  bandeira?: string;
  operadora?: string;
  autorizacao?: string;
}) => {
  const installments = args.method === 'Cartão de Débito' ? 1 : args.installments;
  if (args.method === 'Cartão de Débito' && args.installments !== 1) {
    throw new Error('Cartão de débito não permite parcelamento.');
  }
  if (!Number.isInteger(installments) || installments < 1) {
    throw new Error('Informe uma quantidade válida de parcelas.');
  }

  if (!Number.isInteger(args.grossCents) || args.grossCents <= 0) {
    throw new Error('O valor bruto do cartão deve ser maior que zero.');
  }

  const feePercent = Number.isFinite(Number(args.feePercent))
    ? Math.max(0, Math.min(100, Number(args.feePercent)))
    : 0;
  const feeCents = Math.round(args.grossCents * (feePercent / 100));
  const netCents = Math.max(0, args.grossCents - feeCents);
  const grossInstallments = splitCents(args.grossCents, installments);
  const netInstallments = splitCents(netCents, installments);
  const firstDate = args.firstSettlementDate && parseDateInput(args.firstSettlementDate)
    ? args.firstSettlementDate
    : '';

  const bandeira = args.bandeira?.trim();
  const operadora = args.operadora?.trim();
  const autorizacao = args.autorizacao?.trim();
  const details: CardPaymentDetails = {
    tipo: args.method === 'Cartão de Crédito' ? 'credito' : 'debito',
    ...(bandeira ? { bandeira } : {}),
    ...(operadora ? { operadora } : {}),
    ...(autorizacao ? { autorizacao } : {}),
    parcelas: installments,
    taxaPercentual: feePercent,
    valorBrutoCentavos: args.grossCents,
    valorBruto: fromCents(args.grossCents),
    valorTaxaCentavos: feeCents,
    valorTaxa: fromCents(feeCents),
    valorLiquidoCentavos: netCents,
    valorLiquido: fromCents(netCents),
    ...(firstDate ? { dataPrevistaRecebimento: firstDate } : {}),
    detalhamentoParcelas: grossInstallments.map((amountCents, index) => ({
      numero: index + 1,
      valorCentavos: amountCents,
      valor: fromCents(amountCents),
      valorLiquidoCentavos: netInstallments[index],
      valorLiquido: fromCents(netInstallments[index]),
      ...(firstDate ? {
        dataPrevistaRecebimento: args.installmentIntervalDays !== undefined
          ? addBusinessDaysToDateInput(firstDate, args.installmentIntervalDays * index)
          : addMonthsToDateInput(firstDate, args.method === 'Cartão de Crédito' ? index : 0),
      } : {}),
    })),
  };

  return details;
};

export const createEmptyPaymentDraft = (
  id: string,
  amountCents: number,
  defaultTermDays = 30,
): PaymentDraft => ({
  id,
  forma: 'Dinheiro',
  valor: fromCents(amountCents).toFixed(2),
  prazoDias: String(defaultTermDays),
  dataVencimento: '',
  bandeira: '',
  operadora: '',
  autorizacao: '',
  parcelas: '1',
  dataPrevistaRecebimento: '',
  bancoId: '',
  bancoNome: '',
});

export const normalizePayments = (
  totalCents: number,
  drafts: PaymentDraft[],
  options: PaymentValidationOptions = {},
) => {
  const operationLabel = options.operationLabel?.trim() || 'venda';
  if (totalCents <= 0) throw new Error(`O total da ${operationLabel} deve ser maior que zero.`);
  if (drafts.length === 0) throw new Error('Informe pelo menos uma forma de pagamento.');

  const saleDate = options.saleDate || getDateInputInTimeZone();
  if (!parseDateInput(saleDate)) throw new Error('A data da venda é inválida.');

  const records = drafts.map((draft, index): PaymentRecord => {
    const valueCents = toCents(draft.valor);
    if (valueCents <= 0) throw new Error(`O valor do pagamento ${index + 1} deve ser maior que zero.`);

    // Pagamento simplificado (Configuracoes): cartao confirma na hora, sem
    // bandeira/autorizacao/parcelas, e usa o banco "BANCO" automaticamente
    // em vez do banco escolhido na tela -- ver SIMPLIFIED_CARD_BANK_NAME.
    const isSimplifiedCard = isCardPayment(draft.forma) && options.pagamentoCartaoSimplificadoAtivo === true;
    let effectiveBancoId = draft.bancoId;
    let effectiveBancoNome = draft.bancoNome;
    if (isSimplifiedCard) {
      if (!options.bancoPadraoSimplificado) {
        throw new Error(
          `Nenhum banco padrão "${SIMPLIFIED_CARD_BANK_NAME}" foi encontrado para o pagamento simplificado. `
          + `Abra Financeiro → Bancos e cadastre um banco chamado "${SIMPLIFIED_CARD_BANK_NAME}", `
          + 'ou desligue o pagamento de cartão simplificado em Configurações.',
        );
      }
      effectiveBancoId = options.bancoPadraoSimplificado.id;
      effectiveBancoNome = options.bancoPadraoSimplificado.nome;
    }

    if (paymentRequiresBankAccount(draft.forma) && !effectiveBancoId?.trim()) {
      throw new Error(`Selecione o banco de destino do pagamento ${index + 1}.`);
    }

    const isTerm = draft.forma === 'Pagamento a Prazo';
    const nature = isSimplifiedCard ? 'bancario_digital' : financialNatureForPayment(draft.forma);
    const record: PaymentRecord = {
      id: draft.id,
      indice: index + 1,
      formaPagamento: draft.forma,
      condicaoPagamento: isTerm ? 'aprazo' : 'avista',
      valorCentavos: valueCents,
      valor: fromCents(valueCents),
      status: (paymentIsImmediatelyConfirmed(draft.forma) || isSimplifiedCard) ? 'confirmado' : 'pendente',
      naturezaFinanceira: nature,
      movimentaCaixaFisico: draft.forma === 'Dinheiro',
    };

    if (effectiveBancoId?.trim()) {
      record.bancoId = effectiveBancoId.trim();
      record.bancoNome = effectiveBancoNome?.trim() || '';
    }

    if (isTerm) {
      const informedDays = Number.parseInt(draft.prazoDias, 10);
      const calculatedDueDate = Number.isInteger(informedDays) && informedDays > 0
        ? addDaysToDateInput(saleDate, informedDays)
        : '';
      const dueDate = draft.dataVencimento || calculatedDueDate;
      const dueDays = differenceInCalendarDays(saleDate, dueDate);
      if (!parseDateInput(dueDate) || dueDays === null || dueDays < 1) {
        throw new Error('Pagamento a prazo exige uma data de vencimento válida.');
      }
      record.prazoDias = dueDays;
      record.dataVencimento = dueDate;
    }

    if (isCardPayment(draft.forma) && isSimplifiedCard) {
      record.dataPrevistaRecebimento = saleDate;
      record.cartao = buildCardDetails({
        method: draft.forma,
        grossCents: valueCents,
        installments: 1,
        feePercent: 0,
        firstSettlementDate: saleDate,
      });

      // Parcelamento so pra constar no recibo. `installments: 1` acima
      // continua sendo a verdade financeira: uma transacao, valor integral.
      const parcelasInformadas = Number.parseInt(draft.parcelas, 10);
      if (draft.forma === 'Cartão de Crédito' && Number.isFinite(parcelasInformadas) && parcelasInformadas > 1) {
        record.parcelasExibicao = parcelasInformadas;
      }
    } else if (isCardPayment(draft.forma)) {
      const installments = Number.parseInt(draft.parcelas, 10);
      if (
        draft.forma === 'Cartão de Crédito' &&
        options.maxCreditInstallments &&
        installments > options.maxCreditInstallments
      ) {
        throw new Error(`O cartão de crédito permite no máximo ${options.maxCreditInstallments} parcelas.`);
      }

      const brandKey = draft.bandeira?.trim();
      const brandSchedule = brandKey ? options.cardFeeSchedulesByBrand?.[brandKey] : undefined;
      const effectiveCreditFeePercentByInstallment = brandSchedule?.creditFeePercentByInstallment
        ?? options.creditFeePercentByInstallment;
      const effectiveCreditFeePercent = brandSchedule?.creditFeePercent ?? options.creditFeePercent;
      const effectiveDebitFeePercent = brandSchedule?.debitFeePercent ?? options.debitFeePercent;
      const effectiveCreditSettlementDays = brandSchedule?.creditSettlementDays ?? options.creditSettlementDays;
      const effectiveDebitSettlementDays = brandSchedule?.debitSettlementDays ?? options.debitSettlementDays;

      let firstSettlementDate = draft.dataPrevistaRecebimento;
      if (!firstSettlementDate) {
        const configuredDays = draft.forma === 'Cartão de Crédito'
          ? effectiveCreditSettlementDays
          : effectiveDebitSettlementDays;
        if (Number.isInteger(configuredDays) && Number(configuredDays) >= 0) {
          firstSettlementDate = draft.forma === 'Cartão de Crédito'
            ? addBusinessDaysToDateInput(saleDate, Number(configuredDays))
            : addDaysToDateInput(saleDate, Number(configuredDays));
        }
      }
      if (
        firstSettlementDate &&
        (
          !parseDateInput(firstSettlementDate) ||
          Number(differenceInCalendarDays(saleDate, firstSettlementDate)) < 0
        )
      ) {
        throw new Error('A data prevista de recebimento do cartão é inválida.');
      }

      if (firstSettlementDate) record.dataPrevistaRecebimento = firstSettlementDate;
      const creditFeePercent = creditCardFeeForInstallments(
        effectiveCreditFeePercentByInstallment,
        installments,
        effectiveCreditFeePercent,
      );
      record.cartao = buildCardDetails({
        method: draft.forma,
        grossCents: valueCents,
        installments,
        feePercent: draft.forma === 'Cartão de Crédito'
          ? creditFeePercent
          : effectiveDebitFeePercent,
        firstSettlementDate,
        installmentIntervalDays: draft.forma === 'Cartão de Crédito' ? effectiveCreditSettlementDays : undefined,
        bandeira: draft.bandeira,
        operadora: draft.operadora,
        autorizacao: draft.autorizacao,
      });
    }

    return record;
  });

  const paymentTotal = records.reduce((sum, payment) => sum + payment.valorCentavos, 0);
  if (paymentTotal !== totalCents) {
    throw new Error(`A soma dos pagamentos deve corresponder ao total da ${operationLabel} (${fromCents(totalCents).toFixed(2)}).`);
  }

  return records;
};

/**
 * Explode um pagamento em cartao de credito parcelado em N registros
 * independentes, um por parcela (usando o detalhamento ja calculado por
 * buildCardDetails/normalizePayments) -- para que cada parcela vire seu
 * proprio titulo em Contas a Receber, em vez de um unico titulo com o
 * valor cheio. Debito e credito a vista passam direto, sem alteracao.
 *
 * cartao.parcelas fica 1 em cada registro explodido (mantem
 * applyPaymentReceipt/recebimento parcial funcionando sem mudanca, ja
 * que ele reusa esse campo para decidir quantas parcelas recalcular).
 * numero/totalParcelas guardam a posicao original para exibicao.
 */
export const explodeInstallmentPaymentRecords = (records: PaymentRecord[]): PaymentRecord[] => {
  const exploded = records.flatMap((record): PaymentRecord[] => {
    const totalParcelas = record.cartao?.parcelas ?? 1;
    if (record.formaPagamento !== 'Cartão de Crédito' || !record.cartao || totalParcelas <= 1) {
      return [record];
    }

    const cartao = record.cartao;
    return cartao.detalhamentoParcelas.map((installment): PaymentRecord => {
      const feeCents = Math.max(0, installment.valorCentavos - installment.valorLiquidoCentavos);
      return {
        ...record,
        id: `${record.id}-parcela-${installment.numero}`,
        valorCentavos: installment.valorCentavos,
        valor: installment.valor,
        dataPrevistaRecebimento: installment.dataPrevistaRecebimento || record.dataPrevistaRecebimento,
        cartao: {
          ...cartao,
          parcelas: 1,
          numero: installment.numero,
          totalParcelas,
          valorBrutoCentavos: installment.valorCentavos,
          valorBruto: installment.valor,
          valorTaxaCentavos: feeCents,
          valorTaxa: fromCents(feeCents),
          valorLiquidoCentavos: installment.valorLiquidoCentavos,
          valorLiquido: installment.valorLiquido,
          ...(installment.dataPrevistaRecebimento ? { dataPrevistaRecebimento: installment.dataPrevistaRecebimento } : {}),
          detalhamentoParcelas: [installment],
        },
      };
    });
  });

  return exploded.map((record, index) => ({ ...record, indice: index + 1 }));
};

export const summarizePayments = (payments: PaymentRecord[]) => {
  const receivedCents = payments
    .filter((payment) => payment.status === 'confirmado')
    .reduce((sum, payment) => sum + payment.valorCentavos, 0);
  const pendingCents = payments
    .filter((payment) => payment.status === 'pendente')
    .reduce((sum, payment) => sum + payment.valorCentavos, 0);
  const forms = Array.from(new Set(payments.map((payment) => payment.formaPagamento)));
  const cardFeeCents = payments.reduce(
    (sum, payment) => sum + Number(payment.cartao?.valorTaxaCentavos || 0),
    0,
  );
  const financialNetCents = payments.reduce(
    (sum, payment) => sum + Number(payment.cartao?.valorLiquidoCentavos ?? payment.valorCentavos),
    0,
  );

  return {
    receivedCents,
    received: fromCents(receivedCents),
    pendingCents,
    pending: fromCents(pendingCents),
    cardFeeCents,
    cardFee: fromCents(cardFeeCents),
    financialNetCents,
    financialNet: fromCents(financialNetCents),
    paymentMethodLabel: forms.length === 1 ? forms[0] : 'Múltiplas',
    paymentCondition: payments.some((payment) => payment.condicaoPagamento === 'aprazo')
      ? 'aprazo' as const
      : 'avista' as const,
  };
};

export const applyPaymentReceipt = (
  payments: PaymentRecord[],
  args: {
    transactionId: string;
    paymentIndex?: number;
    amountCents: number;
    method: PaymentMethod;
    receiptId: string;
    receivedAt: string;
  },
) => {
  if (!Number.isInteger(args.amountCents) || args.amountCents <= 0) {
    throw new Error('O valor recebido deve ser maior que zero.');
  }

  const targetIndex = payments.findIndex((payment) => (
    payment.transactionId === args.transactionId ||
    (
      args.paymentIndex !== undefined &&
      payment.indice === args.paymentIndex &&
      payment.status !== 'confirmado'
    )
  ));
  if (targetIndex < 0) {
    throw new Error('O pagamento vinculado à conta a receber não foi encontrado na venda.');
  }

  const target = payments[targetIndex];
  if (args.amountCents > target.valorCentavos) {
    throw new Error('O valor recebido é maior que o saldo do pagamento.');
  }

  const settlementNature = settledFinancialNatureForPayment(args.method);
  if (args.amountCents === target.valorCentavos) {
    return payments.map((payment, index) => index === targetIndex ? {
      ...payment,
      status: 'confirmado' as const,
      formaRecebimento: args.method,
      naturezaRecebimento: settlementNature,
      movimentaCaixaFisico: args.method === 'Dinheiro',
      recebidoEm: args.receivedAt,
    } : payment);
  }

  const remainingCents = target.valorCentavos - args.amountCents;
  const resizedCard = target.cartao
    ? buildCardDetails({
        method: target.formaPagamento as 'Cartão de Crédito' | 'Cartão de Débito',
        grossCents: remainingCents,
        installments: target.cartao.parcelas,
        feePercent: target.cartao.taxaPercentual,
        firstSettlementDate: target.cartao.dataPrevistaRecebimento,
        bandeira: target.cartao.bandeira,
        operadora: target.cartao.operadora,
        autorizacao: target.cartao.autorizacao,
      })
    : undefined;
  const remainingPayment: PaymentRecord = {
    ...target,
    valorCentavos: remainingCents,
    valor: fromCents(remainingCents),
    ...(resizedCard ? { cartao: resizedCard } : {}),
  };
  const receiptPayment: PaymentRecord = {
    id: args.receiptId,
    indice: Math.max(0, ...payments.map((payment) => Number(payment.indice || 0))) + 1,
    formaPagamento: args.method,
    condicaoPagamento: 'avista',
    valorCentavos: args.amountCents,
    valor: fromCents(args.amountCents),
    status: 'confirmado',
    naturezaFinanceira: settlementNature,
    movimentaCaixaFisico: args.method === 'Dinheiro',
    transactionId: args.receiptId,
    formaRecebimento: args.method,
    naturezaRecebimento: settlementNature,
    recebidoEm: args.receivedAt,
    sourcePaymentTransactionId: args.transactionId,
  };

  return [
    ...payments.slice(0, targetIndex),
    remainingPayment,
    ...payments.slice(targetIndex + 1),
    receiptPayment,
  ];
};

const clampPercentual = (valor: number) => Math.max(0, Math.min(100, valor));

/**
 * Resolve o percentual de comissao de UM item vendido, na ordem: produto/
 * servico (comissao propria, se configurada) > vendedor/mecanico (cadastro,
 * se "recebe comissao" = sim) > padrao do sistema (Configuracoes).
 *
 * "Configurado" = valor numerico presente (inclusive 0). Campo em branco no
 * formulario vira `undefined` no documento (ver parseComissaoPercentualInput
 * -- nunca gravamos 0 pra "nao preenchido", senao um vendedor que digitou
 * "0" de proposito ficaria indistinguivel de quem nunca mexeu no campo).
 *
 * `recebeComissao !== true` (false OU nunca configurado) sempre da 0% e
 * PARA -- nao cai pro sistema. Decisao explicita do dono do produto
 * (2026-08-27): todo cadastro de vendedor ja existente esta desmarcado
 * hoje, e isso tem que continuar dando 0%, nao passar a puxar um padrao
 * novo sem ninguem ter pedido.
 */
export const resolveComissaoPercentual = (args: {
  itemPercentual?: number;
  recebeComissao?: boolean;
  percentualVendedor?: number;
  percentualPadraoSistema?: number;
}): number => {
  if (typeof args.itemPercentual === 'number') return clampPercentual(args.itemPercentual);
  if (args.recebeComissao !== true) return 0;
  if (typeof args.percentualVendedor === 'number') return clampPercentual(args.percentualVendedor);
  return clampPercentual(args.percentualPadraoSistema ?? 0);
};

/** Converte o texto digitado num campo de comissao (produto, servico ou
 * vendedor) pro numero a gravar -- ou `undefined` quando o campo ficou em
 * branco, pra o chamador OMITIR a chave no Firestore (nunca gravar
 * `undefined` direto, regra do projeto). Blank != 0: e o que permite a
 * hierarquia acima distinguir "configurado com zero" de "nunca configurado". */
export const parseComissaoPercentualInput = (valor: string): number | undefined => {
  const limpo = valor.trim();
  if (!limpo) return undefined;
  const numero = Number(limpo.replace(',', '.'));
  return Number.isFinite(numero) ? numero : undefined;
};

export const buildCommissionSnapshot = (args: {
  sellerId: string;
  sellerName: string;
  baseCents: number;
  profile?: CommissionProfile | null;
  generatedAt?: string;
}): CommissionSnapshot => {
  const enabled = args.profile?.recebeComissaoPecas === true;
  const percentage = enabled
    ? Math.max(0, Math.min(100, Number(args.profile?.comissaoPercentualPecas || 0)))
    : 0;
  const commissionCents = Math.round(args.baseCents * (percentage / 100));

  return {
    tipo: 'percentual_produtos',
    vendedorId: args.sellerId,
    vendedorNome: args.sellerName,
    baseOriginalCentavos: args.baseCents,
    baseOriginal: fromCents(args.baseCents),
    baseAtualCentavos: args.baseCents,
    baseAtual: fromCents(args.baseCents),
    percentual: percentage,
    valorOriginalCentavos: commissionCents,
    valorOriginal: fromCents(commissionCents),
    valorAtualCentavos: commissionCents,
    valorAtual: fromCents(commissionCents),
    status: percentage > 0 ? 'gerada' : 'nao_aplicavel',
    regraVersion: 1,
    geradaEm: args.generatedAt || new Date().toISOString(),
  };
};

/** Item de entrada pra buildCommissionSnapshotFromItems/buildServiceOrder...
 * -- ja vem com o percentual RESOLVIDO (ver resolveComissaoPercentual);
 * esta funcao so faz a matematica de valor + acumulo, nao decide de onde
 * o percentual vem. */
interface ItemComPercentualResolvido {
  id: string;
  nome: string;
  baseCents: number;
  percentual: number;
}

const buildItensSnapshot = (itens: ItemComPercentualResolvido[]): CommissionItemSnapshot[] =>
  itens.map((item) => {
    const valorCents = Math.round(item.baseCents * (item.percentual / 100));
    return {
      id: item.id,
      nome: item.nome,
      baseOriginalCentavos: item.baseCents,
      baseAtualCentavos: item.baseCents,
      percentual: item.percentual,
      valorOriginalCentavos: valorCents,
      valorAtualCentavos: valorCents,
    };
  });

/**
 * Pedido de Venda (peças), com comissao por item -- substitui o unico
 * percentual flat de buildCommissionSnapshot por um percentual proprio por
 * item (produto com comissao propria vence; senao vendedor; senao sistema
 * -- ver resolveComissaoPercentual, resolvido pelo chamador ANTES de
 * montar `itens`). Guarda o detalhe por item no snapshot (`itens`) pra
 * recalculateCommissionAfterReturn poder devolver so o item certo depois,
 * sem precisar de um percentual medio.
 *
 * buildCommissionSnapshot (a antiga, flat) continua existindo e intocada
 * -- o PDV (src/pages/PDV/PDV.tsx) ainda a usa e nao faz parte desta
 * fatia.
 */
export const buildCommissionSnapshotFromItems = (args: {
  sellerId: string;
  sellerName: string;
  itens: ItemComPercentualResolvido[];
  generatedAt?: string;
}): CommissionSnapshot => {
  const itensSnapshot = buildItensSnapshot(args.itens);
  const baseCents = itensSnapshot.reduce((soma, item) => soma + item.baseOriginalCentavos, 0);
  const commissionCents = itensSnapshot.reduce((soma, item) => soma + item.valorOriginalCentavos, 0);
  const percentualMedio = baseCents > 0 ? Number(((commissionCents / baseCents) * 100).toFixed(4)) : 0;

  return {
    tipo: 'percentual_produtos',
    vendedorId: args.sellerId,
    vendedorNome: args.sellerName,
    baseOriginalCentavos: baseCents,
    baseOriginal: fromCents(baseCents),
    baseAtualCentavos: baseCents,
    baseAtual: fromCents(baseCents),
    percentual: percentualMedio,
    valorOriginalCentavos: commissionCents,
    valorOriginal: fromCents(commissionCents),
    valorAtualCentavos: commissionCents,
    valorAtual: fromCents(commissionCents),
    status: commissionCents > 0 ? 'gerada' : 'nao_aplicavel',
    regraVersion: 1,
    geradaEm: args.generatedAt || new Date().toISOString(),
    itens: itensSnapshot,
  };
};

/**
 * Ordem de Serviço (serviços + peças), com comissao por item -- mesma ideia
 * de buildCommissionSnapshotFromItems, so que em dois grupos separados
 * (serviço e peça tem percentuais resolvidos de fontes diferentes: cada um
 * olha o proprio catalogo, depois recebeComissaoServicos/Pecas do
 * mecanico, depois o padrao do sistema do respectivo tipo). OS nao tem
 * devolucao parcial (so cancelamento total, via cancelCommissionSnapshot),
 * entao os dois grupos aqui sao so pra somar certo o total -- nao precisam
 * do mesmo tratamento de "recalculo por item" que peças de Pedido de Venda.
 */
export const buildServiceOrderCommissionSnapshot = (args: {
  sellerId: string;
  sellerName: string;
  itensServicos: ItemComPercentualResolvido[];
  itensPecas: ItemComPercentualResolvido[];
  generatedAt?: string;
}) => {
  const itensServicosSnapshot = buildItensSnapshot(args.itensServicos);
  const itensPecasSnapshot = buildItensSnapshot(args.itensPecas);

  const baseServicosCentavos = itensServicosSnapshot.reduce((soma, item) => soma + item.baseOriginalCentavos, 0);
  const basePecasCentavos = itensPecasSnapshot.reduce((soma, item) => soma + item.baseOriginalCentavos, 0);
  const valorComissaoServicosCentavos = itensServicosSnapshot.reduce((soma, item) => soma + item.valorOriginalCentavos, 0);
  const valorComissaoPecasCentavos = itensPecasSnapshot.reduce((soma, item) => soma + item.valorOriginalCentavos, 0);

  const baseCents = baseServicosCentavos + basePecasCentavos;
  const commissionCents = valorComissaoServicosCentavos + valorComissaoPecasCentavos;

  return {
    tipo: 'percentual_servicos_produtos',
    vendedorId: args.sellerId,
    vendedorNome: args.sellerName,
    baseOriginalCentavos: baseCents,
    baseOriginal: fromCents(baseCents),
    baseAtualCentavos: baseCents,
    baseAtual: fromCents(baseCents),
    percentual: baseCents > 0 ? Number(((commissionCents / baseCents) * 100).toFixed(4)) : 0,
    baseServicosCentavos,
    baseServicos: fromCents(baseServicosCentavos),
    basePecasCentavos,
    basePecas: fromCents(basePecasCentavos),
    valorComissaoServicosCentavos,
    valorComissaoServicos: fromCents(valorComissaoServicosCentavos),
    valorComissaoPecasCentavos,
    valorComissaoPecas: fromCents(valorComissaoPecasCentavos),
    valorOriginalCentavos: commissionCents,
    valorOriginal: fromCents(commissionCents),
    valorAtualCentavos: commissionCents,
    valorAtual: fromCents(commissionCents),
    status: commissionCents > 0 ? 'gerada' as const : 'nao_aplicavel' as const,
    regraVersion: 1,
    geradaEm: args.generatedAt || new Date().toISOString(),
    itensServicos: itensServicosSnapshot,
    itensPecas: itensPecasSnapshot,
  };
};

/**
 * Recalcula a comissao apos uma devolucao (parcial ou total).
 *
 * `itensDevolvidos` e' a lista dos itens devolvidos NESTA devolucao (bate
 * por id+nome, igual ao match que DevolucaoVendaModal.tsx ja faz contra os
 * itens da venda -- precisa dos dois porque item "avulso" sem produto no
 * catalogo usa id: 'avulso' repetido em varias linhas da mesma venda).
 *
 * Se o snapshot tem `itens` (venda gerada por buildCommissionSnapshotFromItems,
 * com comissao por item): recalcula CADA item devolvido com o percentual
 * PROPRIO dele e resoma os totais -- devolver so um produto de uma venda
 * com produtos de percentuais diferentes nao pode usar um percentual medio,
 * senao o resultado fica errado pros dois lados (sobra mais ou menos
 * comissao do que o item que ficou realmente vale).
 *
 * Senao (snapshot antigo, sem breakdown por item): mantem exatamente a
 * matematica de sempre -- percentual unico da venda x base agregada
 * reduzida. Zero mudanca de comportamento pra vendas ja existentes.
 */
export const recalculateCommissionAfterReturn = (
  snapshot: CommissionSnapshot,
  itensDevolvidos: Array<{ id: string; nome: string; baseCents: number }>,
) => {
  if (snapshot.itens && snapshot.itens.length > 0) {
    const itensAtualizados = snapshot.itens.map((item) => {
      const devolvido = itensDevolvidos.find((d) => d.id === item.id && d.nome === item.nome);
      if (!devolvido) return item;
      const baseAtual = Math.max(0, item.baseAtualCentavos - devolvido.baseCents);
      const valorAtual = Math.round(baseAtual * (item.percentual / 100));
      return { ...item, baseAtualCentavos: baseAtual, valorAtualCentavos: valorAtual };
    });
    const baseCents = itensAtualizados.reduce((soma, item) => soma + item.baseAtualCentavos, 0);
    const commissionCents = itensAtualizados.reduce((soma, item) => soma + item.valorAtualCentavos, 0);
    return {
      ...snapshot,
      baseAtualCentavos: baseCents,
      baseAtual: fromCents(baseCents),
      valorAtualCentavos: commissionCents,
      valorAtual: fromCents(commissionCents),
      status: commissionCents > 0 ? 'gerada' as const : 'nao_aplicavel' as const,
      itens: itensAtualizados,
    };
  }

  const returnedBaseCents = itensDevolvidos.reduce((soma, item) => soma + item.baseCents, 0);
  const baseCents = Math.max(0, snapshot.baseAtualCentavos - returnedBaseCents);
  const commissionCents = Math.round(baseCents * (snapshot.percentual / 100));
  return {
    ...snapshot,
    baseAtualCentavos: baseCents,
    baseAtual: fromCents(baseCents),
    valorAtualCentavos: commissionCents,
    valorAtual: fromCents(commissionCents),
    status: snapshot.percentual > 0 ? 'gerada' as const : 'nao_aplicavel' as const,
  };
};

export const cancelCommissionSnapshot = (
  snapshot: CommissionSnapshot,
  cancelledAt = new Date().toISOString(),
) => ({
  ...snapshot,
  valorAtualCentavos: 0,
  valorAtual: 0,
  status: 'cancelada' as const,
  canceladaEm: cancelledAt,
});

/**
 * Data em que o titulo VENCE (nao a da operacao que o gerou).
 *
 * Precedencia: vencimento explicito (prazo/boleto) > repasse previsto da
 * administradora (cartao) > `data` > vazio. Importa porque numa venda no
 * cartao `data` guarda a data da VENDA, e o dinheiro so entra em
 * dataPrevistaRecebimento (+30 dias, tipicamente) -- usar `data` marcava a
 * parcela como atrasada no dia seguinte a venda.
 *
 * Fonte unica pra ContasReceber.tsx e Dashboard.tsx, que antes tinham a
 * mesma regra escrita (e divergindo) em cada tela.
 */
export const transactionDueDateInput = (transaction: {
  dataVencimento?: string | null;
  dataPrevistaRecebimento?: string | null;
  data?: string | null;
}): string => (
  transaction.dataVencimento || transaction.dataPrevistaRecebimento || transaction.data || ''
);

export const transactionMovesPhysicalCash = (transaction: {
  movimentaCaixaFisico?: boolean;
  formaPagamento?: string;
  naturezaFinanceira?: string;
}) => {
  if (typeof transaction.movimentaCaixaFisico === 'boolean') {
    return transaction.movimentaCaixaFisico;
  }
  return transaction.formaPagamento === 'Dinheiro' || transaction.naturezaFinanceira === 'caixa_fisico';
};

interface FinancialTransactionValue {
  valor?: number;
  valorCentavos?: number;
  valorBruto?: number;
  valorBrutoCentavos?: number;
  valorTaxa?: number;
  valorTaxaCentavos?: number;
  valorLiquido?: number;
  valorLiquidoCentavos?: number;
  cartao?: Partial<CardPaymentDetails> | null;
}

const transactionOriginalGrossCents = (transaction: FinancialTransactionValue) => (
  Number(
    transaction.valorBrutoCentavos
      ?? transaction.cartao?.valorBrutoCentavos
      ?? transaction.valorCentavos
      ?? toCents(transaction.valorBruto ?? transaction.valor),
  )
);

export const transactionGrossCents = (transaction: FinancialTransactionValue) => (
  Number(
    transaction.valorCentavos
      ?? (
        transaction.valor !== undefined
          ? toCents(transaction.valor)
          : transactionOriginalGrossCents(transaction)
      ),
  )
);

export const transactionFeeCents = (transaction: FinancialTransactionValue) => {
  const currentGrossCents = transactionGrossCents(transaction);
  const originalGrossCents = transactionOriginalGrossCents(transaction);
  const originalFeeCents = Number(
    transaction.valorTaxaCentavos
      ?? transaction.cartao?.valorTaxaCentavos
      ?? toCents(transaction.valorTaxa),
  );

  if (originalGrossCents <= 0 || currentGrossCents === originalGrossCents) {
    return Math.max(0, originalFeeCents);
  }

  return Math.max(0, Math.round(currentGrossCents * (originalFeeCents / originalGrossCents)));
};

export const transactionNetCents = (transaction: FinancialTransactionValue) => {
  const currentGrossCents = transactionGrossCents(transaction);
  const originalGrossCents = transactionOriginalGrossCents(transaction);
  const hasExplicitNet = transaction.valorLiquidoCentavos !== undefined
    || transaction.cartao?.valorLiquidoCentavos !== undefined
    || transaction.valorLiquido !== undefined;
  if (!hasExplicitNet) {
    return Math.max(0, currentGrossCents - transactionFeeCents(transaction));
  }
  const originalNetCents = Number(
    transaction.valorLiquidoCentavos
      ?? transaction.cartao?.valorLiquidoCentavos
      ?? toCents(transaction.valorLiquido),
  );

  if (originalGrossCents <= 0 || currentGrossCents === originalGrossCents) {
    return Math.max(0, originalNetCents);
  }

  return Math.max(0, Math.round(currentGrossCents * (originalNetCents / originalGrossCents)));
};

/**
 * Valida uma transferencia manual entre dois bancos cadastrados (Modulo
 * Bancos, F18) antes de gravar o par de lancamentos_bancarios. Lanca erro
 * descritivo em vez de retornar boolean para reaproveitar o mesmo padrao
 * de showError(error.message) ja usado em todo o financeDomain.
 */
export const validateBankTransfer = (args: {
  originId: string;
  destinationId: string;
  amountCents: number;
}): void => {
  if (!args.originId || !args.destinationId) {
    throw new Error('Selecione o banco de origem e o banco de destino.');
  }
  if (args.originId === args.destinationId) {
    throw new Error('O banco de origem deve ser diferente do banco de destino.');
  }
  if (!Number.isInteger(args.amountCents) || args.amountCents <= 0) {
    throw new Error('O valor da transferência deve ser maior que zero.');
  }
};

export const transactionGrossAmount = (transaction: FinancialTransactionValue) => fromCents(transactionGrossCents(transaction));
export const transactionFeeAmount = (transaction: FinancialTransactionValue) => fromCents(transactionFeeCents(transaction));
export const transactionNetAmount = (transaction: FinancialTransactionValue) => fromCents(transactionNetCents(transaction));

/**
 * Categorias que o sistema grava quando ANULA uma receita ja lancada. O
 * cancelamento nao apaga a entrada original (isso preservaria o historico):
 * grava um lancamento de saida compensatorio -- ver OSForm.tsx
 * ("Cancelamento de OS"), PedidoVendaForm.tsx ("Cancelamento de Venda") e
 * DevolucaoVendaModal.tsx ("Devolucao de Venda").
 */
export const REVENUE_REVERSAL_CATEGORIES = [
  'Cancelamento de OS',
  'Cancelamento de Venda',
  'Devolução de Venda',
] as const;

export interface ReversibleTransaction {
  tipo?: string;
  categoria?: string;
  sourceType?: string;
}

/**
 * Identifica lancamentos que ANULAM receita, em vez de serem despesa real.
 *
 * Sem isso, uma OS cancelada aparecia duas vezes errada no mesmo painel: a
 * entrada original continuava somando na receita, e o estorno entrava como
 * "despesa" -- o saldo fechava, mas receita e despesa ficavam infladas.
 *
 * O `tipo === 'saida'` NAO e' redundante e nao pode ser removido: o
 * "estorno da devolucao" (PedidoVendaForm.tsx, `estorno_devolucao_*`) usa a
 * MESMA categoria 'Devolução de Venda' com `tipo: 'entrada'`, porque desfaz
 * a devolucao e traz a receita de volta. Sem essa guarda, essa receita
 * legitima seria anulada por engano.
 */
export const isRevenueReversal = (transaction: ReversibleTransaction): boolean => {
  if (transaction.tipo !== 'saida') return false;

  const categoria = String(transaction.categoria || '').trim();
  if ((REVENUE_REVERSAL_CATEGORIES as readonly string[]).includes(categoria)) return true;

  // Rede de seguranca pra estornos que venham sem categoria preenchida.
  return String(transaction.sourceType || '').startsWith('cancelamento_');
};
