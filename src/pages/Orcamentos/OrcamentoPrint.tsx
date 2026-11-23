import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Printer, ArrowLeft } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { buscarClienteDoDocumento } from '../../services/clienteDoDocumentoService';
import { useAuth } from '../../contexts/AuthContext';
import { usePrintAndClose } from '../../hooks/usePrintAndClose';
import OrcamentoPrintDocument from './OrcamentoPrintDocument';
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

          // Cadastro do cliente pelo id que o orcamento guardou -- pelo nome
          // saia o homonimo errado (clienteDoDocumentoDomain.ts, 23/11/2026).
          const cliente = await buscarClienteDoDocumento(tenantId, orcData);
          if (cliente) setClientData(cliente);
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

  const handlePrint = usePrintAndClose('/orcamentos');

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-primary)' }}>Carregando dados para impressão...</div>;
  }

  if (!data) return null;

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

      <OrcamentoPrintDocument data={data} clientData={clientData} configData={configData} />
    </div>
  );
};

export default OrcamentoPrint;
