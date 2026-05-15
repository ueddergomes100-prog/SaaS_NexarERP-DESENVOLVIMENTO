import React, { useState } from 'react';
import { Receipt, Plus, Search, Filter, FileText, CheckCircle, XCircle, AlertCircle, Eye, Download } from 'lucide-react';
import { showSuccess } from '../../utils/alerts';

// Lista vazia (sem dados fictícios)
const notas: any[] = [];

const NFE: React.FC = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Form state
  const [formData, setFormData] = useState({
    tipo: 'NFS-e',
    cliente: '',
    osId: '',
    valor: '',
    descricao: ''
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Autorizada':
        return <span style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600, backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}><CheckCircle size={14}/> Autorizada</span>;
      case 'Rejeitada':
        return <span style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600, backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '4px' }}><XCircle size={14}/> Rejeitada</span>;
      case 'Processando':
        return <span style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600, backgroundColor: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '4px' }}><AlertCircle size={14}/> Processando</span>;
      default:
        return <span>{status}</span>;
    }
  };

  const handleEmitir = (e: React.FormEvent) => {
    e.preventDefault();
    setIsModalOpen(false);
    showSuccess('Nota enviada para processamento!');
  };

  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Receipt size={28} color="var(--accent-purple)" />
            Módulo Fiscal
          </h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)' }}>Gerenciamento e emissão de NF-e e NFS-e</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileText size={18} /> Relatório Fiscal
          </button>
          <button className="btn-primary" onClick={() => setIsModalOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={18} /> Emitir Nota Fiscal
          </button>
        </div>
      </div>

      <div className="card list-container">
        <div className="list-toolbar" style={{ display: 'flex', justifyContent: 'space-between', padding: '16px', borderBottom: '1px solid var(--border-color)' }}>
          <div className="search-box" style={{ position: 'relative', width: '300px' }}>
            <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input 
              type="text" 
              placeholder="Buscar por número ou cliente..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: '100%', padding: '10px 10px 10px 40px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
            />
          </div>
          <button className="btn-secondary filter-btn" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Filter size={18} /> Filtros
          </button>
        </div>

        <div className="table-wrapper" style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left', color: 'var(--text-muted)' }}>
                <th style={{ padding: '16px' }}>Número</th>
                <th style={{ padding: '16px' }}>Tipo</th>
                <th style={{ padding: '16px' }}>Cliente</th>
                <th style={{ padding: '16px' }}>Data</th>
                <th style={{ padding: '16px' }}>Valor</th>
                <th style={{ padding: '16px' }}>Status</th>
                <th style={{ padding: '16px', textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {notas.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    <Receipt size={40} style={{ opacity: 0.2, margin: '0 auto 12px' }} />
                    <p>Nenhuma nota fiscal emitida ainda.</p>
                  </td>
                </tr>
              ) : (
                notas.map((nota) => (
                  <tr key={nota.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '16px', fontWeight: 500 }}>{nota.numero}</td>
                    <td style={{ padding: '16px' }}>
                      <span style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '12px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}>
                        {nota.tipo}
                      </span>
                    </td>
                    <td style={{ padding: '16px' }}>{nota.cliente}</td>
                    <td style={{ padding: '16px' }}>{new Date(nota.data).toLocaleDateString('pt-BR')}</td>
                    <td style={{ padding: '16px', fontWeight: 600 }}>R$ {nota.valor.toFixed(2).replace('.', ',')}</td>
                    <td style={{ padding: '16px' }}>{getStatusBadge(nota.status)}</td>
                    <td style={{ padding: '16px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                        <button className="icon-btn" title="Visualizar Danfe" style={{ padding: '6px', borderRadius: '4px', backgroundColor: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                          <Eye size={18} />
                        </button>
                        <button className="icon-btn" title="Baixar XML" style={{ padding: '6px', borderRadius: '4px', backgroundColor: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                          <Download size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de Emissão */}
      {isModalOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
            width: '100%', maxWidth: '600px', padding: '32px',
            border: '1px solid var(--border-color)', boxShadow: '0 20px 40px rgba(0,0,0,0.4)'
          }}>
            <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Receipt size={24} color="var(--accent-purple)" />
              Emitir Nova Nota Fiscal
            </h2>
            
            <form onSubmit={handleEmitir}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px' }}>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Tipo de Nota</label>
                  <select 
                    value={formData.tipo}
                    onChange={(e) => setFormData({...formData, tipo: e.target.value})}
                    style={{ padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
                  >
                    <option value="NFS-e">NFS-e (Serviços / Mão de Obra)</option>
                    <option value="NF-e">NF-e (Produtos / Peças)</option>
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Vincular a uma OS (Opcional)</label>
                  <input 
                    type="text" 
                    placeholder="Nº da OS"
                    value={formData.osId}
                    onChange={(e) => setFormData({...formData, osId: e.target.value})}
                    style={{ padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Cliente</label>
                  <input 
                    type="text" 
                    placeholder="Selecione o cliente"
                    value={formData.cliente}
                    onChange={(e) => setFormData({...formData, cliente: e.target.value})}
                    required
                    style={{ padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Descrição dos Serviços/Produtos</label>
                  <textarea 
                    placeholder="Descreva o que sairá na nota..."
                    rows={3}
                    value={formData.descricao}
                    onChange={(e) => setFormData({...formData, descricao: e.target.value})}
                    required
                    style={{ padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', resize: 'vertical' }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Valor Total (R$)</label>
                  <input 
                    type="number" 
                    step="0.01"
                    placeholder="0,00"
                    value={formData.valor}
                    onChange={(e) => setFormData({...formData, valor: e.target.value})}
                    required
                    style={{ padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '18px', fontWeight: 'bold' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '32px' }}>
                <button type="button" className="btn-secondary" onClick={() => setIsModalOpen(false)}>Cancelar</button>
                <button type="submit" className="btn-primary" style={{ backgroundColor: '#10b981', color: 'white' }}>Transmitir Nota</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};

export default NFE;
