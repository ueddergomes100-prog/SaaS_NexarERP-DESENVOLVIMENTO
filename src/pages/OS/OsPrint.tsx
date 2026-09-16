import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Printer, ArrowLeft } from 'lucide-react';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { usePrintAndClose } from '../../hooks/usePrintAndClose';
import OsPrintDocument from './OsPrintDocument';
import './OsPrint.css';

const OsPrint: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { currentUser, tenantId } = useAuth();
  const [osData, setOsData] = useState<any>(null);
  const [clientData, setClientData] = useState<any>(null);
  const [vehicleData, setVehicleData] = useState<any>(null);
  const [configData, setConfigData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchOS = async () => {
      if (!id || !tenantId) return;
      try {
        const docRef = doc(db, 'ordens_de_servico', id);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          const data = { id: docSnap.id, ...docSnap.data() } as any;
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

          if (data.placa) {
            const qV = query(
              collection(db, 'veiculos'),
              where('tenantId', '==', tenantId),
              where('placa', '==', data.placa)
            );
            const snapV = await getDocs(qV);
            if (!snapV.empty) {
              setVehicleData(snapV.docs[0].data());
            }
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

  const handlePrint = usePrintAndClose('/os');

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-primary)' }}>Carregando dados para impressão...</div>;
  }

  if (!osData) return null;

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

      <OsPrintDocument osData={osData} clientData={clientData} vehicleData={vehicleData} configData={configData} />
    </div>
  );
};

export default OsPrint;
