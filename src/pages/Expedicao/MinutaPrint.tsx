import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Printer, ArrowLeft } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { DEFAULT_ORDENAR_MINUTA_POR_LOCAL, ordenarPorLocalizacao } from '../../utils/conferenciaDomain';
import MinutaPrintDocument, { type MinutaItem } from './MinutaPrintDocument';
import '../OS/OsPrint.css'; // Reusing OS print styles, mesmo padrao de PedidoPrint.tsx

const MinutaPrint: React.FC = () => {
  const { pedidoId } = useParams();
  const navigate = useNavigate();
  const { currentUser, tenantId } = useAuth();
  const [pedidoData, setPedidoData] = useState<any>(null);
  const [itens, setItens] = useState<MinutaItem[]>([]);
  const [configData, setConfigData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMinuta = async () => {
      if (!pedidoId || !tenantId) return;
      try {
        const pedidoSnap = await getDoc(doc(db, 'pedidos_venda', pedidoId));
        if (!pedidoSnap.exists()) {
          alert('Pedido não encontrado!');
          navigate('/pedidos-venda');
          return;
        }
        const pedido = { id: pedidoSnap.id, ...pedidoSnap.data() } as any;
        if (pedido.tenantId !== tenantId) {
          alert('Pedido não encontrado!');
          navigate('/pedidos-venda');
          return;
        }
        setPedidoData(pedido);

        let config: any = {};
        if (currentUser) {
          const configSnap = await getDoc(doc(db, 'configuracoes', tenantId));
          if (configSnap.exists()) {
            config = configSnap.data();
            setConfigData(config);
          }
        }

        // Enriquece cada item com localizacaoEstoque/codigo do cadastro --
        // o pedido so guarda id/nome/quantidade (decisao 4 do Modulo 12:
        // nao snapshotar esses campos na venda).
        const itensPedido = Array.isArray(pedido.itens) ? pedido.itens : [];
        const enriquecidos: MinutaItem[] = await Promise.all(
          itensPedido.map(async (item: any): Promise<MinutaItem> => {
            const base: MinutaItem = {
              id: item.id,
              nome: item.nome,
              quantidade: item.quantidade,
              unidadeMedidaSigla: item.unidadeMedidaSigla,
              unidadeMedidaCasasDecimais: item.unidadeMedidaCasasDecimais,
              embalagemId: item.embalagemId,
            };
            if (!item.id || item.id === 'avulso') return base;
            try {
              const estoqueSnap = await getDoc(doc(db, 'estoque', item.id));
              if (estoqueSnap.exists()) {
                const produto = estoqueSnap.data();
                return { ...base, codigo: produto.codigo || '', localizacaoEstoque: produto.localizacaoEstoque || '' };
              }
            } catch (err) {
              console.error('Erro ao buscar dados de estoque do item da minuta:', err);
            }
            return base;
          })
        );

        const ordenarPorLocal = config.ordenarMinutaPorLocal ?? DEFAULT_ORDENAR_MINUTA_POR_LOCAL;
        setItens(ordenarPorLocal ? ordenarPorLocalizacao(enriquecidos) : enriquecidos);
      } catch (error) {
        console.error('Erro ao buscar dados para a minuta:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchMinuta();
  }, [pedidoId, navigate, currentUser, tenantId]);

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-primary)' }}>Carregando minuta de entrega...</div>;
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
          Imprimir Minuta
        </button>
      </div>

      <MinutaPrintDocument pedidoData={pedidoData} itens={itens} configData={configData} />
    </div>
  );
};

export default MinutaPrint;
