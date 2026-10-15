import { isCardPayment, paymentRequiresBankAccount, type PaymentMethod } from './financeDomain';
import { acrescimoDosAjustes, SEM_AJUSTES, type AjustesDaBaixa } from './ajustesDaBaixaDomain';

/**
 * BAIXA EM LOTE (Contas a Pagar / Contas a Receber, 2026-10-14) — regras puras.
 *
 * Pedido do dono: dar baixa em vários documentos de uma vez. O lote NÃO tem
 * regra própria de baixa: o servidor aplica, conta por conta, a mesma
 * validação e a mesma gravação da baixa individual (server/routes/
 * financeiro.routes.js, /baixa-lote). Aqui fica só o que a tela decide antes:
 * quem pode entrar no lote, as formas, quando o banco é obrigatório e o resumo.
 */

/** O mesmo limite do servidor (LIMITE_BAIXA_EM_LOTE em baixaFinanceiraRegras.js). */
export const LIMITE_BAIXA_EM_LOTE = 50;

export type TipoDoLote = 'entrada' | 'saida';

/**
 * As mesmas formas que o servidor aceita na baixa. Cheque fica fora nos dois
 * lados: no Receber ele aguarda compensação com os dados de cada cheque; no
 * Pagar, cheque emitido se baixa pela compensação (Financeiro › Cheques).
 */
export const FORMAS_DA_BAIXA_EM_LOTE: Record<TipoDoLote, readonly string[]> = {
  saida: ['Dinheiro', 'Pix', 'Cartão de Crédito', 'Cartão de Débito', 'Transferência', 'Boleto', 'Outros'],
  entrada: ['Dinheiro', 'Pix', 'Cartão de Crédito', 'Cartão de Débito', 'Transferência', 'Outros'],
};

/** Mesma regra do servidor (exigeBanco): Pagar — tudo que não é dinheiro sai de um banco; Receber — o que a forma exige. */
export const baixaEmLoteExigeBanco = (tipo: TipoDoLote, forma: string): boolean => (
  tipo === 'saida' ? forma !== 'Dinheiro' : paymentRequiresBankAccount(forma as PaymentMethod)
);

export interface TituloCandidato {
  status?: string;
  formaPagamento?: string;
}

/**
 * Esta conta pode ir para o lote? Só em aberto, nunca cheque (compensação),
 * e no Receber nunca cartão (concilia na tela Banco).
 */
export const podeEntrarNoLote = (titulo: TituloCandidato, tipo: TipoDoLote): boolean => {
  if (titulo.status !== 'Pendente') return false;
  const forma = String(titulo.formaPagamento || '');
  if (forma === 'Cheque') return false;
  if (tipo === 'entrada' && isCardPayment(forma)) return false;
  return true;
};

/**
 * Marca ou desmarca contas na seleção, sem passar do limite. Devolve a nova
 * seleção e quantas ficaram de fora por causa do limite (para avisar).
 */
export const marcarNaSelecao = (
  selecao: ReadonlySet<string>,
  ids: readonly string[],
  marcar: boolean,
  limite = LIMITE_BAIXA_EM_LOTE,
): { selecao: Set<string>; deFora: number } => {
  const nova = new Set(selecao);
  if (!marcar) {
    ids.forEach((id) => nova.delete(id));
    return { selecao: nova, deFora: 0 };
  }
  let deFora = 0;
  ids.forEach((id) => {
    if (nova.has(id)) return;
    if (nova.size >= limite) {
      deFora += 1;
      return;
    }
    nova.add(id);
  });
  return { selecao: nova, deFora };
};

/** Estado da caixa "marcar todos" de um grupo: nenhum, alguns ou todos. */
export const estadoDaSelecao = (selecao: ReadonlySet<string>, ids: readonly string[]): 'nenhum' | 'alguns' | 'todos' => {
  if (ids.length === 0) return 'nenhum';
  const marcados = ids.filter((id) => selecao.has(id)).length;
  if (marcados === 0) return 'nenhum';
  return marcados === ids.length ? 'todos' : 'alguns';
};

export interface ItemDoResumo {
  valorCentavos: number;
  /** Juros, multa e desconto desta conta (15/10/2026). */
  ajustes?: AjustesDaBaixa;
}

export interface ResumoDoLote {
  quantidade: number;
  valorCentavos: number;
  /** Juros + multa. */
  acrescimoCentavos: number;
  descontoCentavos: number;
  /** Valor + juros + multa - desconto: o que entra/sai de fato. */
  totalCentavos: number;
}

export const resumoDoLote = (itens: readonly ItemDoResumo[]): ResumoDoLote => {
  const valorCentavos = itens.reduce((soma, item) => soma + Math.round(item.valorCentavos || 0), 0);
  const acrescimoCentavos = itens.reduce((soma, item) => soma + acrescimoDosAjustes(item.ajustes || SEM_AJUSTES), 0);
  const descontoCentavos = itens.reduce((soma, item) => soma + Math.max(0, Math.round(item.ajustes?.descontoCentavos || 0)), 0);
  return { quantidade: itens.length, valorCentavos, acrescimoCentavos, descontoCentavos, totalCentavos: valorCentavos + acrescimoCentavos - descontoCentavos };
};
