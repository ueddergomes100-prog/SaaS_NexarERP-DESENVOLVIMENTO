// Funcoes puras de Limite de Credito (venda a prazo em Pedido de Venda, OS,
// Orcamento e PDV). Sem Firestore -- a busca do saldo em aberto do cliente
// fica nas telas que consomem isto (mesmo filtro de transacoes usado em
// ContasReceber.tsx: status 'Pendente', exclui Cartao de Credito/Debito).
//
// So entra em jogo quando a config `trabalhaComLimiteCredito` esta ligada E
// a venda e' a prazo (condicaoPagamento === 'aprazo', calculado em
// financeDomain.ts). Bloqueia direto, sem modo de aviso/senha -- diferente
// do desconto maximo, aqui o pedido do usuario foi um toggle simples
// sim/nao.

export type MotivoBloqueioCredito = 'sem_limite' | 'limite_excedido';

export interface ChecagemLimiteCreditoResult {
  bloqueado: boolean;
  motivo: MotivoBloqueioCredito | null;
}

const toFiniteNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * Confere se uma venda a prazo pode ser finalizada.
 * `limiteDeCreditoCents`: limite cadastrado no cliente, null/undefined/<=0 =
 * sem limite cadastrado.
 * `saldoEmAbertoCents`: soma das transacoes pendentes do cliente, ja em
 * centavos (sem contar a venda atual).
 * `valorVendaCents`: valor da venda que esta sendo finalizada, em centavos.
 */
export const excedeLimiteCredito = (
  limiteDeCreditoCents: number | null | undefined,
  saldoEmAbertoCents: number,
  valorVendaCents: number,
): ChecagemLimiteCreditoResult => {
  const limite = toFiniteNumber(limiteDeCreditoCents);

  if (limite <= 0) return { bloqueado: true, motivo: 'sem_limite' };

  const totalCents = Math.max(0, toFiniteNumber(saldoEmAbertoCents)) + Math.max(0, toFiniteNumber(valorVendaCents));
  if (totalCents > limite) return { bloqueado: true, motivo: 'limite_excedido' };

  return { bloqueado: false, motivo: null };
};

export const parseTrabalhaComLimiteCredito = (raw: unknown): boolean => raw === true;
