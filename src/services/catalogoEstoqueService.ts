import { collection, getDocs, onSnapshot, query, where, type QuerySnapshot, type DocumentData, type Unsubscribe } from 'firebase/firestore';
import { db } from './firebase';

/**
 * CATALOGO DE PRODUTOS COMPARTILHADO (17/11/2026, fase 4 da otimizacao de
 * leituras -- docs/PLANO_OTIMIZACAO_LEITURAS_2026-10-14.md).
 *
 * Antes, cada tela que precisa do catalogo inteiro (Pedido, PDV, OS,
 * Orcamento, Etiquetas, Precificacao...) fazia o proprio getDocs da colecao
 * `estoque` toda vez que abria: numa loja de 3 mil produtos, 3 mil leituras
 * por abertura de tela. Agora a primeira tela que pede abre UMA escuta ao vivo
 * da colecao e as seguintes recebem a mesma copia, sem ler de novo; mudancas
 * (venda baixando saldo, preco alterado) chegam pela escuta e custam so' o
 * documento que mudou. A escuta vive enquanto a pagina estiver aberta (o cache
 * do desktop e' em memoria: fechar a ultima escuta jogaria tudo fora).
 *
 * Devolve o QuerySnapshot -- o mesmo tipo do getDocs, para trocar a chamada
 * sem mexer no resto da tela. Uma empresa por vez: trocar de filial fecha a
 * escuta da anterior.
 *
 * O app /vendedor tem cache persistente proprio e nao usa isto.
 */

interface EscutaDoCatalogo {
  tenantId: string;
  pararDeEscutar: Unsubscribe;
  ultimo: QuerySnapshot<DocumentData> | null;
  esperando: Array<{ resolver: (snap: QuerySnapshot<DocumentData>) => void; rejeitar: (erro: unknown) => void }>;
  ouvintes: Set<(snap: QuerySnapshot<DocumentData>) => void>;
}

let escuta: EscutaDoCatalogo | null = null;

const encerrar = () => {
  if (!escuta) return;
  try { escuta.pararDeEscutar(); } catch { /* ja' encerrada */ }
  escuta = null;
};

const abrirEscuta = (tenantId: string): EscutaDoCatalogo => {
  if (escuta && escuta.tenantId === tenantId) return escuta;
  encerrar();
  const nova: EscutaDoCatalogo = { tenantId, pararDeEscutar: () => undefined, ultimo: null, esperando: [], ouvintes: new Set() };
  escuta = nova;
  nova.pararDeEscutar = onSnapshot(
    query(collection(db, 'estoque'), where('tenantId', '==', tenantId)),
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
      if (escuta === nova) escuta = null;
    },
  );
  return nova;
};

/** O catalogo `estoque` inteiro da empresa, lido uma vez por pagina aberta. */
export const obterCatalogoEstoque = async (tenantId: string): Promise<QuerySnapshot<DocumentData>> => {
  if (!tenantId) throw new Error('Empresa não identificada para carregar os produtos.');
  const atual = abrirEscuta(tenantId);
  if (atual.ultimo) return atual.ultimo;
  try {
    return await new Promise<QuerySnapshot<DocumentData>>((resolver, rejeitar) => {
      atual.esperando.push({ resolver, rejeitar });
    });
  } catch (erro) {
    console.error('Catálogo compartilhado indisponível, lendo direto:', erro);
    return getDocs(query(collection(db, 'estoque'), where('tenantId', '==', tenantId)));
  }
};

/** O catalogo ja' esta' carregado nesta pagina (usar sem custo)? */
export const catalogoEstoqueJaCarregado = (tenantId: string | null | undefined): boolean => Boolean(
  tenantId && escuta && escuta.tenantId === tenantId && escuta.ultimo,
);

/**
 * Acompanha o catalogo ao vivo (para listas que precisam refletir a mudanca
 * na hora). Chama `aoMudar` com o estado atual assim que existir e a cada
 * mudanca; devolve a funcao para parar de acompanhar (a escuta compartilhada
 * continua aberta para as outras telas).
 */
export const acompanharCatalogoEstoque = (
  tenantId: string,
  aoMudar: (snap: QuerySnapshot<DocumentData>) => void,
  aoFalhar?: (erro: unknown) => void,
): (() => void) => {
  const atual = abrirEscuta(tenantId);
  atual.ouvintes.add(aoMudar);
  if (atual.ultimo) aoMudar(atual.ultimo);
  else {
    obterCatalogoEstoque(tenantId)
      // Caiu no getDocs (escuta falhou): entrega a leitura direta uma vez.
      .then((snap) => { if (escuta !== atual || !atual.ultimo) aoMudar(snap); })
      .catch((erro) => aoFalhar?.(erro));
  }
  return () => { atual.ouvintes.delete(aoMudar); };
};

/** Saiu do sistema: fecha a escuta. */
export const encerrarCatalogoEstoque = encerrar;
