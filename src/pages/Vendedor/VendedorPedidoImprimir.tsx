import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import PedidoPrintDocument from '../Vendas/PedidoPrintDocument';
import PedidoPrintMeiaFolha from '../Vendas/PedidoPrintMeiaFolha';
import { DEFAULT_PEDIDO_PRINT_MODEL } from '../../utils/pedidoPrintModels';
import { parcelasParaImpressao } from '../../utils/parcelasExibicaoDomain';
import { ehPreVenda } from '../../utils/preVendaDomain';
import VendedorImpressaoLayout from './VendedorImpressaoLayout';

/* Mesmo carregamento de PedidoPrint.tsx (desktop), com a trava do app:
 * so' o pedido do proprio vendedor. */
const VendedorPedidoImprimir: React.FC = () => {
  const { id } = useParams();
  const { tenantId, currentUser } = useAuth();
  const [pedidoData, setPedidoData] = useState<any>(null);
  const [clientData, setClientData] = useState<any>(null);
  const [configData, setConfigData] = useState<any>(null);
  const [parcelas, setParcelas] = useState<Array<{ numero: number; dataVencimento: string; valor: number }>>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!id || !tenantId || !currentUser) return;
    let cancelado = false;

    (async () => {
      try {
        const snap = await getDoc(doc(db, 'pedidos_venda', id));
        const data = snap.exists() ? { id: snap.id, ...snap.data() } as Record<string, unknown> : null;
        if (!data || data.tenantId !== tenantId || data.vendedorId !== currentUser.uid) {
          if (!cancelado) setErro('Pedido não encontrado.');
          return;
        }

        const [snapCliente, snapConfig] = await Promise.all([
          getDocs(query(collection(db, 'clientes'), where('tenantId', '==', tenantId), where('nome', '==', data.clienteNome))),
          getDoc(doc(db, 'configuracoes', tenantId)),
        ]);

        // Parcelas so' existem em venda finalizada; pre-venda nao tem. Leitura
        // opcional -- se falhar, a folha sai sem o bloco de parcelas.
        let parcelasCarregadas: Array<{ numero: number; dataVencimento: string; valor: number }> = [];
        try {
          const snapT = await getDocs(query(collection(db, 'transacoes'), where('tenantId', '==', tenantId), where('pedidoId', '==', id)));
          parcelasCarregadas = snapT.docs
            .map((d) => d.data())
            .sort((a, b) => (a.paymentIndex ?? 0) - (b.paymentIndex ?? 0))
            .map((t, index) => ({ numero: t.paymentIndex ?? (index + 1), dataVencimento: t.dataVencimento || '', valor: t.valor || 0 }));
        } catch {
          parcelasCarregadas = [];
        }

        if (cancelado) return;
        setPedidoData(data);
        setClientData(snapCliente.empty ? null : snapCliente.docs[0].data());
        setConfigData(snapConfig.exists() ? snapConfig.data() : null);
        setParcelas(parcelasParaImpressao(parcelasCarregadas, data.pagamentos as never));
      } catch {
        if (!cancelado) setErro('Não foi possível carregar o pedido. Verifique a internet e tente de novo.');
      } finally {
        if (!cancelado) setCarregando(false);
      }
    })();

    return () => { cancelado = true; };
  }, [id, tenantId, currentUser]);

  return (
    <VendedorImpressaoLayout
      rotuloImprimir={pedidoData && ehPreVenda(pedidoData.status) ? 'Imprimir Pré-venda' : 'Imprimir'}
      carregando={carregando}
      erro={erro}
    >
      {pedidoData && ((configData?.modeloImpressaoPedidoVenda || DEFAULT_PEDIDO_PRINT_MODEL) === 'meia-folha' ? (
        <PedidoPrintMeiaFolha pedidoData={pedidoData} clientData={clientData} configData={configData} parcelas={parcelas} />
      ) : (
        <PedidoPrintDocument pedidoData={pedidoData} clientData={clientData} configData={configData} />
      ))}
    </VendedorImpressaoLayout>
  );
};

export default VendedorPedidoImprimir;
