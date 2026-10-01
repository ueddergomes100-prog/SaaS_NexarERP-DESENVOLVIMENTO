import { addDoc, collection, doc, getDocs, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { db } from './firebase';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../utils/documentMetadata';
import { getDateInputInTimeZone } from '../utils/dateTime';
import {
  conflitosDaPromocao,
  errosDaPromocao,
  lerPromocao,
  promocaoParaGravar,
  type Promocao,
  type PromocaoComId,
} from '../utils/promocaoDomain';

/**
 * Firestore das PROMOCOES (2026-10-01). Regra em promocaoDomain.ts.
 *
 * `produtoIds` e' gravado junto dos itens so' pra consulta: "em que promocoes
 * este produto esta?" (cadastro do produto e a trava de duplicidade).
 */

export const COLECAO_PROMOCOES = 'promocoes';

const pedacos = <T>(lista: T[], tamanho = 30): T[][] => {
  const saida: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) saida.push(lista.slice(i, i + tamanho));
  return saida;
};

/** Promocoes da empresa que contem algum destes produtos. */
export const promocoesComProdutos = async (tenantId: string, produtoIds: string[]): Promise<PromocaoComId[]> => {
  const achadas = new Map<string, PromocaoComId>();
  for (const lote of pedacos([...new Set(produtoIds)])) {
    const snap = await getDocs(query(collection(db, COLECAO_PROMOCOES), where('tenantId', '==', tenantId), where('produtoIds', 'array-contains-any', lote)));
    snap.forEach((d) => achadas.set(d.id, { ...lerPromocao(d.data()), id: d.id }));
  }
  return [...achadas.values()];
};

/**
 * Grava a promocao (nova ou existente). Erros de preenchimento e produto que
 * ja esta em outra promocao no mesmo periodo voltam como Error em portugues,
 * todos juntos -- nada e' gravado.
 */
export const salvarPromocao = async (args: {
  tenantId: string;
  uid: string;
  id?: string;
  promocao: Promocao;
  precosAtuais?: Record<string, number>;
}): Promise<string> => {
  const dados = promocaoParaGravar(args.promocao);
  const erros = errosDaPromocao(dados, args.precosAtuais);
  if (erros.length > 0) throw new Error(erros.join(' '));

  const outras = await promocoesComProdutos(args.tenantId, dados.itens.map((i) => i.produtoId));
  const conflitos = conflitosDaPromocao({ ...dados, id: args.id }, outras, getDateInputInTimeZone());
  if (conflitos.length > 0) throw new Error(conflitos.join(' '));

  const gravar = {
    ...dados,
    produtoIds: dados.itens.map((i) => i.produtoId),
    tenantId: args.tenantId,
    updatedAt: serverTimestamp(),
  };
  if (args.id) {
    await updateDoc(doc(db, COLECAO_PROMOCOES, args.id), {
      ...gravar,
      ...buildDocumentUpdateMetadata(args.uid, serverTimestamp(), dados.inativa ? 'Promoção inativada' : 'Promoção alterada'),
    });
    return args.id;
  }
  const ref = await addDoc(collection(db, COLECAO_PROMOCOES), {
    ...gravar,
    createdAt: serverTimestamp(),
    ...buildDocumentMetadata(args.uid, serverTimestamp()),
  });
  return ref.id;
};

/** Encerra/reativa sem mexer no resto (nao some da lista: o historico fica). */
export const alterarSituacaoDaPromocao = async (uid: string, id: string, inativa: boolean): Promise<void> => {
  await updateDoc(doc(db, COLECAO_PROMOCOES, id), {
    inativa,
    updatedAt: serverTimestamp(),
    ...buildDocumentUpdateMetadata(uid, serverTimestamp(), inativa ? 'Promoção inativada' : 'Promoção reativada'),
  });
};

/**
 * Quanto da quota ja saiu: soma, nos pedidos NAO cancelados que levaram a
 * promocao, a quantidade (na unidade base) dos itens dela. Venda cancelada
 * devolve a quota sozinha, porque deixa de entrar na soma.
 */
export const vendidoNaPromocao = async (tenantId: string, promocaoId: string, ignorarPedidoId?: string): Promise<Record<string, number>> => {
  const snap = await getDocs(query(collection(db, 'pedidos_venda'), where('tenantId', '==', tenantId), where('promocaoIds', 'array-contains', promocaoId)));
  const vendido: Record<string, number> = {};
  snap.forEach((d) => {
    const pedido = d.data();
    // O pedido que esta aberto na tela conta pelos itens da tela, nao pelo que foi gravado.
    if (pedido.status === 'Cancelada' || d.id === ignorarPedidoId) return;
    (Array.isArray(pedido.itens) ? pedido.itens : []).forEach((item: Record<string, unknown>) => {
      if (item.promocaoId !== promocaoId) return;
      const qtd = Number(item.quantidadeBase ?? item.quantidade) || 0;
      const id = String(item.id || '');
      vendido[id] = (vendido[id] || 0) + qtd;
    });
  });
  return vendido;
};
