import { chamarServidor } from './apiServidor';
import type { ColecaoDoItem, ExtratoDoItem, ItemDaMovimentacao, MovimentoEstoque } from '../utils/movimentosEstoqueDomain';

/**
 * MOVIMENTACAO DE PRODUTOS (26/10/2026) -- cliente HTTP de
 * server/services/movimentosEstoque.js. Regra em src/utils/movimentosEstoqueDomain.ts.
 */

export interface RespostaMovimentos {
  movimentos: MovimentoEstoque[];
  itens: Record<string, ItemDaMovimentacao>;
  extrato?: ExtratoDoItem;
}

/** Movimentos do periodo (datas AAAA-MM-DD). */
export const consultarMovimentos = (de: string, ate: string) => (
  chamarServidor<RespostaMovimentos>('POST', 'movimentos-estoque', { de, ate }, { falhou: 'Não foi possível montar a movimentação. Tente de novo.' })
);

/** Extrato de um item no periodo, com saldo antes/depois de cada movimento. */
export const consultarExtrato = (de: string, ate: string, colecao: ColecaoDoItem, itemId: string) => (
  chamarServidor<RespostaMovimentos>('POST', 'movimentos-estoque', { de, ate, colecao, itemId }, { falhou: 'Não foi possível montar o extrato do produto. Tente de novo.' })
);
