/*
 * ALTERAR O VALOR DE UMA PARCELA A RECEBER (pedido do cliente, 15/10/2026).
 *
 * Caso real: a nota fiscal sai com o valor da venda, mas o boleto vai com
 * desconto (ou, menos comum, com um acrescimo combinado). Muda SO' o documento
 * de cobranca -- o titulo em `transacoes` --; a venda/OS e a nota continuam com
 * o valor cheio.
 *
 * Regras (decididas com o dono em 15/10/2026):
 *  - pode diminuir e aumentar; o motivo e' obrigatorio e fica gravado;
 *  - so' quem tem "financeiro.alterar_valor_documento" no cadastro do usuario
 *    (dono e administrador, sempre); quem confere e grava e' o servidor;
 *  - qualquer parcela EM ABERTO do Contas a Receber (venda, OS ou manual);
 *  - parcela com boleto emitido: bloqueia ate' desfazer a emissao; boleto que
 *    ja' foi para o banco (remessa) ou pago: bloqueia sempre;
 *  - cartao e cheque nao: o valor e' o que a operadora paga / o que esta'
 *    escrito no cheque.
 *
 * Venda/OS de origem: o pagamento ligado a parcela continua com o valor da
 * venda (e' dele que saem as duplicatas da nota). Quando a parcela alterada e'
 * quitada, o pagamento da venda e' quitado por INTEIRO -- a diferenca e'
 * desconto/acrescimo da cobranca, nao saldo em aberto. Sem isso a venda
 * ficaria "Parcial" para sempre (ver centavosParaAOrigem).
 *
 * Gravacao: so' `valor`/`valorCentavos` mudam. `valorBrutoCentavos` e
 * `valorLiquidoCentavos` ficam como nasceram -- transactionNetCents escala o
 * liquido pelo valor atual, o mesmo que o abatimento com credito ja' faz.
 */
import { isCardPayment, pagamentoDoTitulo, toCents, type PaymentRecord } from './financeDomain';

export const PERMISSAO_ALTERAR_VALOR = 'financeiro.alterar_valor_documento';
export const MOTIVO_ALTERACAO_MINIMO = 5;
export const MOTIVO_ALTERACAO_MAXIMO = 255;

/** Gravado no titulo a cada alteracao (a data, `em`, quem grava e' o servidor). */
export interface AlteracaoValorRegistro {
  /** Valor da parcela antes da PRIMEIRA alteracao. */
  valorOriginalCentavos: number;
  valorAnteriorCentavos: number;
  valorNovoCentavos: number;
  /** Soma de todas as alteracoes. 0 = a parcela voltou ao valor de antes. */
  diferencaCentavos: number;
  motivo: string;
  porUid: string;
  porEmail?: string;
  /** Quantas vezes o valor desta parcela ja' foi alterado. */
  vezes: number;
}

export interface TituloParaAlterarValor {
  tipo?: string;
  status?: string;
  valor?: number;
  valorCentavos?: number;
  formaPagamento?: string;
  cartao?: unknown;
  cheque?: unknown;
  boleto?: { status?: string; nossoNumero?: string; numeroRemessa?: number } | null;
  alteracaoValor?: Partial<AlteracaoValorRegistro> | null;
}

const reais = (centavos: number) => (
  (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
);

export const centavosAtuaisDoTitulo = (titulo: TituloParaAlterarValor): number => (
  Number(titulo.valorCentavos ?? toCents(titulo.valor))
);

/** A parcela esta' com valor diferente do que nasceu (por alteracao manual)? */
export const valorAlteradoAtivo = (titulo: TituloParaAlterarValor | null | undefined): boolean => (
  Number(titulo?.alteracaoValor?.diferencaCentavos || 0) !== 0
);

/**
 * Por que esta parcela NAO pode ter o valor alterado agora ('' = pode).
 * A frase ja' diz o que fazer para resolver.
 */
export const bloqueioParaAlterarValor = (titulo: TituloParaAlterarValor): string => {
  if (titulo.tipo && titulo.tipo !== 'entrada') {
    return 'Só parcelas do Contas a Receber podem ter o valor alterado aqui.';
  }
  if (titulo.status === 'Paga') {
    return 'Esta parcela já foi recebida. Para mudar o valor, estorne o recebimento antes (botão Estornar).';
  }
  if (titulo.status === 'Cancelada') {
    return 'Esta parcela está cancelada e não pode ter o valor alterado.';
  }
  if (titulo.status !== 'Pendente') {
    return 'Só parcelas em aberto podem ter o valor alterado. Atualize a tela e tente de novo.';
  }
  if (isCardPayment(String(titulo.formaPagamento || '')) || titulo.cartao) {
    return 'Parcela de cartão é paga pela operadora no valor da venda; o valor não pode ser alterado aqui.';
  }
  if (titulo.formaPagamento === 'Cheque' || titulo.cheque) {
    const numeroCheque = (titulo.cheque as { numeroCheque?: string } | null | undefined)?.numeroCheque;
    const numero = numeroCheque ? ` (nº ${numeroCheque})` : '';
    return `Esta parcela já tem um cheque registrado${numero}. O valor é o que está escrito no cheque e não pode ser alterado aqui.`;
  }
  if (titulo.boleto) {
    const { status, numeroRemessa, nossoNumero } = titulo.boleto;
    if (status === 'pago') return 'O boleto desta parcela já foi pago. O valor não pode mais ser alterado.';
    if (status === 'em_remessa' || numeroRemessa) {
      const remessa = numeroRemessa ? ` (remessa nº ${numeroRemessa})` : '';
      return `O boleto desta parcela já foi enviado ao banco${remessa}. Mudar o valor aqui não muda o boleto registrado no banco: peça ao banco a baixa do boleto, desfaça a emissão em Financeiro › Boletos e então altere o valor.`;
    }
    const numero = nossoNumero ? ` (nosso número ${nossoNumero})` : '';
    return `Esta parcela já tem boleto emitido${numero}. Para mudar o valor, desfaça a emissão em Financeiro › Boletos, altere o valor aqui e emita o boleto de novo.`;
  }
  return '';
};

/** Confere o novo valor (centavos) contra o atual. '' = valido. */
export const validarNovoValorDoTitulo = (atualCentavos: number, novoCentavos: number): string => {
  if (!Number.isInteger(novoCentavos) || novoCentavos <= 0) {
    return 'Informe o novo valor da parcela, em reais e maior que zero.';
  }
  if (novoCentavos === atualCentavos) {
    return 'O novo valor é igual ao valor atual da parcela. Nada foi alterado.';
  }
  // Muito acima do atual e' quase sempre erro de digitacao (virgula esquecida).
  if (novoCentavos > atualCentavos * 3 + 100000) {
    return `O novo valor (${reais(novoCentavos)}) está muito acima do valor atual da parcela (${reais(atualCentavos)}). Confira o valor digitado, em reais e com vírgula.`;
  }
  return '';
};

export const validarMotivoAlteracaoValor = (motivo: unknown): string => {
  const texto = String(motivo ?? '').trim();
  if (texto.length < MOTIVO_ALTERACAO_MINIMO) {
    return `Escreva o motivo da alteração (mínimo ${MOTIVO_ALTERACAO_MINIMO} letras). Ex.: "desconto combinado no boleto".`;
  }
  if (texto.length > MOTIVO_ALTERACAO_MAXIMO) {
    return `O motivo pode ter no máximo ${MOTIVO_ALTERACAO_MAXIMO} letras. Resuma o texto.`;
  }
  return '';
};

/** Registro que vai para o titulo. Sem chave undefined (o Firestore recusa). */
export const montarAlteracaoValor = (a: {
  titulo: TituloParaAlterarValor;
  novoCentavos: number;
  motivo: string;
  porUid: string;
  porEmail?: string | null;
}): AlteracaoValorRegistro => {
  const anterior = a.titulo.alteracaoValor || null;
  const atual = centavosAtuaisDoTitulo(a.titulo);
  const original = Number.isInteger(anterior?.valorOriginalCentavos) ? Number(anterior?.valorOriginalCentavos) : atual;
  return {
    valorOriginalCentavos: original,
    valorAnteriorCentavos: atual,
    valorNovoCentavos: a.novoCentavos,
    diferencaCentavos: Number(anterior?.diferencaCentavos || 0) + (a.novoCentavos - atual),
    motivo: String(a.motivo).trim(),
    porUid: a.porUid,
    ...(a.porEmail ? { porEmail: a.porEmail } : {}),
    vezes: Number(anterior?.vezes || 0) + 1,
  };
};

/** "De R$ 100,00 para R$ 90,00. Motivo: ..." -- para a tela e o log. */
export const resumoDaAlteracaoValor = (registro: Partial<AlteracaoValorRegistro> | null | undefined): string => {
  if (!registro || !Number.isInteger(registro.valorAnteriorCentavos) || !Number.isInteger(registro.valorNovoCentavos)) return '';
  const motivo = registro.motivo ? ` Motivo: ${registro.motivo}` : '';
  return `De ${reais(Number(registro.valorAnteriorCentavos))} para ${reais(Number(registro.valorNovoCentavos))}.${motivo}`;
};

/**
 * Quanto do pagamento da venda/OS um recebimento desta parcela quita.
 *  - parcela sem alteracao: o mesmo valor recebido (regra de sempre);
 *  - parcela alterada e QUITADA: o pagamento inteiro da venda;
 *  - parcela alterada e recebida em parte (abatimento com credito): o
 *    recebido, mas nunca o pagamento inteiro -- ele so' fecha junto com a
 *    parcela.
 */
export const centavosParaAOrigem = (
  pagamentos: PaymentRecord[],
  a: {
    transactionId: string;
    paymentIndex?: number;
    titulo: TituloParaAlterarValor;
    recebidoCentavos: number;
    tituloQuitado: boolean;
  },
): number => {
  if (!valorAlteradoAtivo(a.titulo)) return a.recebidoCentavos;
  const pagamento = pagamentoDoTitulo(pagamentos, { transactionId: a.transactionId, paymentIndex: a.paymentIndex });
  const pagamentoCentavos = Number(pagamento?.valorCentavos || 0);
  if (!(pagamentoCentavos > 0)) return a.recebidoCentavos;
  if (a.tituloQuitado) return pagamentoCentavos;
  return Math.max(1, Math.min(a.recebidoCentavos, pagamentoCentavos - 1));
};

/**
 * Telas que REFAZEM as parcelas de uma venda/OS (alterar forma de pagamento,
 * salvar a OS de novo) apagariam o valor alterado. '' = pode refazer.
 */
export const bloqueioParaRefazerParcelas = (
  titulos: Array<TituloParaAlterarValor & { descricao?: string }>,
  documento: 'venda' | 'OS',
): string => {
  const alterado = titulos.find((t) => t.status !== 'Cancelada' && valorAlteradoAtivo(t));
  if (!alterado) return '';
  const nome = alterado.descricao ? ` "${alterado.descricao}"` : '';
  const atual = centavosAtuaisDoTitulo(alterado);
  const original = atual - Number(alterado.alteracaoValor?.diferencaCentavos || 0);
  return `A parcela${nome} desta ${documento} teve o valor alterado no Contas a Receber (de ${reais(original)} para ${reais(atual)}). Refazer as parcelas apagaria essa alteração. Para continuar, volte a parcela para ${reais(original)} em Financeiro › Contas a Receber (Alterar valor) e tente de novo.`;
};
