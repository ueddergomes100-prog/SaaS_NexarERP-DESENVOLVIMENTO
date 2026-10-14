import { useEffect, useState } from 'react';
import {
  collection, onSnapshot, query, Timestamp, where,
  type DocumentData, type QueryConstraint, type QuerySnapshot,
} from 'firebase/firestore';
import { db } from '../services/firebase';
import { assinarComReserva } from '../services/consultaComReserva';
import { dateInputToUtcEnd, dateInputToUtcStart } from '../utils/dateTime';
import { dentroDoPeriodo } from '../utils/filtroListaDomain';

/**
 * LISTA = PENDENTES + PERIODO (otimizacao de leituras, 2026-10-14).
 *
 * Para as listas que liam a colecao inteira por tenantId (Trocas,
 * Condicionais, Romaneios, Rotas...): o que ainda esta em aberto
 * (`statusPendentes`) vem de QUALQUER data -- pendente nunca some por periodo,
 * decisao do dono --, e o resto so' do periodo pedido. As duas escutas sao
 * juntadas por id.
 *
 * `de` e `ate` vazios = todo o historico (pedido explicito de quem quer ver
 * tudo). O campo de data pode ser Timestamp (`createdAt`) ou texto AAAA-MM-DD
 * (`data`, `dataSaida`). Sem o indice (tenantId, campo) publicado, a escuta do
 * periodo cai na colecao inteira e o mesmo corte e' feito aqui.
 */
export interface OpcoesPendentesEPeriodo {
  /** Status que aparecem sempre, de qualquer data. Vazio = so' o periodo. */
  statusPendentes?: readonly string[];
  campoData: string;
  tipoData: 'timestamp' | 'texto';
  /** AAAA-MM-DD; vazio = sem limite desse lado. Os dois vazios = tudo. */
  de: string;
  ate: string;
  enabled?: boolean;
}

export interface ResultadoPendentesEPeriodo<T> {
  items: T[];
  loading: boolean;
}

export function usePendentesEPeriodo<T extends { id: string }>(
  colecao: string,
  tenantId: string | null | undefined,
  opcoes: OpcoesPendentesEPeriodo,
): ResultadoPendentesEPeriodo<T> {
  const { statusPendentes, campoData, tipoData, de, ate, enabled = true } = opcoes;
  // Lista vira texto para nao reassinar a cada render por causa de um array novo.
  const chavePendentes = (statusPendentes || []).join('|');
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId || !enabled) {
      setItems([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const daEmpresa = query(collection(db, colecao), where('tenantId', '==', tenantId));
    const pendentes = chavePendentes ? chavePendentes.split('|') : [];
    const partes = new Map<string, T[]>();
    const esperadas = pendentes.length > 0 ? 2 : 1;
    const publicar = () => {
      const porId = new Map<string, T>();
      partes.forEach((lista) => lista.forEach((item) => porId.set(item.id, item)));
      setItems(Array.from(porId.values()));
      if (partes.size >= esperadas) setLoading(false);
    };
    const paraItens = (docs: QuerySnapshot<DocumentData>['docs']) => docs.map((d) => ({ id: d.id, ...d.data() }) as T);
    const falhar = (nome: string) => (erro: unknown) => {
      console.error(`Erro ao ler ${colecao} (${nome}):`, erro);
      if (!partes.has(nome)) partes.set(nome, []);
      publicar();
    };

    const parar: Array<() => void> = [];
    if (pendentes.length > 0) {
      parar.push(onSnapshot(query(daEmpresa, where('status', 'in', pendentes)), (snap) => {
        partes.set('pendentes', paraItens(snap.docs));
        publicar();
      }, falhar('pendentes')));
    }

    if (!de && !ate) {
      parar.push(onSnapshot(daEmpresa, (snap) => {
        partes.set('periodo', paraItens(snap.docs));
        publicar();
      }, falhar('periodo')));
    } else {
      const limites: QueryConstraint[] = [];
      if (tipoData === 'timestamp') {
        const inicio = de ? dateInputToUtcStart(de) : null;
        const fim = ate ? dateInputToUtcEnd(ate) : null;
        if (inicio) limites.push(where(campoData, '>=', Timestamp.fromDate(inicio)));
        if (fim) limites.push(where(campoData, '<=', Timestamp.fromDate(fim)));
      } else {
        if (de) limites.push(where(campoData, '>=', de));
        if (ate) limites.push(where(campoData, '<=', ate));
      }
      parar.push(assinarComReserva(query(daEmpresa, ...limites), daEmpresa, `${colecao} (período por ${campoData})`, (snap) => {
        // Mesmo corte da consulta enxuta, para a reserva (sem indice) mostrar o mesmo.
        partes.set('periodo', paraItens(snap.docs.filter((d) => dentroDoPeriodo(d.data()[campoData], de, ate))));
        publicar();
      }, falhar('periodo')));
    }

    return () => parar.forEach((fn) => fn());
  }, [colecao, tenantId, enabled, chavePendentes, campoData, tipoData, de, ate]);

  return { items, loading };
}
