import { buildChequeDetails, fromCents, toCents } from './financeDomain';
import { camposDoTituloEmCheque, erroDosCheques, type BancoDoCheque, type ParcelaComCheque } from './chequeEmitidoDomain';
import {
  conferirParcelas,
  destinoDaParcelaPaga,
  FORMA_CHEQUE as CHEQUE,
  FORMAS_DE_PAGAMENTO,
  formaDaParcela,
  formaDoPagamentoNaEntrada,
} from './pagamentoEntradaDomain';

/*
 * DESPESA PARCELADA (pedido do dono, 2026-09-24): lancar uma despesa em varias
 * parcelas -- boleto, PIX, transferencia ou CHEQUES -- de uma vez, cada parcela
 * um titulo proprio no Contas a Pagar, com vencimento proprio.
 *
 * Regra pura: recebe o formulario e devolve os titulos prontos para gravar
 * (sem tenantId/metadados, que a tela acrescenta). Nunca `undefined`.
 */

export interface DadosDaDespesa {
  descricao: string;
  categoria: string;
  fornecedorId?: string;
  fornecedorNome?: string;
  /** Forma em que sera paga (Boleto, PIX, Transferencia, Dinheiro, Cheque, Cartao, Outros). */
  forma: string;
  /** Veiculo da frota a que a despesa pertence (opcional). */
  veiculoId?: string;
  veiculoNome?: string;
  veiculoPlaca?: string;
  motoristaId?: string;
  motoristaNome?: string;
}

export interface TituloDaDespesa {
  descricao: string;
  data: string;
  valor: number;
  valorCentavos: number;
  categoria: string;
  status: 'Pendente';
  tipo: 'saida';
  formaPagamentoPrevista: string;
  parcela?: number;
  totalParcelas?: number;
  grupoParcelasId?: string;
  fornecedorId?: string;
  fornecedorNome?: string;
  veiculoId?: string;
  veiculoNome?: string;
  veiculoPlaca?: string;
  motoristaId?: string;
  motoristaNome?: string;
  // So' cheque:
  formaPagamento?: 'Cheque';
  bancoId?: string;
  bancoNome?: string;
  cheque?: ReturnType<typeof camposDoTituloEmCheque>['cheque'];
  dataPrevistaRecebimento?: string;
}

const FORMA_CHEQUE = 'Cheque';

/** Problema que IMPEDE lancar (em portugues, dizendo o que fazer), ou null. A soma que nao fecha e' tratada a parte. */
export const erroDaDespesa = (
  dados: DadosDaDespesa,
  parcelas: ParcelaComCheque[],
  totalDaDespesa: number,
  bancos: BancoDoCheque[],
): string | null => {
  if (!dados.descricao.trim()) return 'Informe a descrição da despesa.';
  if (!dados.categoria.trim()) return 'Escolha a categoria da despesa.';
  if (!(toCents(totalDaDespesa) > 0)) return 'Informe o valor da despesa (maior que zero).';
  const conferencia = conferirParcelas(parcelas, totalDaDespesa);
  if (conferencia.erro) return conferencia.erro;
  if (dados.forma === FORMA_CHEQUE) return erroDosCheques(parcelas, bancos);
  return null;
};

/** A soma das parcelas nao fecha com o total? (aviso, a tela pede confirmacao) */
export const avisoDeSoma = (parcelas: ParcelaComCheque[], totalDaDespesa: number): string | null => (
  conferirParcelas(parcelas, totalDaDespesa).aviso
);

/**
 * Titulos da despesa, um por parcela. Com mais de uma parcela, a descricao ganha
 * "(Parcela i/n)" e todas levam o mesmo `grupoParcelasId` (para achar o
 * parcelamento inteiro depois).
 */
export const montarTitulosDaDespesa = (
  dados: DadosDaDespesa,
  parcelas: ParcelaComCheque[],
  bancos: BancoDoCheque[],
  grupoParcelasId: string,
): TituloDaDespesa[] => {
  const total = parcelas.length;
  const descricaoBase = dados.descricao.toUpperCase().trim();
  const categoria = dados.categoria.toUpperCase().trim();
  return parcelas.map((parcela, indice) => {
    const cheque = dados.forma === FORMA_CHEQUE ? camposDoTituloEmCheque(parcela, bancos) : null;
    const centavos = toCents(parcela.valor);
    return {
      descricao: total > 1 ? `${descricaoBase} (Parcela ${indice + 1}/${total})` : descricaoBase,
      data: cheque ? cheque.cheque.dataCompensacao : parcela.vencimento,
      valor: fromCents(centavos),
      valorCentavos: centavos,
      categoria,
      status: 'Pendente' as const,
      tipo: 'saida' as const,
      formaPagamentoPrevista: dados.forma,
      ...(total > 1 ? { parcela: indice + 1, totalParcelas: total, grupoParcelasId } : {}),
      ...(dados.fornecedorId && dados.fornecedorNome ? { fornecedorId: dados.fornecedorId, fornecedorNome: dados.fornecedorNome } : {}),
      ...(dados.veiculoId ? { veiculoId: dados.veiculoId, veiculoNome: dados.veiculoNome || '', ...(dados.veiculoPlaca ? { veiculoPlaca: dados.veiculoPlaca } : {}) } : {}),
      ...(dados.motoristaId ? { motoristaId: dados.motoristaId, motoristaNome: dados.motoristaNome || '' } : {}),
      ...(cheque || {}),
    };
  });
};

/*
 * PARCELAS COM FORMA PROPRIA E PARCELA JA' PAGA (pedido do dono, 24/11/2026).
 *
 * Entrada de nota (XML e Nota Avulsa): cada parcela tem a sua forma (boleto,
 * cheque, PIX...) e pode nascer JA' PAGA -- "a parte ja' paga ja' tem que
 * debitar automatico onde ele escolher". A parcela paga vira titulo Pago com
 * os MESMOS campos do "A vista (ja' paga na entrada)" da nota inteira, e o
 * saldo do banco e' debitado na mesma gravacao da nota (debitosDasParcelasPagas).
 * Cheque pago = cheque a vista: sai do banco do cheque, e o numero fica no
 * titulo como informacao.
 */

const DATA_ISO_PARCELA = /^\d{4}-\d{2}-\d{2}$/;

export interface OpcoesDasParcelas {
  /** Forma do topo do cartao: vale para a parcela sem forma propria. */
  formaPadrao: string;
  bancos: BancoDoCheque[];
}

/**
 * Primeiro problema das parcelas por forma (em portugues, dizendo o que
 * fazer), ou null. Soma e datas vazias ficam com conferirParcelas.
 */
export const erroDasParcelasPorForma = (
  parcelas: ParcelaComCheque[],
  opcoes: OpcoesDasParcelas & { hoje: string },
): string | null => {
  const { formaPadrao, bancos, hoje } = opcoes;
  for (const parcela of parcelas) {
    const forma = formaDaParcela(parcela, formaPadrao);
    if (!(FORMAS_DE_PAGAMENTO as readonly string[]).includes(forma)) return `Escolha a forma de pagamento da parcela ${parcela.numero}.`;
    if (!parcela.jaPaga) continue;
    if (DATA_ISO_PARCELA.test(parcela.vencimento) && parcela.vencimento > hoje) {
      return `A parcela ${parcela.numero} está marcada como já paga, mas a data é futura. Informe o dia em que foi paga (hoje ou antes) ou desmarque "Já paga".`;
    }
    if (destinoDaParcelaPaga(parcela, formaPadrao) === 'banco' && !bancos.some((b) => b.id === parcela.bancoId)) {
      return forma === CHEQUE
        ? `Escolha de qual banco saiu o cheque da parcela ${parcela.numero}.`
        : `Escolha de qual banco saiu o pagamento da parcela ${parcela.numero}, ou marque "Caixa" se foi em dinheiro.`;
    }
  }
  // Cheque a compensar: banco, numero e data obrigatorios (como sempre).
  const aCompensar = parcelas.filter((p) => !p.jaPaga && formaDaParcela(p, formaPadrao) === CHEQUE);
  const erroCheques = erroDosCheques(aCompensar, bancos);
  if (erroCheques) return erroCheques;
  // Numero repetido no mesmo banco, contando tambem o cheque ja' pago.
  const vistos = new Set<string>();
  for (const parcela of parcelas) {
    const numero = String(parcela.numeroCheque ?? '').trim();
    if (formaDaParcela(parcela, formaPadrao) !== CHEQUE || !numero || !parcela.bancoId) continue;
    const chave = `${parcela.bancoId}|${numero}`;
    if (vistos.has(chave)) {
      const banco = bancos.find((b) => b.id === parcela.bancoId)?.nome || '';
      return `O cheque nº ${numero}${banco ? ` do banco ${banco}` : ''} aparece mais de uma vez. Cada cheque precisa de um número diferente.`;
    }
    vistos.add(chave);
  }
  return null;
};

/**
 * Campos do titulo de UMA parcela (forma, status, data, banco, cheque), sem
 * descricao, fornecedor e metadados -- que a tela acrescenta. Nunca `undefined`.
 *  - em aberto: Pendente, com a forma da parcela em `formaPagamento` e em
 *    `formaPagamentoPrevista` (cheque leva banco, numero e data de compensacao);
 *  - ja' paga: Paga na data informada, com a forma/natureza/banco do "A vista".
 */
export const camposDoTituloDaParcela = (parcela: ParcelaComCheque, opcoes: OpcoesDasParcelas) => {
  const { formaPadrao, bancos } = opcoes;
  const forma = formaDaParcela(parcela, formaPadrao);
  const valorCentavos = toCents(parcela.valor);
  const base = {
    data: parcela.vencimento,
    valor: fromCents(valorCentavos),
    valorCentavos,
    formaPagamentoPrevista: forma,
  };
  if (!parcela.jaPaga) {
    return forma === CHEQUE
      ? { ...base, status: 'Pendente' as const, ...camposDoTituloEmCheque(parcela, bancos) }
      : { ...base, status: 'Pendente' as const, formaPagamento: forma };
  }
  const destino = destinoDaParcelaPaga(parcela, formaPadrao);
  const banco = destino === 'banco' ? bancos.find((b) => b.id === parcela.bancoId) : undefined;
  if (destino === 'banco' && !banco) throw new Error(`Escolha de qual banco saiu o pagamento da parcela ${parcela.numero}.`);
  const numeroCheque = String(parcela.numeroCheque ?? '').trim();
  return {
    ...base,
    status: 'Paga' as const,
    dataPagamento: parcela.vencimento,
    formaPagamento: forma === CHEQUE ? CHEQUE : formaDoPagamentoNaEntrada(destino, forma),
    naturezaFinanceira: destino === 'banco' ? 'bancario_digital' as const : 'caixa_fisico' as const,
    movimentaCaixaFisico: destino === 'caixa',
    ...(banco ? { bancoId: banco.id, bancoNome: banco.nome } : {}),
    ...(forma === CHEQUE && banco && numeroCheque
      ? { cheque: buildChequeDetails({ bancoEmissor: banco.nome, numeroCheque, dataCompensacao: parcela.vencimento }) }
      : {}),
  };
};

/** Quanto sai de cada banco AGORA (parcelas ja' pagas pelo banco), em centavos. */
export const debitosDasParcelasPagas = (
  parcelas: ParcelaComCheque[],
  formaPadrao: string,
): Array<{ bancoId: string; centavos: number }> => {
  const porBanco = new Map<string, number>();
  parcelas.forEach((parcela) => {
    if (!parcela.jaPaga || destinoDaParcelaPaga(parcela, formaPadrao) !== 'banco' || !parcela.bancoId) return;
    porBanco.set(parcela.bancoId, (porBanco.get(parcela.bancoId) || 0) + toCents(parcela.valor));
  });
  return [...porBanco.entries()].map(([bancoId, centavos]) => ({ bancoId, centavos }));
};

/** A parcela como fica guardada no registro da nota: so' o que existe (nunca `undefined`). */
export const parcelaParaRegistro = (parcela: ParcelaComCheque, formaPadrao: string) => {
  const forma = formaDaParcela(parcela, formaPadrao);
  const numeroCheque = String(parcela.numeroCheque ?? '').trim();
  const destino = parcela.jaPaga ? destinoDaParcelaPaga(parcela, formaPadrao) : null;
  return {
    numero: parcela.numero,
    vencimento: parcela.vencimento,
    valor: fromCents(toCents(parcela.valor)),
    forma,
    ...(destino ? { jaPaga: true, destino } : {}),
    ...((forma === CHEQUE || destino === 'banco') && parcela.bancoId ? { bancoId: parcela.bancoId } : {}),
    ...(forma === CHEQUE && numeroCheque ? { numeroCheque } : {}),
  };
};
