import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { DEFAULT_MINUTA_MOSTRAR_LOCAL, DEFAULT_MINUTA_MOSTRAR_MARCA } from '../../utils/conferenciaDomain';
import { usePrintAndClose } from '../../hooks/usePrintAndClose';
import MinutaPrintDocument from '../Expedicao/MinutaPrintDocument';
import { PEDIDO_PRINT_LOTE_SAFETY_LIMIT } from '../Vendas/pedidoPrintLoteConstants';
import { montarMinutaDeTroca, nomeDoUsuarioLogado, type MinutaTrocaMontada } from './minutaTrocaLoader';
import '../OS/OsPrint.css';
import '../Vendas/PedidoPrintLote.css'; // .print-batch-item (quebra de pagina por minuta)

/**
 * Minutas de TROCA em LOTE (pedido da Shopping Rural, 24/09/2026: "nao tem a
 * opcao de imprimir tudo de uma vez"). Abre pela lista de Trocas, com as
 * selecionadas em ?ids=a,b,c. Cada troca sai numa folha propria, do mesmo
 * jeito da minuta individual (TrocaMinutaPrint) -- a montagem e' a mesma,
 * vem de minutaTrocaLoader.
 */
const TrocaMinutaPrintLote: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser, tenantId } = useAuth();
  const [minutas, setMinutas] = useState<MinutaTrocaMontada[]>([]);
  const [configData, setConfigData] = useState<Record<string, unknown> | null>(null);
  const [usuarioNome, setUsuarioNome] = useState('');
  const [geradoEm] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [truncated, setTruncated] = useState(false);
  const [naoEncontradas, setNaoEncontradas] = useState(0);
  const dispararImpressao = usePrintAndClose('/vendas/trocas');

  const mostrarMarca = (configData?.minutaMostrarMarca ?? DEFAULT_MINUTA_MOSTRAR_MARCA) !== false;
  const mostrarLocal = (configData?.minutaMostrarLocal ?? DEFAULT_MINUTA_MOSTRAR_LOCAL) !== false;

  useEffect(() => {
    const ids = (new URLSearchParams(location.search).get('ids') || '').split(',').map((id) => id.trim()).filter(Boolean);
    const idsParaCarregar = ids.slice(0, PEDIDO_PRINT_LOTE_SAFETY_LIMIT);

    const carregar = async () => {
      if (!currentUser || !tenantId || idsParaCarregar.length === 0) {
        setLoading(false);
        return;
      }
      try {
        setTruncated(ids.length > idsParaCarregar.length);
        let config: Record<string, any> = {};
        const configSnap = await getDoc(doc(db, 'configuracoes', tenantId));
        if (configSnap.exists()) {
          config = configSnap.data();
          setConfigData(config);
        }
        setUsuarioNome(await nomeDoUsuarioLogado(currentUser.uid, currentUser.displayName || currentUser.email || ''));

        const snaps = await Promise.all(idsParaCarregar.map((id) => getDoc(doc(db, 'trocas', id))));
        const trocas = snaps
          .filter((snap) => snap.exists() && snap.data()?.tenantId === tenantId)
          .map((snap) => ({ id: snap.id, ...snap.data() } as Record<string, any> & { id: string }));
        setNaoEncontradas(idsParaCarregar.length - trocas.length);
        setMinutas(await Promise.all(trocas.map((troca) => montarMinutaDeTroca({ troca, tenantId, config }))));
      } catch (error) {
        console.error('Erro ao buscar as trocas para a minuta em lote:', error);
      } finally {
        setLoading(false);
      }
    };
    void carregar();
  }, [currentUser, tenantId, location.search]);

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-primary)' }}>Carregando minutas de troca...</div>;
  }

  if (minutas.length === 0) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-primary)' }}>
        <p>Nenhuma troca encontrada para imprimir. Volte à lista e selecione as trocas de novo.</p>
        <button className="btn-secondary" onClick={() => navigate('/vendas/trocas')} style={{ marginTop: '16px' }}>
          <ArrowLeft size={18} style={{ marginRight: 8 }} />
          Voltar
        </button>
      </div>
    );
  }

  return (
    <div className="print-layout-wrapper">
      <div className="print-actions no-print">
        <button className="btn-secondary" onClick={() => navigate('/vendas/trocas')}>
          <ArrowLeft size={18} style={{ marginRight: 8 }} />
          Voltar
        </button>
        <span style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
          {minutas.length} {minutas.length === 1 ? 'minuta' : 'minutas'} de troca
          {truncated ? ` (limite de ${PEDIDO_PRINT_LOTE_SAFETY_LIMIT} por vez aplicado)` : ''}
          {naoEncontradas > 0 ? ` — ${naoEncontradas} não encontrada(s)` : ''}
        </span>
        <button className="btn-primary" onClick={dispararImpressao}>
          <Printer size={18} style={{ marginRight: 8 }} />
          Imprimir {minutas.length > 1 ? 'Todas' : 'Minuta'}
        </button>
      </div>

      {minutas.map((minuta) => (
        <div className="print-batch-item" key={String(minuta.trocaData.id)}>
          <MinutaPrintDocument
            pedidoData={minuta.trocaData}
            itens={minuta.itens}
            configData={configData}
            cliente={minuta.cliente}
            vendedorCodigo={minuta.vendedorCodigo}
            usuarioNome={usuarioNome}
            geradoEm={geradoEm}
            mostrarMarca={mostrarMarca}
            mostrarLocal={mostrarLocal}
            titulo="MINUTA DE TROCA — SEM COBRANÇA"
            rotuloNumero="Troca"
            operacao="TROCA"
            condicaoPagto="SEM COBRANÇA"
          />
        </div>
      ))}
    </div>
  );
};

export default TrocaMinutaPrintLote;
