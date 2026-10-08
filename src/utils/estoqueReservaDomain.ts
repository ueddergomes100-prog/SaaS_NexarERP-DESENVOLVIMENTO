export type MomentoBaixaEstoque = 'imediato' | 'pedido' | 'caixa' | 'nf';

export const MOMENTO_BAIXA_ESTOQUE_OPTIONS: Array<{ value: MomentoBaixaEstoque; label: string }> = [
  { value: 'imediato', label: 'Baixar imediatamente (padrão)' },
  { value: 'pedido', label: 'Reservar no Pedido e na OS (baixa só ao finalizar)' },
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

// ---------------------------------------------------------------------------
// Reserva VISIVEL (maquinas pesadas, fase 2 -- 2026-10-07). O numero ja
// existia em `quantidadeReservada` (pre-venda, condicional, OS com "Reservar
// no Pedido", troca); faltava mostrar na lista de Estoque e em toda busca.
// ---------------------------------------------------------------------------

export interface ResumoDeReserva {
  quantidade: number;
  reservada: number;
  disponivel: number;
  temReserva: boolean;
}

export const resumoDeReserva = (produto: { quantidade?: unknown; quantidadeReservada?: unknown } | null | undefined): ResumoDeReserva => {
  const quantidade = Math.max(0, Number(produto?.quantidade) || 0);
  const reservada = Math.max(0, Number(produto?.quantidadeReservada) || 0);
  return {
    quantidade,
    reservada,
    disponivel: computeAvailableStock(quantidade, reservada),
    temReserva: reservada > 0,
  };
};

const formatarQtd = (valor: number, casas: number, sigla: string) => `${valor.toFixed(Math.max(0, casas))} ${sigla || 'UN'}`;

/** "Reservado: 2 UN · Disponível: 8 UN" -- so' quando ha reserva; senao ''. */
export const textoDaReserva = (produto: { quantidade?: unknown; quantidadeReservada?: unknown; unidadeMedidaSigla?: string | null; unidadeMedidaCasasDecimais?: number | null } | null | undefined): string => {
  const r = resumoDeReserva(produto);
  if (!r.temReserva) return '';
  const casas = produto?.unidadeMedidaCasasDecimais ?? 0;
  const sigla = produto?.unidadeMedidaSigla || 'UN';
  return `Reservado: ${formatarQtd(r.reservada, casas, sigla)} · Disponível: ${formatarQtd(r.disponivel, casas, sigla)}`;
};

/** Onde uma reserva pode estar: o que a tela "de onde vem" procura. */
export type OrigemDeReserva = 'pre_venda' | 'ordem_de_servico' | 'condicional' | 'troca';

export const ROTULO_ORIGEM_RESERVA: Record<OrigemDeReserva, string> = {
  pre_venda: 'Pré-venda',
  ordem_de_servico: 'Ordem de Serviço',
  condicional: 'Condicional',
  troca: 'Troca',
};

export interface ReservaEncontrada {
  origem: OrigemDeReserva;
  documentoId: string;
  numero: string;
  cliente: string;
  quantidade: number;
}

/** Soma o que cada documento aberto segura de um produto (itens com o mesmo id somam). */
export const quantidadeDoProdutoNosItens = (itens: unknown, produtoId: string): number => {
  if (!Array.isArray(itens)) return 0;
  return itens.reduce<number>((total, item) => {
    const i = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const id = i.id ?? i.produtoId ?? i.pecaId;
    if (id !== produtoId) return total;
    const qtd = Number(i.quantidade ?? i.qtd ?? 0);
    return total + (Number.isFinite(qtd) && qtd > 0 ? qtd : 0);
  }, 0);
};
