import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  DollarSign, 
  CheckCircle, 
  Users, 
  TrendingUp,
  MoreVertical,
  Eye,
  EyeOff,
  Clock
} from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import { collection, query, onSnapshot, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import './Dashboard.css';

interface OSData {
  id: string;
  clienteNome: string;
  modelo: string;
  placa: string;
  status: string;
  statusColor: string;
  createdAt: any;
}

interface TransacaoData {
  id: string;
  valor: number;
  tipo: 'entrada' | 'saida';
  status: 'Paga' | 'Pendente';
  createdAt?: any;
}

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [osList, setOsList] = useState<OSData[]>([]);
  const [transacoes, setTransacoes] = useState<TransacaoData[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableTab, setTableTab] = useState<'Ativas' | 'Finalizadas'>('Ativas');
  const [hideData, setHideData] = useState(() => localStorage.getItem('nexus_hide_dashboard') === 'true');
  const [currentDate, setCurrentDate] = useState(new Date());

  const { currentUser, userRole, userPermissions, loading: authLoading, tenantId, isOwner } = useAuth();
  const hasFinancialAccess = isOwner || userPermissions?.includes('dashboard.valores');

  useEffect(() => {
    const timer = setInterval(() => setCurrentDate(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (userRole === 'SuperAdmin') {
      navigate('/superadmin');
    }
  }, [userRole, navigate]);

  const toggleHideData = () => {
    const newVal = !hideData;
    setHideData(newVal);
    localStorage.setItem('nexus_hide_dashboard', String(newVal));
  };

  useEffect(() => {
    if (!currentUser) return;

    // Busca Ordens de Serviço do usuário logado
    const qOs = query(
      collection(db, 'ordens_de_servico'), 
      where('tenantId', '==', tenantId)
    );
    const unsubscribeOs = onSnapshot(qOs, (querySnapshot) => {
      let data: OSData[] = [];
      querySnapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() } as OSData);
      });
      // Ordena por data decrescente
      data.sort((a, b) => {
        const dateA = a.createdAt?.seconds || 0;
        const dateB = b.createdAt?.seconds || 0;
        return dateB - dateA;
      });
      setOsList(data);
      setLoading(false);
    });

    let unsubscribeTrans = () => {};
    
    if (hasFinancialAccess) {
      // Busca Transações Financeiras do usuário logado (Somente se tiver acesso)
      const qTransacoes = query(
        collection(db, 'transacoes'),
        where('tenantId', '==', tenantId)
      );
      unsubscribeTrans = onSnapshot(qTransacoes, (querySnapshot) => {
        const data: TransacaoData[] = [];
        querySnapshot.forEach((doc) => {
          data.push({ id: doc.id, ...doc.data() } as TransacaoData);
        });
        setTransacoes(data);
      });
    }

    return () => {
      unsubscribeOs();
      unsubscribeTrans();
    };
  }, [currentUser, hasFinancialAccess]);

  // -- Cálculos de Métricas --
  const hoje = new Date();
  const mesAtual = hoje.getMonth();
  const anoAtual = hoje.getFullYear();

  // Filtrando OSs deste mês
  const osMesAtual = osList.filter(os => {
    if (!os.createdAt) return true; 
    const date = os.createdAt?.toDate ? os.createdAt.toDate() : new Date();
    return date.getMonth() === mesAtual && date.getFullYear() === anoAtual;
  });

  const osFinalizadasMes = osMesAtual.filter(os => os.status === 'Finalizada').length;

  // Calculando Clientes Únicos no mês
  const clientesUnicosMes = new Set(osMesAtual.map(os => os.clienteNome)).size;

  // OS Ativas e Finalizadas para Tabelas e Gráficos
  const osAtivas = osList.filter(os => os.status !== 'Finalizada' && os.status !== 'Cancelada');
  const osFinalizadas = osList.filter(os => os.status === 'Finalizada');

  // Gráfico de Status de OS Ativas
  const contagemStatus: Record<string, { value: number, color: string }> = {};
  osAtivas.forEach(os => {
    if (!contagemStatus[os.status]) {
      contagemStatus[os.status] = { value: 0, color: os.statusColor || '#8b5cf6' };
    }
    contagemStatus[os.status].value += 1;
  });

  const osStatusData = Object.keys(contagemStatus).map(status => ({
    name: status,
    value: contagemStatus[status].value,
    color: contagemStatus[status].color
  }));

  // Faturamento Mensal e Hoje Baseado em Transações Reais
  const transacoesPagasMes = transacoes.filter(t => {
    if (t.status !== 'Paga') return false;
    if (!t.createdAt) return true;
    const date = t.createdAt?.toDate ? t.createdAt.toDate() : new Date();
    return date.getMonth() === mesAtual && date.getFullYear() === anoAtual;
  });

  const faturamentoMes = transacoesPagasMes
    .filter(t => t.tipo === 'entrada' && t.formaPagamento !== 'Crédito de Devolução')
    .reduce((acc, curr) => acc + Number(curr.valor), 0);

  const transacoesPagasHoje = transacoesPagasMes.filter(t => {
    if (!t.createdAt) return false;
    const date = t.createdAt?.toDate ? t.createdAt.toDate() : new Date();
    return date.getDate() === hoje.getDate();
  });

  const faturamentoHoje = transacoesPagasHoje
    .filter(t => t.tipo === 'entrada' && t.formaPagamento !== 'Crédito de Devolução')
    .reduce((acc, curr) => acc + Number(curr.valor), 0);

  const despesasMes = transacoesPagasMes
    .filter(t => t.tipo === 'saida')
    .reduce((acc, curr) => acc + Number(curr.valor), 0);

  const lucroLiquidoMes = faturamentoMes - despesasMes;

  // Agrupando dados para o Gráfico de Fluxo de Caixa
  const mesesAbreviados = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  
  // Vamos construir os últimos 6 meses a partir de hoje
  const cashFlowData = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(anoAtual, mesAtual - i, 1);
    const m = d.getMonth();
    const y = d.getFullYear();
    
    // Filtrar transações desse mes/ano
    const transM = transacoes.filter(t => {
      if (!t.createdAt || t.status !== 'Paga') return false;
      const date = t.createdAt?.toDate ? t.createdAt.toDate() : new Date();
      return date.getMonth() === m && date.getFullYear() === y;
    });

    const entradas = transM.filter(t => t.tipo === 'entrada' && t.formaPagamento !== 'Crédito de Devolução').reduce((acc, curr) => acc + Number(curr.valor), 0);
    const saidas = transM.filter(t => t.tipo === 'saida').reduce((acc, curr) => acc + Number(curr.valor), 0);

    cashFlowData.push({
      name: mesesAbreviados[m],
      entradas: entradas,
      saidas: saidas
    });
  }

  const formattedDate = new Intl.DateTimeFormat('pt-BR', { 
    weekday: 'long', 
    day: 'numeric', 
    month: 'long'
  }).format(currentDate);

  const formattedTime = new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(currentDate);

  return (
    <div className="dashboard">
      <div className="dashboard-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '20px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h1 className="page-title">Dashboard</h1>
            <button 
              className="icon-btn" 
              onClick={toggleHideData} 
              title={hideData ? "Mostrar valores" : "Ocultar valores"}
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              {hideData ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </div>
          <p className="page-subtitle">Visão geral do sistema e métricas em tempo real</p>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
          <div style={{ 
            display: 'flex', alignItems: 'center', gap: '16px', 
            backgroundColor: 'var(--bg-secondary)', padding: '12px 24px', 
            borderRadius: '16px', border: '1px solid var(--border-color)',
            boxShadow: '0 4px 15px rgba(0,0,0,0.1)'
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              <span style={{ fontSize: '13px', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                {formattedDate}
              </span>
              <span style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--text-primary)', letterSpacing: '1px' }}>
                {formattedTime}
              </span>
            </div>
            <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'rgba(139, 92, 246, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b5cf6' }}>
              <Clock size={20} />
            </div>
          </div>
          
          <button className="btn-primary" onClick={() => navigate('/os/nova')}>
            Nova Ordem de Serviço
          </button>
        </div>
      </div>

      <div className="summary-cards">
        {hasFinancialAccess && (
          <div className="card stat-card" style={{ borderLeft: '4px solid #10b981' }}>
            <div className="stat-header">
              <div className="stat-icon green-bg" style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#10b981' }}>
                <TrendingUp size={24} />
              </div>
              <span className="stat-trend positive">Líquido</span>
            </div>
            <div className="stat-info">
              <h3 style={{ color: lucroLiquidoMes >= 0 ? '#10b981' : '#ef4444' }}>
                {hideData ? 'R$ •••••' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(lucroLiquidoMes)}
              </h3>
              <p>Lucro Líquido Mês</p>
            </div>
          </div>
        )}

        {hasFinancialAccess && (
          <div className="card stat-card">
            <div className="stat-header">
              <div className="stat-icon purple-bg">
                <DollarSign size={24} />
              </div>
              <span className="stat-trend positive">Bruto</span>
            </div>
            <div className="stat-info">
              <h3>{hideData ? 'R$ •••••' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(faturamentoMes)}</h3>
              <p>Receita Bruta Mês</p>
            </div>
          </div>
        )}

        <div className="card stat-card">
          <div className="stat-header">
            <div className="stat-icon green-bg">
              <CheckCircle size={24} />
            </div>
            <span className="stat-trend positive">Atual</span>
          </div>
          <div className="stat-info">
            <h3>{hideData ? '•••' : osFinalizadasMes}</h3>
            <p>OS Finalizadas Mês</p>
          </div>
        </div>

        <div className="card stat-card">
          <div className="stat-header">
            <div className="stat-icon blue-bg">
              <Users size={24} />
            </div>
            <span className="stat-trend positive">Atual</span>
          </div>
          <div className="stat-info">
            <h3>{hideData ? '•••' : clientesUnicosMes}</h3>
            <p>Clientes Atendidos Mês</p>
          </div>
        </div>

        {hasFinancialAccess && (
          <div className="card stat-card">
            <div className="stat-header">
              <div className="stat-icon yellow-bg">
                <TrendingUp size={24} />
              </div>
              <span className="stat-trend positive">Hoje</span>
            </div>
            <div className="stat-info">
              <h3>{hideData ? 'R$ •••••' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(faturamentoHoje)}</h3>
              <p>Faturamento Hoje</p>
            </div>
          </div>
        )}
      </div>

      <div className="dashboard-charts">
        {hasFinancialAccess && (
          <div className="card chart-container">
            <div className="card-header">
              <h3>Fluxo de Caixa Mensal (Últimos 6 meses)</h3>
              <button className="icon-btn" onClick={() => navigate('/financeiro/caixa')}><MoreVertical size={18} /></button>
            </div>
            <div className="chart-wrapper" style={{ filter: hideData ? 'blur(6px)' : 'none', transition: 'filter 0.3s', userSelect: hideData ? 'none' : 'auto', pointerEvents: hideData ? 'none' : 'auto' }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={cashFlowData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="name" stroke="#a0a0ab" tick={{fill: '#a0a0ab'}} axisLine={false} tickLine={false} />
                  <YAxis stroke="#a0a0ab" tick={{fill: '#a0a0ab'}} axisLine={false} tickLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                    itemStyle={{ color: 'var(--text-primary)' }}
                    cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                  />
                  <Bar dataKey="entradas" fill="#8b5cf6" radius={[4, 4, 0, 0]} name="Entradas (R$)" />
                  <Bar dataKey="saidas" fill="#ef4444" radius={[4, 4, 0, 0]} name="Saídas (R$)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <div className={`card chart-container small`} style={{ gridColumn: !hasFinancialAccess ? '1 / -1' : undefined }}>
          <div className="card-header">
            <h3>Status de OS Ativas</h3>
            <button className="icon-btn" onClick={() => navigate('/os')}><MoreVertical size={18} /></button>
          </div>
          <div className="chart-wrapper pie-wrapper" style={{ filter: hideData ? 'blur(6px)' : 'none', transition: 'filter 0.3s', userSelect: hideData ? 'none' : 'auto', pointerEvents: hideData ? 'none' : 'auto' }}>
            {osStatusData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={osStatusData}
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={5}
                      dataKey="value"
                      stroke="none"
                    >
                      {osStatusData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pie-legend">
                  {osStatusData.map((item, index) => (
                    <div key={index} className="legend-item">
                      <span className="legend-color" style={{ backgroundColor: item.color }}></span>
                      <span className="legend-label">{item.name} ({item.value})</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
                Nenhuma OS ativa no momento.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card table-container">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '20px' }}>
            <h3 
              onClick={() => setTableTab('Ativas')}
              style={{ 
                cursor: 'pointer', 
                margin: 0,
                color: tableTab === 'Ativas' ? 'var(--text-primary)' : 'var(--text-muted)',
                borderBottom: tableTab === 'Ativas' ? '2px solid var(--accent-purple)' : '2px solid transparent',
                paddingBottom: '4px',
                transition: 'all 0.2s'
              }}
            >
              Carros no Pátio (Em Andamento)
            </h3>
            <h3 
              onClick={() => setTableTab('Finalizadas')}
              style={{ 
                cursor: 'pointer', 
                margin: 0,
                color: tableTab === 'Finalizadas' ? 'var(--text-primary)' : 'var(--text-muted)',
                borderBottom: tableTab === 'Finalizadas' ? '2px solid #10b981' : '2px solid transparent',
                paddingBottom: '4px',
                transition: 'all 0.2s'
              }}
            >
              Últimas Finalizadas
            </h3>
          </div>
          <button className="btn-secondary" onClick={() => navigate('/os')}>Ver Módulo OS</button>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Placa</th>
                <th>Modelo</th>
                <th>Cliente</th>
                <th>Status OS</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '20px' }}>Carregando dados...</td>
                </tr>
              ) : (tableTab === 'Ativas' ? osAtivas : osFinalizadas).length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
                    {tableTab === 'Ativas' ? 'Não há carros no pátio no momento.' : 'Nenhuma OS finalizada recentemente.'}
                  </td>
                </tr>
              ) : (
                (tableTab === 'Ativas' ? osAtivas : osFinalizadas).slice(0, 5).map((vehicle) => (
                  <tr key={vehicle.id}>
                    <td className="font-medium" style={{ textTransform: 'uppercase' }}>{vehicle.placa}</td>
                    <td>{vehicle.modelo || '-'}</td>
                    <td>{vehicle.clienteNome}</td>
                    <td>
                      <span className="status-badge" style={{ backgroundColor: `${vehicle.statusColor}20`, color: vehicle.statusColor }}>
                        <span className="status-dot" style={{ backgroundColor: vehicle.statusColor }}></span>
                        {vehicle.status}
                      </span>
                    </td>
                    <td>
                      <button className="icon-btn" onClick={() => navigate(`/os/editar/${vehicle.id}`)} title="Ver Detalhes">
                        <MoreVertical size={18} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
