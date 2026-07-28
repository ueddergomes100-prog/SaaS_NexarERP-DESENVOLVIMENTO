import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Printer, ArrowLeft } from 'lucide-react';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import PedidoPrintDocument from './PedidoPrintDocument';
import { PEDIDO_PRINT_LOTE_SAFETY_LIMIT } from './pedidoPrintLoteConstants';
import '../OS/OsPrint.css'; // Reusing OS print styles
import './PedidoPrintLote.css';

const PedidoPrintLote: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser, tenantId } = useAuth();
  const [pedidos, setPedidos] = useState<any[]>([]);
  const [clientsById, setClientsById] = useState<Record<string, any>>({});
  const [configData, setConfigData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [truncated, setTruncated] = useState(false);

  const queryParams = new URLSearchParams(location.search);
  const ids = (queryParams.get('ids') || '').split(',').map((id) => id.trim()).filter(Boolean);
  const idsToLoad = ids.slice(0, PEDIDO_PRINT_LOTE_SAFETY_LIMIT);

  useEffect(() => {
    const fetchLote = async () => {
      if (!currentUser || !tenantId || idsToLoad.length === 0) {
        setLoading(false);
        return;
      }
      try {
        setTruncated(ids.length > idsToLoad.length);

        const pedidoDocs = await Promise.all(
          idsToLoad.map((id) => getDoc(doc(db, 'pedidos_venda', id))),
        );
        const loadedPedidos = pedidoDocs
          .filter((snap) => snap.exists())
          .map((snap) => ({ id: snap.id, ...snap.data() } as any));
        setPedidos(loadedPedidos);

        const clienteNomes = Array.from(
          new Set(loadedPedidos.map((p) => p.clienteNome).filter(Boolean)),
        );
        const clientEntries = await Promise.all(
          clienteNomes.map(async (nome) => {
            const qC = query(
              collection(db, 'clientes'),
              where('tenantId', '==', tenantId),
              where('nome', '==', nome),
            );
            const snapC = await getDocs(qC);
            return [nome, snapC.empty ? null : snapC.docs[0].data()] as const;
          }),
        );
        setClientsById(Object.fromEntries(clientEntries));

        const configRef = doc(db, 'configuracoes', tenantId);
        const configSnap = await getDoc(configRef);
        if (configSnap.exists()) {
          setConfigData(configSnap.data());
        }
      } catch (error) {
        console.error('Erro ao buscar pedidos para impressão em lote', error);
      } finally {
        setLoading(false);
      }
    };
    fetchLote();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, tenantId, location.search]);

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-primary)' }}>Carregando pedidos para impressão...</div>;
  }

  if (pedidos.length === 0) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-primary)' }}>
        <p>Nenhum pedido encontrado para impressão.</p>
        <button className="btn-secondary" onClick={() => navigate('/pedidos-venda')} style={{ marginTop: '16px' }}>
          <ArrowLeft size={18} style={{ marginRight: 8 }} />
          Voltar
        </button>
      </div>
    );
  }

  return (
    <div className="print-layout-wrapper">
      <div className="print-actions no-print">
        <button className="btn-secondary" onClick={() => navigate('/pedidos-venda')}>
          <ArrowLeft size={18} style={{ marginRight: 8 }} />
          Voltar
        </button>
        <span style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
          {pedidos.length} {pedidos.length === 1 ? 'pedido selecionado' : 'pedidos selecionados'}
          {truncated ? ` (limite de ${PEDIDO_PRINT_LOTE_SAFETY_LIMIT} por vez aplicado)` : ''}
        </span>
        <button className="btn-primary" onClick={handlePrint}>
          <Printer size={18} style={{ marginRight: 8 }} />
          Imprimir {pedidos.length > 1 ? 'Todos' : 'Recibo'}
        </button>
      </div>

      {pedidos.map((pedidoData) => (
        <div className="print-batch-item" key={pedidoData.id}>
          <PedidoPrintDocument
            pedidoData={pedidoData}
            clientData={clientsById[pedidoData.clienteNome] || null}
            configData={configData}
          />
        </div>
      ))}
    </div>
  );
};

export default PedidoPrintLote;
