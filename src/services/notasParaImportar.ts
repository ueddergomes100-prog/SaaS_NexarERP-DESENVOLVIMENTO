import { collection, getDocs, query, Timestamp, where, type DocumentData, type QueryDocumentSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import { lerComReserva } from './consultaComReserva';
import { addDaysToDateInput, dateInputToUtcStart, getDateInputInTimeZone } from '../utils/dateTime';
import { ehNfseDeEntrada } from '../utils/nfseEntradaDomain';

/**
 * Notas oferecidas no "Importar de uma Nota" de Etiquetas e Precificação
 * (otimização de leituras, 2026-10-14). Antes: TODAS as notas da empresa a
 * cada abertura do modal -- a de entrada com o XML dentro. Agora as ATIVAS
 * lançadas nos últimos 90 dias; "Ver notas mais antigas" traz todas as ativas.
 */
export const DIAS_NOTAS_PARA_IMPORTAR = 90;

export type ColecaoNotasParaImportar = 'notas_fiscais_entrada' | 'notas_avulsas';

export const lerNotasAtivasParaImportar = async (
  colecao: ColecaoNotasParaImportar,
  tenantId: string,
  todasAsDatas = false,
): Promise<QueryDocumentSnapshot<DocumentData>[]> => {
  const daEmpresa = query(collection(db, colecao), where('tenantId', '==', tenantId));
  const ativas = query(daEmpresa, where('status', '==', 'ativa'));
  const inicio = dateInputToUtcStart(addDaysToDateInput(getDateInputInTimeZone(), -DIAS_NOTAS_PARA_IMPORTAR));
  // NFS-e de entrada (servico tomado, 27/10/2026) nao tem produto: fica fora.
  const comProduto = (d: QueryDocumentSnapshot<DocumentData>) => !ehNfseDeEntrada(d.data());
  if (todasAsDatas || !inicio) {
    return (await getDocs(ativas)).docs.filter(comProduto);
  }
  const snap = await lerComReserva(
    query(ativas, where('createdAt', '>=', Timestamp.fromDate(inicio))),
    daEmpresa,
    `Notas para importar (${colecao})`,
  );
  // Mesmo corte da consulta enxuta, para a reserva (sem indice) mostrar o mesmo.
  return snap.docs.filter((d) => {
    const dados = d.data();
    const lancada = dados.createdAt?.toDate ? dados.createdAt.toDate() as Date : null;
    return dados.status === 'ativa' && Boolean(lancada && lancada >= inicio) && comProduto(d);
  });
};
