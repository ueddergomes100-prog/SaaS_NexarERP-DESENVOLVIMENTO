import React, { useEffect, useState } from 'react';
import { TrendingUp, Download, PieChart, BarChart2, DollarSign, Calendar, Loader2 } from 'lucide-react';
import { collection, query, onSnapshot, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';

interface TransacaoData {
  id: string;
  data: string; // YYYY-MM-DD
  descricao: string;
  categoria: string;
  valor: number;
  tipo: 'entrada' | 'saida';
  status: 'Paga' | 'Pendente';
  formaPagamento?: string;
  createdAt?: {
    seconds?: number;
  };
}

const Faturamento: React.FC = () => {
  const [transacoes, setTransacoes] = useState<TransacaoData[]>([]);
  const [loading, setLoading] = useState(true);
  const [anoFiltro, setAnoFiltro] = useState<number>(new Date().getFullYear());
  const { currentUser, tenantId } = useAuth();

  useEffect(() => {
    if (!currentUser) return;
    const q = query(collection(db, 'transacoes'), where('tenantId', '==', tenantId));
    
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const data: TransacaoData[] = [];
      querySnapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() } as TransacaoData);
      });
      setTransacoes(data);
      setLoading(false);
    }, (error) => {
      console.error("Erro ao buscar transações pro Faturamento:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser]);

  // Filtra transações apenas do ano selecionado e Pagas
  const transacoesAno = transacoes.filter(t => {
    if (t.status !== 'Paga') return false;
    
    let year = '';
    if (t.data) {
      year = t.data.substring(0, 4);
    } else if (t.createdAt?.seconds) {
      year = String(new Date(t.createdAt.seconds * 1000).getFullYear());
    }
    
    return year === String(anoFiltro);
  });

  // --- CÁLCULOS DO DRE SIMPLIFICADO ---
  const receitasFiltradas = transacoesAno.filter(t => t.tipo === 'entrada' && t.formaPagamento !== 'Crédito de Devolução');
  
  const receitaServicos = receitasFiltradas.filter(t => t.categoria === 'Serviços' || t.categoria === 'Serviços Automotivos').reduce((acc, curr) => acc + curr.valor, 0);
  const receitaPecas = receitasFiltradas.filter(t => t.categoria === 'Venda de Peças').reduce((acc, curr) => acc + curr.valor, 0);
  const receitaOutros = receitasFiltradas.filter(t => t.categoria !== 'Serviços' && t.categoria !== 'Serviços Automotivos' && t.categoria !== 'Venda de Peças').reduce((acc, curr) => acc + curr.valor, 0);

  const receitaBruta = receitaServicos + receitaPecas + receitaOutros;
  const totalDespesas = transacoesAno.filter(t => t.tipo === 'saida').reduce((acc, curr) => acc + curr.valor, 0);
  const lucroLiquido = receitaBruta - totalDespesas;
  const margemLucro = receitaBruta > 0 ? (lucroLiquido / receitaBruta) * 100 : 0;

  // --- FORMAS DE PAGAMENTO ---
  const formasPagamento: Record<string, number> = {};
  receitasFiltradas.forEach(t => {
    const f = t.formaPagamento || 'Não informada';
    formasPagamento[f] = (formasPagamento[f] || 0) + t.valor;
  });

  // --- CÁLCULOS DO BALANCETE MENSAL ---
  const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  
  const balanceteMeses = meses.map((nomeMes, index) => {
    const mesStr = String(index + 1).padStart(2, '0');
    const transacoesMes = transacoesAno.filter(t => {
      let month = '';
      if (t.data) {
        month = t.data.substring(5, 7);
      } else if (t.createdAt?.seconds) {
        month = String(new Date(t.createdAt.seconds * 1000).getMonth() + 1).padStart(2, '0');
      }
      return month === mesStr;
    });
    
    const receitas = transacoesMes.filter(t => t.tipo === 'entrada' && t.formaPagamento !== 'Crédito de Devolução').reduce((acc, curr) => acc + curr.valor, 0);
    const despesas = transacoesMes.filter(t => t.tipo === 'saida').reduce((acc, curr) => acc + curr.valor, 0);
    const saldo = receitas - despesas;
    
    return { nomeMes, receitas, despesas, saldo };
  });

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  };

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: '100px' }}><Loader2 className="spin-animation" size={32} color="var(--accent-purple)" /></div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <TrendingUp size={28} color="var(--accent-purple)" />
            Faturamento & DRE
          </h1>
          <p style={{ color: 'var(--text-muted)' }}>Demonstrativo de Resultados e Balancete Mensal</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <select 
            value={anoFiltro}
            onChange={(e) => setAnoFiltro(Number(e.target.value))}
            style={{ padding: '10px 16px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
          >
            {[...Array(5)].map((_, i) => {
              const ano = new Date().getFullYear() - i;
              return <option key={ano} value={ano}>{ano}</option>;
            })}
          </select>
          <button className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Download size={18} /> Exportar PDF
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        {/* Bloco DRE Simplificado */}
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
            <PieChart size={20} color="var(--accent-purple)" />
            DRE Simplificado ({anoFiltro})
          </h2>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>1. Receita Bruta Total</span>
              <span style={{ fontWeight: 600, color: '#10b981' }}>{formatCurrency(receitaBruta)}</span>
            </div>
            
            <div style={{ paddingLeft: '24px', display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--text-muted)' }}>
                <span>↳ Venda de Peças (Pedidos de Venda)</span>
                <span>{formatCurrency(receitaPecas)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--text-muted)' }}>
                <span>↳ Serviços (Mão de Obra / OS)</span>
                <span>{formatCurrency(receitaServicos)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--text-muted)' }}>
                <span>↳ Outras Receitas</span>
                <span>{formatCurrency(receitaOutros)}</span>
              </div>
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>2. (-) Despesas / Custos Totais</span>
              <span style={{ fontWeight: 600, color: '#ef4444' }}>{formatCurrency(totalDespesas)}</span>
            </div>

            <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '8px 0' }}></div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Receitas por Forma de Pagamento</span>
            </div>
            <div style={{ paddingLeft: '24px', display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '8px' }}>
              {Object.entries(formasPagamento).sort((a,b) => b[1] - a[1]).map(([forma, valor]) => (
                <div key={forma} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--text-muted)' }}>
                  <span>↳ {forma}</span>
                  <span>{formatCurrency(valor)}</span>
                </div>
              ))}
            </div>

            <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '8px 0' }}></div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', backgroundColor: lucroLiquido >= 0 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', borderRadius: 'var(--radius-md)', border: `1px solid ${lucroLiquido >= 0 ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}` }}>
              <span style={{ fontWeight: 700, fontSize: '16px' }}>(=) Lucro Líquido do Exercício</span>
              <span style={{ fontWeight: 700, fontSize: '20px', color: lucroLiquido >= 0 ? '#10b981' : '#ef4444' }}>
                {formatCurrency(lucroLiquido)}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Margem de Lucro:</span>
              <span style={{ fontWeight: 600, fontSize: '14px', padding: '4px 8px', borderRadius: '12px', backgroundColor: margemLucro >= 20 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)', color: margemLucro >= 20 ? '#10b981' : '#f59e0b' }}>
                {margemLucro.toFixed(2)}%
              </span>
            </div>
          </div>
        </div>

        {/* Bloco Resumo Gráfico / KPIs rápidos */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', flex: 1 }}>
            <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '24px', color: 'var(--text-secondary)' }}>Média Mensal de Receita</h2>
            <div style={{ fontSize: '32px', fontWeight: 700 }}>
              {formatCurrency(receitaBruta / (new Date().getFullYear() === anoFiltro ? new Date().getMonth() + 1 : 12))}
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '8px' }}>Com base nos meses transcorridos em {anoFiltro}.</p>
          </div>
          
          <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', flex: 1 }}>
            <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '24px', color: 'var(--text-secondary)' }}>Média Mensal de Despesas</h2>
            <div style={{ fontSize: '32px', fontWeight: 700 }}>
              {formatCurrency(totalDespesas / (new Date().getFullYear() === anoFiltro ? new Date().getMonth() + 1 : 12))}
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '8px' }}>Foco em redução de custos operacionais.</p>
          </div>
        </div>
      </div>

      {/* Tabela de Balancete Mensal */}
      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Calendar size={20} color="var(--accent-purple)" />
          Balancete Mensal
        </h2>
        
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '13px', textTransform: 'uppercase' }}>
                <th style={{ padding: '16px' }}>Mês</th>
                <th style={{ padding: '16px' }}>Receitas</th>
                <th style={{ padding: '16px' }}>Despesas</th>
                <th style={{ padding: '16px' }}>Resultado (Saldo)</th>
              </tr>
            </thead>
            <tbody>
              {balanceteMeses.map((mes, index) => {
                // Só exibe meses que já passaram ou o atual, a menos que seja um ano anterior completo
                const mesAtual = new Date().getMonth();
                const isAnoAtual = anoFiltro === new Date().getFullYear();
                if (isAnoAtual && index > mesAtual) return null;

                return (
                  <tr key={mes.nomeMes} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '16px', fontWeight: 500 }}>{mes.nomeMes}</td>
                    <td style={{ padding: '16px', color: '#10b981' }}>{formatCurrency(mes.receitas)}</td>
                    <td style={{ padding: '16px', color: '#ef4444' }}>{formatCurrency(mes.despesas)}</td>
                    <td style={{ padding: '16px', fontWeight: 600, color: mes.saldo >= 0 ? '#10b981' : '#ef4444' }}>
                      {formatCurrency(mes.saldo)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Faturamento;
