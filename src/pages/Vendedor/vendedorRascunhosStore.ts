import type { ItemVendaExterna } from '../../services/vendedorExternoVendaService';

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

export type TipoRascunho = 'pedido' | 'orcamento';

export interface RascunhoVenda {
  /** Vira tambem o id do documento no Firestore ao enviar -- e' o que torna
   *  o envio seguro de repetir (ver criarPreVendaExterna). */
  localId: string;
  tipo: TipoRascunho;
  cliente: { id: string; nome: string; telefone?: string };
  itens: ItemVendaExterna[];
  criadoEm: string;
  atualizadoEm: string;
  /** Motivo da ultima tentativa de envio que falhou. */
  ultimoErro?: string;
}

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
