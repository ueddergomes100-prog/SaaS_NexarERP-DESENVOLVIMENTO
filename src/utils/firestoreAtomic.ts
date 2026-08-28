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
import { buildAjusteEstoqueDoc, computeQuantidadeDepoisAjuste, type TipoAjusteEstoque } from './ajusteEstoqueDomain';

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

export interface AjusteEstoqueManualParams {
  tenantId: string;
  produtoId: string;
  produtoNome: string;
  produtoCodigo?: string;
  tipo: TipoAjusteEstoque;
  quantidade: number;
  motivo: string;
  observacao?: string;
  controlarLote: boolean;
  /** Lote existente reaproveitado -- obrigatorio na saida, opcional na entrada. */
  loteId?: string;
  /** Entrada em lote novo, usado so quando loteId nao veio. */
  loteNovoCodigo?: string;
  loteNovoValidade?: string | null;
  usuarioId: string;
  usuarioNome: string;
}

// Ajuste manual de estoque (tela AjusteEstoque.tsx). Nunca deixa negativar
// -- nem o produto, nem o lote -- independente da config venderSemEstoque:
// isso aqui e' correcao de dado, nao venda. Por isso nao reaproveita
// applyStockAdjustments/applyStockFieldDeltas (as duas aceitam
// allowNegativeStock vindo da tela de venda).
export const applyAjusteEstoqueManual = async (
  transaction: Transaction,
  db: Firestore,
  params: AjusteEstoqueManualParams
): Promise<{ loteId?: string; quantidadeDepois: number }> => {
  const produtoRef = doc(db, 'estoque', params.produtoId);
  const loteRef = params.loteId ? doc(db, 'estoque_lotes', params.loteId) : null;

  const [produtoSnap, loteSnap] = await Promise.all([
    transaction.get(produtoRef),
    loteRef ? transaction.get(loteRef) : Promise.resolve(null),
  ]);

  if (!produtoSnap.exists()) {
    throw new Error(`Produto "${params.produtoNome}" não foi encontrado. Atualize a página e tente novamente.`);
  }

  const quantidadeAntes = Number(produtoSnap.data().quantidade || 0);
  const quantidadeDepois = computeQuantidadeDepoisAjuste(quantidadeAntes, params.tipo, params.quantidade);

  if (quantidadeDepois < 0) {
    throw new Error(`Estoque insuficiente para "${params.produtoNome}". Disponível: ${quantidadeAntes}.`);
  }

  transaction.update(produtoRef, {
    quantidade: quantidadeDepois,
    updatedAt: serverTimestamp(),
  });

  let loteIdFinal: string | undefined;
  let loteCodigoFinal: string | undefined;
  let validadeFinal: string | undefined;

  if (params.controlarLote) {
    if (loteRef && loteSnap?.exists()) {
      const loteData = loteSnap.data();
      const saldoLoteAntes = Number(loteData.quantidade || 0);
      const saldoLoteDepois = params.tipo === 'entrada'
        ? saldoLoteAntes + params.quantidade
        : saldoLoteAntes - params.quantidade;

      if (saldoLoteDepois < 0) {
        throw new Error(`Estoque insuficiente no lote "${loteData.lote}". Disponível: ${saldoLoteAntes}.`);
      }

      transaction.update(loteRef, {
        quantidade: saldoLoteDepois,
        updatedAt: serverTimestamp(),
      });

      loteIdFinal = params.loteId;
      loteCodigoFinal = loteData.lote;
      validadeFinal = loteData.validade || undefined;
    } else if (params.tipo === 'entrada' && params.loteNovoCodigo?.trim()) {
      const novoLoteRef = doc(collection(db, 'estoque_lotes'));
      transaction.set(novoLoteRef, {
        tenantId: params.tenantId,
        produtoId: params.produtoId,
        lote: params.loteNovoCodigo.trim(),
        validade: params.loteNovoValidade || null,
        quantidade: params.quantidade,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      loteIdFinal = novoLoteRef.id;
      loteCodigoFinal = params.loteNovoCodigo.trim();
      validadeFinal = params.loteNovoValidade || undefined;
    } else {
      throw new Error(`"${params.produtoNome}" controla lote e validade. Selecione um lote ou informe um lote novo.`);
    }
  }

  const ajusteRef = doc(collection(db, 'ajustes_estoque'));
  transaction.set(ajusteRef, {
    ...buildAjusteEstoqueDoc({
      tenantId: params.tenantId,
      produtoId: params.produtoId,
      produtoNome: params.produtoNome,
      produtoCodigo: params.produtoCodigo,
      tipo: params.tipo,
      quantidade: params.quantidade,
      motivo: params.motivo,
      observacao: params.observacao,
      loteId: loteIdFinal,
      lote: loteCodigoFinal,
      validade: validadeFinal,
      quantidadeAntes,
      quantidadeDepois,
      usuarioId: params.usuarioId,
      usuarioNome: params.usuarioNome,
    }),
    createdAt: serverTimestamp(),
  });

  return { loteId: loteIdFinal, quantidadeDepois };
};
