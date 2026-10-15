/*
 * BOLETO PARA PARCELA "PAGAMENTO A PRAZO" (pedido do dono, 15/10/2026).
 *
 * A tela de Boletos so' lista titulo com forma "Boleto"; a parcela de uma
 * venda a prazo nao tinha como virar boleto. "Gerar boleto" (Contas a Receber)
 * troca a forma da PARCELA para Boleto -- ela entra em Financeiro > Boletos,
 * aba "Aguardando emissao" -- e marca `boletoDeAPrazo`, para poder voltar:
 * "Voltar a prazo" (sem boleto emitido) ou "Desfazer emissao" em Boletos.
 *
 * A venda nao muda (a condicao dela continua a prazo). De proposito NAO usa
 * `formaPagamentoOriginal`: esse campo e' o que o estorno de uma baixa usa
 * para devolver a forma de antes, e ali tem de voltar "Boleto".
 */
import { financialNatureForPayment } from './financeDomain';

export const FORMA_A_PRAZO = 'Pagamento a Prazo' as const;

export interface TituloParaBoletoDeAPrazo {
  tipo?: string;
  status?: string;
  formaPagamento?: string;
  dataVencimento?: string | null;
  dataPrevistaRecebimento?: string | null;
  boleto?: unknown;
  boletoDeAPrazo?: boolean;
}

/** Por que a parcela NAO pode virar boleto agora ('' = pode). */
export const bloqueioParaGerarBoleto = (titulo: TituloParaBoletoDeAPrazo): string => {
  if (titulo.tipo && titulo.tipo !== 'entrada') return 'Só parcelas do Contas a Receber viram boleto.';
  if (titulo.status === 'Paga') return 'Esta parcela já foi recebida.';
  if (titulo.status === 'Cancelada') return 'Esta parcela está cancelada.';
  if (titulo.status === 'Renegociada') return 'Esta parcela foi renegociada. O boleto sai pelas parcelas da renegociação.';
  if (titulo.status !== 'Pendente') return 'Só parcelas em aberto viram boleto. Atualize a tela e tente de novo.';
  if (titulo.boleto) return 'Esta parcela já tem boleto emitido. Veja em Financeiro › Boletos.';
  if (titulo.formaPagamento === 'Boleto') return 'Esta parcela já é cobrada em boleto. Emita em Financeiro › Boletos, aba "Aguardando emissão".';
  if (titulo.formaPagamento !== FORMA_A_PRAZO) {
    return `Só parcela "${FORMA_A_PRAZO}" vira boleto por aqui. Esta é "${titulo.formaPagamento || 'sem forma'}".`;
  }
  if (!(titulo.dataVencimento || titulo.dataPrevistaRecebimento)) {
    return 'Esta parcela está sem data de vencimento, e o boleto precisa dela. Confira a venda de origem.';
  }
  return '';
};

/** Por que a parcela NAO pode voltar a ser "a prazo" agora ('' = pode). */
export const bloqueioParaVoltarAPrazo = (titulo: TituloParaBoletoDeAPrazo): string => {
  if (!titulo.boletoDeAPrazo) return 'Esta parcela não foi convertida de "a prazo" para boleto.';
  if (titulo.status !== 'Pendente') return 'Só parcelas em aberto voltam a ser "a prazo".';
  if (titulo.boleto) return 'O boleto desta parcela já foi emitido. Desfaça a emissão em Financeiro › Boletos: ela volta a ser "a prazo" sozinha.';
  return '';
};

/** Campos gravados no titulo ao gerar o boleto. */
export const camposAoGerarBoleto = () => ({
  formaPagamento: 'Boleto' as const,
  naturezaFinanceira: financialNatureForPayment('Boleto'),
  boletoDeAPrazo: true,
});

/** Campos gravados ao voltar a ser "a prazo" (a marca `boletoDeAPrazo` sai em separado). */
export const camposAoVoltarAPrazo = () => ({
  formaPagamento: FORMA_A_PRAZO,
  naturezaFinanceira: financialNatureForPayment(FORMA_A_PRAZO),
});
