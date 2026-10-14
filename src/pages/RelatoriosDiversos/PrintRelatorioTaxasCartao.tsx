import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { collection, query, where } from 'firebase/firestore';
import { lerComReserva } from '../../services/consultaComReserva';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { nomeArquivoRelatorio } from '../../utils/relatorioPdfDomain';
import { montarDocumentoTaxasCartao, type TransacaoCartao } from '../../utils/relatorioTaxasCartaoDomain';
import RelatorioPreview, { type DocumentoRelatorioSemEmpresa } from '../../components/Reports/RelatorioPreview';

/*
 * Relatorios Diversos > Taxas de cartao. Abre no padrao de relatorio do
 * sistema (PDF na tela, colunas por caixa de marcar). A soma por bandeira
 * mora em relatorioTaxasCartaoDomain.
 */
const PrintRelatorioTaxasCartao: React.FC = () => {
  const { search } = useLocation();
  const navigate = useNavigate();
  const { tenantId, currentUser } = useAuth();

  const params = new URLSearchParams(search);
  const inicio = params.get('inicio') || '';
  const fim = params.get('fim') || '';
  const periodoInvalido = !inicio || !fim || inicio > fim;

  const [transacoes, setTransacoes] = useState<TransacaoCartao[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelado = false;
    const carregar = async () => {
      if (!currentUser || !tenantId || periodoInvalido) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError('');
      try {
        // So' os lancamentos do periodo (otimizacao de leituras, 2026-10-14) --
        // antes lia TODAS as transacoes da empresa. O relatorio continua
        // cortando: a reserva (sem indice) traz todas.
        const todas = query(collection(db, 'transacoes'), where('tenantId', '==', tenantId));
        const snapshot = await lerComReserva(
          query(todas, where('data', '>=', inicio), where('data', '<=', fim)),
          todas,
          'Taxas de cartão (período)',
        );
        if (cancelado) return;
        setTransacoes(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }) as TransacaoCartao));
      } catch (erro) {
        console.error('Erro ao buscar relatório de taxas de cartão:', erro);
        if (!cancelado) setError('Não foi possível carregar as taxas de cartão. Verifique sua conexão e tente de novo.');
      } finally {
        if (!cancelado) setLoading(false);
      }
    };
    void carregar();
    return () => { cancelado = true; };
  }, [currentUser, tenantId, inicio, fim, periodoInvalido]);

  const titulo = 'Taxas Pagas às Administradoras';

  const documento = useMemo<DocumentoRelatorioSemEmpresa | null>(() => (
    loading ? null : montarDocumentoTaxasCartao(transacoes, inicio, fim)
  ), [fim, inicio, loading, transacoes]);

  return (
    <div style={{ padding: '20px' }}>
      <RelatorioPreview
        relatorioId="taxas-cartao"
        documento={periodoInvalido ? null : documento}
        nomeArquivo={nomeArquivoRelatorio(titulo, inicio, fim)}
        onFechar={() => navigate('/relatorios-diversos')}
        carregando={loading}
        erro={periodoInvalido ? 'Período inválido: volte e confira a data inicial e a data final.' : error}
      />
    </div>
  );
};

export default PrintRelatorioTaxasCartao;
