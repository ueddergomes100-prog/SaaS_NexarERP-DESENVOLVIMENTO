import { useEffect, useState } from 'react';
import { collection, getDocs, query, where, type DocumentData, type QueryDocumentSnapshot } from 'firebase/firestore';
import { lerComReserva } from '../services/consultaComReserva';
import { dentroDoPeriodo } from '../utils/filtroListaDomain';
import { db } from '../services/firebase';
import { useAuth } from '../contexts/AuthContext';
import { filtrarVendasVisiveis } from '../utils/visibilidadeVendasDomain';
import { filtrarVendasFaturadas, type DadosRelatorioVendas } from '../utils/relatorioVendasDomain';

const VAZIO: DadosRelatorioVendas = { sales: [], transactions: [], users: {}, products: {}, returns: [] };

/** `in` do Firestore aceita ate 30 valores por consulta. */
const LOTE_IN = 30;

/** Documentos de `colecao` cujo `campo` esta em `ids` (lotes de 30), juntados por id. */
const lerPorIds = async (colecao: string, tenantId: string, campo: string, ids: string[]) => {
  const porId = new Map<string, QueryDocumentSnapshot<DocumentData>>();
  const consultas = [];
  for (let i = 0; i < ids.length; i += LOTE_IN) {
    consultas.push(getDocs(query(collection(db, colecao), where('tenantId', '==', tenantId), where(campo, 'in', ids.slice(i, i + LOTE_IN)))));
  }
  (await Promise.all(consultas)).forEach((snap) => snap.docs.forEach((d) => porId.set(d.id, d)));
  return porId;
};

/**
 * Carrega o que o relatorio de vendas precisa, com as mesmas regras em todo
 * lugar: vendas que o usuario pode ver, so' as que contam como faturamento.
 * Usado pela tela Vendas > Relatorio de Vendas e pelo Vendas por Vendedor de
 * Relatorios Diversos -- os dois mostram o mesmo numero.
 *
 * Otimizacao de leituras (2026-10-14): antes lia TODOS os pedidos e TODAS as
 * transacoes e devolucoes da empresa a cada abertura. Agora le as vendas do
 * PERIODO (`dataVenda`, a mesma data da tela) e, delas, so' as transacoes e
 * devolucoes ligadas -- que e' como o relatorio as usa (enriquecerVendas).
 * Sem as duas datas nao le nada: o relatorio (vendaNoPeriodo) so' mostra
 * venda com inicio e fim preenchidos. Venda antiga sem `dataVenda` fica de
 * fora (mesma regra da lista de Pedidos de Venda).
 */
export const useDadosRelatorioVendas = ({ de, ate }: { de: string; ate: string }) => {
  const { tenantId, currentUser, vendasVisiveisDeUsuarioId } = useAuth();
  const [data, setData] = useState<DadosRelatorioVendas>(VAZIO);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!tenantId || !currentUser || !de || !ate) {
        setData(VAZIO);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError('');
      try {
        const tenantQuery = (name: string) => query(collection(db, name), where('tenantId', '==', tenantId));
        const todasAsVendas = tenantQuery('pedidos_venda');
        const vendasDoPeriodo = query(todasAsVendas, where('dataVenda', '>=', de), where('dataVenda', '<=', ate));
        const [vendasSnap, usersSnap, productsSnap] = await Promise.all([
          lerComReserva(vendasDoPeriodo, todasAsVendas, 'Relatório de vendas (período)'),
          getDocs(tenantQuery('usuarios')),
          getDocs(tenantQuery('estoque')),
        ]);
        // A reserva (sem indice) traz todas: o mesmo corte aqui.
        const salesDocs = vendasSnap.docs.filter((d) => dentroDoPeriodo(d.data().dataVenda, de, ate));
        const idsDasVendas = salesDocs.map((d) => d.id);
        // Transacao liga pela venda em `pedidoId` ou, nas antigas, em `sourceId`;
        // devolucao em `pedidoVendaId` ou `pedidoOrigemId` (ver enriquecerVendas).
        const [porPedidoId, porSourceId, devPorVenda, devPorOrigem] = await Promise.all([
          lerPorIds('transacoes', tenantId, 'pedidoId', idsDasVendas),
          lerPorIds('transacoes', tenantId, 'sourceId', idsDasVendas),
          lerPorIds('devolucoes_venda', tenantId, 'pedidoVendaId', idsDasVendas),
          lerPorIds('devolucoes_venda', tenantId, 'pedidoOrigemId', idsDasVendas),
        ]);
        const transactionsDocs = Array.from(new Map([...porPedidoId, ...porSourceId]).values());
        const returnsDocs = Array.from(new Map([...devPorVenda, ...devPorOrigem]).values());

        if (cancelled) return;
        const users: Record<string, any> = {};
        usersSnap.forEach((document) => { users[document.id] = { id: document.id, ...document.data() }; });
        const products: Record<string, any> = {};
        productsSnap.forEach((document) => { products[document.id] = { id: document.id, ...document.data() }; });

        setData({
          sales: filtrarVendasFaturadas(filtrarVendasVisiveis(
            salesDocs.map((document) => ({ id: document.id, ...document.data() })) as any[],
            vendasVisiveisDeUsuarioId,
          )),
          transactions: transactionsDocs.map((document) => ({ id: document.id, ...document.data() })),
          users,
          products,
          returns: returnsDocs.map((document) => ({ id: document.id, ...document.data() })),
        });
      } catch (loadError) {
        console.error('Erro ao carregar relatório de vendas:', loadError);
        if (!cancelled) setError('Não foi possível carregar o relatório. Verifique sua conexão e permissões.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [currentUser, tenantId, vendasVisiveisDeUsuarioId, de, ate]);

  return { data, loading, error };
};
