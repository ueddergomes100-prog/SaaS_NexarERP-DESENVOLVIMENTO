import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { DEFAULT_MINUTA_MOSTRAR_LOCAL, DEFAULT_MINUTA_MOSTRAR_MARCA } from '../../utils/conferenciaDomain';
import MinutaPrintDocument from '../Expedicao/MinutaPrintDocument';
import { montarMinutaDeTroca, nomeDoUsuarioLogado, type MinutaTrocaMontada } from './minutaTrocaLoader';
import '../OS/OsPrint.css';

/**
 * Minuta de entrega da TROCA: o mesmo papel da minuta de venda (separacao e
 * entrega, sem valores), com o titulo "MINUTA DE TROCA — SEM COBRANÇA" e a
 * condicao "SEM COBRANÇA", pro entregador nao cobrar nada.
 *
 * Varias de uma vez: TrocaMinutaPrintLote (mesma montagem, minutaTrocaLoader).
 */
const TrocaMinutaPrint: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { currentUser, tenantId } = useAuth();
  const [minuta, setMinuta] = useState<MinutaTrocaMontada | null>(null);
  const [configData, setConfigData] = useState<Record<string, unknown> | null>(null);
  const [usuarioNome, setUsuarioNome] = useState('');
  const [geradoEm] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const mostrarMarca = (configData?.minutaMostrarMarca ?? DEFAULT_MINUTA_MOSTRAR_MARCA) !== false;
  const mostrarLocal = (configData?.minutaMostrarLocal ?? DEFAULT_MINUTA_MOSTRAR_LOCAL) !== false;

  useEffect(() => {
    const carregar = async () => {
      if (!id || !tenantId) return;
      try {
        const snap = await getDoc(doc(db, 'trocas', id));
        if (!snap.exists() || snap.data().tenantId !== tenantId) {
          alert('Troca não encontrada!');
          navigate('/vendas/trocas');
          return;
        }
        const troca = { id: snap.id, ...snap.data() } as Record<string, any> & { id: string };

        let config: Record<string, any> = {};
        const configSnap = await getDoc(doc(db, 'configuracoes', tenantId));
        if (configSnap.exists()) {
          config = configSnap.data();
          setConfigData(config);
        }
        if (currentUser) {
          setUsuarioNome(await nomeDoUsuarioLogado(currentUser.uid, currentUser.displayName || currentUser.email || ''));
        }
        setMinuta(await montarMinutaDeTroca({ troca, tenantId, config }));
      } catch (error) {
        console.error('Erro ao buscar dados para a minuta de troca:', error);
      } finally {
        setLoading(false);
      }
    };
    void carregar();
  }, [id, navigate, currentUser, tenantId]);

  if (loading) return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-primary)' }}>Carregando minuta de troca...</div>;
  if (!minuta) return null;

  return (
    <div className="print-layout-wrapper">
      <div className="print-actions no-print">
        <button className="btn-secondary" onClick={() => navigate(`/vendas/trocas/${id}`)}>
          <ArrowLeft size={18} style={{ marginRight: 8 }} />
          Voltar
        </button>
        <button className="btn-primary" onClick={() => window.print()}>
          <Printer size={18} style={{ marginRight: 8 }} />
          Imprimir Minuta de Troca
        </button>
      </div>

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
  );
};

export default TrocaMinutaPrint;
