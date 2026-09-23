import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../contexts/AuthContext';
import { filtrarVendasVisiveis } from '../utils/visibilidadeVendasDomain';
import { filtrarVendasFaturadas, type DadosRelatorioVendas } from '../utils/relatorioVendasDomain';

const VAZIO: DadosRelatorioVendas = { sales: [], transactions: [], users: {}, products: {}, returns: [] };

/**
 * Carrega o que o relatorio de vendas precisa, com as mesmas regras em todo
 * lugar: vendas que o usuario pode ver, so' as que contam como faturamento.
 * Usado pela tela Vendas > Relatorio de Vendas e pelo Vendas por Vendedor de
 * Relatorios Diversos -- os dois mostram o mesmo numero.
 */
export const useDadosRelatorioVendas = () => {
  const { tenantId, currentUser, vendasVisiveisDeUsuarioId } = useAuth();
  const [data, setData] = useState<DadosRelatorioVendas>(VAZIO);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!tenantId || !currentUser) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError('');
      try {
        const tenantQuery = (name: string) => query(collection(db, name), where('tenantId', '==', tenantId));
        const [salesSnap, transactionsSnap, usersSnap, productsSnap, returnsSnap] = await Promise.all([
          getDocs(tenantQuery('pedidos_venda')),
          getDocs(tenantQuery('transacoes')),
          getDocs(tenantQuery('usuarios')),
          getDocs(tenantQuery('estoque')),
          getDocs(tenantQuery('devolucoes_venda')),
        ]);

        if (cancelled) return;
        const users: Record<string, any> = {};
        usersSnap.forEach((document) => { users[document.id] = { id: document.id, ...document.data() }; });
        const products: Record<string, any> = {};
        productsSnap.forEach((document) => { products[document.id] = { id: document.id, ...document.data() }; });

        setData({
          sales: filtrarVendasFaturadas(filtrarVendasVisiveis(
            salesSnap.docs.map((document) => ({ id: document.id, ...document.data() })) as any[],
            vendasVisiveisDeUsuarioId,
          )),
          transactions: transactionsSnap.docs.map((document) => ({ id: document.id, ...document.data() })),
          users,
          products,
          returns: returnsSnap.docs.map((document) => ({ id: document.id, ...document.data() })),
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
  }, [currentUser, tenantId, vendasVisiveisDeUsuarioId]);

  return { data, loading, error };
};
