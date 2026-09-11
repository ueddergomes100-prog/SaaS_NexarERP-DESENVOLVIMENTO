import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, FileText, LogOut, Tag, Users } from 'lucide-react';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { buscarResumoHojeDoVendedor } from '../../services/vendedorRankingService';
import './vendedorMobile.css';

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
  const { currentUser, tenantId, logout, userNome } = useAuth();
  const [recentes, setRecentes] = useState<PedidoRecente[]>([]);
  const [resumoHoje, setResumoHoje] = useState<{ pedidos: number; orcamentos: number } | null>(null);

  useEffect(() => {
    if (!tenantId || !currentUser) return;
    let cancelado = false;
    buscarResumoHojeDoVendedor(tenantId, currentUser.uid)
      .then((resumo) => { if (!cancelado) setResumoHoje(resumo); })
      .catch(() => setResumoHoje({ pedidos: 0, orcamentos: 0 }));
    return () => { cancelado = true; };
  }, [tenantId, currentUser]);

  const totalHoje = (resumoHoje?.pedidos || 0) + (resumoHoje?.orcamentos || 0);
  const dadosGrafico = useMemo(() => [
    { nome: 'Pedidos', valor: resumoHoje?.pedidos || 0, cor: '#9964f0' },
    { nome: 'Orçamentos', valor: resumoHoje?.orcamentos || 0, cor: '#3b82f6' },
  ], [resumoHoje]);

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

  const nome = userNome || currentUser?.displayName || 'Vendedor';

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
        <div className="vendedor-atalhos-grid">
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

        {resumoHoje && totalHoje > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Resumo de hoje
            </div>
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: '20px', padding: '18px', borderRadius: '18px',
                backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-color)',
              }}
            >
              <div style={{ position: 'relative', width: '110px', height: '110px', flexShrink: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={dadosGrafico}
                      dataKey="valor"
                      nameKey="nome"
                      innerRadius={32}
                      outerRadius={50}
                      paddingAngle={dadosGrafico.some((d) => d.valor > 0) ? 3 : 0}
                      startAngle={90}
                      endAngle={-270}
                      stroke="none"
                    >
                      {dadosGrafico.map((entrada) => (
                        <Cell key={entrada.nome} fill={entrada.cor} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                  <span style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-primary)' }}>{totalHoje}</span>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600 }}>hoje</span>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ width: '10px', height: '10px', borderRadius: '3px', backgroundColor: '#9964f0', flexShrink: 0 }} />
                  <span style={{ fontSize: '13px', color: 'var(--text-secondary)', flex: 1 }}>Pedidos</span>
                  <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>{resumoHoje.pedidos}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ width: '10px', height: '10px', borderRadius: '3px', backgroundColor: '#3b82f6', flexShrink: 0 }} />
                  <span style={{ fontSize: '13px', color: 'var(--text-secondary)', flex: 1 }}>Orçamentos</span>
                  <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>{resumoHoje.orcamentos}</span>
                </div>
              </div>
            </div>
          </div>
        )}

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
