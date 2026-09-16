import React, { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import OsPrintDocument from '../OS/OsPrintDocument';
import VendedorImpressaoLayout from './VendedorImpressaoLayout';

/* Mesmo carregamento de OsPrint.tsx (desktop): OS + cliente + veiculo +
 * configuracao da empresa, e a mesma folha (OsPrintDocument). */
const VendedorOsImprimir: React.FC = () => {
  const { id } = useParams();
  const { tenantId, userPermissions } = useAuth();
  const [dados, setDados] = useState<{ osData: any; clientData: any; vehicleData: any; configData: any } | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!id || !tenantId) return;
    let cancelado = false;

    (async () => {
      try {
        const snap = await getDoc(doc(db, 'ordens_de_servico', id));
        const osData = snap.exists() ? { id: snap.id, ...snap.data() } as Record<string, unknown> : null;
        if (!osData || osData.tenantId !== tenantId) {
          if (!cancelado) setErro('Ordem de serviço não encontrada.');
          return;
        }

        const [snapCliente, snapVeiculo, snapConfig] = await Promise.all([
          getDocs(query(collection(db, 'clientes'), where('tenantId', '==', tenantId), where('nome', '==', osData.clienteNome))),
          osData.placa
            ? getDocs(query(collection(db, 'veiculos'), where('tenantId', '==', tenantId), where('placa', '==', osData.placa)))
            : Promise.resolve(null),
          getDoc(doc(db, 'configuracoes', tenantId)),
        ]);

        if (cancelado) return;
        setDados({
          osData,
          clientData: snapCliente.empty ? null : snapCliente.docs[0].data(),
          vehicleData: snapVeiculo && !snapVeiculo.empty ? snapVeiculo.docs[0].data() : null,
          configData: snapConfig.exists() ? snapConfig.data() : null,
        });
      } catch {
        if (!cancelado) setErro('Não foi possível carregar a ordem de serviço. Verifique a internet e tente de novo.');
      } finally {
        if (!cancelado) setCarregando(false);
      }
    })();

    return () => { cancelado = true; };
  }, [id, tenantId]);

  if (!userPermissions.includes('mecanica.os')) {
    return <Navigate to="/vendedor" replace />;
  }

  return (
    <VendedorImpressaoLayout rotuloImprimir="Imprimir OS" carregando={carregando} erro={erro}>
      {dados && (
        <OsPrintDocument osData={dados.osData} clientData={dados.clientData} vehicleData={dados.vehicleData} configData={dados.configData} />
      )}
    </VendedorImpressaoLayout>
  );
};

export default VendedorOsImprimir;
