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
    // Item vendido em embalagem (saco de 20 kg) reserva na unidade base: e' o
    // `quantidadeBase` que bate com o `quantidadeReservada` do produto.
    const qtd = Number(i.quantidadeBase ?? i.quantidade ?? i.qtd ?? 0);
    return total + (Number.isFinite(qtd) && qtd > 0 ? qtd : 0);
  }, 0);
};

// ---------------------------------------------------------------------------
// RESERVA NA VENDA (decisao do dono, 13/10/2026). PDV, Pedido de Venda e OS
// olhavam so' o estoque fisico: peca segurada em pre-venda, condicional, OS
// ou troca aparecia livre no balcao. Agora o que conta e' o DISPONIVEL
// (estoque - reservado pelos OUTROS documentos -- a reserva do proprio
// documento volta para ele) e a regra da empresa decide:
//  - empresa que NAO vende sem estoque: TRAVA, citando quem segura a peca;
//  - empresa que vende sem estoque: so' AVISA quando a reserva entra no meio.
// ---------------------------------------------------------------------------

export type SituacaoDaSaida = 'ok' | 'avisar_reserva' | 'bloquear_reserva' | 'bloquear_estoque';

export interface AnaliseDaSaida {
  situacao: SituacaoDaSaida;
  /** Estoque fisico do produto. */
  estoque: number;
  /** Reservado por OUTROS documentos (sem a reserva deste). */
  reservadoPorOutros: number;
  /** O que este documento pode usar: estoque - reservado pelos outros. */
  disponivel: number;
}

const numeroOuZero = (valor: unknown): number => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};

/**
 * `pedida` e' o TOTAL do produto no documento depois da mudanca (todas as
 * linhas, na unidade base). `reservadoPeloDocumento` e' o que este documento
 * ja' segura gravado (pre-venda ou OS aberta com reserva) -- ele nao conta
 * contra o proprio documento.
 */
/**
 * "Permitir venda sem estoque" e' da filial, mas o produto pode se trancar
 * ("Bloquear venda sem estoque" no cadastro, 20/10/2026): marcado, nao sai
 * sem saldo em nenhuma tela nem no servidor, mesmo com a chave ligada.
 */
export const podeVenderSemEstoque = (
  permiteNaFilial: boolean,
  produto: { bloquearVendaSemEstoque?: unknown } | null | undefined,
): boolean => permiteNaFilial && produto?.bloquearVendaSemEstoque !== true;

export const analisarSaidaComReserva = (args: {
  quantidade: unknown;
  quantidadeReservada: unknown;
  pedida: number;
  reservadoPeloDocumento?: number;
  permiteVendaSemEstoque: boolean;
}): AnaliseDaSaida => {
  const estoque = numeroOuZero(args.quantidade);
  const reservada = Math.max(0, numeroOuZero(args.quantidadeReservada));
  const propria = Math.max(0, numeroOuZero(args.reservadoPeloDocumento));
  const reservadoPorOutros = Math.max(0, reservada - propria);
  const disponivel = Math.max(0, Math.max(0, estoque) - reservadoPorOutros);
  const pedida = Math.max(0, numeroOuZero(args.pedida));
  const base = { estoque, reservadoPorOutros, disponivel };
  // Folga de arredondamento (quilo com 3 casas).
  if (pedida <= disponivel + 1e-9) return { situacao: 'ok', ...base };
  if (args.permiteVendaSemEstoque) {
    return { situacao: reservadoPorOutros > 0 ? 'avisar_reserva' : 'ok', ...base };
  }
  return { situacao: reservadoPorOutros > 0 ? 'bloquear_reserva' : 'bloquear_estoque', ...base };
};

const rotuloDaReserva = (r: ReservaEncontrada, formatar: (v: number) => string): string => {
  const numero = r.numero ? ` #${r.numero}` : '';
  const cliente = r.cliente ? ` · ${r.cliente}` : '';
  return `${ROTULO_ORIGEM_RESERVA[r.origem]}${numero}${cliente} (${formatar(r.quantidade)})`;
};

/**
 * Texto da mensagem: numeros do produto + quem segura a reserva. Lista no
 * maximo 5 documentos (o resto vira "e mais N") para a mensagem caber.
 */
export const textoDaSaidaComReserva = (args: {
  analise: AnaliseDaSaida;
  pedida: number;
  reservas: ReservaEncontrada[];
  sigla?: string | null;
  casas?: number | null;
}): string => {
  const casas = args.casas ?? 0;
  const sigla = args.sigla || 'UN';
  const fmt = (v: number) => formatarQtd(v, casas, sigla);
  const { analise } = args;
  const numeros = `Estoque ${fmt(analise.estoque)}, reservado ${fmt(analise.reservadoPorOutros)}, disponível ${fmt(analise.disponivel)}; nesta venda ${fmt(Math.max(0, args.pedida))}.`;
  if (args.reservas.length === 0) return numeros;
  const primeiras = args.reservas.slice(0, 5).map((r) => rotuloDaReserva(r, fmt));
  const resto = args.reservas.length > 5 ? ` e mais ${args.reservas.length - 5}` : '';
  return `${numeros} Reservado em: ${primeiras.join('; ')}${resto}.`;
};
