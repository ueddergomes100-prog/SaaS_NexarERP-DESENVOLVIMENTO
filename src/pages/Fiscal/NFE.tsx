import React from 'react';
import { Receipt, AlertTriangle } from 'lucide-react';

const NFE: React.FC = () => {
  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>Emitir Nota Fiscal</h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)' }}>Gerenciamento e emissão de notas fiscais</p>
        </div>
      </div>

      <div className="card" style={{ padding: '60px 24px', textAlign: 'center', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <Receipt size={64} style={{ margin: '0 auto 24px', color: 'var(--accent-purple)', opacity: 0.5 }} />
        <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '12px' }}>Módulo Fiscal em Desenvolvimento</h2>
        <p style={{ color: 'var(--text-muted)', maxWidth: '500px', margin: '0 auto 24px' }}>
          Em breve você poderá emitir notas fiscais (NFS-e e NF-e) diretamente pelo Nexus ERP, com integração automática com a sua prefeitura e SEFAZ.
        </p>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '12px 24px', backgroundColor: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', borderRadius: 'var(--radius-md)', fontWeight: 500 }}>
          <AlertTriangle size={18} />
          Em fase de testes de homologação
        </div>
      </div>
    </div>
  );
};

export default NFE;
