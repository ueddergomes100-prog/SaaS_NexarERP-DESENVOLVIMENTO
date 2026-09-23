import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
import {
  isVendaDoUsuario,
  MENSAGEM_VENDA_DE_OUTRO_USUARIO,
  TITULO_VENDA_DE_OUTRO_USUARIO,
} from '../../utils/visibilidadeVendasDomain';
import { showError, showWarning } from '../../utils/alerts';
import { MENSAGEM_SEGUNDA_VIA_MINUTA, PEDIDO_CAMPO_MINUTA_IMPRESSA, type ViasMinuta } from '../../utils/pedidoImpressaoDomain';
import MinutaPrintDocument, { perguntarViasMinuta, ViasDaMinuta, type MinutaCliente, type MinutaItem } from './MinutaPrintDocument';
import '../OS/OsPrint.css'; // Reusing OS print styles, mesmo padrao de PedidoPrint.tsx

/**
 * Codigo de barras que vai no papel, sempre do CADASTRO do produto (o pedido
 * nao guarda). Item vendido em embalagem imprime o codigo daquela embalagem
 * quando ela tem um; senao o do produto; senao o de qualquer embalagem
 * cadastrada. Sem nenhum, fica em branco -- nunca inventa.
 */
const codigoBarrasDoProduto = (produto: any, embalagemId?: string): string => {
  const embalagens: any[] = Array.isArray(produto.embalagens) ? produto.embalagens : [];
  const daEmbalagem = embalagemId ? embalagens.find((e) => e && e.id === embalagemId)?.codigoBarras : '';
  const qualquerEmbalagem = embalagens.find((e) => e && String(e.codigoBarras || '').trim())?.codigoBarras;
  return String(daEmbalagem || produto.codigoBarras || qualquerEmbalagem || '').trim();
};

const MinutaPrint: React.FC = () => {
  const { pedidoId } = useParams();
  const navigate = useNavigate();
  const { currentUser, tenantId, vendasVisiveisDeUsuarioId } = useAuth();
  const [pedidoData, setPedidoData] = useState<any>(null);
  const [itens, setItens] = useState<MinutaItem[]>([]);
  const [configData, setConfigData] = useState<any>(null);
  const mostrarMarca = (configData?.minutaMostrarMarca ?? DEFAULT_MINUTA_MOSTRAR_MARCA) !== false;
  const mostrarLocal = (configData?.minutaMostrarLocal ?? DEFAULT_MINUTA_MOSTRAR_LOCAL) !== false;
  const [cliente, setCliente] = useState<MinutaCliente | null>(null);
  const [vendedorCodigo, setVendedorCodigo] = useState('');
  const [usuarioNome, setUsuarioNome] = useState('');
  // Fixo enquanto a tela esta aberta: o "Gerado em" do rodape nao pode andar
  // a cada render.
  const [geradoEm] = useState(() => new Date());
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
        // Mesma trava do link direto de PedidoPrint: a minuta lista os
        // itens e o cliente da venda.
        if (vendasVisiveisDeUsuarioId && !isVendaDoUsuario(pedido, vendasVisiveisDeUsuarioId)) {
          showError(TITULO_VENDA_DE_OUTRO_USUARIO, MENSAGEM_VENDA_DE_OUTRO_USUARIO);
          navigate('/expedicao');
          return;
        }
        setPedidoData(pedido);

        // Dados do cliente pro cabecalho (codigo, endereco, contatos, CPF).
        // Pelo id quando a venda guardou; venda antiga so' tem o nome.
        // Cadastro nao achado nao trava a impressao: o cabecalho sai so'
        // com o nome que a venda guardou.
        try {
          if (pedido.clienteId) {
            const clienteSnap = await getDoc(doc(db, 'clientes', pedido.clienteId));
            if (clienteSnap.exists() && clienteSnap.data().tenantId === tenantId) {
              setCliente(clienteSnap.data() as MinutaCliente);
            }
          } else if (pedido.clienteNome) {
            const porNome = await getDocs(query(
              collection(db, 'clientes'),
              where('tenantId', '==', tenantId),
              where('nome', '==', pedido.clienteNome),
            ));
            if (!porNome.empty) setCliente(porNome.docs[0].data() as MinutaCliente);
          }
        } catch (err) {
          console.error('Erro ao buscar o cliente da minuta:', err);
        }

        // Codigo do vendedor ("1 - DAVI JORGE") e nome de quem imprime.
        try {
          if (pedido.vendedorId) {
            const vendedorSnap = await getDoc(doc(db, 'usuarios', pedido.vendedorId));
            if (vendedorSnap.exists() && vendedorSnap.data().tenantId === tenantId) {
              setVendedorCodigo(String(vendedorSnap.data().codigoVendedor || ''));
            }
          }
        } catch (err) {
          console.error('Erro ao buscar o vendedor da minuta:', err);
        }
        try {
          if (currentUser) {
            const perfilSnap = await getDoc(doc(db, 'usuarios', currentUser.uid));
            const perfil = perfilSnap.exists() ? perfilSnap.data() : null;
            setUsuarioNome(String(perfil?.nome || perfil?.nomeResponsavel || currentUser.displayName || currentUser.email || ''));
          }
        } catch (err) {
          console.error('Erro ao buscar o usuario da minuta:', err);
          setUsuarioNome(currentUser?.displayName || currentUser?.email || '');
        }

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
  }, [pedidoId, navigate, currentUser, tenantId, vendasVisiveisDeUsuarioId]);

  const [vias, setVias] = useState<ViasMinuta>(1);

  const handlePrint = async () => {
    const escolhidas = await perguntarViasMinuta();
    if (!escolhidas) return;
    if (pedidoData?.[PEDIDO_CAMPO_MINUTA_IMPRESSA] === true) {
      showWarning('2ª via', MENSAGEM_SEGUNDA_VIA_MINUTA);
    }
    // Marca ANTES do dialogo do navegador (depois nao ha' garantia de rodar).
    if (pedidoId) {
      try {
        await updateDoc(doc(db, 'pedidos_venda', pedidoId), {
          [PEDIDO_CAMPO_MINUTA_IMPRESSA]: true,
          minutaImpressaEm: serverTimestamp(),
        });
      } catch (error) {
        console.error('Erro ao marcar minuta como impressa:', error);
        showWarning('A minuta vai imprimir, mas não foi possível marcá-la como impressa', 'Você talvez não tenha permissão para alterar pedidos.');
      }
    }
    // Renderiza as vias antes de abrir o dialogo de impressao.
    setVias(escolhidas);
    await new Promise((resolve) => setTimeout(resolve, 150));
    window.print();
    setVias(1);
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

      <ViasDaMinuta vias={vias}>
        <MinutaPrintDocument
          pedidoData={pedidoData}
          itens={itens}
          configData={configData}
          cliente={cliente}
          vendedorCodigo={vendedorCodigo}
          usuarioNome={usuarioNome}
          geradoEm={geradoEm}
          mostrarMarca={mostrarMarca}
          mostrarLocal={mostrarLocal}
        />
      </ViasDaMinuta>
    </div>
  );
};

export default MinutaPrint;
