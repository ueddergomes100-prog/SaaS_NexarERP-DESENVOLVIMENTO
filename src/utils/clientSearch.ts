import { normalizeSearchText } from './textSearch';

export interface SearchableClient {
  nome?: string | null;
  codigo?: string | null;
}

/**
 * Busca de cliente compartilhada por Pedido de Venda, OS e Orcamento.
 * Casa por nome (acento e caixa normalizados) ou por codigo exato/prefixo.
 * Termo vazio retorna a lista inteira (o dropdown ja e limitado em
 * altura/scroll, nao em quantidade de itens).
 */
export const searchClients = <T extends SearchableClient>(clients: T[], term: string): T[] => {
  const normalizedTerm = normalizeSearchText(term);
  if (!normalizedTerm) return clients;
  return clients.filter((client) => (
    normalizeSearchText(client.nome).includes(normalizedTerm)
    || normalizeSearchText(client.codigo).includes(normalizedTerm)
  ));
};
