import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Printer, ArrowLeft } from 'lucide-react';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import PedidoPrintDocument from './PedidoPrintDocument';
import {
  isVendaDoUsuario,
  MENSAGEM_VENDA_DE_OUTRO_USUARIO,
  TITULO_VENDA_DE_OUTRO_USUARIO,
} from '../../utils/visibilidadeVendasDomain';
import { showError } from '../../utils/alerts';
import '../OS/OsPrint.css'; // Reusing OS print styles

const PedidoPrint: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { currentUser, tenantId, vendasVisiveisDeUsuarioId } = useAuth();
  const [pedidoData, setPedidoData] = useState<any>(null);
  const [clientData, setClientData] = useState<any>(null);
  const [configData, setConfigData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPedido = async () => {
      if (!id || !tenantId) return;
      try {
        const docRef = doc(db, 'pedidos_venda', id);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          const data = { id: docSnap.id, ...docSnap.data() } as any;
          // Imprimir e' ver: a mesma trava da tela de visualizacao vale aqui.
          if (vendasVisiveisDeUsuarioId && !isVendaDoUsuario(data, vendasVisiveisDeUsuarioId)) {
            showError(TITULO_VENDA_DE_OUTRO_USUARIO, MENSAGEM_VENDA_DE_OUTRO_USUARIO);
            navigate('/pedidos-venda');
            setLoading(false);
            return;
          }
          setPedidoData(data);

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
          alert('Pedido não encontrado!');
          navigate('/pedidos-venda');
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
    fetchPedido();
  }, [id, navigate, currentUser, tenantId, vendasVisiveisDeUsuarioId]);

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-primary)' }}>Carregando dados para impressão...</div>;
  }

  if (!pedidoData) return null;

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

      <PedidoPrintDocument pedidoData={pedidoData} clientData={clientData} configData={configData} />
    </div>
  );
};

export default PedidoPrint;
