import React, { useEffect, useState } from 'react';
import { ArrowUpCircle, ArrowDownCircle, Search, Filter, DollarSign, Eye, EyeOff, Calendar } from 'lucide-react';
import { collection, query, onSnapshot, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import './Financeiro.css';

interface TransacaoData {
  id: string;
  data: string;
  descricao: string;
  categoria: string;
  valor: number;
  tipo: 'entrada' | 'saida';
  status: 'Paga' | 'Pendente';
  createdAt?: any;
}

const Caixa: React.FC = () => {
  const [transacoes, setTransacoes] = useState<TransacaoData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSaldo, setShowSaldo] = useState(false);
  const [diasFiltro, setDiasFiltro] = useState<number>(30); // Padrão 30 dias
  const { currentUser } = useAuth();

  useEffect(() => {
    if (!currentUser) return;
    // Escutar transacoes do Firestore do usuario logado
    const q = query(collection(db, 'transacoes'), where('tenantId', '==', currentUser.uid));
    
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const data: TransacaoData[] = [];
      querySnapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() } as TransacaoData);
      });
      data.sort((a, b) => {
        const dateA = a.createdAt?.seconds || 0;
        const dateB = b.createdAt?.seconds || 0;
        return dateB - dateA;
      });
      setTransacoes(data);
      setLoading(false);
    }, (error) => {
      console.error("Erro ao buscar transações:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser]);

  const filteredTransacoes = transacoes.filter(t => {
    if (diasFiltro === 0) return true; // 0 significa 'Tudo'
    if (!t.createdAt) return true;
    
    const dataTransacao = new Date(t.createdAt.seconds * 1000);
    const limite = new Date();
    limite.setDate(limite.getDate() - diasFiltro);
    
    return dataTransacao >= limite;
  });

  const totalEntradas = filteredTransacoes.filter(t => t.tipo === 'entrada' && t.status === 'Paga').reduce((acc, curr) => acc + curr.valor, 0);
  const totalSaidas = filteredTransacoes.filter(t => t.tipo === 'saida' && t.status === 'Paga').reduce((acc, curr) => acc + curr.valor, 0);
  const saldoAtual = totalEntradas - totalSaidas;

  return (
    <div className="financeiro-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Fluxo de Caixa</h1>
          <p className="page-subtitle">Controle de entradas, saídas e faturamento</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn-secondary" style={{ color: '#ef4444', borderColor: '#ef444440' }} onClick={() => alert('Função "Nova Despesa" será implementada em breve.')}>
            <ArrowDownCircle size={18} style={{ marginRight: 8 }} />
            Nova Despesa
          </button>
          <button className="btn-primary" style={{ backgroundColor: '#10b981', boxShadow: '0 0 15px rgba(16, 185, 129, 0.4)' }} onClick={() => alert('Função "Nova Receita" será implementada em breve.')}>
            <ArrowUpCircle size={18} style={{ marginRight: 8 }} />
            Nova Receita
          </button>
        </div>
      </div>

      <div className="financeiro-cards">
        <div className="card stat-card">
          <div className="stat-header">
            <div className="stat-icon green-bg">
              <ArrowUpCircle size={24} />
            </div>
          </div>
          <div className="stat-info">
            <h3>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalEntradas)}</h3>
            <p>Entradas Recebidas</p>
          </div>
        </div>

        <div className="card stat-card">
          <div className="stat-header">
            <div className="stat-icon" style={{ backgroundColor: '#ef444415', color: '#ef4444' }}>
              <ArrowDownCircle size={24} />
            </div>
          </div>
          <div className="stat-info">
            <h3>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalSaidas)}</h3>
            <p>Saídas Pagas</p>
          </div>
        </div>

        <div className="card stat-card">
          <div className="stat-header">
            <div className="stat-icon purple-bg">
              <DollarSign size={24} />
            </div>
            <button 
              onClick={() => setShowSaldo(!showSaldo)} 
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              title={showSaldo ? 'Ocultar Saldo' : 'Mostrar Saldo'}
            >
              {showSaldo ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </div>
          <div className="stat-info">
            <h3>
              {showSaldo 
                ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(saldoAtual) 
                : 'R$ •••••'}
            </h3>
            <p>Saldo do Período</p>
          </div>
        </div>
      </div>

      <div className="card list-container">
        <div className="list-toolbar">
          <div className="search-box">
            <Search size={18} className="search-icon" />
            <input type="text" placeholder="Buscar transação..." />
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <Calendar size={18} style={{ color: 'var(--text-muted)' }} />
            <select 
              value={diasFiltro} 
              onChange={(e) => setDiasFiltro(Number(e.target.value))}
              style={{ 
                backgroundColor: 'var(--bg-tertiary)', 
                border: '1px solid var(--border-color)', 
                color: 'white', 
                padding: '8px 12px', 
                borderRadius: 'var(--radius-md)' 
              }}
            >
              <option value={7}>Últimos 7 dias</option>
              <option value={15}>Últimos 15 dias</option>
              <option value={30}>Últimos 30 dias</option>
              <option value={90}>Últimos 90 dias</option>
              <option value={0}>Todo o período</option>
            </select>
          </div>
        </div>

        <div className="table-wrapper">
          <table className="data-table financeiro-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Descrição</th>
                <th>Categoria</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Valor (R$)</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '20px' }}>Carregando fluxo de caixa...</td>
                </tr>
              ) : filteredTransacoes.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '20px' }}>Nenhuma transação encontrada no período selecionado.</td>
                </tr>
              ) : (
                filteredTransacoes.map((t) => (
                  <tr key={t.id}>
                    <td style={{ color: 'var(--text-muted)' }}>{t.data || new Date(t.createdAt?.seconds * 1000).toLocaleDateString('pt-BR')}</td>
                    <td className="font-medium">{t.descricao}</td>
                    <td>{t.categoria}</td>
                    <td>
                      <span className="status-badge" style={{ 
                        backgroundColor: t.status === 'Paga' ? '#10b98120' : '#f59e0b20', 
                        color: t.status === 'Paga' ? '#10b981' : '#f59e0b' 
                      }}>
                        <span className="status-dot" style={{ backgroundColor: t.status === 'Paga' ? '#10b981' : '#f59e0b' }}></span>
                        {t.status}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: '600', color: t.tipo === 'entrada' ? '#10b981' : '#ef4444' }}>
                      {t.tipo === 'entrada' ? '+' : '-'} {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(t.valor))}
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

export default Caixa;
