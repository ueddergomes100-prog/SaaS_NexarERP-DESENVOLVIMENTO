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
 * As mesmas formas que o servidor aceita na baixa. No Receber, cheque fica
 * fora: aguarda compensação com os dados de cada cheque. No Pagar, desde
 * 24/11/2026 o cheque emitido se baixa direto no Contas a Pagar (debita o
 * banco na hora), também em lote.
 */
export const FORMAS_DA_BAIXA_EM_LOTE: Record<TipoDoLote, readonly string[]> = {
  saida: ['Dinheiro', 'Pix', 'Cartão de Crédito', 'Cartão de Débito', 'Transferência', 'Boleto', 'Cheque', 'Outros'],
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
 * Esta conta pode ir para o lote? Só em aberto; no Receber nunca cheque
 * (compensação) nem cartão (concilia na tela Banco). No Pagar, cheque entra.
 */
export const podeEntrarNoLote = (titulo: TituloCandidato, tipo: TipoDoLote): boolean => {
  if (titulo.status !== 'Pendente') return false;
  const forma = String(titulo.formaPagamento || '');
  if (tipo === 'entrada' && forma === 'Cheque') return false;
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

/*
 * DESCONTO GERAL NA BAIXA EM LOTE (27/11/2026, pedido do dono: "selecionar todas as
 * contas do cliente e dar desconto geral, em vez de ir notinha por notinha"). O
 * desconto e' repartido entre as contas na proporcao do valor de cada uma, em
 * centavos, sem sobra nem falta (o resto vai para as maiores fracoes). Nenhuma conta
 * recebe desconto maior que o proprio valor. Depois, da' para mexer conta por conta.
 */

/** Reparte `totalCentavos` pelos valores. null = desconto invalido (maior que a soma ou negativo). */
export const ratearDescontoGeral = (valoresCentavos: readonly number[], totalCentavos: number): number[] | null => {
  const valores = valoresCentavos.map((v) => Math.max(0, Math.round(Number(v) || 0)));
  const soma = valores.reduce((a, b) => a + b, 0);
  const total = Math.round(Number(totalCentavos) || 0);
  if (total < 0 || total > soma) return null;
  if (total === 0 || soma === 0) return valores.map(() => 0);
  const exatos = valores.map((v) => (v * total) / soma);
  const partes = exatos.map((e) => Math.floor(e));
  let falta = total - partes.reduce((a, b) => a + b, 0);
  const ordem = exatos.map((e, i) => ({ i, fracao: e - Math.floor(e) })).sort((a, b) => b.fracao - a.fracao || valores[b.i] - valores[a.i]);
  for (const { i } of ordem) {
    if (falta <= 0) break;
    if (partes[i] < valores[i]) { partes[i] += 1; falta -= 1; }
  }
  return partes;
};

/** Percentual (0 a 100) aplicado em cada conta; null = percentual invalido. */
export const descontoPercentualPorConta = (valoresCentavos: readonly number[], percentual: number): number[] | null => {
  const p = Number(percentual);
  if (!Number.isFinite(p) || p < 0 || p > 100) return null;
  return valoresCentavos.map((v) => Math.round((Math.max(0, Math.round(Number(v) || 0)) * p) / 100));
};
