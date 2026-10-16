import { acrescimoDosAjustes, type AjustesDaBaixa } from './ajustesDaBaixaDomain';

/**
 * PAGAMENTO PARCIAL (Contas a Receber e a Pagar), pedido do dono de
 * 16/10/2026: "cliente deve uma venda de 1000, vai pagando 100 em 100".
 * Regra pura: a tela e o servidor (server/domain, gerado) usam a mesma.
 *
 * Decisoes do dono (16/10/2026):
 *  - o "Dar Baixa" tem o campo "Valor recebido agora" (ou pago), que ja' vem
 *    com o total; menos que o total = parcial. A conta continua em aberto
 *    com o que falta e mostra "Pago R$ 100,00 de R$ 1.000,00". Cada
 *    pagamento vira um lancamento proprio, com recibo e estorno; a venda/OS
 *    fica "Parcial" ate' quitar;
 *  - conta vencida: juros e multa PROPORCIONAIS a parte paga (os R$ 900 que
 *    ficam pagam juros quando forem pagos);
 *  - vale no Receber e no Pagar (so' na baixa individual; o lote quita).
 *
 * Conta: do valor recebido, `juros + multa` sao acrescimo e o desconto
 * abate a mais. O que sai da conta (o "principal") e'
 *   principal = recebido - juros - multa + desconto.
 */

export const principalDaBaixa = (valorRecebidoCentavos: number, a: AjustesDaBaixa): number => (
  Math.round(Number(valorRecebidoCentavos) || 0) - acrescimoDosAjustes(a) + Math.max(0, Math.round(a.descontoCentavos || 0))
);

/** O total que quita a conta: saldo + juros + multa - desconto. */
export const totalParaQuitar = (saldoCentavos: number, a: AjustesDaBaixa): number => (
  Math.round(saldoCentavos) + acrescimoDosAjustes(a) - Math.max(0, Math.round(a.descontoCentavos || 0))
);

const reais = (centavos: number): string => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(centavos / 100);

/**
 * O que impede receber/pagar esse valor, ou null. `bloqueioParcial` = motivo
 * de a conta nao aceitar parte (boleto emitido, cheque...); so' pesa quando o
 * valor nao quita.
 */
export const erroDoValorRecebido = (
  saldoCentavos: number,
  valorRecebidoCentavos: number,
  a: AjustesDaBaixa,
  opcoes: { bloqueioParcial?: string; pagar?: boolean } = {},
): string | null => {
  const recebido = Math.round(Number(valorRecebidoCentavos) || 0);
  const verbo = opcoes.pagar ? 'pago' : 'recebido';
  if (!Number.isInteger(valorRecebidoCentavos) || recebido <= 0) return `Informe o valor ${verbo} (ex.: 100,00).`;
  const principal = principalDaBaixa(recebido, a);
  if (principal <= 0) return `O valor ${verbo} não cobre os juros e a multa. Diminua os juros/multa ou aumente o valor.`;
  if (principal > saldoCentavos) {
    return `O valor ${verbo} passa do que falta desta conta (${reais(totalParaQuitar(saldoCentavos, a))} com juros, multa e desconto). Confira o valor.`;
  }
  if (principal < saldoCentavos && opcoes.bloqueioParcial) return opcoes.bloqueioParcial;
  return null;
};

/**
 * Juros e multa proporcionais (decisao do dono): o calculado pela filial vale
 * para a conta inteira; do valor recebido, a parte da conta paga juros e
 * multa na mesma proporcao. Desconto entra inteiro.
 *   principal = (recebido + desconto) / (1 + taxaJuros + taxaMulta)
 */
export const separarValorRecebido = (
  saldoCentavos: number,
  valorRecebidoCentavos: number,
  sugestao: { jurosCentavos: number; multaCentavos: number },
  descontoCentavos = 0,
): { principalCentavos: number; jurosCentavos: number; multaCentavos: number } => {
  const saldo = Math.max(0, Math.round(saldoCentavos));
  const recebido = Math.max(0, Math.round(valorRecebidoCentavos));
  const desconto = Math.max(0, Math.round(descontoCentavos));
  const juros = Math.max(0, Math.round(sugestao.jurosCentavos || 0));
  const multa = Math.max(0, Math.round(sugestao.multaCentavos || 0));
  if (saldo === 0) return { principalCentavos: 0, jurosCentavos: 0, multaCentavos: 0 };
  const taxa = (juros + multa) / saldo;
  const estimado = Math.min(saldo, Math.round((recebido + desconto) / (1 + taxa)));
  const jurosParte = Math.round((juros * estimado) / saldo);
  const multaParte = Math.round((multa * estimado) / saldo);
  // O principal fecha a conta com o que foi digitado (o arredondamento fica nele).
  return { principalCentavos: recebido + desconto - jurosParte - multaParte, jurosCentavos: jurosParte, multaCentavos: multaParte };
};

export interface TituloParaParcial {
  formaPagamento?: string;
  boleto?: { status?: string; nossoNumero?: string } | null;
  renegociacao?: unknown;
  status?: string;
}

/** A conta aceita pagamento de uma parte? '' = aceita. Frase pronta para a tela. */
export const bloqueioDoParcial = (titulo: TituloParaParcial): string => {
  const forma = String(titulo.formaPagamento || '');
  if (forma === 'Cartão de Crédito' || forma === 'Cartão de Débito') {
    return 'Conta de cartão não aceita pagamento parcial: o valor vem da operadora. Concilie na tela Banco.';
  }
  if (titulo.boleto && titulo.boleto.status !== 'cancelado') {
    return 'Esta conta tem boleto emitido, e o valor do boleto é fixo. Receba o valor inteiro, ou desfaça a emissão em Financeiro › Boletos antes de receber uma parte.';
  }
  if (titulo.renegociacao) {
    return 'Parcela de renegociação: receba o valor inteiro. Para combinar outro valor, desfaça a renegociação e renegocie de novo.';
  }
  return '';
};

export interface ResumoDoParcial {
  /** O valor da conta antes do primeiro pagamento parcial. */
  valorAntesDoParcialCentavos?: number;
  /** Quanto ja' foi pago por partes. */
  pagoParcialCentavos?: number;
}

/** "Pago R$ 100,00 de R$ 1.000,00" (vazio = nenhum pagamento parcial). */
export const textoDoParcial = (titulo: ResumoDoParcial, pagar = false): string => {
  const pago = Math.round(Number(titulo.pagoParcialCentavos) || 0);
  const original = Math.round(Number(titulo.valorAntesDoParcialCentavos) || 0);
  if (pago <= 0 || original <= 0) return '';
  return `${pagar ? 'Pago' : 'Recebido'} ${reais(pago)} de ${reais(original)}`;
};
