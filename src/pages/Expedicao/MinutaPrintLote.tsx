import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Printer, ArrowLeft } from 'lucide-react';
import { collection, doc, getDoc, getDocs, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import {
  DEFAULT_MINUTA_MOSTRAR_LOCAL,
  DEFAULT_MINUTA_MOSTRAR_MARCA,
  DEFAULT_ORDENAR_MINUTA_POR_LOCAL,
  ordenarPorLocalizacao,
} from '../../utils/conferenciaDomain';
import { filtrarVendasVisiveis } from '../../utils/visibilidadeVendasDomain';
import { usePrintAndClose } from '../../hooks/usePrintAndClose';
import { PEDIDO_PRINT_LOTE_SAFETY_LIMIT } from '../Vendas/pedidoPrintLoteConstants';
import { showWarning } from '../../utils/alerts';
import { mensagemSegundaViaMinutaLote, PEDIDO_CAMPO_MINUTA_IMPRESSA, type ViasMinuta } from '../../utils/pedidoImpressaoDomain';
import MinutaPrintDocument, { perguntarViasMinuta, ViasDaMinuta, type MinutaCliente, type MinutaItem } from './MinutaPrintDocument';
import '../OS/OsPrint.css'; // Reusing OS print styles
import '../Vendas/PedidoPrintLote.css'; // .print-batch-item (quebra de pagina por item)

/**
 * Minuta de Entrega em LOTE -- mesma logica de MinutaPrint.tsx (Fatia 2),
 * so que repetida pra cada pedido selecionado em Pedidos de Venda >
 * "Imprimir Selecionados" > Minuta de Entrega. Nao reaproveita o componente
 * de pagina inteira MinutaPrint.tsx (ele so aceita 1 :pedidoId na rota) --
 * so o MinutaPrintDocument, que ja e a peca puramente visual.
 */
const codigoBarrasDoProduto = (produto: any, embalagemId?: string): string => {
  const embalagens: any[] = Array.isArray(produto.embalagens) ? produto.embalagens : [];
  const daEmbalagem = embalagemId ? embalagens.find((e) => e && e.id === embalagemId)?.codigoBarras : '';
  const qualquerEmbalagem = embalagens.find((e) => e && String(e.codigoBarras || '').trim())?.codigoBarras;
  return String(daEmbalagem || produto.codigoBarras || qualquerEmbalagem || '').trim();
};

interface MinutaLoteEntry {
  pedidoData: any;
  itens: MinutaItem[];
  cliente: MinutaCliente | null;
  vendedorCodigo: string;
}

const MinutaPrintLote: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser, tenantId, vendasVisiveisDeUsuarioId } = useAuth();
  const [entradas, setEntradas] = useState<MinutaLoteEntry[]>([]);
  const [configData, setConfigData] = useState<any>(null);
  const [usuarioNome, setUsuarioNome] = useState('');
  const [geradoEm] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [truncated, setTruncated] = useState(false);

  const mostrarMarca = (configData?.minutaMostrarMarca ?? DEFAULT_MINUTA_MOSTRAR_MARCA) !== false;
  const mostrarLocal = (configData?.minutaMostrarLocal ?? DEFAULT_MINUTA_MOSTRAR_LOCAL) !== false;

  const queryParams = new URLSearchParams(location.search);
  const ids = (queryParams.get('ids') || '').split(',').map((id) => id.trim()).filter(Boolean);
  const idsToLoad = ids.slice(0, PEDIDO_PRINT_LOTE_SAFETY_LIMIT);

  useEffect(() => {
    const fetchLote = async () => {
      if (!currentUser || !tenantId || idsToLoad.length === 0) {
        setLoading(false);
        return;
      }
      try {
        setTruncated(ids.length > idsToLoad.length);

        let config: any = {};
        const configSnap = await getDoc(doc(db, 'configuracoes', tenantId));
        if (configSnap.exists()) {
          config = configSnap.data();
          setConfigData(config);
        }

        const perfilSnap = await getDoc(doc(db, 'usuarios', currentUser.uid));
        const perfil = perfilSnap.exists() ? perfilSnap.data() : null;
        setUsuarioNome(String(perfil?.nome || perfil?.nomeResponsavel || currentUser.displayName || currentUser.email || ''));

        const pedidoDocs = await Promise.all(idsToLoad.map((id) => getDoc(doc(db, 'pedidos_venda', id))));
        const pedidosCarregados = filtrarVendasVisiveis(
          pedidoDocs
            .filter((snap) => snap.exists() && snap.data()!.tenantId === tenantId)
            .map((snap) => ({ id: snap.id, ...snap.data() } as any)),
          vendasVisiveisDeUsuarioId,
        );

        const ordenarPorLocal = config.ordenarMinutaPorLocal ?? DEFAULT_ORDENAR_MINUTA_POR_LOCAL;

        const montadas = await Promise.all(pedidosCarregados.map(async (pedido): Promise<MinutaLoteEntry> => {
          let cliente: MinutaCliente | null = null;
          try {
            if (pedido.clienteId) {
              const clienteSnap = await getDoc(doc(db, 'clientes', pedido.clienteId));
              if (clienteSnap.exists() && clienteSnap.data().tenantId === tenantId) {
                cliente = clienteSnap.data() as MinutaCliente;
              }
            } else if (pedido.clienteNome) {
              const porNome = await getDocs(query(
                collection(db, 'clientes'),
                where('tenantId', '==', tenantId),
                where('nome', '==', pedido.clienteNome),
              ));
              if (!porNome.empty) cliente = porNome.docs[0].data() as MinutaCliente;
            }
          } catch (err) {
            console.error('Erro ao buscar o cliente da minuta:', err);
          }

          let vendedorCodigo = '';
          try {
            if (pedido.vendedorId) {
              const vendedorSnap = await getDoc(doc(db, 'usuarios', pedido.vendedorId));
              if (vendedorSnap.exists() && vendedorSnap.data().tenantId === tenantId) {
                vendedorCodigo = String(vendedorSnap.data().codigoVendedor || '');
              }
            }
          } catch (err) {
            console.error('Erro ao buscar o vendedor da minuta:', err);
          }

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
                  return {
                    ...base,
                    codigo: produto.codigo || '',
                    codigoBarras: codigoBarrasDoProduto(produto, item.embalagemId),
                    marca: produto.marca || '',
                    localizacaoEstoque: produto.localizacaoEstoque || '',
                  };
                }
              } catch (err) {
                console.error('Erro ao buscar dados de estoque do item da minuta:', err);
              }
              return base;
            }),
          );

          return {
            pedidoData: pedido,
            itens: ordenarPorLocal ? ordenarPorLocalizacao(enriquecidos) : enriquecidos,
            cliente,
            vendedorCodigo,
          };
        }));

        setEntradas(montadas);
      } catch (error) {
        console.error('Erro ao buscar pedidos para a minuta em lote:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchLote();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, tenantId, location.search, vendasVisiveisDeUsuarioId]);

  const dispararImpressao = usePrintAndClose('/pedidos-venda');
  const [vias, setVias] = useState<ViasMinuta>(1);

  const handlePrint = async () => {
    const escolhidas = await perguntarViasMinuta();
    if (!escolhidas) return;
    const jaImpressas = entradas.filter((e) => e.pedidoData[PEDIDO_CAMPO_MINUTA_IMPRESSA] === true).length;
    if (jaImpressas > 0) showWarning('2ª via', mensagemSegundaViaMinutaLote(jaImpressas));
    try {
      await Promise.all(entradas.map((e) => updateDoc(doc(db, 'pedidos_venda', e.pedidoData.id), {
        [PEDIDO_CAMPO_MINUTA_IMPRESSA]: true,
        minutaImpressaEm: serverTimestamp(),
      })));
    } catch (error) {
      console.error('Erro ao marcar minutas como impressas:', error);
      showWarning('As minutas vão imprimir, mas não foi possível marcá-las como impressas', 'Você talvez não tenha permissão para alterar pedidos.');
    }
    setVias(escolhidas);
    await new Promise((resolve) => setTimeout(resolve, 150));
    dispararImpressao();
  };

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-primary)' }}>Carregando minutas...</div>;
  }

  if (entradas.length === 0) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-primary)' }}>
        <p>Nenhum pedido encontrado para a minuta.</p>
        <button className="btn-secondary" onClick={() => navigate('/pedidos-venda')} style={{ marginTop: '16px' }}>
          <ArrowLeft size={18} style={{ marginRight: 8 }} />
          Voltar
        </button>
      </div>
    );
  }

  return (
    <div className="print-layout-wrapper">
      <div className="print-actions no-print">
        <button className="btn-secondary" onClick={() => navigate('/pedidos-venda')}>
          <ArrowLeft size={18} style={{ marginRight: 8 }} />
          Voltar
        </button>
        <span style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
          {entradas.length} {entradas.length === 1 ? 'minuta' : 'minutas'}
          {truncated ? ` (limite de ${PEDIDO_PRINT_LOTE_SAFETY_LIMIT} por vez aplicado)` : ''}
        </span>
        <button className="btn-primary" onClick={handlePrint}>
          <Printer size={18} style={{ marginRight: 8 }} />
          Imprimir {entradas.length > 1 ? 'Todas' : 'Minuta'}
        </button>
      </div>

      {entradas.map((entrada) => (
        <div className="print-batch-item" key={entrada.pedidoData.id}>
          <ViasDaMinuta vias={vias}>
            <MinutaPrintDocument
              pedidoData={entrada.pedidoData}
              itens={entrada.itens}
              configData={configData}
              cliente={entrada.cliente}
              vendedorCodigo={entrada.vendedorCodigo}
              usuarioNome={usuarioNome}
              geradoEm={geradoEm}
              mostrarMarca={mostrarMarca}
              mostrarLocal={mostrarLocal}
            />
          </ViasDaMinuta>
        </div>
      ))}
    </div>
  );
};

export default MinutaPrintLote;
