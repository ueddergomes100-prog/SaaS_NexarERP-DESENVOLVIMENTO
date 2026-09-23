import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Printer, ArrowLeft } from 'lucide-react';
import { doc, getDoc, updateDoc, serverTimestamp, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import PedidoPrintModelo from './PedidoPrintModelo';
import {
  isVendaDoUsuario,
  MENSAGEM_VENDA_DE_OUTRO_USUARIO,
  TITULO_VENDA_DE_OUTRO_USUARIO,
} from '../../utils/visibilidadeVendasDomain';
import { showError, showWarning } from '../../utils/alerts';
import { parcelasParaImpressao } from '../../utils/parcelasExibicaoDomain';
import { ehPreVenda } from '../../utils/preVendaDomain';
import { MENSAGEM_SEGUNDA_VIA } from '../../utils/pedidoImpressaoDomain';
import { usePrintAndClose } from '../../hooks/usePrintAndClose';
import '../OS/OsPrint.css'; // Reusing OS print styles

const PedidoPrint: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { currentUser, tenantId, vendasVisiveisDeUsuarioId } = useAuth();
  const [pedidoData, setPedidoData] = useState<any>(null);
  const [clientData, setClientData] = useState<any>(null);
  const [configData, setConfigData] = useState<any>(null);
  const [parcelas, setParcelas] = useState<Array<{ numero: number; dataVencimento: string; valor: number }>>([]);
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

          // Parcelas do pedido -- gravadas em documentos separados na
          // colecao 'transacoes', usadas so pelo modelo meia-folha.
          const qT = query(
            collection(db, 'transacoes'),
            where('tenantId', '==', tenantId),
            where('pedidoId', '==', id),
          );
          const snapT = await getDocs(qT);
          const parcelasCarregadas = snapT.docs
            .map((docT) => docT.data())
            .sort((a, b) => (a.paymentIndex ?? 0) - (b.paymentIndex ?? 0))
            .map((t, index) => ({
              // paymentIndex ja nasce base-1 (ver 'indice' em financeDomain.ts)
              // -- somar +1 aqui duplicava a conta e mostrava "PARC 2" pra
              // pagamento unico.
              numero: t.paymentIndex ?? (index + 1),
              dataVencimento: t.dataVencimento || '',
              valor: t.valor || 0,
            }));
          // O financeiro manda: se a venda gerou mais de uma transacao, essas
          // sao as parcelas de verdade. A divisao so entra no cartao
          // simplificado, que tem transacao unica e parcelamento informado so
          // pra constar no papel. Ver parcelasExibicaoDomain.ts.
          setParcelas(parcelasParaImpressao(parcelasCarregadas, data.pagamentos));
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

  const dispararImpressao = usePrintAndClose('/pedidos-venda');

  // Marca o pedido como impresso ANTES de abrir o dialogo de impressao (nao
  // depois): usePrintAndClose fecha a aba assim que o dialogo fecha, entao
  // gravar depois nunca chegaria a rodar. Aviso de 2a via primeiro, pra
  // quem imprime de novo por engano ainda ver o texto antes do dialogo do
  // navegador tomar a tela.
  const handlePrint = async () => {
    if (pedidoData?.impresso === true) {
      showWarning('2ª via', MENSAGEM_SEGUNDA_VIA);
    }
    if (id) {
      try {
        await updateDoc(doc(db, 'pedidos_venda', id), { impresso: true, impressoEm: serverTimestamp() });
      } catch (error) {
        // Nao bloqueia a impressao por causa disso -- so a marcacao falhou.
        console.error('Erro ao marcar pedido como impresso:', error);
      }
    }
    dispararImpressao();
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
          {ehPreVenda(pedidoData.status) ? 'Imprimir Pré-venda' : 'Imprimir Recibo'}
        </button>
      </div>

      <PedidoPrintModelo pedidoData={pedidoData} clientData={clientData} configData={configData} parcelas={parcelas} />
    </div>
  );
};

export default PedidoPrint;
