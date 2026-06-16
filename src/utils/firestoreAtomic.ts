import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  type Firestore,
  type Transaction,
  where,
} from 'firebase/firestore';

export type SequenceKey = 'ordens_de_servico' | 'pedidos_venda' | 'orcamentos';

export interface StockAdjustmentItem {
  id: string;
  nome?: string;
  quantidade: number;
}

export const parseSequenceValue = (value: unknown) => {
  const parsed = Number.parseInt(String(value || '').replace(/\D/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const formatSequenceValue = (value: number, size: number) => {
  return String(value).padStart(size, '0');
};

export const getCurrentMaxSequence = async (
  db: Firestore,
  collectionName: SequenceKey,
  tenantId: string,
  fieldName: string
) => {
  const q = query(
    collection(db, collectionName),
    where('tenantId', '==', tenantId),
    orderBy(fieldName, 'desc'),
    limit(1)
  );

  const snap = await getDocs(q);
  if (snap.empty) return 0;

  return parseSequenceValue(snap.docs[0].data()[fieldName]);
};

export const reserveTenantSequence = async (
  transaction: Transaction,
  db: Firestore,
  tenantId: string,
  key: SequenceKey,
  minCurrentValue = 0
) => {
  const counterRef = doc(db, 'contadores', tenantId);
  const counterSnap = await transaction.get(counterRef);
  const currentValue = counterSnap.exists() ? parseSequenceValue(counterSnap.data()[key]) : 0;
  const nextValue = Math.max(currentValue, minCurrentValue) + 1;

  transaction.set(
    counterRef,
    {
      tenantId,
      [key]: nextValue,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return nextValue;
};

export const applyStockAdjustments = async (
  transaction: Transaction,
  db: Firestore,
  items: StockAdjustmentItem[],
  direction: 'decrement' | 'increment',
  allowNegativeStock = false
) => {
  for (const item of items) {
    if (!item.id || item.id === 'avulso') continue;

    const quantity = Number(item.quantidade || 0);
    if (quantity <= 0) continue;

    const stockRef = doc(db, 'estoque', item.id);
    const stockSnap = await transaction.get(stockRef);
    if (!stockSnap.exists()) continue;

    const currentQuantity = Number(stockSnap.data().quantidade || 0);
    const nextQuantity =
      direction === 'decrement'
        ? currentQuantity - quantity
        : currentQuantity + quantity;

    if (nextQuantity < 0 && !allowNegativeStock) {
      const itemName = item.nome || 'item selecionado';
      throw new Error(`Estoque insuficiente para ${itemName}. Disponivel: ${currentQuantity}.`);
    }

    transaction.update(stockRef, {
      quantidade: allowNegativeStock ? nextQuantity : Math.max(0, nextQuantity),
      updatedAt: serverTimestamp(),
    });
  }
};
