import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Receipt } from 'lucide-react';
import { addDoc, collection, doc, getDoc, getDocs, query, serverTimestamp, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showError, showSuccess, showWarning } from '../../utils/alerts';
import { buildDocumentMetadata } from '../../utils/documentMetadata';
import { STATUS_FINALIZADA } from '../../utils/preVendaDomain';
import { emitirNfceDoPedido, NfceEmissaoError, type PedidoParaEmissao } from '../../services/nfceEmissaoService';
import VendedorHeader from './VendedorHeader';
import {
  PAGINA_MEUS_PEDIDOS,
  PERMISSAO_MINHAS_VENDAS,
  filtrarMeusPedidos,
} from '../../utils/meusPedidosMobileDomain';

interface ItemLista {
  id: string;
  tipo: 'Pedido' | 'Orçamento';
  numero: string;
  status: string;
  clienteNome: string;
  valorTotal: number;
  createdAtMillis: number;
}

const formatarMoeda = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const toMillis = (value: unknown): number => {
  const withToMillis = value as { toMillis?: () => number } | undefined;
  return typeof withToMillis?.toMillis === 'function' ? withToMillis.toMillis() : 0;
};

const corStatus = (status: string): string => {
  if (status === 'Finalizada') return '#10b981';
  if (status === 'Cancelada') return '#ef4444';
  if (status === 'Pendente') return '#3b82f6';
  return '#f59e0b';
};

const VendedorMeusPedidos: React.FC = () => {
  const navigate = useNavigate();
  const { tenantId, currentUser, userPermissions, controlaFiscal } = useAuth();
  const [itens, setItens] = useState<ItemLista[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState('');
  const [visiveis, setVisiveis] = useState(PAGINA_MEUS_PEDIDOS);
  const [emitindoId, setEmitindoId] = useState<string | null>(null);

  // "Minhas Vendas" marcada no cadastro do funcionario: aparecem TODAS as
  // vendas dele aqui. Sem ela, so' as dos ultimos 30 dias.
  const temMinhasVendas = userPermissions.includes(PERMISSAO_MINHAS_VENDAS);

  const podeEmitirNota = controlaFiscal && userPermissions.includes('fiscal.emitir');

  useEffect(() => {
    if (!tenantId || !currentUser) return;
    let cancelado = false;
    setCarregando(true);
    setErroCarga('');

    (async () => {
      // Sem orderBy nem limit de proposito: so' igualdade (nao pede indice
      // composto no Firestore) e ordena aqui. A versao anterior pedia
      // orderBy + limit, o indice nao existia, a consulta falhava e o erro era
      // engolido -- a lista aparecia vazia mesmo com vendas gravadas.
      const [pedidosSnap, orcamentosSnap] = await Promise.all([
        getDocs(query(
          collection(db, 'pedidos_venda'),
          where('tenantId', '==', tenantId),
          where('vendedorId', '==', currentUser.uid),
        )).catch((erro) => { console.error('Erro ao carregar meus pedidos:', erro); return null; }),
        getDocs(query(
          collection(db, 'orcamentos'),
          where('tenantId', '==', tenantId),
          where('criadoPor', '==', currentUser.uid),
        )).catch((erro) => { console.error('Erro ao carregar meus orcamentos:', erro); return null; }),
      ]);

      if (cancelado) return;
      if (!pedidosSnap && !orcamentosSnap) {
        setErroCarga('Não foi possível carregar seus pedidos agora. Verifique a internet e tente de novo.');
        setCarregando(false);
        return;
      }

      const doPedidos: ItemLista[] = (pedidosSnap?.docs || []).map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          tipo: 'Pedido' as const,
          numero: data.numeroPedido || '',
          status: data.status || '',
          clienteNome: data.clienteNome || '',
          valorTotal: Number(data.valorTotal || 0),
          createdAtMillis: toMillis(data.createdAt),
        };
      });
      const doOrcamentos: ItemLista[] = (orcamentosSnap?.docs || []).map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          tipo: 'Orçamento' as const,
          numero: data.numeroOrcamento || '',
          status: data.status || '',
          clienteNome: data.clienteNome || '',
          valorTotal: Number(data.valorTotal || 0),
          createdAtMillis: toMillis(data.createdAt),
        };
      });

      setItens([...doPedidos, ...doOrcamentos]);
      setCarregando(false);
    })();

    return () => { cancelado = true; };
  }, [tenantId, currentUser]);

  /**
   * Emite a NFC-e de um pedido que ja virou venda de verdade (status
   * Finalizada -- pre-venda ainda pode mudar de item/estoque, nao emite
   * nota). Confere antes se ja existe nota autorizada pra este pedido
   * (mesma consulta que PedidoVendaForm.tsx faz no desktop) pra nao emitir
   * duas vezes.
   */
  const handleEmitirNota = async (item: ItemLista) => {
    if (!tenantId || emitindoId) return;
    setEmitindoId(item.id);
    try {
      const notasSnap = await getDocs(query(
        collection(db, 'notas_fiscais'),
        where('tenantId', '==', tenantId),
        where('pedidoId', '==', item.id),
      ));
      const jaAutorizada = notasSnap.docs.some((d) => d.data().status === 'authorized');
      if (jaAutorizada) {
        showWarning('Este pedido já tem uma nota fiscal emitida e autorizada.');
        return;
      }

      const pedidoSnap = await getDoc(doc(db, 'pedidos_venda', item.id));
      if (!pedidoSnap.exists()) {
        showError('Pedido não encontrado', 'Este pedido não existe mais.');
        return;
      }
      const pedidoData = pedidoSnap.data();

      const pedido: PedidoParaEmissao = {
        id: pedidoSnap.id,
        tenantId,
        clienteNome: pedidoData.clienteNome || 'CONSUMIDOR FINAL',
        itens: Array.isArray(pedidoData.itens) ? pedidoData.itens : [],
        pagamentos: Array.isArray(pedidoData.pagamentos) ? pedidoData.pagamentos : [],
        valorTotal: Number(pedidoData.valorTotal || 0),
        valorTotalItens: Number(pedidoData.valorTotalItens || 0),
      };

      const { nota, itensFiscais } = await emitirNfceDoPedido(pedido);

      if (currentUser) {
        await addDoc(collection(db, 'notas_fiscais'), {
          spedyId: nota.id,
          number: nota.number,
          accessKey: nota.accessKey || null,
          tipo: 'NFC-e',
          clienteNome: pedido.clienteNome,
          valor: pedido.valorTotal,
          itensFiscais,
          status: nota.status,
          processingMessage: nota.processingDetail?.message || null,
          processingCode: nota.processingDetail?.code || null,
          tenantId,
          createdAt: serverTimestamp(),
          data: new Date().toISOString(),
          pedidoId: pedido.id,
          ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
        });
      }

      if (nota.status === 'authorized') {
        showSuccess('Nota fiscal emitida e autorizada!');
      } else if (['enqueued', 'processing', 'created'].includes(nota.status)) {
        showWarning('Nota enviada, mas a SEFAZ ainda não confirmou. Consulte mais tarde no sistema.');
      } else {
        showError('Nota fiscal rejeitada', nota.processingDetail?.message || 'A SEFAZ rejeitou a nota. Consulte o pedido no sistema.');
      }
    } catch (error) {
      const mensagem = error instanceof NfceEmissaoError
        ? error.message
        : 'Não foi possível emitir a nota fiscal. Tente novamente.';
      showError('Erro ao emitir nota', mensagem);
    } finally {
      setEmitindoId(null);
    }
  };

  const lista = filtrarMeusPedidos(itens, { temMinhasVendas, agoraMillis: Date.now() });
  const listaVisivel = lista.slice(0, visiveis);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-primary)' }}>
      <VendedorHeader titulo="Meus Pedidos" />

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 24px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {carregando ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>Carregando...</div>
        ) : erroCarga ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: '#ef4444', fontSize: '14px' }}>{erroCarga}</div>
        ) : lista.length === 0 ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>
            {temMinhasVendas
              ? 'Você ainda não tem nenhuma venda registrada.'
              : 'Nenhum pedido ou orçamento seu nos últimos 30 dias.'}
          </div>
        ) : (
          listaVisivel.map((item) => {
            const mostraEmitirNota = podeEmitirNota && item.tipo === 'Pedido' && item.status === STATUS_FINALIZADA;
            return (
              <div
                key={`${item.tipo}-${item.id}`}
                style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '14px', borderRadius: '14px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}
              >
                {/* Pedido abre o detalhe (visualizar/imprimir/cancelar). Orcamento
                    ainda nao tem tela de detalhe no app. */}
                <div
                  role={item.tipo === 'Pedido' ? 'button' : undefined}
                  tabIndex={item.tipo === 'Pedido' ? 0 : undefined}
                  onClick={item.tipo === 'Pedido' ? () => navigate(`/vendedor/pedido/${item.id}`) : undefined}
                  onKeyDown={item.tipo === 'Pedido' ? (e) => { if (e.key === 'Enter') navigate(`/vendedor/pedido/${item.id}`); } : undefined}
                  style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: item.tipo === 'Pedido' ? 'pointer' : 'default' }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.clienteNome || 'Sem cliente'}
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '3px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {item.tipo} #{item.numero}
                      <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: corStatus(item.status) }} />
                      <span style={{ color: corStatus(item.status), fontWeight: 600 }}>{item.status}</span>
                    </div>
                  </div>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>{formatarMoeda(item.valorTotal)}</div>
                </div>

                {mostraEmitirNota && (
                  <button
                    type="button"
                    onClick={() => void handleEmitirNota(item)}
                    disabled={emitindoId === item.id}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', height: '40px',
                      borderRadius: '10px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)',
                      color: 'var(--text-primary)', fontSize: '14px', fontWeight: 700,
                      cursor: emitindoId === item.id ? 'default' : 'pointer', opacity: emitindoId === item.id ? 0.7 : 1,
                    }}
                  >
                    <Receipt size={16} />
                    {emitindoId === item.id ? 'Emitindo...' : 'Emitir Nota Fiscal'}
                  </button>
                )}
              </div>
            );
          })
        )}

        {!carregando && !erroCarga && lista.length > listaVisivel.length && (
          <button
            type="button"
            onClick={() => setVisiveis((atual) => atual + PAGINA_MEUS_PEDIDOS)}
            style={{ height: '44px', borderRadius: '12px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}
          >
            Ver mais ({lista.length - listaVisivel.length})
          </button>
        )}
      </div>
    </div>
  );
};

export default VendedorMeusPedidos;
