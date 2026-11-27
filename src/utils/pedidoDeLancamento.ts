/**
 * "Nova Acao" do Dashboard -> lancar conta (27/11/2026, pedido do dono): o
 * Dashboard pede e a tela de Contas a Receber/Pagar abre a janela de
 * lancamento. Funciona com a tela ainda fechada (ela le o pedido ao montar) e
 * com ela ja' aberta em outra aba (o evento chega na hora). O pedido e' gasto
 * uma vez so'.
 */
export type LancamentoPedido = 'receber' | 'pagar';

const CHAVE = 'hennder.abrirLancamento';
export const EVENTO_ABRIR_LANCAMENTO = 'hennder:abrir-lancamento';

export const pedirLancamento = (qual: LancamentoPedido): void => {
  try {
    sessionStorage.setItem(CHAVE, qual);
  } catch {
    /* sem armazenamento: o evento abaixo ainda abre a tela ja' montada */
  }
  window.dispatchEvent(new CustomEvent(EVENTO_ABRIR_LANCAMENTO, { detail: qual }));
};

/** true uma vez, se o pedido for para esta tela (e apaga o pedido). */
export const consumirPedidoDeLancamento = (qual: LancamentoPedido): boolean => {
  try {
    if (sessionStorage.getItem(CHAVE) !== qual) return false;
    sessionStorage.removeItem(CHAVE);
    return true;
  } catch {
    return false;
  }
};
