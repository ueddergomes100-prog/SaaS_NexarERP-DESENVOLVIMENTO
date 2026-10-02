import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { nomeArquivoRelatorio } from '../../utils/relatorioPdfDomain';
import {
  montarDocumentoVeiculos,
  TITULO_RELATORIO_VEICULOS,
  type VeiculoDoRelatorio,
} from '../../utils/relatorioVeiculosDomain';
import RelatorioPreview, { type DocumentoRelatorioSemEmpresa } from '../../components/Reports/RelatorioPreview';

/*
 * Relatorios Diversos > Veiculos dos clientes. Abre no padrao de relatorio
 * do sistema (PDF na tela, colunas por caixa de marcar). A regra (busca e
 * ordem) mora em relatorioVeiculosDomain.
 */
const PrintRelatorioVeiculos: React.FC = () => {
  const { tenantId } = useAuth();
  const { search } = useLocation();
  const navigate = useNavigate();
  const busca = new URLSearchParams(search).get('search') || '';

  const [veiculos, setVeiculos] = useState<VeiculoDoRelatorio[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelado = false;
    const carregar = async () => {
      if (!tenantId) return;
      setLoading(true);
      setError('');
      try {
        const snapshot = await getDocs(query(collection(db, 'veiculos'), where('tenantId', '==', tenantId)));
        if (cancelado) return;
        setVeiculos(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }) as VeiculoDoRelatorio));
      } catch (erro) {
        console.error('Erro ao buscar veículos:', erro);
        if (!cancelado) setError('Não foi possível carregar os veículos. Verifique sua conexão e tente de novo.');
      } finally {
        if (!cancelado) setLoading(false);
      }
    };
    void carregar();
    return () => { cancelado = true; };
  }, [tenantId]);

  const documento = useMemo<DocumentoRelatorioSemEmpresa | null>(() => (
    loading ? null : montarDocumentoVeiculos(veiculos, busca)
  ), [busca, loading, veiculos]);

  return (
    <div style={{ padding: '20px' }}>
      <RelatorioPreview
        relatorioId="veiculos-clientes"
        documento={documento}
        nomeArquivo={nomeArquivoRelatorio(TITULO_RELATORIO_VEICULOS)}
        onFechar={() => navigate('/relatorios-diversos')}
        carregando={loading}
        erro={error}
      />
    </div>
  );
};

export default PrintRelatorioVeiculos;
