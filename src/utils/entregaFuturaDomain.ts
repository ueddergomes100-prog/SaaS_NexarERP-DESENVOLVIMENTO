/*
 * VENDA COM ENTREGA FUTURA (item 5 da lista do dono, 23/10/2026).
 *
 * Decisoes do dono (caixinhas de 23/10):
 *  - Chave por filial "Trabalha com venda para entrega futura" liga a caixa
 *    "Entrega futura" no Pedido de Venda. Desligada, nada muda na tela.
 *  - Faturar = financeiro + NF-e de simples faturamento (CFOP 5.922/6.922),
 *    SEM mexer no estoque: a quantidade fica RESERVADA. A regra do estoque
 *    ao faturar e' da filial: padrao "reserva o que tem e deixa faturar sem
 *    estoque" (entrega futura costuma ser de coisa que ainda vai chegar);
 *    a outra opcao "reserva e exige estoque".
 *  - Entrega EM PARTES, por item e quantidade, pelo botao Entregar: cada
 *    entrega baixa o estoque, emite a remessa (5.116/6.116 producao propria,
 *    5.117/6.117 revenda) referenciando a nota de faturamento e entra no
 *    romaneio. Tela Expedicao > Entregas futuras lista o que falta.
 *  - "Previsao de entrega" opcional; atrasados em destaque.
 *  - Empresa que nao controla fiscal usa tudo sem nota.
 *
 * O que fica no pedido: `entregaFutura: true`, `previsaoEntrega`,
 * `entregaFuturaSituacao` (pendente/parcial/entregue) e
 * `entregaFuturaEntregue` (quantidade ja' entregue por item, na ordem dos
 * itens). Cada entrega e' um documento em `entregas_futuras` (so' o
 * servidor grava).
 *
 * Puro: usado pelas telas e pelo servidor (server/domain).
 */

export const CHAVE_TRABALHA_COM_ENTREGA_FUTURA = 'trabalhaComEntregaFutura';
export const DEFAULT_TRABALHA_COM_ENTREGA_FUTURA = false;
export const parseTrabalhaComEntregaFutura = (valor: unknown): boolean => valor === true;

export const CHAVE_ENTREGA_FUTURA_EXIGE_ESTOQUE = 'entregaFuturaExigeEstoque';
export const DEFAULT_ENTREGA_FUTURA_EXIGE_ESTOQUE = false;
export const parseEntregaFuturaExigeEstoque = (valor: unknown): boolean => valor === true;

export const PERMISSAO_ENTREGAS_FUTURAS = 'operacoes.entregas_futuras';
export const COLECAO_ENTREGAS_FUTURAS = 'entregas_futuras';

// ---------------------------------------------------------------------------
// CFOP
// ---------------------------------------------------------------------------

/** Nota de simples faturamento: 5.922 dentro do estado, 6.922 fora. */
export const cfopDoFaturamento = (interestadual: boolean): string => (interestadual ? '6922' : '5922');

/**
 * Nota da entrega (remessa): 5.116/6.116 para producao propria
 * (`produzidoInternamente`), 5.117/6.117 para mercadoria comprada para revender.
 */
export const cfopDaRemessa = (produzidoInternamente: boolean, interestadual: boolean): string => (
  `${interestadual ? '6' : '5'}${produzidoInternamente ? '116' : '117'}`
);

export const CFOPS_FATURAMENTO: readonly string[] = ['5922', '6922'];
export const CFOPS_REMESSA: readonly string[] = ['5116', '5117', '6116', '6117'];

/** Finalidade gravada em `notas_fiscais` (as telas de venda leem `pedidoId` como "a nota do pedido"). */
export const FINALIDADE_NOTA_FATURAMENTO = 'faturamento_entrega_futura';
export const FINALIDADE_NOTA_REMESSA = 'remessa_entrega_futura';

// ---------------------------------------------------------------------------
// Pedido
// ---------------------------------------------------------------------------

export type SituacaoEntregaFutura = 'pendente' | 'parcial' | 'entregue';

export const ROTULO_SITUACAO_ENTREGA: Record<SituacaoEntregaFutura, string> = {
  pendente: 'Aguardando entrega',
  parcial: 'Entregue em parte',
  entregue: 'Entregue',
};

const DATA_VALIDA = /^\d{4}-\d{2}-\d{2}$/;
const numero = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const arred = (v: number) => Math.round(v * 1e6) / 1e6;

/** Data no formato do banco ("2026-11-05") ou vazio. */
export const parsePrevisaoEntrega = (valor: unknown): string => {
  const s = String(valor ?? '').trim().slice(0, 10);
  return DATA_VALIDA.test(s) ? s : '';
};

/** Previsao vencida: data prevista anterior a hoje (os dois em "aaaa-mm-dd"). */
export const entregaAtrasada = (previsao: unknown, hoje: string): boolean => {
  const p = parsePrevisaoEntrega(previsao);
  return Boolean(p) && p < hoje;
};

export interface ItemDoPedidoParaEntrega {
  id: string;
  nome: string;
  quantidade: number;
  /** Fator da embalagem vendida (quantas unidades base cada unidade vendida consome). */
  fatorConversao?: number;
}

export interface SaldoDoItem {
  indice: number;
  id: string;
  nome: string;
  vendida: number;
  entregue: number;
  saldo: number;
  fatorConversao: number;
}

/** Quantidade entregue por item, na ordem dos itens (campo `entregaFuturaEntregue`). */
export const lerEntregue = (valor: unknown, totalItens: number): number[] => {
  const lista = Array.isArray(valor) ? valor : [];
  return Array.from({ length: totalItens }, (_, i) => Math.max(0, numero(lista[i])));
};

/** O que falta entregar de cada item (nunca negativo). */
export const saldoAEntregar = (itens: ItemDoPedidoParaEntrega[], entregue: unknown): SaldoDoItem[] => {
  const ja = lerEntregue(entregue, itens.length);
  return itens.map((item, indice) => {
    const vendida = Math.max(0, numero(item.quantidade));
    const e = Math.min(vendida, ja[indice]);
    return {
      indice,
      id: String(item.id || ''),
      nome: String(item.nome || ''),
      vendida,
      entregue: e,
      saldo: arred(vendida - e),
      fatorConversao: numero(item.fatorConversao) > 0 ? numero(item.fatorConversao) : 1,
    };
  });
};

/** pendente (nada entregue), parcial, entregue (saldo zero em tudo). */
export const situacaoDaEntrega = (saldos: SaldoDoItem[]): SituacaoEntregaFutura => {
  if (saldos.length === 0) return 'entregue';
  const entregouAlgo = saldos.some((s) => s.entregue > 1e-9);
  const faltaAlgo = saldos.some((s) => s.saldo > 1e-9);
  if (!faltaAlgo) return 'entregue';
  return entregouAlgo ? 'parcial' : 'pendente';
};

export interface LinhaDaEntrega { indice: number; quantidade: number }
export interface PedidoDeEntrega {
  itens: LinhaDaEntrega[];
  /** Rota em montagem escolhida (vazio = sem rota agora). */
  romaneioId: string;
  observacao: string;
}

const ID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Le o que a tela mandou para uma entrega e confere com o saldo. Devolve a
 * primeira coisa errada, em portugues, ou a entrega limpa (so' linhas com
 * quantidade).
 */
export const lerPedidoDeEntrega = (corpo: unknown, saldos: SaldoDoItem[]): { erro: string } | { entrega: PedidoDeEntrega } => {
  const c = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
  if (!Array.isArray(c.itens)) return { erro: 'Informe o que está sendo entregue.' };
  const itens: LinhaDaEntrega[] = [];
  const vistos = new Set<number>();
  for (const bruto of c.itens) {
    const l = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>;
    const indice = Number(l.indice);
    const quantidade = numero(l.quantidade);
    if (!Number.isInteger(indice) || indice < 0 || indice >= saldos.length) return { erro: 'Item da entrega inválido. Atualize a tela e tente de novo.' };
    if (vistos.has(indice)) return { erro: `${saldos[indice].nome}: o item aparece duas vezes na entrega.` };
    vistos.add(indice);
    if (quantidade < 0) return { erro: `${saldos[indice].nome}: quantidade inválida.` };
    if (quantidade === 0) continue;
    if (quantidade > saldos[indice].saldo + 1e-9) {
      return { erro: `${saldos[indice].nome}: falta entregar ${saldos[indice].saldo}, não dá para entregar ${quantidade}.` };
    }
    itens.push({ indice, quantidade: arred(quantidade) });
  }
  if (itens.length === 0) return { erro: 'Informe a quantidade de pelo menos um item para entregar.' };
  const romaneioId = String(c.romaneioId ?? '').trim();
  if (romaneioId && !ID_VALIDO.test(romaneioId)) return { erro: 'Rota inválida. Atualize a tela e escolha de novo.' };
  return { entrega: { itens, romaneioId, observacao: String(c.observacao ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) } };
};

/** `entregaFuturaEntregue` depois desta entrega. */
export const entregueDepois = (entregueAtual: unknown, totalItens: number, entrega: PedidoDeEntrega): number[] => {
  const lista = lerEntregue(entregueAtual, totalItens);
  entrega.itens.forEach((l) => { lista[l.indice] = arred(lista[l.indice] + l.quantidade); });
  return lista;
};

/** "Pedido #0035 · entrega 2" (numero da entrega dentro do pedido, a partir de 1). */
export const tituloDaEntrega = (numeroPedido: unknown, numeroEntrega: number): string => (
  `Pedido #${String(numeroPedido || '?')} · entrega ${numeroEntrega}`
);

/** Numero "0035/2" para a linha do romaneio e a nota. */
export const numeroDaEntrega = (numeroPedido: unknown, numeroEntrega: number): string => `${String(numeroPedido || '?')}/${numeroEntrega}`;

/**
 * Texto das informacoes complementares da remessa: a SEFAZ e o cliente
 * precisam saber de qual faturamento esta entrega e'.
 */
export const infoComplementarDaRemessa = (a: { numeroPedido: unknown; numeroEntrega: number; notaNumero: unknown; notaChave: string; notaData: string }): string => {
  const numero = a.notaNumero ? ` nº ${a.notaNumero}` : '';
  const data = a.notaData ? ` de ${a.notaData}` : '';
  return `Remessa de mercadoria referente à venda para entrega futura (${tituloDaEntrega(a.numeroPedido, a.numeroEntrega)}), faturada na NF-e${numero}${data}, chave ${a.notaChave}. Mercadoria já faturada: sem cobrança nesta nota.`;
};

/** Texto das informacoes complementares da nota de faturamento (5.922). */
export const infoComplementarDoFaturamento = (numeroPedido: unknown, previsaoEntrega: string): string => (
  `Simples faturamento de venda para entrega futura (Pedido de venda nº ${String(numeroPedido || '?')}).${previsaoEntrega ? ` Previsão de entrega: ${previsaoEntrega.split('-').reverse().join('/')}.` : ''} A mercadoria sai em nota de remessa própria (CFOP 5.116/5.117), que referencia esta.`
);

// ---------------------------------------------------------------------------
// Regras de bloqueio
// ---------------------------------------------------------------------------

/** Por que este pedido nao pode receber entrega agora (ou null). */
export const erroParaEntregar = (pedido: { status?: unknown; entregaFutura?: unknown; numeroPedido?: unknown }, saldos: SaldoDoItem[]): string | null => {
  const numero = String(pedido.numeroPedido || '?');
  if (pedido.entregaFutura !== true) return `O pedido #${numero} não é uma venda para entrega futura.`;
  if (String(pedido.status || '') !== 'Finalizada') return `O pedido #${numero} ainda não foi faturado. Fature a venda antes de entregar.`;
  if (situacaoDaEntrega(saldos) === 'entregue') return `O pedido #${numero} já foi entregue por completo.`;
  return null;
};

/**
 * Cancelar a venda: so' enquanto nada foi entregue (a reserva e' liberada).
 * Com entrega feita, o caminho e' a Devolucao de Venda.
 */
export const erroParaCancelarComEntregaFutura = (pedido: { entregaFutura?: unknown; numeroPedido?: unknown; itens?: unknown; entregaFuturaEntregue?: unknown }): string | null => {
  if (pedido.entregaFutura !== true) return null;
  const itens = Array.isArray(pedido.itens) ? (pedido.itens as ItemDoPedidoParaEntrega[]) : [];
  const saldos = saldoAEntregar(itens, pedido.entregaFuturaEntregue);
  if (saldos.some((s) => s.entregue > 1e-9)) {
    return `O pedido #${String(pedido.numeroPedido || '?')} já teve mercadoria entregue. Para desfazer, registre uma Devolução de Venda; cancelar só é possível antes da primeira entrega.`;
  }
  return null;
};
