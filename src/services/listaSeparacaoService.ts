import { collection, documentId, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { emLotes, LOTE_IN_POR_ID } from '../utils/firestoreLimites';

/**
 * Itens dos pedidos da rota, para a lista de separacao (listaSeparacaoDomain.ts).
 * Por id, em lotes de 10 (firestoreLimites.ts). Id que nao volta fica fora do mapa:
 * a linha de entrega futura da rota nao e' um pedido, e pedido apagado nao existe mais.
 */
export const lerItensDosPedidos = async (tenantId: string, ids: string[]): Promise<Map<string, unknown>> => {
  const mapa = new Map<string, unknown>();
  await Promise.all(emLotes(ids, LOTE_IN_POR_ID).map(async (lote) => {
    const snap = await getDocs(query(collection(db, 'pedidos_venda'), where('tenantId', '==', tenantId), where(documentId(), 'in', lote)));
    snap.docs.forEach((d) => mapa.set(d.id, d.data().itens));
  }));
  return mapa;
};
