// Nota Avulsa: compra manual de mercadoria sem XML fiscal, pra empresa que
// nao faz analise fiscal na entrada (ver item 2 do pedido do dono, e a
// ressalva em fiscalDomain.ts sobre isso ficar FORA do gate de
// controlaFiscal -- e a ferramenta pra quem nao controla fiscal).
//
// Mesma dupla ativa/cancelada de tudo que passou a nao ter mais exclusao
// fisica -- nunca existe deleteDoc pra notas_avulsas.

export const STATUS_NOTA_AVULSA_ATIVA = 'ativa';
export const STATUS_NOTA_AVULSA_CANCELADA = 'cancelada';

export type StatusNotaAvulsa = typeof STATUS_NOTA_AVULSA_ATIVA | typeof STATUS_NOTA_AVULSA_CANCELADA;

export type FormaPagamentoNotaAvulsa = 'a_vista' | 'pendente';

export interface NotaAvulsaItem {
  produtoId: string;
  produtoNome: string;
  quantidade: number;
  precoCusto: number;
  precoVenda: number;
}

/** Um item so entra na nota com produto escolhido, quantidade e custo
 * maiores que zero -- preco de venda pode ficar 0 (produto que a empresa
 * decide precificar depois, no cadastro). */
export const itemNotaAvulsaValido = (item: NotaAvulsaItem): boolean => (
  Boolean(item.produtoId)
  && item.quantidade > 0
  && item.precoCusto > 0
);

export const calcularValorTotalNotaAvulsa = (itens: NotaAvulsaItem[]): number => (
  itens.reduce((total, item) => total + item.quantidade * item.precoCusto, 0)
);
