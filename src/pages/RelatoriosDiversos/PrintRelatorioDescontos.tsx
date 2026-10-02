import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { nomeArquivoRelatorio } from '../../utils/relatorioPdfDomain';
import { montarDocumentoDescontos, type FontesRelatorioDescontos } from '../../utils/relatorioDescontosDomain';
import RelatorioPreview, { type DocumentoRelatorioSemEmpresa } from '../../components/Reports/RelatorioPreview';

const VAZIO: FontesRelatorioDescontos = { pedidos: [], ordens: [], orcamentos: [] };

/*
 * Relatorios Diversos > Descontos concedidos. Abre no padrao de relatorio do
 * sistema (PDF na tela, colunas por caixa de marcar). Periodo, visibilidade
 * de vendas e totais moram em relatorioDescontosDomain.
 */
const PrintRelatorioDescontos: React.FC = () => {
  const { search } = useLocation();
  const navigate = useNavigate();
  const { tenantId, currentUser, vendasVisiveisDeUsuarioId } = useAuth();

  const params = new URLSearchParams(search);
  const inicio = params.get('inicio') || '';
  const fim = params.get('fim') || '';
  const periodoInvalido = !inicio || !fim || inicio > fim;

  const [fontes, setFontes] = useState<FontesRelatorioDescontos>(VAZIO);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelado = false;
    const carregar = async () => {
      if (!currentUser || !tenantId) return;
      setLoading(true);
      setError('');
      try {
        const doTenant = (nome: string) => getDocs(query(collection(db, nome), where('tenantId', '==', tenantId)));
        const [pedidosSnap, osSnap, orcamentosSnap] = await Promise.all([
          doTenant('pedidos_venda'),
          doTenant('ordens_de_servico'),
          doTenant('orcamentos'),
        ]);
        if (cancelado) return;
        const lista = (snap: typeof pedidosSnap) => snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        setFontes({ pedidos: lista(pedidosSnap), ordens: lista(osSnap), orcamentos: lista(orcamentosSnap) });
      } catch (erro) {
        console.error('Erro ao buscar relatório de descontos concedidos:', erro);
        if (!cancelado) setError('Não foi possível carregar os descontos concedidos. Verifique sua conexão e tente de novo.');
      } finally {
        if (!cancelado) setLoading(false);
      }
    };
    void carregar();
    return () => { cancelado = true; };
  }, [currentUser, tenantId]);

  const titulo = 'Descontos Concedidos';

  const documento = useMemo<DocumentoRelatorioSemEmpresa | null>(() => (
    loading ? null : montarDocumentoDescontos(fontes, { inicio, fim, vendasVisiveisDeUsuarioId })
  ), [fim, fontes, inicio, loading, vendasVisiveisDeUsuarioId]);

  return (
    <div style={{ padding: '20px' }}>
      <RelatorioPreview
        relatorioId="descontos"
        documento={periodoInvalido ? null : documento}
        nomeArquivo={nomeArquivoRelatorio(titulo, inicio, fim)}
        onFechar={() => navigate('/relatorios-diversos')}
        carregando={loading}
        erro={periodoInvalido ? 'Período inválido: volte e confira a data inicial e a data final.' : error}
      />
    </div>
  );
};

export default PrintRelatorioDescontos;
