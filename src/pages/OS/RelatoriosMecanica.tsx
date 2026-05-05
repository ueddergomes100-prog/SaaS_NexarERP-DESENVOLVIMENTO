import React from 'react';
import { PieChart, Download, Search, Filter } from 'lucide-react';

const RelatoriosMecanica: React.FC = () => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <PieChart size={28} color="var(--accent-purple)" />
            Relatórios da Mecânica
          </h1>
          <p style={{ color: 'var(--text-muted)' }}>Métricas de produtividade e serviços executados por cada mecânico</p>
        </div>
        <button className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'white' }}>
          <Download size={18} /> Exportar Completo
        </button>
      </div>

      <div style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', color: '#f59e0b', padding: '12px 16px', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', gap: '12px', fontWeight: 500 }}>
        <span style={{ display: 'inline-block', width: '8px', height: '8px', backgroundColor: '#f59e0b', borderRadius: '50%' }}></span>
        Módulo em Desenvolvimento. O cálculo de produtividade dos mecânicos estará disponível em breve.
      </div>

      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
          <div className="search-bar" style={{ flex: 1, position: 'relative' }}>
            <Search size={20} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input 
              type="text" 
              placeholder="Buscar por mecânico ou período..." 
              style={{ width: '100%', padding: '12px 16px 12px 48px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'white' }}
            />
          </div>
          <button className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 16px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'white' }}>
            <Filter size={20} /> Filtros de Data
          </button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '13px', textTransform: 'uppercase' }}>
                <th style={{ padding: '16px' }}>Mecânico</th>
                <th style={{ padding: '16px' }}>OS Finalizadas</th>
                <th style={{ padding: '16px' }}>Total de Serviços (Itens)</th>
                <th style={{ padding: '16px' }}>Valor (Mão de Obra)</th>
                <th style={{ padding: '16px', textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={5} style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  <PieChart size={48} style={{ margin: '0 auto 16px', opacity: 0.2 }} />
                  <p>Nenhuma OS finalizada no período selecionado.</p>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default RelatoriosMecanica;
