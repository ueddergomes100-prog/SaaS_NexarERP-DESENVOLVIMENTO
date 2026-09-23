import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Printer, ArrowLeft } from 'lucide-react';
import { doc, getDoc, updateDoc, serverTimestamp, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import PedidoPrintModelo from './PedidoPrintModelo';
import { PEDIDO_PRINT_LOTE_SAFETY_LIMIT } from './pedidoPrintLoteConstants';
import { filtrarVendasVisiveis } from '../../utils/visibilidadeVendasDomain';
import { showWarning } from '../../utils/alerts';
import { mensagemSegundaViaLote } from '../../utils/pedidoImpressaoDomain';
import { usePrintAndClose } from '../../hooks/usePrintAndClose';
import '../OS/OsPrint.css'; // Reusing OS print styles
import './PedidoPrintLote.css';

const PedidoPrintLote: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser, tenantId, vendasVisiveisDeUsuarioId } = useAuth();
  const [pedidos, setPedidos] = useState<any[]>([]);
  const [clientsById, setClientsById] = useState<Record<string, any>>({});
  const [parcelasByPedidoId, setParcelasByPedidoId] = useState<Record<string, Array<{ numero: number; dataVencimento: string; valor: number }>>>({});
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
        // A impressao em lote recebe os ids pela URL -- sem este filtro,
        // bastaria colar o id do pedido do colega na query string.
        const loadedPedidos = filtrarVendasVisiveis(
          pedidoDocs
            .filter((snap) => snap.exists())
            .map((snap) => ({ id: snap.id, ...snap.data() } as any)),
          vendasVisiveisDeUsuarioId,
        );
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

        // Parcelas de cada pedido -- gravadas em documentos separados na
        // colecao 'transacoes', usadas so pelo modelo meia-folha.
        const parcelasEntries = await Promise.all(
          loadedPedidos.map(async (pedido) => {
            const qT = query(
              collection(db, 'transacoes'),
              where('tenantId', '==', tenantId),
              where('pedidoId', '==', pedido.id),
            );
            const snapT = await getDocs(qT);
            const parcelasCarregadas = snapT.docs
              .map((docT) => docT.data())
              .sort((a, b) => (a.paymentIndex ?? 0) - (b.paymentIndex ?? 0))
              .map((t, index) => ({
                // paymentIndex ja nasce base-1 (ver 'indice' em financeDomain.ts).
                numero: t.paymentIndex ?? (index + 1),
                dataVencimento: t.dataVencimento || '',
                valor: t.valor || 0,
              }));
            return [pedido.id, parcelasCarregadas] as const;
          }),
        );
        setParcelasByPedidoId(Object.fromEntries(parcelasEntries));

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
  }, [currentUser, tenantId, location.search, vendasVisiveisDeUsuarioId]);

  const dispararImpressao = usePrintAndClose('/pedidos-venda');

  // Mesma logica de PedidoPrint.tsx, so que pro lote inteiro: marca todos
  // como impressos e avisa (uma vez so) quantos ja eram 2a via, antes do
  // dialogo do navegador abrir.
  const handlePrint = async () => {
    const jaImpressos = pedidos.filter((p) => p.impresso === true).length;
    if (jaImpressos > 0) {
      showWarning('2ª via', mensagemSegundaViaLote(jaImpressos));
    }
    try {
      await Promise.all(pedidos.map((p) => (
        updateDoc(doc(db, 'pedidos_venda', p.id), { impresso: true, impressoEm: serverTimestamp() })
      )));
    } catch (error) {
      console.error('Erro ao marcar pedidos como impressos:', error);
    }
    dispararImpressao();
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
          <PedidoPrintModelo
            pedidoData={pedidoData}
            clientData={clientsById[pedidoData.clienteNome] || null}
            configData={configData}
            parcelas={parcelasByPedidoId[pedidoData.id] || []}
          />
        </div>
      ))}
    </div>
  );
};

export default PedidoPrintLote;
