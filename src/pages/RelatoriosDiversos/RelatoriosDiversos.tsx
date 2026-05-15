import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Car, Printer, Search, ArrowRight, BarChart2, DollarSign, ArrowUpCircle, ArrowDownCircle, Calendar } from 'lucide-react';
import '../OS/OS.css'; // Reusing OS styles for consistency

const RelatoriosDiversos: React.FC = () => {
  const navigate = useNavigate();
  const [activeReport, setActiveReport] = useState<string | null>(null);

  // Filters for Veículos Report
  const [veiculoSearchTerm, setVeiculoSearchTerm] = useState('');

  // Filters for Financial Reports
  const [finDataInicio, setFinDataInicio] = useState(new Date().toISOString().split('T')[0]);
  const [finDataFim, setFinDataFim] = useState(new Date().toISOString().split('T')[0]);
  const [finStatus, setFinStatus] = useState<'Paga' | 'Pendente'>('Pendente');

  const reports = [
    {
      id: 'veiculos',
      title: 'Relatório de Veículos (Frota)',
      description: 'Listagem completa ou filtrada dos veículos cadastrados no sistema, seus donos e detalhes. Ideal para impressão.',
      icon: <Car size={24} color="#3b82f6" />,
      color: '#3b82f6'
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
