import React, { useState } from 'react';
import { Upload, FileText, AlertTriangle, Package, CheckCircle, Search, Save } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import '../OS/OS.css'; // Reusing global form styles

const EntradaNFE: React.FC = () => {
  const navigate = useNavigate();
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.name.endsWith('.xml')) {
        setSelectedFile(file);
      } else {
        alert('Por favor, envie apenas arquivos XML.');
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.name.endsWith('.xml')) {
        setSelectedFile(file);
      } else {
        alert('Por favor, envie apenas arquivos XML.');
      }
    }
  };

  return (
    <div className="os-page">
      <div className="page-header" style={{ marginBottom: '16px' }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <FileText size={28} color="var(--accent-purple)" />
            Entrada de Nota Fiscal (XML)
          </h1>
          <p className="page-subtitle">Importe notas fiscais de fornecedores para dar entrada no estoque e financeiro.</p>
        </div>
      </div>

      <div style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: 'var(--radius-md)', padding: '16px', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <AlertTriangle color="#f59e0b" size={24} />
        <div>
          <h4 style={{ color: '#f59e0b', margin: '0 0 4px 0', fontSize: '15px' }}>Módulo em Desenvolvimento</h4>
          <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '13px' }}>A leitura automática do XML e integração com a SEFAZ estão sendo construídas. Esta é uma prévia visual da tela.</p>
        </div>
      </div>

      <div className="form-grid">
        <div className="card" style={{ gridColumn: 'span 12', padding: '32px', textAlign: 'center' }}>
          
          <div 
            style={{
              border: `2px dashed ${dragActive ? 'var(--accent-purple)' : 'var(--border-color)'}`,
              borderRadius: 'var(--radius-lg)',
              padding: '64px 24px',
              backgroundColor: dragActive ? 'rgba(139, 92, 246, 0.05)' : 'var(--bg-tertiary)',
              transition: 'all 0.3s ease',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '16px'
            }}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => document.getElementById('xml-upload')?.click()}
          >
            <input 
              type="file" 
              id="xml-upload" 
              accept=".xml" 
              style={{ display: 'none' }} 
              onChange={handleFileChange}
            />
            <Upload size={48} color={dragActive ? 'var(--accent-purple)' : 'var(--text-muted)'} />
            
            {selectedFile ? (
              <div style={{ color: '#10b981', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                <CheckCircle size={24} />
                <span style={{ fontWeight: 600 }}>{selectedFile.name}</span>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Arquivo carregado com sucesso.</span>
              </div>
            ) : (
              <div>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '18px' }}>Arraste o XML da Nota Fiscal aqui</h3>
                <p style={{ margin: 0, color: 'var(--text-muted)' }}>ou clique para selecionar o arquivo no computador</p>
              </div>
            )}
          </div>
        </div>

        {/* Simulando a leitura do XML (Exibido apenas de forma visual) */}
        <div className="card" style={{ gridColumn: 'span 12', opacity: selectedFile ? 1 : 0.4, pointerEvents: selectedFile ? 'auto' : 'none', transition: 'opacity 0.3s', position: 'relative', overflow: 'hidden' }}>
          {/* Tarja diagonal de PRÉVIA */}
          <div style={{ position: 'absolute', top: '15px', right: '-35px', backgroundColor: '#f59e0b', color: '#fff', padding: '4px 40px', transform: 'rotate(45deg)', fontSize: '12px', fontWeight: 'bold', letterSpacing: '2px', boxShadow: '0 2px 4px rgba(0,0,0,0.2)', zIndex: 10 }}>
            PRÉVIA
          </div>
          
          <div className="section-header" style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Package size={20} className="section-icon" />
            <h3 style={{ margin: 0 }}>Itens Identificados na Nota Fiscal</h3>
            <span style={{ fontSize: '10px', backgroundColor: 'rgba(245, 158, 11, 0.2)', color: '#f59e0b', padding: '4px 8px', borderRadius: '4px', border: '1px solid rgba(245, 158, 11, 0.3)', fontWeight: 'bold' }}>MODO PRÉVIA</span>
          </div>
          
          <div style={{ padding: '24px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' }}>
               <div className="input-group">
                 <label>Fornecedor</label>
                 <input type="text" value="Auto Peças Distribuidora S.A." disabled />
               </div>
               <div className="input-group">
                 <label>CNPJ</label>
                 <input type="text" value="00.000.000/0001-00" disabled />
               </div>
               <div className="input-group">
                 <label>Número da NF</label>
                 <input type="text" value="001.234.567" disabled />
               </div>
               <div className="input-group">
                 <label>Data de Emissão</label>
                 <input type="text" value="04/05/2026" disabled />
               </div>
            </div>

            <table className="data-table" style={{ width: '100%', marginBottom: '24px' }}>
              <thead>
                <tr>
                  <th>Código Produto</th>
                  <th>Descrição</th>
                  <th>NCM</th>
                  <th>Qtd</th>
                  <th>Custo Unit.</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>98765</td>
                  <td>Filtro de Óleo Lubrax</td>
                  <td>8421.23.00</td>
                  <td>10</td>
                  <td>R$ 15,00</td>
                  <td>R$ 150,00</td>
                </tr>
                <tr>
                  <td>12345</td>
                  <td>Pastilha de Freio Cobreq</td>
                  <td>8708.30.19</td>
                  <td>4</td>
                  <td>R$ 45,00</td>
                  <td>R$ 180,00</td>
                </tr>
              </tbody>
            </table>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Save size={18} /> Confirmar Entrada no Estoque
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EntradaNFE;
