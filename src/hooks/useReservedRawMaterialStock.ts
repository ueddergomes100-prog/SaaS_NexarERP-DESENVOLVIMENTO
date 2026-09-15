import { useEffect, useState } from 'react';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../services/firebase';
import { computeReservedRawMaterialMap, normalizarComponente, type ItemComposicaoResumo, type OrdemAtivaResumo } from '../utils/producaoDomain';

export interface UseReservedRawMaterialStockResult {
  /**
   * `chaveComponente(origem, id)` -> quantidade reservada pelas ordens em
   * producao. A chave leva a origem porque a composicao pode consumir
   * tanto `materias_primas` quanto `estoque` (ver producaoDomain.ts);
   * consulte sempre via `chaveComponente`, nunca pelo id cru.
   */
  reservedMap: Map<string, number>;
  loading: boolean;
}

/**
 * Quanto de cada componente esta reservado por ordens de producao
 * ATIVAS (status 'em_producao') no momento -- usado pra mostrar "Estoque
 * Previsto" no cadastro de materia-prima. Assina ordens_producao em
 * tempo real (Firestore onSnapshot); a composicao de cada produto
 * referenciado e buscada uma unica vez por mudanca na lista de ordens
 * ativas (getDoc, nao onSnapshot -- composicao muda raro, nao vale a
 * pena manter N listeners abertos so pra isso).
 */
export function useReservedRawMaterialStock(tenantId: string | null | undefined): UseReservedRawMaterialStockResult {
  const [reservedMap, setReservedMap] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) {
      setReservedMap(new Map());
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    const q = query(
      collection(db, 'ordens_producao'),
      where('tenantId', '==', tenantId),
      where('status', '==', 'em_producao'),
    );

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const activeOrders: OrdemAtivaResumo[] = snapshot.docs.map((docSnap) => ({
        produtoId: docSnap.data().produtoId,
        quantidadePlanejada: Number(docSnap.data().quantidadePlanejada || 0),
      }));

      const produtoIdsDistintos = [...new Set(activeOrders.map((o) => o.produtoId))];
      const compositionsByProdutoId: Record<string, ItemComposicaoResumo[]> = {};

      await Promise.all(produtoIdsDistintos.map(async (produtoId) => {
        try {
          const composicaoSnap = await getDoc(doc(db, 'produtos_composicao', produtoId));
          const itens = composicaoSnap.exists() && Array.isArray(composicaoSnap.data().itens)
            ? composicaoSnap.data().itens
            : [];
          compositionsByProdutoId[produtoId] = itens.map((item: any) => {
            const componente = normalizarComponente(item);
            return {
              componenteId: componente.componenteId,
              origem: componente.origem,
              quantidade: componente.quantidade,
            };
          });
        } catch {
          compositionsByProdutoId[produtoId] = [];
        }
      }));

      setReservedMap(computeReservedRawMaterialMap(activeOrders, compositionsByProdutoId));
      setLoading(false);
    }, () => {
      setLoading(false);
    });

    return () => unsubscribe();
  }, [tenantId]);

  return { reservedMap, loading };
}
