import React, { useState, useEffect } from 'react';
import { BarChart2, DollarSign, Package, XCircle, ShoppingCart } from 'lucide-react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';

const RelatoriosVendas: React.FC = () => {
  const { currentUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [metricas, setMetricas] = useState({
    faturamentoTotal: 0,
    qtdVendas: 0,
    qtdCanceladas: 0,
    produtosMaisVendidos: [] as {nome: string, qtd: number, valor: number}[],
    vendasPorPgto: {} as Record<string, number>,
  });

  useEffect(() => {
    const carregarRelatorios = async () => {
      if (!currentUser) return;
      try {
        const q = query(collection(db, 'pedidos_venda'), where('tenantId', '==', currentUser.uid));
        const snap = await getDocs(q);

        let fatTotal = 0;
        let qtd = 0;
        let canceladas = 0;
        const prodMap: Record<string, {nome: string, qtd: number, valor: number}> = {};
        const pgtoMap: Record<string, number> = {};

        snap.forEach(doc => {
          const p = doc.data();
          if (p.status === 'Cancelada') {
            canceladas++;
          } else {
            qtd++;
            fatTotal += p.valorTotal || 0;
            
            // Forma de Pagamento
            const pgto = p.formaPagamento || 'Outros';
            pgtoMap[pgto] = (pgtoMap[pgto] || 0) + (p.valorTotal || 0);

            // Produtos
            if (p.itens && Array.isArray(p.itens)) {
              p.itens.forEach((item: any) => {
                if (!prodMap[item.nome]) prodMap[item.nome] = { nome: item.nome, qtd: 0, valor: 0 };
                prodMap[item.nome].qtd += item.quantidade;
                prodMap[item.nome].valor += item.subtotal;
              });
            }
          }
        });

        const prodList = Object.values(prodMap).sort((a, b) => b.qtd - a.qtd).slice(0, 10); // Top 10

        setMetricas({
          faturamentoTotal: fatTotal,
          qtdVendas: qtd,
          qtdCanceladas: canceladas,
          produtosMaisVendidos: prodList,
          vendasPorPgto: pgtoMap
        });
      } catch (err) {
        console.error("Erro ao carregar relatório:", err);
      } finally {
        setLoading(false);
      }
    };
    carregarRelatorios();
  }, [currentUser]);

  if (loading) return <div style={{ padding: '40px', color: 'white', textAlign: 'center' }}>Calculando métricas de vendas...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div>
        <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <BarChart2 size={28} color="#10b981" />
          Dashboard Gerencial de Vendas
        </h1>
        <p style={{ color: 'var(--text-muted)' }}>Métricas e faturamento em tempo real baseados nos pedidos de venda</p>
      </div>

      {/* Resumo Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', borderLeft: '4px solid #10b981' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Faturamento Total</span>
            <DollarSign size={20} color="#10b981" />
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: 'white' }}>
            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(metricas.faturamentoTotal)}
          </div>
        </div>

        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', borderLeft: '4px solid #3b82f6' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Vendas Concluídas</span>
            <ShoppingCart size={20} color="#3b82f6" />
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: 'white' }}>
            {metricas.qtdVendas} <span style={{fontSize:'14px', color:'var(--text-muted)', fontWeight: 400}}>pedidos</span>
          </div>
        </div>

        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', borderLeft: '4px solid #ef4444' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Vendas Canceladas</span>
            <XCircle size={20} color="#ef4444" />
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: 'white' }}>
            {metricas.qtdCanceladas} <span style={{fontSize:'14px', color:'var(--text-muted)', fontWeight: 400}}>cancelamentos</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px' }}>
        {/* Mais Vendidos */}
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Package size={20} color="#8b5cf6" /> Top Produtos Mais Vendidos
          </h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                <th style={{ padding: '12px 8px' }}>Produto</th>
                <th style={{ padding: '12px 8px', textAlign: 'center' }}>Qtd Vendida</th>
                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Receita Gerada</th>
              </tr>
            </thead>
            <tbody>
              {metricas.produtosMaisVendidos.map((prod, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '12px 8px', fontWeight: 500 }}>{prod.nome}</td>
                  <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                    <span style={{ backgroundColor: 'var(--bg-tertiary)', padding: '4px 8px', borderRadius: '4px' }}>{prod.qtd} un.</span>
                  </td>
                  <td style={{ padding: '12px 8px', textAlign: 'right', fontWeight: 600, color: '#10b981' }}>
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(prod.valor)}
                  </td>
                </tr>
              ))}
              {metricas.produtosMaisVendidos.length === 0 && (
                <tr>
                  <td colSpan={3} style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>Sem dados de produtos.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Formas de Pagamento */}
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <DollarSign size={20} color="#f59e0b" /> Faturamento por Pagamento
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {Object.entries(metricas.vendasPorPgto).sort((a,b) => b[1] - a[1]).map(([pgto, valor]) => (
              <div key={pgto} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '8px' }}>
                <span style={{ fontWeight: 600, color: 'white' }}>{pgto}</span>
                <span style={{ fontWeight: 700, color: '#10b981' }}>
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor)}
                </span>
              </div>
            ))}
            {Object.keys(metricas.vendasPorPgto).length === 0 && (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>Sem dados de faturamento.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default RelatoriosVendas;
