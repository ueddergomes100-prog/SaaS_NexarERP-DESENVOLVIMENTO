import React, { useEffect, useState } from 'react';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import VendedorHeader from './VendedorHeader';

interface ItemLista {
  id: string;
  tipo: 'Pedido' | 'Orçamento';
  numero: string;
  status: string;
  clienteNome: string;
  valorTotal: number;
  createdAtMillis: number;
}

const formatarMoeda = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const toMillis = (value: unknown): number => {
  const withToMillis = value as { toMillis?: () => number } | undefined;
  return typeof withToMillis?.toMillis === 'function' ? withToMillis.toMillis() : 0;
};

const corStatus = (status: string): string => {
  if (status === 'Finalizada') return '#10b981';
  if (status === 'Cancelada') return '#ef4444';
  if (status === 'Pendente') return '#3b82f6';
  return '#f59e0b';
};

const VendedorMeusPedidos: React.FC = () => {
  const { tenantId, currentUser } = useAuth();
  const [itens, setItens] = useState<ItemLista[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    if (!tenantId || !currentUser) return;
    let cancelado = false;
    setCarregando(true);

    (async () => {
      const [pedidosSnap, orcamentosSnap] = await Promise.all([
        getDocs(query(
          collection(db, 'pedidos_venda'),
          where('tenantId', '==', tenantId),
          where('vendedorId', '==', currentUser.uid),
          orderBy('createdAt', 'desc'),
          limit(25),
        )).catch(() => null),
        getDocs(query(
          collection(db, 'orcamentos'),
          where('tenantId', '==', tenantId),
          where('criadoPor', '==', currentUser.uid),
          orderBy('createdAt', 'desc'),
          limit(25),
        )).catch(() => null),
      ]);

      if (cancelado) return;

      const doPedidos: ItemLista[] = (pedidosSnap?.docs || []).map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          tipo: 'Pedido' as const,
          numero: data.numeroPedido || '',
          status: data.status || '',
          clienteNome: data.clienteNome || '',
          valorTotal: Number(data.valorTotal || 0),
          createdAtMillis: toMillis(data.createdAt),
        };
      });
      const doOrcamentos: ItemLista[] = (orcamentosSnap?.docs || []).map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          tipo: 'Orçamento' as const,
          numero: data.numeroOrcamento || '',
          status: data.status || '',
          clienteNome: data.clienteNome || '',
          valorTotal: Number(data.valorTotal || 0),
          createdAtMillis: toMillis(data.createdAt),
        };
      });

      setItens([...doPedidos, ...doOrcamentos].sort((a, b) => b.createdAtMillis - a.createdAtMillis));
      setCarregando(false);
    })();

    return () => { cancelado = true; };
  }, [tenantId, currentUser]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-primary)' }}>
      <VendedorHeader titulo="Meus Pedidos" />

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 24px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {carregando ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>Carregando...</div>
        ) : itens.length === 0 ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
            Você ainda não gravou nenhum pedido ou orçamento.
          </div>
        ) : (
          itens.map((item) => (
            <div
              key={`${item.tipo}-${item.id}`}
              style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px', borderRadius: '14px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.clienteNome || 'Sem cliente'}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '3px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {item.tipo} #{item.numero}
                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: corStatus(item.status) }} />
                  <span style={{ color: corStatus(item.status), fontWeight: 600 }}>{item.status}</span>
                </div>
              </div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>{formatarMoeda(item.valorTotal)}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default VendedorMeusPedidos;
