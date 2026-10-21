import type { ItemVendaExterna } from '../../services/vendedorExternoVendaService';
import type { EscolhaNotaFiscal } from '../../utils/pedidoVendedorDomain';
import type { ItemTrocaRascunho } from '../../utils/trocaDomain';
import type { RotaEscolhida } from '../../utils/rotaPreVendaDomain';

/**
 * Rascunhos de pedido/orcamento do vendedor externo, guardados NO APARELHO.
 *
 * O pedido nao vai pra base quando o vendedor termina de montar: fica aqui,
 * editavel a vontade, ate ele tocar "Enviar dados" (VendedorRascunhos.tsx).
 * Motivo (decisao do dono do produto): pedido enviado na hora cai na fila da
 * loja, que pode comecar a conferir/separar enquanto o cliente ainda pede
 * pra trocar ou tirar item -- e ai o vendedor teria que ligar pra loja. So'
 * depois de enviado o pedido vira pre-venda de verdade, e dai em diante o
 * app so' visualiza/cancela.
 *
 * localStorage, nao IndexedDB: poucos pedidos com poucos itens cabem com
 * folga, e sobrevive a fechar o app. Quando existir o modo offline completo,
 * este armazenamento e' o que precisa migrar.
 *
 * Chave por empresa + login: celular compartilhado nao mistura rascunho de
 * um vendedor com o de outro.
 */

export type TipoRascunho = 'pedido' | 'orcamento' | 'troca';

export interface RascunhoVenda {
  /** Vira tambem o id do documento no Firestore ao enviar -- e' o que torna
   *  o envio seguro de repetir (ver criarPreVendaExterna). */
  localId: string;
  tipo: TipoRascunho;
  cliente: { id: string; nome: string; telefone?: string };
  /** Pedido e orcamento. Na TROCA fica vazio: os itens dela (sem preco, com motivo) estao em `itensTroca`. */
  itens: ItemVendaExterna[];
  /** So' troca: reposicao sem cobranca -- produto, quantidade e motivo de cada item. */
  itensTroca?: ItemTrocaRascunho[];
  /** Pedido e troca: recado pra loja (sai na minuta da retaguarda). */
  observacao?: string;
  /** So' pedido, e so' na empresa que controla nota fiscal: o que o vendedor marcou. */
  notaFiscal?: EscolhaNotaFiscal;
  criadoEm: string;
  atualizadoEm: string;
  /** Motivo da ultima tentativa de envio que falhou. */
  ultimoErro?: string;
  /**
   * "Pronto para enviar" (13/10/2026, decisao do dono): o vendedor fechou o
   * pedido com o cliente e o app manda sozinho quando tiver sinal
   * (envioRascunhos.ts). Sem isso continua rascunho -- a loja nao pode
   * separar pedido que o cliente ainda vai mudar. Editar o rascunho tira a
   * marca: o vendedor confirma de novo ao salvar.
   */
  pronto?: boolean;
  prontoEm?: string;
  /**
   * Rota de entrega escolhida ao marcar "Pronto" (21/10/2026,
   * rotaPreVendaDomain.ts). So' pedido, e so' na empresa que pergunta a
   * rota. No envio o servidor confere de novo: se a rota ja' saiu, cai na
   * que sobrou.
   */
  rota?: RotaEscolhida;
}

/** Avisa a tela de Rascunhos (e quem mais escutar) que a lista mudou. */
export const EVENTO_RASCUNHOS_ALTERADOS = 'nexus-vendedor-rascunhos-alterados';

const chave = (tenantId: string, usuarioId: string) => `nexus_vendedor_rascunhos:${tenantId}:${usuarioId}`;

export class RascunhoStorageError extends Error {}

export const novoLocalId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
};

export const listarRascunhos = (tenantId: string, usuarioId: string): RascunhoVenda[] => {
  try {
    const bruto = localStorage.getItem(chave(tenantId, usuarioId));
    const lista = bruto ? JSON.parse(bruto) : [];
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
};

const gravarLista = (tenantId: string, usuarioId: string, lista: RascunhoVenda[]) => {
  try {
    localStorage.setItem(chave(tenantId, usuarioId), JSON.stringify(lista));
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENTO_RASCUNHOS_ALTERADOS));
  } catch {
    // Quem chama precisa saber: um rascunho que nao gravou e' venda perdida.
    throw new RascunhoStorageError('Não foi possível salvar no aparelho. Verifique se há espaço livre no celular e tente de novo.');
  }
};

export const buscarRascunho = (tenantId: string, usuarioId: string, localId: string): RascunhoVenda | null =>
  listarRascunhos(tenantId, usuarioId).find((r) => r.localId === localId) || null;

export const salvarRascunho = (tenantId: string, usuarioId: string, rascunho: RascunhoVenda) => {
  const lista = listarRascunhos(tenantId, usuarioId);
  const indice = lista.findIndex((r) => r.localId === rascunho.localId);
  if (indice >= 0) {
    lista[indice] = rascunho;
  } else {
    lista.push(rascunho);
  }
  gravarLista(tenantId, usuarioId, lista);
};

export const removerRascunho = (tenantId: string, usuarioId: string, localId: string) => {
  gravarLista(tenantId, usuarioId, listarRascunhos(tenantId, usuarioId).filter((r) => r.localId !== localId));
};

export const marcarErroRascunho = (tenantId: string, usuarioId: string, localId: string, mensagem: string) => {
  const lista = listarRascunhos(tenantId, usuarioId).map((r) => (r.localId === localId ? { ...r, ultimoErro: mensagem } : r));
  gravarLista(tenantId, usuarioId, lista);
};

/** Marca/desmarca "Pronto para enviar". Marcar limpa o erro antigo: a proxima tentativa e' nova. */
export const marcarProntoRascunho = (tenantId: string, usuarioId: string, localId: string, pronto: boolean, rota?: RotaEscolhida | null) => {
  const agora = new Date().toISOString();
  const lista = listarRascunhos(tenantId, usuarioId).map((r) => {
    if (r.localId !== localId) return r;
    const copia: RascunhoVenda = { ...r };
    delete copia.pronto;
    delete copia.prontoEm;
    // A rota acompanha o "Pronto": desmarcou, a escolha some; marcou de
    // novo, pergunta de novo.
    delete copia.rota;
    if (!pronto) return copia;
    delete copia.ultimoErro;
    return { ...copia, pronto: true, prontoEm: agora, ...(rota ? { rota } : {}) };
  });
  gravarLista(tenantId, usuarioId, lista);
};
