import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { isPedidoCancelado } from '../utils/preVendaDomain';

/**
 * "Mais vendidos/usados" pro app do vendedor externo: sem tabela de
 * frequencia de busca (o sistema nunca registrou isso), a lista honesta e'
 * calculada direto do historico real -- produto que mais aparece em
 * pedidos/orcamentos recentes, cliente com mais pedidos recentes. Janela
 * limitada (ultimos N documentos) pra nao varrer a colecao inteira toda
 * vez que a tela abre.
 */

const JANELA_DOCUMENTOS = 100;

interface ItemComQuantidade {
  id?: unknown;
  quantidade?: unknown;
}

const contarProdutosPorFrequencia = (docs: { itens?: unknown; status?: unknown }[]): Map<string, number> => {
  const contagem = new Map<string, number>();
  for (const doc of docs) {
    if (isPedidoCancelado(doc.status)) continue;
    const itens = Array.isArray(doc.itens) ? (doc.itens as ItemComQuantidade[]) : [];
    for (const item of itens) {
      const id = typeof item.id === 'string' ? item.id : '';
      if (!id || id === 'avulso') continue;
      const quantidade = Number(item.quantidade) || 0;
      contagem.set(id, (contagem.get(id) || 0) + quantidade);
    }
  }
  return contagem;
};

/** Ids de produto ordenados do mais vendido pro menos vendido, olhando os
 *  ultimos pedidos_venda + orcamentos do tenant. */
export const buscarIdsProdutosMaisVendidos = async (tenantId: string): Promise<string[]> => {
  const [pedidosSnap, orcamentosSnap] = await Promise.all([
    getDocs(query(
      collection(db, 'pedidos_venda'),
      where('tenantId', '==', tenantId),
      orderBy('createdAt', 'desc'),
      limit(JANELA_DOCUMENTOS),
    )).catch(() => null),
    getDocs(query(
      collection(db, 'orcamentos'),
      where('tenantId', '==', tenantId),
      orderBy('createdAt', 'desc'),
      limit(JANELA_DOCUMENTOS),
    )).catch(() => null),
  ]);

  const docs = [
    ...(pedidosSnap?.docs || []).map((d) => d.data()),
    ...(orcamentosSnap?.docs || []).map((d) => ({ itens: d.data().pecas, status: d.data().status })),
  ];

  const contagem = contarProdutosPorFrequencia(docs);
  return Array.from(contagem.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id]) => id);
};

/** Ids de cliente ordenados de quem mais pediu pra quem menos pediu,
 *  olhando os ultimos pedidos_venda + orcamentos do tenant (nao cancelados). */
export const buscarIdsClientesMaisFrequentes = async (tenantId: string): Promise<string[]> => {
  const [pedidosSnap, orcamentosSnap] = await Promise.all([
    getDocs(query(
      collection(db, 'pedidos_venda'),
      where('tenantId', '==', tenantId),
      orderBy('createdAt', 'desc'),
      limit(JANELA_DOCUMENTOS),
    )).catch(() => null),
    getDocs(query(
      collection(db, 'orcamentos'),
      where('tenantId', '==', tenantId),
      orderBy('createdAt', 'desc'),
      limit(JANELA_DOCUMENTOS),
    )).catch(() => null),
  ]);

  const contagem = new Map<string, number>();
  for (const docSnap of [...(pedidosSnap?.docs || []), ...(orcamentosSnap?.docs || [])]) {
    const data = docSnap.data();
    if (isPedidoCancelado(data.status)) continue;
    const clienteId = typeof data.clienteId === 'string' ? data.clienteId : '';
    if (!clienteId) continue;
    contagem.set(clienteId, (contagem.get(clienteId) || 0) + 1);
  }

  return Array.from(contagem.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id]) => id);
};
