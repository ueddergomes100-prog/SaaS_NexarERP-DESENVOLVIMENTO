/**
 * "MEUS PEDIDOS" NO APP DO VENDEDOR (2026-09-21).
 *
 * Regra do dono: quem tem a permissao "Minhas Vendas" no cadastro do
 * funcionario ve, em Meus Pedidos, TODAS as vendas dele -- inclusive as feitas
 * no computador e as antigas. Quem nao tem ve so' o recente (ultimos 30 dias):
 * o suficiente pra acompanhar o que acabou de enviar, sem abrir o historico
 * de vendas.
 */

/** Permissao do cadastro do funcionario (permissionCatalog.ts). */
export const PERMISSAO_MINHAS_VENDAS = 'vendas.minhas_vendas';

export const DIAS_RECENTES_SEM_MINHAS_VENDAS = 30;

/** Quantos cartoes aparecem por vez; "Ver mais" traz o resto. */
export const PAGINA_MEUS_PEDIDOS = 30;

export interface ItemMeusPedidos {
  id: string;
  tipo: 'Pedido' | 'Orçamento';
  createdAtMillis: number;
}

/** Mais novos primeiro; item sem data (venda muito antiga) vai pro fim. */
export const ordenarMaisNovosPrimeiro = <T extends ItemMeusPedidos>(itens: T[]): T[] => (
  [...itens].sort((a, b) => b.createdAtMillis - a.createdAtMillis)
);

export const filtrarMeusPedidos = <T extends ItemMeusPedidos>(
  itens: T[],
  params: { temMinhasVendas: boolean; agoraMillis: number },
): T[] => {
  const ordenados = ordenarMaisNovosPrimeiro(itens);
  if (params.temMinhasVendas) return ordenados;
  const limite = params.agoraMillis - DIAS_RECENTES_SEM_MINHAS_VENDAS * 24 * 60 * 60 * 1000;
  // Sem data nao da' pra provar que e' recente: fica de fora do modo limitado.
  return ordenados.filter((item) => item.createdAtMillis >= limite && item.createdAtMillis > 0);
};
