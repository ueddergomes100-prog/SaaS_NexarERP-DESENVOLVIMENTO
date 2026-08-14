export type MomentoBaixaEstoque = 'imediato' | 'pedido' | 'caixa' | 'nf';

export const MOMENTO_BAIXA_ESTOQUE_OPTIONS: Array<{ value: MomentoBaixaEstoque; label: string }> = [
  { value: 'imediato', label: 'Baixar imediatamente (padrão)' },
  { value: 'pedido', label: 'Reservar no Pedido' },
  { value: 'caixa', label: 'Baixar no Caixa' },
  { value: 'nf', label: 'Baixar na NF' },
];

export const DEFAULT_MOMENTO_BAIXA_ESTOQUE: MomentoBaixaEstoque = 'imediato';

// Calculo puro do estoque disponivel (quantidade - reservada). Nao depende
// do Firestore.
export const computeAvailableStock = (
  quantidade: number | undefined,
  quantidadeReservada: number | undefined
): number => {
  const qtd = Math.max(0, Number.isFinite(quantidade) ? (quantidade as number) : 0);
  const reservada = Math.max(0, Number.isFinite(quantidadeReservada) ? (quantidadeReservada as number) : 0);
  return Math.max(0, qtd - reservada);
};

// Funcoes puras de reconciliacao de reserva (Modulo 13, Fatia 1). Nao
// dependem do Firestore -- a leitura/escrita fica em applyStockFieldDeltas
// (src/utils/firestoreAtomic.ts), chamada pela tela que consome isto (OS).

export interface StockLineItem {
  id: string;
  nome?: string;
  quantidade: number;
}

export interface StockFieldDelta {
  id: string;
  nome?: string;
  quantidadeDelta: number;
  quantidadeReservadaDelta: number;
}

const sumStockLineItemsById = (items: StockLineItem[]): Map<string, { nome?: string; quantidade: number }> => {
  const byId = new Map<string, { nome?: string; quantidade: number }>();

  for (const item of items) {
    if (!item.id || item.id === 'avulso') continue;

    const quantity = Number(item.quantidade || 0);
    if (quantity <= 0) continue;

    const existing = byId.get(item.id);
    byId.set(item.id, {
      nome: existing?.nome || item.nome,
      quantidade: (existing?.quantidade || 0) + quantity,
    });
  }

  return byId;
};

// OS continua aberta -- reconcilia a reserva anterior com a lista atual de
// pecas. Delta simetrico, so mexe em quantidadeReservada (quantidadeDelta
// sempre 0 no resultado).
export const computeReservationDelta = (previous: StockLineItem[], next: StockLineItem[]): StockFieldDelta[] => {
  const previousMap = sumStockLineItemsById(previous);
  const nextMap = sumStockLineItemsById(next);
  const ids = new Set([...previousMap.keys(), ...nextMap.keys()]);
  const result: StockFieldDelta[] = [];

  for (const id of ids) {
    const previousQuantity = previousMap.get(id)?.quantidade || 0;
    const nextQuantity = nextMap.get(id)?.quantidade || 0;
    const delta = nextQuantity - previousQuantity;
    if (delta === 0) continue;

    result.push({
      id,
      nome: nextMap.get(id)?.nome || previousMap.get(id)?.nome,
      quantidadeDelta: 0,
      quantidadeReservadaDelta: delta,
    });
  }

  return result;
};

// Libera 100% de "previous" e aplica "target" em quantidade, na direcao
// indicada por sign (-1 = debito real ao finalizar, +1 = devolucao real ao
// cancelar uma OS que ja tinha baixa). Helper interno -- use
// computeReservationCommit/computeReservationReturn.
const computeReservationSettle = (previous: StockLineItem[], target: StockLineItem[], sign: 1 | -1): StockFieldDelta[] => {
  const previousMap = sumStockLineItemsById(previous);
  const targetMap = sumStockLineItemsById(target);
  const ids = new Set([...previousMap.keys(), ...targetMap.keys()]);
  const result: StockFieldDelta[] = [];

  for (const id of ids) {
    const previousQuantity = previousMap.get(id)?.quantidade || 0;
    const targetQuantity = targetMap.get(id)?.quantidade || 0;
    if (previousQuantity === 0 && targetQuantity === 0) continue;

    result.push({
      id,
      nome: targetMap.get(id)?.nome || previousMap.get(id)?.nome,
      quantidadeDelta: sign * targetQuantity || 0,
      quantidadeReservadaDelta: -previousQuantity || 0,
    });
  }

  return result;
};

// Finalizando: libera 100% da reserva anterior e debita de verdade "commit"
// (podem divergir, se as pecas mudaram no mesmo save que finaliza).
export const computeReservationCommit = (previous: StockLineItem[], commit: StockLineItem[]): StockFieldDelta[] =>
  computeReservationSettle(previous, commit, -1);

// Cancelando uma OS que ja tinha baixa REAL (nao so reserva): libera
// qualquer reserva remanescente e devolve o estoque de verdade.
export const computeReservationReturn = (previous: StockLineItem[], returned: StockLineItem[]): StockFieldDelta[] =>
  computeReservationSettle(previous, returned, 1);

// So libera a reserva anterior, sem debitar nem devolver nada -- nomeada a
// parte de computeReservationCommit(previous, []) pra deixar claro no call
// site que e' so liberacao.
export const computeReservationRelease = (previous: StockLineItem[]): StockFieldDelta[] =>
  computeReservationCommit(previous, []);
