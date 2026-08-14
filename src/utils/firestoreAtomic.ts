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
import type { StockFieldDelta } from './estoqueReservaDomain';

/**
 * Chave do contador por tenant (documento "contadores/{tenantId}").
 * Qualquer string e aceita -- por convencao deve ser o nome da colecao
 * correspondente quando ela existe, para getCurrentMaxSequence poder
 * fazer bootstrap a partir de documentos legados sem contador ainda.
 * Chaves em uso hoje: 'ordens_de_servico', 'pedidos_venda', 'orcamentos'.
 */
export type SequenceKey = string;

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
  const nextValue = await getNextTenantSequenceValue(transaction, db, tenantId, key, minCurrentValue);
  writeTenantSequenceValue(transaction, db, tenantId, key, nextValue);

  return nextValue;
};

export const getNextTenantSequenceValue = async (
  transaction: Transaction,
  db: Firestore,
  tenantId: string,
  key: SequenceKey,
  minCurrentValue = 0
) => {
  const counterRef = doc(db, 'contadores', tenantId);
  const counterSnap = await transaction.get(counterRef);
  const currentValue = counterSnap.exists() ? parseSequenceValue(counterSnap.data()[key]) : 0;

  return Math.max(currentValue, minCurrentValue) + 1;
};

export const writeTenantSequenceValue = (
  transaction: Transaction,
  db: Firestore,
  tenantId: string,
  key: SequenceKey,
  nextValue: number
) => {
  const counterRef = doc(db, 'contadores', tenantId);
  transaction.set(
    counterRef,
    {
      tenantId,
      [key]: nextValue,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
};

export const applyStockAdjustments = async (
  transaction: Transaction,
  db: Firestore,
  items: StockAdjustmentItem[],
  direction: 'decrement' | 'increment',
  allowNegativeStock = false
) => {
  const itemsById = new Map<string, StockAdjustmentItem>();

  for (const item of items) {
    if (!item.id || item.id === 'avulso') continue;

    const quantity = Number(item.quantidade || 0);
    if (quantity <= 0) continue;

    const existing = itemsById.get(item.id);
    itemsById.set(item.id, {
      id: item.id,
      nome: existing?.nome || item.nome,
      quantidade: (existing?.quantidade || 0) + quantity,
    });
  }

  const adjustmentReads = await Promise.all(
    Array.from(itemsById.values()).map(async (item) => {
      const stockRef = doc(db, 'estoque', item.id);
      return {
        item,
        stockRef,
        stockSnap: await transaction.get(stockRef),
      };
    })
  );

  for (const { item, stockRef, stockSnap } of adjustmentReads) {
    if (!stockSnap.exists()) continue;

    const currentQuantity = Number(stockSnap.data().quantidade || 0);
    const nextQuantity =
      direction === 'decrement'
        ? currentQuantity - item.quantidade
        : currentQuantity + item.quantidade;

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

// Aditiva -- nao mexe em applyStockAdjustments nem nos 7 pontos que ja a
// chamam (PDV/OS/Orcamento/PedidoVenda/Devolucao). Usada pelo Modulo 13
// (Reserva de estoque) pra mexer em quantidade e/ou quantidadeReservada na
// mesma escrita, a partir dos deltas puros de estoqueReservaDomain.ts.
export const applyStockFieldDeltas = async (
  transaction: Transaction,
  db: Firestore,
  deltas: StockFieldDelta[],
  allowNegativeStock = false
) => {
  if (deltas.length === 0) return;

  const reads = await Promise.all(
    deltas.map(async (delta) => {
      const stockRef = doc(db, 'estoque', delta.id);
      return {
        delta,
        stockRef,
        stockSnap: await transaction.get(stockRef),
      };
    })
  );

  for (const { delta, stockRef, stockSnap } of reads) {
    if (!stockSnap.exists()) continue;

    const currentQuantidade = Number(stockSnap.data().quantidade || 0);
    const currentReservada = Number(stockSnap.data().quantidadeReservada || 0);
    const nextQuantidade = currentQuantidade + delta.quantidadeDelta;
    const itemName = delta.nome || 'item selecionado';

    if (delta.quantidadeDelta < 0 && nextQuantidade < 0 && !allowNegativeStock) {
      throw new Error(`Estoque insuficiente para ${itemName}. Disponivel: ${currentQuantidade}.`);
    }

    if (delta.quantidadeReservadaDelta > 0 && !allowNegativeStock) {
      const disponivel = currentQuantidade - currentReservada;
      if (disponivel < delta.quantidadeReservadaDelta) {
        throw new Error(`Estoque insuficiente para reservar ${itemName}. Disponivel: ${disponivel}.`);
      }
    }

    transaction.update(stockRef, {
      quantidade: allowNegativeStock ? nextQuantidade : Math.max(0, nextQuantidade),
      quantidadeReservada: Math.max(0, currentReservada + delta.quantidadeReservadaDelta),
      updatedAt: serverTimestamp(),
    });
  }
};
