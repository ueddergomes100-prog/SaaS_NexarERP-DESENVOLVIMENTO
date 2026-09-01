/**
 * PARCELAS QUE APARECEM NO PAPEL, SEM CONTROLE FINANCEIRO.
 *
 * ---------------------------------------------------------------------------
 * O PEDIDO
 * ---------------------------------------------------------------------------
 *
 * No pagamento de cartao SIMPLIFICADO (Configuracoes), o cartao e confirmado
 * na hora: entra UMA transacao, com o valor INTEGRAL, direto no banco padrao.
 * Sem bandeira, sem taxa, sem recebimento futuro -- e assim que a empresa
 * pediu, e assim continua.
 *
 * O que faltava era so o papel: o cliente parcelou em 3x na maquininha e o
 * recibo mostrava uma linha unica de R$ 100,00. Agora da pra informar em
 * quantas vezes foi, e o recibo mostra "3 x 33,33".
 *
 * ---------------------------------------------------------------------------
 * O QUE ISTO NAO FAZ
 * ---------------------------------------------------------------------------
 *
 * Nao cria transacao, nao mexe em saldo, nao gera conta a receber e nao muda
 * o que o caixa recebeu. E' informacao impressa, e so.
 *
 * Por isso o numero de parcelas mora em `parcelasExibicao`, um campo proprio,
 * e NAO em `cartao.parcelas`: aquele comanda o financeiro de verdade (explode
 * o pagamento em N transacoes, aplica taxa por parcela e agenda recebimento).
 * Se os dois fossem o mesmo campo, informar "3x" no modo simplificado passaria
 * a mexer no dinheiro -- exatamente o que a empresa NAO quer.
 */

export interface ParcelaExibicao {
  numero: number;
  dataVencimento: string;
  valor: number;
}

/**
 * Divide um valor em N parcelas, em CENTAVOS, sem perder nem sobrar um
 * centavo. R$ 100,00 em 3x vira 33,34 + 33,33 + 33,33.
 *
 * A sobra vai na PRIMEIRA parcela, nao na ultima: e' como a maquininha de
 * cartao faz, entao e' o valor que o cliente vai ver na fatura dele.
 */
export const dividirValorEmParcelas = (valorTotal: number, quantidade: number): number[] => {
  const totalCents = Math.round(Number(valorTotal) * 100);
  const partes = Math.floor(Number(quantidade));

  if (!Number.isFinite(totalCents) || totalCents <= 0) return [];
  if (!Number.isFinite(partes) || partes <= 1) return [totalCents / 100];

  const base = Math.floor(totalCents / partes);
  const sobra = totalCents - base * partes;

  return Array.from({ length: partes }, (_, indice) => (
    (indice === 0 ? base + sobra : base) / 100
  ));
};

/** So o que esta regra precisa enxergar de um pagamento gravado na venda. */
export interface PagamentoComParcelasExibicao {
  valor?: number;
  valorCentavos?: number;
  /** Quantidade informada so pra mostrar no papel (modo simplificado). */
  parcelasExibicao?: number;
}

/**
 * Linhas da tabela de parcelas do recibo.
 *
 * Quem manda e sempre o FINANCEIRO: se a venda gerou mais de uma transacao
 * (cartao parcelado no modo completo, crediario), essas linhas ja sao as
 * verdadeiras, com vencimento de verdade, e nao ha nada a inventar aqui.
 *
 * A divisao so entra quando o financeiro tem uma linha unica e o pagamento
 * declara parcelamento de exibicao -- o caso do cartao simplificado.
 *
 * O vencimento fica VAZIO de proposito. O sistema nao controla essas
 * parcelas, entao nao sabe quando cada uma cai; imprimir uma data calculada
 * seria inventar compromisso que ninguem acompanha.
 */
export const parcelasParaImpressao = (
  parcelasFinanceiras: ParcelaExibicao[],
  pagamentos: PagamentoComParcelasExibicao[] | null | undefined,
): ParcelaExibicao[] => {
  const financeiras = parcelasFinanceiras || [];
  if (financeiras.length > 1) return financeiras;

  const pagamentoParcelado = (pagamentos || []).find((pagamento) => (
    Number(pagamento?.parcelasExibicao) > 1
  ));
  if (!pagamentoParcelado) return financeiras;

  const valor = Number(pagamentoParcelado.valorCentavos) > 0
    ? Number(pagamentoParcelado.valorCentavos) / 100
    : Number(pagamentoParcelado.valor || 0);

  const valores = dividirValorEmParcelas(valor, Number(pagamentoParcelado.parcelasExibicao));
  if (valores.length <= 1) return financeiras;

  return valores.map((valorDaParcela, indice) => ({
    numero: indice + 1,
    dataVencimento: '',
    valor: valorDaParcela,
  }));
};
