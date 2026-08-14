export type MomentoBaixaEstoque = 'imediato' | 'pedido' | 'caixa' | 'nf';

export const MOMENTO_BAIXA_ESTOQUE_OPTIONS: Array<{ value: MomentoBaixaEstoque; label: string }> = [
  { value: 'imediato', label: 'Baixar imediatamente (padrão)' },
  { value: 'pedido', label: 'Reservar no Pedido' },
  { value: 'caixa', label: 'Baixar no Caixa' },
  { value: 'nf', label: 'Baixar na NF' },
];

export const DEFAULT_MOMENTO_BAIXA_ESTOQUE: MomentoBaixaEstoque = 'imediato';

// Calculo puro do estoque disponivel (quantidade - reservada). Nao depende
// do Firestore. Nesta fatia nao existe nenhum fluxo que escreva
// quantidadeReservada, entao o resultado sera sempre igual a quantidade --
// a funcao existe pronta para a fatia que introduzir mutacoes de reserva.
export const computeAvailableStock = (
  quantidade: number | undefined,
  quantidadeReservada: number | undefined
): number => {
  const qtd = Math.max(0, Number.isFinite(quantidade) ? (quantidade as number) : 0);
  const reservada = Math.max(0, Number.isFinite(quantidadeReservada) ? (quantidadeReservada as number) : 0);
  return Math.max(0, qtd - reservada);
};
