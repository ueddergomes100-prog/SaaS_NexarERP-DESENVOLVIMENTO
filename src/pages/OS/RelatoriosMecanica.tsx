import React from 'react';
import { PieChart, Download } from 'lucide-react';

const RelatoriosMecanica: React.FC = () => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>Relatórios da Oficina</h1>
          <p style={{ color: 'var(--text-muted)' }}>Métricas de serviços, OS e produtividade</p>
        </div>
        <button className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'white' }}>
          <Download size={18} /> Exportar
        </button>
      </div>

      <div className="card list-container" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div style={{ textAlign: 'center', padding: '80px 20px', color: 'var(--text-muted)' }}>
          <PieChart size={48} style={{ margin: '0 auto 16px', opacity: 0.2 }} />
          <h3>Módulo em Desenvolvimento</h3>
          <p style={{ marginTop: '8px', maxWidth: '400px', margin: '8px auto' }}>
            Gráficos de produtividade de mecânicos, ticket médio de OS e histórico de veículos estarão disponíveis em breve.
          </p>
        </div>
      </div>
    </div>
  );
};

export default RelatoriosMecanica;
