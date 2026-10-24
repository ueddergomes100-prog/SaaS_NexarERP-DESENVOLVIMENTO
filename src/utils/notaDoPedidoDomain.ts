/**
 * NOTA FISCAL DO PEDIDO (23/10/2026, lista do dono).
 *
 * Um pedido de venda tem UMA nota de venda: a NF-e ou o cupom (NFC-e). Regras:
 *
 * 1. Pedido com nota valendo (autorizada ou aguardando a SEFAZ) some das listas
 *    de emissao (lote e "Importar do Pedido de Venda") e o servidor recusa uma
 *    segunda nota. Nota rejeitada nao conta: o pedido continua para reenviar.
 * 2. Cupom conta como nota, mas a troca "cupom -> NF-e" continua valendo para o
 *    cliente que pede NF-e depois (botao do cupom autorizado na tela de Notas).
 * 3. "Com nota / Sem nota" (`comNotaFiscal` no pedido, o mesmo campo do app):
 *    pedido SEM nota nunca vai para a emissao; para emitir, troca-se no pedido.
 *    Pedido antigo, sem a marcacao, continua aparecendo para emitir (como antes)
 *    e pode ser tirado da lista marcando "Sem nota".
 * 4. Duas pessoas emitindo o mesmo pedido ao mesmo tempo: o servidor guarda no
 *    pedido quem esta emitindo (trava curta) e recusa a segunda.
 *
 * Notas que NAO sao a nota de venda do pedido (apontam para ele por outro
 * motivo): devolucao, remessa da entrega futura e transferencia.
 */

export const STATUS_NOTA_VALENDO = ['authorized', 'enqueued', 'processing', 'created'] as const;
export const FINALIDADES_FORA_DA_NOTA_DO_PEDIDO = ['devolucao', 'remessa_entrega_futura', 'transferencia'] as const;

/** Tempo que a trava de "alguem esta emitindo" segura o pedido sem resposta. */
export const TRAVA_EMISSAO_MS = 3 * 60 * 1000;

export interface NotaResumo {
  tipo?: string | null;
  status?: string | null;
  finalidade?: string | null;
  number?: number | string | null;
  integrationId?: string | null;
}

export interface TravaEmissao {
  integrationId: string;
  tipo: string;
  emMillis: number;
}

export type MarcaNotaFiscal = 'com' | 'sem' | 'nao_informado';

/** `comNotaFiscal` do pedido: true = com nota, false = sem nota, ausente = pedido antigo/nao informado. */
export const marcaNotaDoPedido = (comNotaFiscal: unknown): MarcaNotaFiscal => {
  if (comNotaFiscal === true) return 'com';
  if (comNotaFiscal === false) return 'sem';
  return 'nao_informado';
};

/** Esta nota e' a nota de venda do pedido e esta valendo? */
export const notaValeComoNotaDoPedido = (nota: NotaResumo): boolean => (
  (nota.tipo === 'NF-e' || nota.tipo === 'NFC-e')
  && (STATUS_NOTA_VALENDO as readonly string[]).includes(String(nota.status || ''))
  && !(FINALIDADES_FORA_DA_NOTA_DO_PEDIDO as readonly string[]).includes(String(nota.finalidade || ''))
);

export const notasValendoDoPedido = <T extends NotaResumo>(notas: T[]): T[] => notas.filter(notaValeComoNotaDoPedido);

/** Pedido aparece nas listas de emissao (lote e "Importar do Pedido de Venda")? */
export const pedidoEntraNaEmissao = (pedido: { comNotaFiscal?: unknown }, notasDoPedido: NotaResumo[]): boolean => (
  marcaNotaDoPedido(pedido.comNotaFiscal) !== 'sem' && notasValendoDoPedido(notasDoPedido).length === 0
);

const doPedido = (numeroPedido?: string | null) => (numeroPedido ? `O pedido #${numeroPedido}` : 'Este pedido');
const deQualPedido = (numeroPedido?: string | null) => (numeroPedido ? `do pedido #${numeroPedido}` : 'deste pedido');
const numeroDa = (nota: NotaResumo) => (nota.number !== null && nota.number !== undefined && String(nota.number) !== '' ? ` nº ${nota.number}` : '');
const situacaoDa = (nota: NotaResumo) => (nota.status === 'authorized' ? 'autorizada' : 'aguardando a SEFAZ');

/**
 * Por que NAO emitir esta nota agora (null = pode emitir). Mesma regra na tela e no
 * servidor. `integrationId` e' o id da nota que esta sendo enviada: reenviar a mesma
 * nota (retransmissao) nao conta como segunda nota.
 */
export const motivoParaNaoEmitir = (args: {
  numeroPedido?: string | null;
  status?: string | null;
  comNotaFiscal?: unknown;
  tipo: 'NF-e' | 'NFC-e';
  integrationId?: string | null;
  notas: NotaResumo[];
  trava?: TravaEmissao | null;
  agoraMillis: number;
}): string | null => {
  const quem = doPedido(args.numeroPedido);
  if (args.status === 'Cancelada') return `${quem} foi cancelado: não se emite nota fiscal para ele.`;
  if (marcaNotaDoPedido(args.comNotaFiscal) === 'sem') {
    return `${quem} está marcado como SEM nota fiscal. Para emitir, abra o pedido e troque para COM nota fiscal.`;
  }
  const outras = notasValendoDoPedido(args.notas).filter((n) => !args.integrationId || n.integrationId !== args.integrationId);
  const nfe = outras.find((n) => n.tipo === 'NF-e');
  if (nfe) {
    return `${quem} já tem a NF-e${numeroDa(nfe)} ${situacaoDa(nfe)}. Não se emite uma segunda nota para o mesmo pedido.`;
  }
  const cupom = outras.find((n) => n.tipo === 'NFC-e');
  if (cupom) {
    if (args.tipo === 'NFC-e') {
      return `${quem} já tem o cupom fiscal (NFC-e)${numeroDa(cupom)} ${situacaoDa(cupom)}. Não se emite um segundo cupom para o mesmo pedido.`;
    }
    // Troca do cupom por NF-e: so' com o cupom ja' autorizado (a SEFAZ precisa ter respondido).
    if (cupom.status !== 'authorized') {
      return `O cupom fiscal (NFC-e) ${deQualPedido(args.numeroPedido)} ainda aguarda a SEFAZ. Espere a resposta antes de emitir a NF-e no lugar dele.`;
    }
  }
  const trava = args.trava;
  if (
    trava
    && trava.integrationId
    && trava.integrationId !== args.integrationId
    && args.agoraMillis - Number(trava.emMillis || 0) < TRAVA_EMISSAO_MS
    && !args.notas.some((n) => n.integrationId && n.integrationId === trava.integrationId)
  ) {
    return `A nota ${deQualPedido(args.numeroPedido)} está sendo emitida agora por outra tela. Espere um minuto e confira a lista de notas fiscais.`;
  }
  return null;
};

/** Pode marcar o pedido como SEM nota? (null = pode). Pedido com nota valendo nao volta para "sem nota". */
export const motivoParaNaoMarcarSemNota = (args: { numeroPedido?: string | null; notas: NotaResumo[] }): string | null => {
  const valendo = notasValendoDoPedido(args.notas)[0];
  if (!valendo) return null;
  const qual = valendo.tipo === 'NFC-e' ? `o cupom fiscal (NFC-e)${numeroDa(valendo)}` : `a NF-e${numeroDa(valendo)}`;
  return `${doPedido(args.numeroPedido)} já tem ${qual} ${situacaoDa(valendo)}: não dá para marcar como sem nota fiscal.`;
};

/** Corpo do POST /api/vendas/nota-fiscal (servidor confere tudo de novo). */
export const lerPedidoDeMarcaNota = (corpo: unknown): { pedidoId: string; comNotaFiscal: boolean } | { erro: string } => {
  const c = (corpo || {}) as Record<string, unknown>;
  const pedidoId = typeof c.pedidoId === 'string' ? c.pedidoId.trim() : '';
  if (!pedidoId || pedidoId.length > 128 || pedidoId.includes('/')) return { erro: 'Pedido não informado.' };
  if (typeof c.comNotaFiscal !== 'boolean') return { erro: 'Informe se o pedido é COM ou SEM nota fiscal.' };
  return { pedidoId, comNotaFiscal: c.comNotaFiscal };
};
