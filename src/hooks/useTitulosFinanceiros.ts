import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where, type DocumentData, type Query, type QuerySnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { assinarComReserva } from '../services/consultaComReserva';
import { getDateInputInTimeZone } from '../utils/dateTime';

/**
 * TÍTULOS DE CONTAS A PAGAR / A RECEBER (otimização de leituras, 2026-10-14).
 *
 * As duas telas escutavam TODAS as transações do tipo, desde o primeiro dia
 * da empresa, a cada abertura. Agora:
 *  - em aberto (status Pendente), de qualquer data — pendente nunca some;
 *    é o que soma "Total a Receber/Pendente" e o aviso de vencidas;
 *  - pagas HOJE (cartão "Recebido/Pago Hoje");
 *  - histórico de pagas SÓ quando a tela lista pagas: pelo período pedido
 *    (`{ de, ate }`) ou tudo (`'todo'`, escolha explícita de "qualquer data").
 *    Paga sem `dataPagamento` (título que nasceu pago) é filtrada pelo
 *    vencimento (passaNoPeriodoDoTitulo), então são duas consultas: por
 *    data de pagamento e por vencimento.
 *
 * As consultas de igualdade não precisam de índice composto. As de período
 * usam (tenantId, tipo, status, dataPagamento|data); sem o índice publicado,
 * caem na consulta antiga (todas do tipo) e o filtro da tela segura.
 *
 * O Caixa usa sem `tipo` (entradas e saídas), sem as abertas e sem as pagas
 * de hoje: só o histórico de pagas do período (índices sem `tipo`).
 */

export type HistoricoDePagas = null | 'todo' | { de: string; ate: string };

export interface TituloLido {
  id: string;
}

const lerDocumentos = <T extends TituloLido>(snapshot: QuerySnapshot<DocumentData>) => (
  snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as T))
);

export const useTitulosFinanceiros = <T extends TituloLido>(args: {
  tenantId: string | null;
  /** Sem tipo = entradas e saídas. */
  tipo?: 'entrada' | 'saida';
  historico: HistoricoDePagas;
  /** Em aberto de qualquer data (padrão: sim). */
  abertas?: boolean;
  /** Pagas hoje (padrão: sim). */
  pagasHoje?: boolean;
}): { titulos: T[]; carregando: boolean } => {
  const { tenantId, tipo, historico, abertas = true, pagasHoje = true } = args;
  const [titulos, setTitulos] = useState<T[]>([]);
  const [carregando, setCarregando] = useState(true);

  // Chave estável do histórico (o objeto muda a cada render).
  const chaveHistorico = historico === null ? '' : historico === 'todo' ? 'todo' : `${historico.de}|${historico.ate}`;

  useEffect(() => {
    if (!tenantId) {
      setTitulos([]);
      setCarregando(false);
      return undefined;
    }
    setCarregando(true);
    const hoje = getDateInputInTimeZone();
    const base = collection(db, 'transacoes');
    const doTipo = tipo
      ? query(base, where('tenantId', '==', tenantId), where('tipo', '==', tipo))
      : query(base, where('tenantId', '==', tenantId));
    const rotulo = tipo || 'entrada e saída';
    const partes = new Map<string, T[]>();
    const esperadas = new Set<string>();
    const chegaram = new Set<string>();

    const publicar = () => {
      const porId = new Map<string, T>();
      partes.forEach((lista) => lista.forEach((titulo) => porId.set(titulo.id, titulo)));
      setTitulos(Array.from(porId.values()));
      if ([...esperadas].every((nome) => chegaram.has(nome))) setCarregando(false);
    };
    const receber = (nome: string) => (snapshot: QuerySnapshot<DocumentData>) => {
      partes.set(nome, lerDocumentos<T>(snapshot));
      chegaram.add(nome);
      publicar();
    };
    const falhar = (nome: string) => (erro: unknown) => {
      console.error(`Títulos (${rotulo}, ${nome}):`, erro);
      chegaram.add(nome);
      publicar();
    };
    const parar: Array<() => void> = [];
    const escutar = (nome: string, consulta: Query<DocumentData>) => {
      esperadas.add(nome);
      parar.push(onSnapshot(consulta, receber(nome), falhar(nome)));
    };
    const escutarComReserva = (nome: string, consulta: Query<DocumentData>) => {
      esperadas.add(nome);
      parar.push(assinarComReserva(consulta, doTipo, `Títulos (${rotulo}, ${nome})`, receber(nome), falhar(nome)));
    };

    if (abertas) escutar('abertas', query(doTipo, where('status', '==', 'Pendente')));
    if (pagasHoje) escutar('pagasHoje', query(doTipo, where('status', '==', 'Paga'), where('dataPagamento', '==', hoje)));

    if (chaveHistorico === 'todo') {
      escutar('pagas', query(doTipo, where('status', '==', 'Paga')));
    } else if (chaveHistorico) {
      const [de, ate] = chaveHistorico.split('|');
      const pagas = query(doTipo, where('status', '==', 'Paga'));
      const entre = (campo: string) => [
        ...(de ? [where(campo, '>=', de)] : []),
        ...(ate ? [where(campo, '<=', ate)] : []),
      ];
      escutarComReserva('pagasPorPagamento', query(pagas, ...entre('dataPagamento')));
      escutarComReserva('pagasPorVencimento', query(pagas, ...entre('data')));
    }

    if (esperadas.size === 0) {
      setTitulos([]);
      setCarregando(false);
    }

    return () => parar.forEach((fn) => fn());
  }, [tenantId, tipo, chaveHistorico, abertas, pagasHoje]);

  return { titulos, carregando };
};
