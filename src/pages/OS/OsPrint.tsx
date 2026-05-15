import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Printer, ArrowLeft } from 'lucide-react';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import './OsPrint.css';

const OsPrint: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { currentUser, tenantId } = useAuth();
  const [osData, setOsData] = useState<any>(null);
  const [clientData, setClientData] = useState<any>(null);
  const [configData, setConfigData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchOS = async () => {
      if (!id || !tenantId) return;
      try {
        const docRef = doc(db, 'ordens_de_servico', id);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          const data = { id: docSnap.id, ...docSnap.data() };
          setOsData(data);

          // Buscar dados detalhados do cliente
          const qC = query(
            collection(db, 'clientes'), 
            where('tenantId', '==', tenantId),
            where('nome', '==', data.clienteNome)
          );
          const snapC = await getDocs(qC);
          if (!snapC.empty) {
            setClientData(snapC.docs[0].data());
          }
        } else {
          alert('Ordem de serviço não encontrada!');
          navigate('/os');
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
    fetchOS();
  }, [id, navigate, currentUser, tenantId]);

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-primary)' }}>Carregando dados para impressão...</div>;
  }

  if (!osData) return null;

  const dataCriacao = osData.createdAt?.toDate ? osData.createdAt.toDate().toLocaleDateString('pt-BR') : 'N/A';
  const servicos = osData.servicos || [];
  const pecas = osData.pecas || [];
  const todosItens = [
    ...servicos.map((s: any) => ({ ...s, tipo: 'Serviço' })),
    ...pecas.map((p: any) => ({ ...p, tipo: 'Peça' }))
  ];
  const valorTotal = osData.valorTotal || 0;

  return (
    <div className="print-layout-wrapper">
      <div className="print-actions no-print">
        <button className="btn-secondary" onClick={() => navigate('/os')}>
          <ArrowLeft size={18} style={{ marginRight: 8 }} />
          Voltar
        </button>
        <button className="btn-primary" onClick={handlePrint}>
          <Printer size={18} style={{ marginRight: 8 }} />
          Imprimir OS
        </button>
      </div>

      <div className="a4-page">
        <div className="a4-header">
          <div className="a4-logo">
            {configData?.logo && (
              <img src={configData.logo} alt="Logo" style={{ maxHeight: '80px', maxWidth: '250px', objectFit: 'contain', marginBottom: '8px' }} />
            )}
            <h2 style={{ fontSize: configData?.logo ? '16px' : '24px', margin: 0 }}>{configData?.nomeOficina || 'NEXAR OFICINA'}</h2>
            <p>CNPJ: {configData?.cnpj || '00.000.000/0001-00'}</p>
            <p>{configData?.endereco || 'Av. das Indústrias, 1000 - São Paulo, SP'}</p>
            <p>{configData?.telefone || '(11) 3333-4444'} | {configData?.email || 'contato@nexaroficina.com.br'}</p>
          </div>
          <div className="a4-os-info">
            <h1>ORDEM DE SERVIÇO</h1>
            <h2 className="os-number">Nº {osData.numeroOS || osData.id.substring(0, 6).toUpperCase()}</h2>
            <p><strong>Data:</strong> {dataCriacao}</p>
          </div>
        </div>

        <div className="a4-section">
          <h3 className="section-title">Dados do Cliente</h3>
          <div className="a4-grid">
            <p><strong>Nome:</strong> {osData.clienteNome}</p>
            <p><strong>CPF/CNPJ:</strong> {clientData?.documento || '---'}</p>
            <p><strong>Telefone:</strong> {osData.clienteTelefone}</p>
            <p><strong>E-mail:</strong> {clientData?.email || '---'}</p>
          </div>
          <div style={{ marginTop: '8px', borderTop: '1px solid #eee', paddingTop: '8px' }}>
            <p><strong>Endereço:</strong> {clientData?.endereco || '---'}{clientData?.numero ? `, ${clientData.numero}` : ''}</p>
            <p><strong>Bairro:</strong> {clientData?.bairro || '---'}</p>
          </div>
        </div>

        <div className="a4-section">
          <h3 className="section-title">Dados do Veículo</h3>
          <div className="a4-grid">
            <p><strong>Veículo:</strong> {osData.modelo || 'Não informado'}</p>
            <p><strong>Placa:</strong> {osData.placa?.toUpperCase()}</p>
            <p><strong>Ano:</strong> {osData.ano || 'Não informado'}</p>
            <p><strong>Cor:</strong> {osData.cor || 'Não informado'}</p>
          </div>
        </div>

        <div className="a4-section" style={{ display: 'flex', gap: '20px' }}>
          <div style={{ flex: 1 }}>
            <h3 className="section-title">Problema Relatado (Cliente)</h3>
            <p className="a4-text-block">{osData.defeitoRelatado || 'Nenhum defeito relatado.'}</p>
          </div>
          <div style={{ flex: 1 }}>
            <h3 className="section-title">Relatório Técnico (Mecânico)</h3>
            <p className="a4-text-block">{osData.relatorioTecnico || 'Nenhum relatório técnico emitido.'}</p>
          </div>
        </div>

        <div className="a4-section">
          <h3 className="section-title">Serviços e Peças Executados</h3>
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
                  <td colSpan={4} style={{ textAlign: 'center', padding: '10px' }}>Nenhum serviço ou peça adicionado.</td>
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

        <div className="a4-signatures">
          <div className="signature-box">
            <div className="signature-line"></div>
            <p>Assinatura do Cliente</p>
          </div>
          <div className="signature-box">
            <div className="signature-line"></div>
            <p>Assinatura do Responsável (Oficina)</p>
          </div>
        </div>

        <div className="a4-footer">
          <p>{configData?.garantiaPadrao || 'Garantia de 90 dias para peças e serviços executados de acordo com o Código de Defesa do Consumidor.'}</p>
          <p>Gerado pelo Sistema Nexar ERP.</p>
        </div>
      </div>
    </div>
  );
};

export default OsPrint;
