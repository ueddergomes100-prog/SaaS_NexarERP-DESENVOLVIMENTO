import { useEffect, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../services/firebase';

export interface TenantCollectionItem {
  id: string;
}

export interface UseTenantCollectionOptions {
  /** Campo usado para ordenar a lista (comparacao textual). */
  sortField?: string;
  /** Quando false, nao assina a coleção (ex: aguardando permissao). */
  enabled?: boolean;
}

export interface UseTenantCollectionResult<T> {
  items: T[];
  loading: boolean;
  error: Error | null;
  removeItem: (id: string) => Promise<void>;
}

/**
 * Assina em tempo real uma colecao do Firestore filtrada por tenantId
 * (padrao comum de catalogos: categorias, unidades de medida, bandeiras
 * de cartao, etc.). F4 do plano de evolucao.
 */
export function useTenantCollection<T extends TenantCollectionItem>(
  collectionName: string,
  tenantId: string | null | undefined,
  options: UseTenantCollectionOptions = {},
): UseTenantCollectionResult<T> {
  const { sortField, enabled = true } = options;
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!tenantId || !enabled) {
      setItems([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    const q = query(collection(db, collectionName), where('tenantId', '==', tenantId));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }) as T);
        if (sortField) {
          data.sort((a, b) => (
            String((a as Record<string, unknown>)[sortField] ?? '')
              .localeCompare(String((b as Record<string, unknown>)[sortField] ?? ''))
          ));
        }
        setItems(data);
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [collectionName, tenantId, enabled, sortField]);

  const removeItem = async (id: string) => {
    await deleteDoc(doc(db, collectionName, id));
  };

  return { items, loading, error, removeItem };
}
