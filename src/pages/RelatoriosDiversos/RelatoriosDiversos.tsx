import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Car, Printer, Search, ArrowRight, BarChart2, DollarSign, ArrowUpCircle, ArrowDownCircle, Calendar, ShoppingCart, Users } from 'lucide-react';
import '../OS/OS.css'; // Reusing OS styles for consistency

const RelatoriosDiversos: React.FC = () => {
  const navigate = useNavigate();

  const getDefaultFimDate = () => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().split('T')[0];
  };

  const getInitialState = <T,>(key: string, defaultValue: T): T => {
    try {
      const item = sessionStorage.getItem(`relatorios_${key}`);
      return item ? JSON.parse(item) : defaultValue;
    } catch {
      return defaultValue;
    }
  };

  const [activeReport, setActiveReport] = useState<string | null>(
    () => getInitialState('activeReport', null)
  );

  // Filters for Veículos Report
  const [veiculoSearchTerm, setVeiculoSearchTerm] = useState(
    () => getInitialState('veiculoSearchTerm', '')
  );

  // Filters for Financial Reports
  const [finDataInicio, setFinDataInicio] = useState(
    () => getInitialState('finDataInicio', new Date().toISOString().split('T')[0])
  );
  
  const [finDataFim, setFinDataFim] = useState(
    () => getInitialState('finDataFim', getDefaultFimDate())
  );
  
  const [finStatus, setFinStatus] = useState<'Paga' | 'Pendente'>(
    () => getInitialState('finStatus', 'Pendente')
  );

  const getStartOfMonth = () => {
    const d = new Date();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${d.getFullYear()}-${month}-01`;
  };

  const getEndOfMonth = () => {
    const d = new Date();
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${d.getFullYear()}-${month}-${String(lastDay).padStart(2, '0')}`;
  };

  const [vendasPeriodo, setVendasPeriodo] = useState<string>(
    () => getInitialState('vendasPeriodo', 'atual')
  );

  const [vendasDataInicio, setVendasDataInicio] = useState<string>(
    () => getInitialState('vendasDataInicio', getStartOfMonth())
  );

  const [vendasDataFim, setVendasDataFim] = useState<string>(
    () => getInitialState('vendasDataFim', getEndOfMonth())
  );

  useEffect(() => {
    sessionStorage.setItem('relatorios_activeReport', JSON.stringify(activeReport));
  }, [activeReport]);

  useEffect(() => {
    sessionStorage.setItem('relatorios_veiculoSearchTerm', JSON.stringify(veiculoSearchTerm));
  }, [veiculoSearchTerm]);

  useEffect(() => {
    sessionStorage.setItem('relatorios_finDataInicio', JSON.stringify(finDataInicio));
  }, [finDataInicio]);

  useEffect(() => {
    sessionStorage.setItem('relatorios_finDataFim', JSON.stringify(finDataFim));
  }, [finDataFim]);

  useEffect(() => {
    sessionStorage.setItem('relatorios_finStatus', JSON.stringify(finStatus));
  }, [finStatus]);

  useEffect(() => {
    sessionStorage.setItem('relatorios_vendasPeriodo', JSON.stringify(vendasPeriodo));
  }, [vendasPeriodo]);

  useEffect(() => {
    sessionStorage.setItem('relatorios_vendasDataInicio', JSON.stringify(vendasDataInicio));
  }, [vendasDataInicio]);

  useEffect(() => {
    sessionStorage.setItem('relatorios_vendasDataFim', JSON.stringify(vendasDataFim));
  }, [vendasDataFim]);

  const reports = [
    {
      id: 'veiculos',
      title: 'Relatório de Veículos (Frota)',
      description: 'Listagem completa ou filtrada dos veículos cadastrados no sistema, seus donos e detalhes. Ideal para impressão.',
      icon: <Car size={24} color="#3b82f6" />,
      color: '#3b82f6'
    },
    {
      id: 'vendas-geral',
      title: 'Relatório de Vendas (Geral)',
      description: 'Gere PDFs com listagem detalhada de vendas e devoluções do período, com contagens de transações e faturamento líquido.',
      icon: <ShoppingCart size={24} color="#8b5cf6" />,
      color: '#8b5cf6'
    },
    {
      id: 'vendas-vendedor',
      title: 'Relatório de Vendas por Vendedor',
      description: 'Gere PDFs com a análise de vendas e devoluções agrupadas por vendedor no período selecionado.',
      icon: <Users size={24} color="#f59e0b" />,
      color: '#f59e0b'
    },
    {
      id: 'contas-receber',
      title: 'Relatório de Recebimentos / Débitos',
      description: 'Gere PDFs com o resumo diário ou mensal do que foi recebido, ou liste todos os débitos de clientes em aberto.',
      icon: <ArrowDownCircle size={24} color="#10b981" />,
      color: '#10b981'
    },
    {
      id: 'contas-pagar',
      title: 'Relatório de Pagamentos / Despesas',
      description: 'Gere PDFs listando as contas que já foram pagas no período ou as contas a pagar que ainda estão pendentes.',
      icon: <ArrowUpCircle size={24} color="#ef4444" />,
      color: '#ef4444'
    },
    {
      id: 'placeholder',
      title: 'Outros Relatórios (Em Breve)',
      description: 'Novos relatórios gerenciais serão adicionados aqui em atualizações futuras.',
      icon: <BarChart2 size={24} color="var(--text-muted)" />,
      color: 'var(--text-muted)'
    }
  ];

  const handlePrintVeiculos = () => {
    navigate(`/relatorios-diversos/print/veiculos?search=${encodeURIComponent(veiculoSearchTerm)}`);
  };

  const handlePrintFinanceiro = (tipo: 'entrada' | 'saida') => {
    navigate(`/relatorios-diversos/print/financeiro?tipo=${tipo}&status=${finStatus}&inicio=${finDataInicio}&fim=${finDataFim}`);
  };

  const handlePrintVendas = (tipoReport: 'geral' | 'vendedor') => {
    navigate(`/relatorios-diversos/print/vendas?tipo=${tipoReport}&inicio=${vendasDataInicio}&fim=${vendasDataFim}`);
  };

  const handleVendasPeriodoChange = (value: string) => {
    setVendasPeriodo(value);
    const year = new Date().getFullYear();
    if (value === 'atual') {
      setVendasDataInicio(getStartOfMonth());
      setVendasDataFim(getEndOfMonth());
    } else if (value !== 'custom') {
      const monthIdx = parseInt(value);
      const start = `${year}-${String(monthIdx + 1).padStart(2, '0')}-01`;
      const lastDay = new Date(year, monthIdx + 1, 0).getDate();
      const end = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      setVendasDataInicio(start);
      setVendasDataFim(end);
    }
  };

  const handleVendasDataInicioChange = (val: string) => {
    setVendasDataInicio(val);
    setVendasPeriodo('custom');
  };

  const handleVendasDataFimChange = (val: string) => {
    setVendasDataFim(val);
    setVendasPeriodo('custom');
  };

  return (
    <div className="os-page">
      <div className="page-header">
        <div className="header-title-group">
          <div>
            <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <FileText size={28} color="var(--accent-purple)" />
              Relatórios Diversos
            </h1>
            <p className="page-subtitle">Central de relatórios de listagem e impressões rápidas em PDF</p>
          </div>
        </div>
      </div>

      <div className="form-grid">
        <div className="form-column">
          <div className="card form-section" style={{ padding: '24px' }}>
            <div className="section-header" style={{ marginBottom: '24px' }}>
              <h3>Selecione um Relatório</h3>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {reports.map(report => (
                <div 
                  key={report.id}
                  onClick={() => report.id !== 'placeholder' && setActiveReport(activeReport === report.id ? null : report.id)}
                  style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '16px', 
                    padding: '16px', 
                    backgroundColor: activeReport === report.id ? `${report.color}15` : 'var(--bg-secondary)', 
                    border: `1px solid ${activeReport === report.id ? report.color : 'var(--border-color)'}`, 
                    borderRadius: 'var(--radius-lg)',
                    cursor: report.id !== 'placeholder' ? 'pointer' : 'not-allowed',
                    transition: 'all 0.2s ease',
                    opacity: report.id === 'placeholder' ? 0.6 : 1
                  }}
                >
                  <div style={{ padding: '12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '12px' }}>
                    {report.icon}
                  </div>
                  <div style={{ flex: 1 }}>
                    <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {report.title}
                    </h4>
                    <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
                      {report.description}
                    </p>
                  </div>
                  {report.id !== 'placeholder' && (
                    <ArrowRight size={20} color={activeReport === report.id ? report.color : 'var(--text-muted)'} />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="form-column">
          {activeReport === 'veiculos' && (
            <div className="card form-section animate-fade-in-up" style={{ padding: '24px', border: '1px solid #3b82f650', backgroundColor: '#3b82f60a' }}>
              <div className="section-header" style={{ marginBottom: '24px' }}>
                <Car size={20} color="#3b82f6" />
                <h3 style={{ color: '#3b82f6' }}>Filtros: Relatório de Veículos</h3>
              </div>
              
              <div className="input-group" style={{ marginBottom: '24px' }}>
                <label>Pesquisar por Placa, Cliente ou Modelo (Opcional)</label>
                <div style={{ position: 'relative' }}>
                  <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input 
                    type="text" 
                    placeholder="Digite para filtrar os resultados impressos..." 
                    value={veiculoSearchTerm}
                    onChange={(e) => setVeiculoSearchTerm(e.target.value)}
                    style={{ 
                      width: '100%', 
                      padding: '12px 12px 12px 40px', 
                      backgroundColor: 'var(--bg-tertiary)', 
                      border: '1px solid var(--border-color)', 
                      borderRadius: 'var(--radius-md)', 
                      color: 'var(--text-primary)' 
                    }}
                  />
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px' }}>
                  Deixe em branco para imprimir toda a frota cadastrada.
                </p>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button 
                  className="btn-primary" 
                  onClick={handlePrintVeiculos}
                  style={{ 
                    backgroundColor: '#3b82f6', 
                    padding: '12px 24px', 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '8px', 
                    fontWeight: 'bold',
                    boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)'
                  }}
                >
                  <Printer size={18} />
                  GERAR PDF
                </button>
              </div>
            </div>
          )}

          {(activeReport === 'contas-receber' || activeReport === 'contas-pagar') && (
            <div className="card form-section animate-fade-in-up" style={{ padding: '24px', border: `1px solid ${activeReport === 'contas-receber' ? '#10b98150' : '#ef444450'}`, backgroundColor: activeReport === 'contas-receber' ? '#10b9810a' : '#ef44440a' }}>
              <div className="section-header" style={{ marginBottom: '24px' }}>
                {activeReport === 'contas-receber' ? <ArrowDownCircle size={20} color="#10b981" /> : <ArrowUpCircle size={20} color="#ef4444" />}
                <h3 style={{ color: activeReport === 'contas-receber' ? '#10b981' : '#ef4444' }}>
                  Filtros: {activeReport === 'contas-receber' ? 'Contas a Receber' : 'Contas a Pagar'}
                </h3>
              </div>
              
              <div className="input-group" style={{ marginBottom: '24px' }}>
                <label>Tipo de Relatório</label>
                <div style={{ display: 'flex', gap: '16px', marginTop: '8px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '12px 16px', backgroundColor: finStatus === 'Pendente' ? 'var(--bg-tertiary)' : 'transparent', border: `1px solid ${finStatus === 'Pendente' ? (activeReport === 'contas-receber' ? '#10b981' : '#ef4444') : 'var(--border-color)'}`, borderRadius: 'var(--radius-md)' }}>
                    <input type="radio" checked={finStatus === 'Pendente'} onChange={() => setFinStatus('Pendente')} style={{ display: 'none' }} />
                    <span style={{ fontWeight: finStatus === 'Pendente' ? 600 : 400, color: finStatus === 'Pendente' ? (activeReport === 'contas-receber' ? '#10b981' : '#ef4444') : 'var(--text-primary)' }}>
                      Em Aberto / Pendentes
                    </span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '12px 16px', backgroundColor: finStatus === 'Paga' ? 'var(--bg-tertiary)' : 'transparent', border: `1px solid ${finStatus === 'Paga' ? (activeReport === 'contas-receber' ? '#10b981' : '#ef4444') : 'var(--border-color)'}`, borderRadius: 'var(--radius-md)' }}>
                    <input type="radio" checked={finStatus === 'Paga'} onChange={() => setFinStatus('Paga')} style={{ display: 'none' }} />
                    <span style={{ fontWeight: finStatus === 'Paga' ? 600 : 400, color: finStatus === 'Paga' ? (activeReport === 'contas-receber' ? '#10b981' : '#ef4444') : 'var(--text-primary)' }}>
                      Baixadas / Pagas
                    </span>
                  </label>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
                <div className="input-group">
                  <label>Data Inicial</label>
                  <input type="date" value={finDataInicio} onChange={(e) => setFinDataInicio(e.target.value)} style={{ width: '100%', padding: '12px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }} />
                </div>
                <div className="input-group">
                  <label>Data Final</label>
                  <input type="date" value={finDataFim} onChange={(e) => setFinDataFim(e.target.value)} style={{ width: '100%', padding: '12px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }} />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button 
                  className="btn-primary" 
                  onClick={() => handlePrintFinanceiro(activeReport === 'contas-receber' ? 'entrada' : 'saida')}
                  style={{ 
                    backgroundColor: activeReport === 'contas-receber' ? '#10b981' : '#ef4444', 
                    borderColor: activeReport === 'contas-receber' ? '#10b981' : '#ef4444', 
                    padding: '12px 24px', 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '8px', 
                    fontWeight: 'bold',
                    boxShadow: `0 4px 12px ${activeReport === 'contas-receber' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`
                  }}
                >
                  <Printer size={18} />
                  GERAR PDF
                </button>
              </div>
            </div>
          )}

          {(activeReport === 'vendas-geral' || activeReport === 'vendas-vendedor') && (
            <div className="card form-section animate-fade-in-up" style={{ padding: '24px', border: `1px solid ${activeReport === 'vendas-geral' ? '#8b5cf650' : '#f59e0b50'}`, backgroundColor: activeReport === 'vendas-geral' ? '#8b5cf60a' : '#f59e0b0a' }}>
              <div className="section-header" style={{ marginBottom: '24px' }}>
                {activeReport === 'vendas-geral' ? <ShoppingCart size={20} color="#8b5cf6" /> : <Users size={20} color="#f59e0b" />}
                <h3 style={{ color: activeReport === 'vendas-geral' ? '#8b5cf6' : '#f59e0b' }}>
                  Filtros: {activeReport === 'vendas-geral' ? 'Relatório de Vendas (Geral)' : 'Vendas por Vendedor'}
                </h3>
              </div>
              
              <div className="input-group" style={{ marginBottom: '24px' }}>
                <label>Selecionar Período (Mês)</label>
                <select 
                  value={vendasPeriodo} 
                  onChange={(e) => handleVendasPeriodoChange(e.target.value)}
                  style={{ 
                    width: '100%', 
                    padding: '12px', 
                    backgroundColor: 'var(--bg-tertiary)', 
                    border: '1px solid var(--border-color)', 
                    borderRadius: 'var(--radius-md)', 
                    color: 'var(--text-primary)',
                    marginTop: '8px'
                  }}
                >
                  <option value="atual">Mês Atual (Pré-definido)</option>
                  <option value="0">Janeiro</option>
                  <option value="1">Fevereiro</option>
                  <option value="2">Março</option>
                  <option value="3">Abril</option>
                  <option value="4">Maio</option>
                  <option value="5">Junho</option>
                  <option value="6">Julho</option>
                  <option value="7">Agosto</option>
                  <option value="8">Setembro</option>
                  <option value="9">Outubro</option>
                  <option value="10">Novembro</option>
                  <option value="11">Dezembro</option>
                  <option value="custom">Período Customizado (Data a Data)</option>
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
                <div className="input-group">
                  <label>Data Inicial</label>
                  <input 
                    type="date" 
                    value={vendasDataInicio} 
                    onChange={(e) => handleVendasDataInicioChange(e.target.value)} 
                    style={{ width: '100%', padding: '12px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', marginTop: '8px' }} 
                  />
                </div>
                <div className="input-group">
                  <label>Data Final</label>
                  <input 
                    type="date" 
                    value={vendasDataFim} 
                    onChange={(e) => handleVendasDataFimChange(e.target.value)} 
                    style={{ width: '100%', padding: '12px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', marginTop: '8px' }} 
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button 
                  className="btn-primary" 
                  onClick={() => handlePrintVendas(activeReport === 'vendas-geral' ? 'geral' : 'vendedor')}
                  style={{ 
                    backgroundColor: activeReport === 'vendas-geral' ? '#8b5cf6' : '#f59e0b', 
                    borderColor: activeReport === 'vendas-geral' ? '#8b5cf6' : '#f59e0b', 
                    padding: '12px 24px', 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '8px', 
                    fontWeight: 'bold',
                    boxShadow: `0 4px 12px ${activeReport === 'vendas-geral' ? 'rgba(139, 92, 246, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`
                  }}
                >
                  <Printer size={18} />
                  GERAR PDF
                </button>
              </div>
            </div>
          )}

          {!activeReport && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '40px', color: 'var(--text-muted)', textAlign: 'center' }}>
              <FileText size={48} style={{ opacity: 0.2, marginBottom: '16px' }} />
              <p>Selecione um relatório ao lado para configurar os filtros e gerar o PDF.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default RelatoriosDiversos;
