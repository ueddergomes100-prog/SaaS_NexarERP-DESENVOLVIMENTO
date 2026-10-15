import { addDaysToDateInput, differenceInCalendarDays, parseDateInput } from './dateTime';
import type { PaymentDraft } from './financeDomain';

/**
 * PRE-VENDA FATURADA EM OUTRO DIA (pedido do cliente, decisao do dono de
 * 15/10/2026): vale SEMPRE a data do faturamento, sem perguntar.
 *
 * A data da venda vira o dia em que se fatura, e os vencimentos do boleto e
 * do pagamento a prazo passam a contar dali. Antes eles ficavam presos ao dia
 * em que a pre-venda foi feita: o boleto de "30 dias" de uma pre-venda de
 * 10/10 faturada em 15/10 vencia em 09/11, com 25 dias de prazo de verdade.
 *
 * Os vencimentos andam o mesmo numero de dias que separa a pre-venda do
 * faturamento: o prazo combinado com o cliente (30 dias, 15/30/45, ou uma data
 * digitada) continua o mesmo, contado do faturamento. Cheque nao muda (a data
 * de compensacao e' a escrita no cheque), nem cartao, Pix ou dinheiro.
 */

/** Dias entre a data da pre-venda e o faturamento (0 quando nao da para saber ou nao andou). */
export const diasAteOFaturamento = (dataDaPreVenda: string, dataDoFaturamento: string): number => {
  if (!parseDateInput(dataDaPreVenda) || !parseDateInput(dataDoFaturamento)) return 0;
  const dias = Number(differenceInCalendarDays(dataDaPreVenda, dataDoFaturamento));
  return Number.isFinite(dias) && dias > 0 ? dias : 0;
};

const andar = (data: string, dias: number): string => (parseDateInput(data) ? addDaysToDateInput(data, dias) : data);

export const reancorarVencimentosNoFaturamento = (
  pagamentos: PaymentDraft[],
  dataDaPreVenda: string,
  dataDoFaturamento: string,
): PaymentDraft[] => {
  const dias = diasAteOFaturamento(dataDaPreVenda, dataDoFaturamento);
  if (dias === 0) return pagamentos;
  return pagamentos.map((pagamento) => {
    if (pagamento.forma === 'Boleto') {
      return {
        ...pagamento,
        dataPrevistaRecebimento: andar(pagamento.dataPrevistaRecebimento, dias),
        ...(Array.isArray(pagamento.parcelasPersonalizadas) ? {
          parcelasPersonalizadas: pagamento.parcelasPersonalizadas.map((parcela) => ({ ...parcela, vencimento: andar(parcela.vencimento, dias) })),
        } : {}),
      };
    }
    if (pagamento.forma === 'Pagamento a Prazo') {
      return { ...pagamento, dataVencimento: andar(pagamento.dataVencimento, dias) };
    }
    return pagamento;
  });
};
