import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Printer, ArrowLeft } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import '../OS/OsPrint.css'; // Reusing OS print styles

const PedidoPrint: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [pedidoData, setPedidoData] = useState<any>(null);
  const [configData, setConfigData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPedido = async () => {
      if (!id) return;
      try {
        const docRef = doc(db, 'pedidos_venda', id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setPedidoData({ id: docSnap.id, ...docSnap.data() });
        } else {
          alert('Pedido não encontrado!');
          navigate('/pedidos-venda');
        }

        // Fetch configs
        if (currentUser) {
          const configRef = doc(db, 'configuracoes', currentUser.uid);
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
    fetchPedido();
  }, [id, navigate, currentUser]);

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'white' }}>Carregando dados para impressão...</div>;
  }

  if (!pedidoData) return null;

  const dataCriacao = pedidoData.createdAt?.toDate ? pedidoData.createdAt.toDate().toLocaleDateString('pt-BR') : 'N/A';
  const itens = pedidoData.itens || [];
  const valorTotal = pedidoData.valorTotal || 0;

  return (
    <div className="print-layout-wrapper">
      <div className="print-actions no-print">
        <button className="btn-secondary" onClick={() => navigate('/pedidos-venda')}>
          <ArrowLeft size={18} style={{ marginRight: 8 }} />
          Voltar
        </button>
        <button className="btn-primary" onClick={handlePrint}>
          <Printer size={18} style={{ marginRight: 8 }} />
          Imprimir Recibo
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
            <p>{configData?.endereco || ''}</p>
            <p>{configData?.telefone || ''} | {configData?.email || ''}</p>
          </div>
          <div className="a4-os-info">
            <h1>RECIBO DE VENDA</h1>
            <h2 className="os-number">Nº {pedidoData.numeroPedido || pedidoData.id.substring(0, 6).toUpperCase()}</h2>
            <p><strong>Data:</strong> {dataCriacao}</p>
          </div>
        </div>

        <div className="a4-grid">
          <p><strong>Cliente:</strong> {pedidoData.clienteNome}</p>
          <p><strong>Forma de Pagamento:</strong> {pedidoData.formaPagamento}</p>
        </div>

        <div className="a4-section">
          <h3 className="section-title">Produtos Adquiridos</h3>
          <table className="a4-table">
            <thead>
              <tr>
                <th>Descrição do Item</th>
                <th style={{ textAlign: 'center' }}>Qtd</th>
                <th style={{ textAlign: 'right' }}>V. Unitário</th>
                <th style={{ textAlign: 'right' }}>Desconto</th>
                <th style={{ textAlign: 'right' }}>Subtotal (R$)</th>
              </tr>
            </thead>
            <tbody>
              {itens.length > 0 ? (
                itens.map((item: any, i: number) => (
                  <tr key={i}>
                    <td>{item.nome}</td>
                    <td style={{ textAlign: 'center' }}>{item.quantidade}</td>
                    <td style={{ textAlign: 'right' }}>
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.precoUnitario)}
                    </td>
                    <td style={{ textAlign: 'right', color: item.desconto > 0 ? '#ef4444' : 'inherit' }}>
                      {item.desconto > 0 ? `- ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.desconto)}` : '-'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.subtotal)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '10px' }}>Nenhum item adicionado.</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} style={{ textAlign: 'right', fontWeight: 'bold' }}>TOTAL GERAL:</td>
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
            <p>Assinatura do Responsável</p>
          </div>
        </div>

        <div className="a4-footer">
          <p>Obrigado pela preferência!</p>
          <p>Gerado pelo Sistema Nexar ERP.</p>
        </div>
      </div>
    </div>
  );
};

export default PedidoPrint;
