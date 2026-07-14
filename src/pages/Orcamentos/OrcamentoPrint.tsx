import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Printer, ArrowLeft } from 'lucide-react';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { getCompanyAddressRows } from '../../utils/companyAddress';
import '../OS/OsPrint.css';

const OrcamentoPrint: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { currentUser, tenantId } = useAuth();
  const [data, setData] = useState<any>(null);
  const [clientData, setClientData] = useState<any>(null);
  const [configData, setConfigData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      if (!id || !tenantId) return;
      try {
        const docRef = doc(db, 'orcamentos', id);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          const orcData = { id: docSnap.id, ...docSnap.data() } as any;
          setData(orcData);

          // Buscar dados detalhados do cliente
          const qC = query(
            collection(db, 'clientes'), 
            where('tenantId', '==', tenantId),
            where('nome', '==', orcData.clienteNome)
          );
          const snapC = await getDocs(qC);
          if (!snapC.empty) {
            setClientData(snapC.docs[0].data());
          }
        } else {
          alert('Orçamento não encontrado!');
          navigate('/orcamentos');
        }

        if (currentUser) {
          const configRef = doc(db, 'configuracoes', tenantId || '');
          const configSnap = await getDoc(configRef);
          if (configSnap.exists()) {
            setConfigData(configSnap.data());
          }
        }
      } catch (error) {
        console.error("Erro ao buscar dados", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [id, navigate, currentUser, tenantId]);

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-primary)' }}>Carregando dados para impressão...</div>;
  }

  if (!data) return null;

  const dataCriacao = data.createdAt?.toDate ? data.createdAt.toDate().toLocaleDateString('pt-BR') : 'N/A';
  const companyAddressRows = getCompanyAddressRows(configData, 'Endereço da Empresa');
  const servicos = data.servicos || [];
  const pecas = data.pecas || [];
  const todosItens = [
    ...servicos.map((s: any) => ({ ...s, tipo: 'Serviço' })),
    ...pecas.map((p: any) => ({ ...p, tipo: 'Peça/Produto' }))
  ];
  const valorTotal = data.valorTotal || 0;

  return (
    <div className="print-layout-wrapper">
      <div className="print-actions no-print">
        <button className="btn-secondary" onClick={() => navigate('/orcamentos')}>
          <ArrowLeft size={18} style={{ marginRight: 8 }} />
          Voltar
        </button>
        <button className="btn-primary" onClick={handlePrint}>
          <Printer size={18} style={{ marginRight: 8 }} />
          Imprimir Orçamento
        </button>
      </div>

      <div className="a4-page">
        <div className="a4-header">
          <div className="a4-logo">
            {configData?.logo && (
              <img src={configData.logo} alt="Logo" style={{ maxHeight: '80px', maxWidth: '250px', objectFit: 'contain', marginBottom: '8px' }} />
            )}
            <h2 style={{ fontSize: configData?.logo ? '16px' : '24px', margin: 0 }}>{configData?.nomeOficina || 'NEXAR ERP'}</h2>
            <p>CNPJ: {configData?.cnpj || '00.000.000/0001-00'}</p>
            {companyAddressRows.map((row) => (
              <p key={row.label}><strong>{row.label}:</strong> {row.value}</p>
            ))}
            <p>{configData?.telefone || '(00) 0000-0000'} | {configData?.email || 'contato@empresa.com.br'}</p>
          </div>
          <div className="a4-os-info">
            <h1 style={{ color: 'var(--accent-purple)' }}>ORÇAMENTO</h1>
            <h2 className="os-number">Nº {data.numeroOrcamento || data.id.substring(0, 6).toUpperCase()}</h2>
            <p><strong>Data:</strong> {dataCriacao}</p>
            <p><strong>Validade:</strong> {data.validadeDias || 15} dias</p>
          </div>
        </div>

        <div className="a4-section">
          <h3 className="section-title">Dados do Cliente</h3>
          <div className="a4-grid">
            <p><strong>Nome:</strong> {data.clienteNome}</p>
            <p><strong>CPF/CNPJ:</strong> {clientData?.documento || '---'}</p>
            <p><strong>Telefone:</strong> {data.clienteTelefone || 'N/A'}</p>
            <p><strong>E-mail:</strong> {clientData?.email || '---'}</p>
          </div>
          <div style={{ marginTop: '8px', borderTop: '1px solid #eee', paddingTop: '8px' }}>
            <p><strong>Endereço:</strong> {clientData?.endereco || '---'}{clientData?.numero ? `, ${clientData.numero}` : ''}</p>
            <p><strong>Bairro:</strong> {clientData?.bairro || '---'}</p>
          </div>
        </div>

        {(data.placa || data.modelo) && (
          <div className="a4-section">
            <h3 className="section-title">Dados do Veículo</h3>
            <div className="a4-grid">
              <p><strong>Veículo:</strong> {data.modelo || 'Não informado'}</p>
              <p><strong>Placa:</strong> {data.placa?.toUpperCase() || 'N/A'}</p>
              <p><strong>Ano:</strong> {data.ano || 'N/A'}</p>
              <p><strong>Cor:</strong> {data.cor || 'N/A'}</p>
            </div>
          </div>
        )}

        <div className="a4-section">
          <h3 className="section-title">Itens do Orçamento</h3>
          <table className="a4-table">
            <thead>
              <tr>
                <th>Descrição do Item</th>
                <th style={{ textAlign: 'center' }}>Qtd</th>
                <th style={{ textAlign: 'right' }}>Valor Unitário</th>
                <th style={{ textAlign: 'right' }}>Total (R$)</th>
              </tr>
            </thead>
            <tbody>
              {todosItens.length > 0 ? (
                todosItens.map((item: any, i: number) => (
                  <tr key={i}>
                    <td>
                      {item.nome}
                      <span style={{ fontSize: '10px', color: '#666', marginLeft: '6px' }}>({item.tipo})</span>
                    </td>
                    <td style={{ textAlign: 'center' }}>{item.quantidade}</td>
                    <td style={{ textAlign: 'right' }}>
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.preco)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.preco * item.quantidade)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: '10px' }}>Nenhum item adicionado.</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} style={{ textAlign: 'right', fontWeight: 'bold' }}>TOTAL GERAL:</td>
                <td style={{ textAlign: 'right', fontWeight: 'bold', fontSize: '18px' }}>
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valorTotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {data.observacoes && (
          <div className="a4-section">
            <h3 className="section-title">Observações</h3>
            <p className="a4-text-block">{data.observacoes}</p>
          </div>
        )}

        <div className="a4-signatures" style={{ marginTop: '60px' }}>
          <div className="signature-box">
            <div className="signature-line"></div>
            <p>Assinatura do Cliente</p>
          </div>
          <div className="signature-box">
            <div className="signature-line"></div>
            <p>Responsável Comercial</p>
          </div>
        </div>

        <div className="a4-footer">
          <p>Este orçamento tem validade de {data.validadeDias || 15} dias a partir da data de emissão.</p>
          <p>Gerado pelo Sistema Nexar ERP.</p>
        </div>
      </div>
    </div>
  );
};

export default OrcamentoPrint;
