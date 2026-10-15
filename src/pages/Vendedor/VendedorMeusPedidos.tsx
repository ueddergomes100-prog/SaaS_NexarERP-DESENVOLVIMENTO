import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, Receipt } from 'lucide-react';
import { addDoc, collection, doc, getDoc, getDocs, query, serverTimestamp, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showError, showSuccess, showWarning } from '../../utils/alerts';
import { buildDocumentMetadata } from '../../utils/documentMetadata';
import { STATUS_FINALIZADA } from '../../utils/preVendaDomain';
import { emitirNfceDoPedido, NfceEmissaoError, type PedidoParaEmissao } from '../../services/nfceEmissaoService';
import { spedyService } from '../../services/spedyService';
import { nomeArquivoDocumento, numeroDaNota } from '../../utils/nomeArquivoDomain';
import { STATUS_NOTA_EM_TRANSMISSAO } from '../../utils/cancelamentoNotaVendaDomain';
import { compartilharOuBaixarPdf } from './folhaParaPdf';
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

/** Nota da venda mostrada na lista (15/10/2026): a que vale, autorizada > aguardando > as outras. */
interface NotaDoPedido { spedyId: string; tipo: string; status: string; number: number | string | null }

const prioridadeDaNota = (status: string) => (status === 'authorized' ? 0 : STATUS_NOTA_EM_TRANSMISSAO.includes(status) ? 1 : 2);
const LIMITE_DO_IN = 30;

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
  // Notas dos pedidos da lista (15/10/2026): com nota autorizada o botao vira
  // "Visualizar Nota Fiscal" -- antes "Emitir" aparecia em toda venda finalizada.
  const [notasPorPedido, setNotasPorPedido] = useState<Record<string, NotaDoPedido>>({});
  const [abrindoNotaId, setAbrindoNotaId] = useState<string | null>(null);
  const pdfProntoRef = React.useRef<Record<string, Blob>>({});
  // "Agora" e' fixado quando a lista carrega (nao a cada render): a janela
  // de 30 dias e' decidida uma vez por carga, e a renderizacao fica pura.
  const [agoraMillis, setAgoraMillis] = useState(0);

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
      setAgoraMillis(Date.now());
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
      const daVenda = notasSnap.docs.map((d) => d.data()).filter((n) => n.finalidade !== 'devolucao');
      if (daVenda.some((n) => n.status === 'authorized')) {
        showWarning('Este pedido já tem uma nota fiscal emitida e autorizada.');
        return;
      }
      // Nota que ainda aguarda a SEFAZ tambem barra: emitir de novo duplicaria a nota.
      if (daVenda.some((n) => STATUS_NOTA_EM_TRANSMISSAO.includes(String(n.status)))) {
        showWarning('A nota deste pedido ainda está aguardando a SEFAZ. Espere a resposta antes de emitir de novo.');
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
        clienteId: pedidoData.clienteId || null,
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

      setNotasPorPedido((atual) => ({ ...atual, [pedido.id]: { spedyId: nota.id, tipo: 'NFC-e', status: nota.status, number: nota.number ?? null } }));
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

  const lista = filtrarMeusPedidos(itens, { temMinhasVendas, agoraMillis });
  const listaVisivel = lista.slice(0, visiveis);

  // Situacao da nota de cada venda finalizada na tela (15/10/2026). Consulta
  // pelos pedidos visiveis, de 30 em 30 (limite do "in" do Firestore). Sem
  // permissao de nota fiscal nao consulta nada (o botao nem aparece).
  const idsFinalizadosVisiveis = listaVisivel
    .filter((item) => item.tipo === 'Pedido' && item.status === STATUS_FINALIZADA)
    .map((item) => item.id);
  const chaveIdsFinalizados = idsFinalizadosVisiveis.join(',');
  useEffect(() => {
    if (!podeEmitirNota || !tenantId || !chaveIdsFinalizados) return;
    let cancelado = false;
    const ids = chaveIdsFinalizados.split(',');
    const lotes: string[][] = [];
    for (let i = 0; i < ids.length; i += LIMITE_DO_IN) lotes.push(ids.slice(i, i + LIMITE_DO_IN));
    void Promise.all(lotes.map((lote) => getDocs(query(
      collection(db, 'notas_fiscais'),
      where('tenantId', '==', tenantId),
      where('pedidoId', 'in', lote),
    )))).then((resultados) => {
      if (cancelado) return;
      const melhores: Record<string, NotaDoPedido> = {};
      resultados.forEach((snap) => snap.docs.forEach((d) => {
        const dados = d.data();
        if (dados.finalidade === 'devolucao' || !dados.pedidoId) return;
        const nota: NotaDoPedido = { spedyId: String(dados.spedyId || ''), tipo: String(dados.tipo || ''), status: String(dados.status || ''), number: dados.number ?? null };
        const atual = melhores[dados.pedidoId];
        if (!atual || prioridadeDaNota(nota.status) < prioridadeDaNota(atual.status)) melhores[dados.pedidoId] = nota;
      }));
      setNotasPorPedido((anterior) => ({ ...anterior, ...melhores }));
    }).catch((erro) => {
      // Sem a consulta o app volta ao jeito antigo: "Emitir" confere na hora do toque.
      console.warn('Meus Pedidos: nao foi possivel consultar as notas dos pedidos.', erro);
    });
    return () => { cancelado = true; };
  }, [podeEmitirNota, tenantId, chaveIdsFinalizados]);

  /** Abre o PDF da nota no celular (menu de compartilhar) ou baixa, no computador. */
  const handleVisualizarNota = async (item: ItemLista, nota: NotaDoPedido) => {
    if (abrindoNotaId || !nota.spedyId) return;
    const tipoSpedy = nota.tipo === 'NFC-e' ? 'consumer' : 'product';
    const nomeArquivo = nomeArquivoDocumento({ tipo: nota.tipo === 'NFC-e' ? 'NFCE' : 'NFE', numero: nota.number, destinatario: item.clienteNome });
    setAbrindoNotaId(item.id);
    try {
      const pdf = pdfProntoRef.current[item.id] || await spedyService.baixarArquivoFiscal(nota.spedyId, tipoSpedy, 'pdf');
      const resultado = await compartilharOuBaixarPdf(pdf, nomeArquivo, `Nota fiscal do pedido #${item.numero}`);
      if (resultado === 'precisa_toque') {
        pdfProntoRef.current[item.id] = pdf;
        showWarning('PDF da nota pronto', 'Toque de novo em "Visualizar Nota Fiscal" para abrir.');
      } else {
        delete pdfProntoRef.current[item.id];
      }
    } catch (erro) {
      showError('Não foi possível abrir a nota', erro instanceof Error ? erro.message : 'Tente de novo em instantes.');
    } finally {
      setAbrindoNotaId(null);
    }
  };

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
                style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '14px', borderRadius: 'var(--app-raio-linha)', backgroundColor: 'var(--bg-elevated)', boxShadow: 'var(--app-sombra)', border: '1px solid var(--border-color)' }}
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

                {mostraEmitirNota && notasPorPedido[item.id]?.status === 'authorized' ? (
                  <button
                    type="button"
                    onClick={() => void handleVisualizarNota(item, notasPorPedido[item.id])}
                    disabled={abrindoNotaId === item.id}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', height: '40px',
                      borderRadius: '10px', border: '1px solid rgba(16,185,129,0.35)', backgroundColor: 'rgba(16,185,129,0.1)',
                      color: '#10b981', fontSize: '14px', fontWeight: 700,
                      cursor: abrindoNotaId === item.id ? 'default' : 'pointer', opacity: abrindoNotaId === item.id ? 0.7 : 1,
                    }}
                  >
                    <Eye size={16} />
                    {abrindoNotaId === item.id ? 'Abrindo...' : `Visualizar Nota Fiscal${notasPorPedido[item.id].number ? ` (nº ${numeroDaNota(notasPorPedido[item.id].number)})` : ''}`}
                  </button>
                ) : mostraEmitirNota && notasPorPedido[item.id] && STATUS_NOTA_EM_TRANSMISSAO.includes(notasPorPedido[item.id].status) ? (
                  <div style={{ textAlign: 'center', fontSize: '13px', fontWeight: 600, color: '#f59e0b', padding: '8px 0' }}>
                    Nota fiscal aguardando a SEFAZ
                  </div>
                ) : mostraEmitirNota && (
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
