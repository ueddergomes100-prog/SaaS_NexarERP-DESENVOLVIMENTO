import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, FileText, LogOut, Tag, Users } from 'lucide-react';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';

interface PedidoRecente {
  id: string;
  tipo: 'Pedido' | 'Orçamento';
  numero: string;
  status: string;
  clienteNome: string;
  valorTotal: number;
}

const formatarMoeda = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const atalhoStyle: React.CSSProperties = {
  aspectRatio: '1', borderRadius: '18px', padding: '18px', display: 'flex', flexDirection: 'column',
  justifyContent: 'space-between', cursor: 'pointer', border: 'none', textAlign: 'left',
};

const VendedorHome: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser, tenantId, logout } = useAuth();
  const [recentes, setRecentes] = useState<PedidoRecente[]>([]);

  useEffect(() => {
    if (!tenantId || !currentUser) return;
    let cancelado = false;

    getDocs(query(
      collection(db, 'pedidos_venda'),
      where('tenantId', '==', tenantId),
      where('vendedorId', '==', currentUser.uid),
      orderBy('createdAt', 'desc'),
      limit(3),
    )).then((snap) => {
      if (cancelado) return;
      setRecentes(snap.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          tipo: 'Pedido' as const,
          numero: data.numeroPedido || '',
          status: data.status || '',
          clienteNome: data.clienteNome || '',
          valorTotal: Number(data.valorTotal || 0),
        };
      }));
    }).catch(() => setRecentes([]));

    return () => { cancelado = true; };
  }, [tenantId, currentUser]);

  const nome = currentUser?.displayName || currentUser?.email?.split('@')[0] || 'Vendedor';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-primary)' }}>
      <div
        style={{
          padding: '52px 22px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'linear-gradient(180deg, color-mix(in srgb, var(--brand-700) 22%, var(--bg-primary)) 0%, var(--bg-primary) 100%)',
        }}
      >
        <div>
          <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', fontWeight: 500 }}>Olá,</div>
          <div style={{ fontSize: '19px', fontWeight: 800, color: 'var(--text-primary)' }}>{nome}</div>
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          aria-label="Sair"
          style={{
            width: '40px', height: '40px', borderRadius: '12px', backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-muted)', cursor: 'pointer',
          }}
        >
          <LogOut size={18} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 22px 22px', display: 'flex', flexDirection: 'column', gap: '22px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: '14px' }}>
          <button
            type="button"
            onClick={() => navigate('/vendedor/pedido/novo')}
            style={{ ...atalhoStyle, background: 'linear-gradient(150deg, var(--brand-600) 0%, var(--brand-800, #5a21b6) 100%)', boxShadow: '0 14px 26px rgba(124,58,237,0.30)' }}
          >
            <Box size={28} color="#fff" strokeWidth={1.7} />
            <span style={{ fontSize: '15.5px', fontWeight: 700, color: '#fff', lineHeight: 1.25 }}>Novo Pedido</span>
          </button>

          <button
            type="button"
            onClick={() => navigate('/vendedor/orcamento/novo')}
            style={{ ...atalhoStyle, backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}
          >
            <FileText size={28} color="var(--brand-400)" strokeWidth={1.7} />
            <span style={{ fontSize: '15.5px', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.25 }}>Novo Orçamento</span>
          </button>

          <button
            type="button"
            onClick={() => navigate('/vendedor/preco')}
            style={{ ...atalhoStyle, backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}
          >
            <Tag size={28} color="var(--brand-400)" strokeWidth={1.7} />
            <span style={{ fontSize: '15.5px', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.25 }}>Consultar Preço</span>
          </button>

          <button
            type="button"
            onClick={() => navigate('/vendedor/cliente')}
            style={{ ...atalhoStyle, backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}
          >
            <Users size={28} color="var(--brand-400)" strokeWidth={1.7} />
            <span style={{ fontSize: '15.5px', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.25 }}>Consultar Cliente</span>
          </button>
        </div>

        {recentes.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Últimos pedidos
            </div>
            {recentes.map((item) => (
              <div
                key={item.id}
                style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '13px 14px', borderRadius: '14px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.clienteNome}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {item.tipo} #{item.numero} &middot; {item.status}
                  </div>
                </div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>{formatarMoeda(item.valorTotal)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default VendedorHome;
