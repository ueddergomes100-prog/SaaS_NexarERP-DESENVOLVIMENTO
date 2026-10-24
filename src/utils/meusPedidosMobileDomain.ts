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

/**
 * Quantos cartoes aparecem por vez; "Ver mais" traz mais tantos (23/10/2026, pedido
 * do dono: os 6 ultimos e "Ver mais" de 6 em 6). O app busca no banco so' o que
 * mostra -- pedidos e orcamentos vem de duas colecoes, cada uma ordenada pela data.
 */
export const PAGINA_MEUS_PEDIDOS = 6;

/**
 * Quantos documentos buscar de uma das colecoes para mostrar `alvo` cartoes
 * na lista misturada (pedidos + orcamentos, mais novos primeiro): cada colecao
 * precisa ter ao menos `alvo` carregados (ou ter acabado) para a mistura sair certa.
 */
export const quantoBuscarDaFonte = (carregados: number, alvo: number, esgotada: boolean): number => (
  esgotada ? 0 : Math.max(0, alvo - carregados)
);

/** Ainda ha o que mostrar no "Ver mais"? */
export const temMaisMeusPedidos = (args: { totalNaLista: number; visiveis: number; fontesEsgotadas: boolean }): boolean => (
  args.totalNaLista > args.visiveis || !args.fontesEsgotadas
);

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
