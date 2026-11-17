import { collection, getDocs, onSnapshot, query, where, type QuerySnapshot, type DocumentData, type Unsubscribe } from 'firebase/firestore';
import { db } from './firebase';

/**
 * CATALOGOS COMPARTILHADOS (17/11/2026, fase 4 da otimizacao de leituras --
 * docs/PLANO_OTIMIZACAO_LEITURAS_2026-10-14.md).
 *
 * Antes, cada tela que precisa de um cadastro inteiro (produtos, clientes,
 * fornecedores...) fazia o proprio getDocs/onSnapshot da colecao toda vez que
 * abria: numa loja de 3 mil produtos, 3 mil leituras por abertura de tela.
 * Agora a primeira tela que pede abre UMA escuta ao vivo da colecao e as
 * seguintes recebem a mesma copia, sem ler de novo; mudancas chegam pela
 * escuta e custam so' o documento que mudou. A escuta vive enquanto a pagina
 * estiver aberta (o cache do desktop e' em memoria: fechar a ultima escuta
 * jogaria tudo fora).
 *
 * Devolve o QuerySnapshot -- o mesmo tipo do getDocs, para trocar a chamada
 * sem mexer no resto da tela. Uma empresa por vez em cada colecao: trocar de
 * filial fecha a escuta da anterior.
 */

interface EscutaDoCatalogo {
  colecao: string;
  tenantId: string;
  pararDeEscutar: Unsubscribe;
  ultimo: QuerySnapshot<DocumentData> | null;
  esperando: Array<{ resolver: (snap: QuerySnapshot<DocumentData>) => void; rejeitar: (erro: unknown) => void }>;
  ouvintes: Set<(snap: QuerySnapshot<DocumentData>) => void>;
}

const escutas = new Map<string, EscutaDoCatalogo>();

const encerrar = (colecao: string) => {
  const atual = escutas.get(colecao);
  if (!atual) return;
  try { atual.pararDeEscutar(); } catch { /* ja' encerrada */ }
  escutas.delete(colecao);
};

const abrirEscuta = (colecao: string, tenantId: string): EscutaDoCatalogo => {
  const existente = escutas.get(colecao);
  if (existente && existente.tenantId === tenantId) return existente;
  encerrar(colecao);
  const nova: EscutaDoCatalogo = { colecao, tenantId, pararDeEscutar: () => undefined, ultimo: null, esperando: [], ouvintes: new Set() };
  escutas.set(colecao, nova);
  nova.pararDeEscutar = onSnapshot(
    query(collection(db, colecao), where('tenantId', '==', tenantId)),
    (snap) => {
      nova.ultimo = snap;
      const esperando = nova.esperando.splice(0);
      esperando.forEach(({ resolver }) => resolver(snap));
      nova.ouvintes.forEach((ouvinte) => ouvinte(snap));
    },
    (erro) => {
      // Sem permissao (saiu do sistema) ou queda: descarta a escuta; o proximo
      // pedido abre outra. Quem esperava recebe o erro e cai no getDocs.
      const esperando = nova.esperando.splice(0);
      esperando.forEach(({ rejeitar }) => rejeitar(erro));
      if (escutas.get(colecao) === nova) escutas.delete(colecao);
    },
  );
  return nova;
};

/** A colecao inteira da empresa, lida uma vez por pagina aberta. */
export const obterCatalogo = async (colecao: string, tenantId: string | null | undefined): Promise<QuerySnapshot<DocumentData>> => {
  if (!tenantId) throw new Error('Empresa não identificada para carregar o cadastro.');
  const atual = abrirEscuta(colecao, tenantId);
  if (atual.ultimo) return atual.ultimo;
  try {
    return await new Promise<QuerySnapshot<DocumentData>>((resolver, rejeitar) => {
      atual.esperando.push({ resolver, rejeitar });
    });
  } catch (erro) {
    console.error(`Catálogo compartilhado de ${colecao} indisponível, lendo direto:`, erro);
    return getDocs(query(collection(db, colecao), where('tenantId', '==', tenantId)));
  }
};

/** A colecao ja' esta' carregada nesta pagina (usar sem custo)? */
export const catalogoJaCarregado = (colecao: string, tenantId: string | null | undefined): boolean => {
  const atual = escutas.get(colecao);
  return Boolean(tenantId && atual && atual.tenantId === tenantId && atual.ultimo);
};

/**
 * Acompanha a colecao ao vivo. Chama `aoMudar` com o estado atual assim que
 * existir e a cada mudanca; devolve a funcao para parar de acompanhar (a
 * escuta compartilhada continua aberta para as outras telas).
 */
export const acompanharCatalogo = (
  colecao: string,
  tenantId: string,
  aoMudar: (snap: QuerySnapshot<DocumentData>) => void,
  aoFalhar?: (erro: unknown) => void,
): (() => void) => {
  const atual = abrirEscuta(colecao, tenantId);
  atual.ouvintes.add(aoMudar);
  if (atual.ultimo) aoMudar(atual.ultimo);
  else {
    obterCatalogo(colecao, tenantId)
      // Caiu no getDocs (escuta falhou): entrega a leitura direta uma vez.
      .then((snap) => { if (escutas.get(colecao) !== atual || !atual.ultimo) aoMudar(snap); })
      .catch((erro) => aoFalhar?.(erro));
  }
  return () => { atual.ouvintes.delete(aoMudar); };
};

// Atalhos do catalogo de produtos (o mais usado).
export const obterCatalogoEstoque = (tenantId: string | null | undefined) => obterCatalogo('estoque', tenantId);
export const catalogoEstoqueJaCarregado = (tenantId: string | null | undefined) => catalogoJaCarregado('estoque', tenantId);
export const acompanharCatalogoEstoque = (
  tenantId: string,
  aoMudar: (snap: QuerySnapshot<DocumentData>) => void,
  aoFalhar?: (erro: unknown) => void,
) => acompanharCatalogo('estoque', tenantId, aoMudar, aoFalhar);
