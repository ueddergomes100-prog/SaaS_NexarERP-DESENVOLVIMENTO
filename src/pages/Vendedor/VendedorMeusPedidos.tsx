import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, Receipt } from 'lucide-react';
import {
  addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, startAfter, Timestamp, where,
  type DocumentData, type QueryConstraint, type QueryDocumentSnapshot,
} from 'firebase/firestore';
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
  DIAS_RECENTES_SEM_MINHAS_VENDAS,
  PAGINA_MEUS_PEDIDOS,
  PERMISSAO_MINHAS_VENDAS,
  filtrarMeusPedidos,
  quantoBuscarDaFonte,
  temMaisMeusPedidos,
} from '../../utils/meusPedidosMobileDomain';

interface ItemLista {
  id: string;
  tipo: 'Pedido' | 'Orçamento';
  numero: string;
  status: string;
  clienteNome: string;
  valorTotal: number;
  createdAtMillis: number;
  /** "Sem nota" (false) nao mostra "Emitir Nota Fiscal" (23/10/2026). */
  comNotaFiscal?: boolean;
}

const formatarMoeda = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const toMillis = (value: unknown): number => {
  const withToMillis = value as { toMillis?: () => number } | undefined;
  return typeof withToMillis?.toMillis === 'function' ? withToMillis.toMillis() : 0;
};

type FonteMeusPedidos = 'pedidos' | 'orcamentos';
interface EstadoDaFonte {
  itens: ItemLista[];
  ultimo: QueryDocumentSnapshot<DocumentData> | null;
  esgotada: boolean;
}
const fonteVazia = (): EstadoDaFonte => ({ itens: [], ultimo: null, esgotada: false });

const paraItemDaLista = (fonte: FonteMeusPedidos, id: string, data: DocumentData): ItemLista => ({
  id,
  tipo: fonte === 'pedidos' ? 'Pedido' : 'Orçamento',
  numero: (fonte === 'pedidos' ? data.numeroPedido : data.numeroOrcamento) || '',
  status: data.status || '',
  clienteNome: data.clienteNome || '',
  valorTotal: Number(data.valorTotal || 0),
  createdAtMillis: toMillis(data.createdAt),
  ...(typeof data.comNotaFiscal === 'boolean' ? { comNotaFiscal: data.comNotaFiscal } : {}),
});

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

  // De 6 em 6 (23/10/2026): cada colecao (pedidos e orcamentos) e' lida em
  // paginas, mais novos primeiro (indice tenantId + vendedor + createdAt).
  // Sem o indice publicado, a consulta falha com failed-precondition e a
  // colecao cai na leitura antiga (tudo de uma vez, ordenado aqui) -- a lista
  // nunca fica vazia por falta de indice.
  const fontesRef = useRef<Record<FonteMeusPedidos, EstadoDaFonte>>({ pedidos: fonteVazia(), orcamentos: fonteVazia() });
  const geracaoRef = useRef(0);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [fontesEsgotadas, setFontesEsgotadas] = useState(false);

  const garantirCarregados = async (alvo: number, geracao: number, desde: number | null) => {
    if (!tenantId || !currentUser) return;
    const ler = async (fonte: FonteMeusPedidos) => {
      const estado = fontesRef.current[fonte];
      const quantos = quantoBuscarDaFonte(estado.itens.length, alvo, estado.esgotada);
      if (quantos <= 0) return;
      const colecao = fonte === 'pedidos' ? 'pedidos_venda' : 'orcamentos';
      const campoDoDono = fonte === 'pedidos' ? 'vendedorId' : 'criadoPor';
      const filtros: QueryConstraint[] = [where('tenantId', '==', tenantId), where(campoDoDono, '==', currentUser.uid)];
      try {
        const ordenada = query(collection(db, colecao), ...filtros,
          ...(desde !== null ? [where('createdAt', '>=', Timestamp.fromMillis(desde))] : []),
          orderBy('createdAt', 'desc'),
          ...(estado.ultimo ? [startAfter(estado.ultimo)] : []),
          limit(quantos));
        const snap = await getDocs(ordenada);
        if (geracao !== geracaoRef.current) return;
        estado.itens.push(...snap.docs.map((d) => paraItemDaLista(fonte, d.id, d.data())));
        if (snap.docs.length > 0) estado.ultimo = snap.docs[snap.docs.length - 1];
        if (snap.docs.length < quantos) estado.esgotada = true;
      } catch (erro) {
        if ((erro as { code?: string })?.code !== 'failed-precondition') throw erro;
        console.warn(`Meus Pedidos: sem o indice de ${colecao} ordenado por data; lendo tudo de uma vez.`);
        const tudo = await getDocs(query(collection(db, colecao), ...filtros));
        if (geracao !== geracaoRef.current) return;
        estado.itens = tudo.docs.map((d) => paraItemDaLista(fonte, d.id, d.data()));
        estado.esgotada = true;
      }
    };
    await Promise.all([ler('pedidos'), ler('orcamentos')]);
    if (geracao !== geracaoRef.current) return;
    setItens([...fontesRef.current.pedidos.itens, ...fontesRef.current.orcamentos.itens]);
    setFontesEsgotadas(fontesRef.current.pedidos.esgotada && fontesRef.current.orcamentos.esgotada);
  };

  useEffect(() => {
    if (!tenantId || !currentUser) return;
    const geracao = geracaoRef.current + 1;
    geracaoRef.current = geracao;
    fontesRef.current = { pedidos: fonteVazia(), orcamentos: fonteVazia() };
    setCarregando(true);
    setErroCarga('');
    setVisiveis(PAGINA_MEUS_PEDIDOS);
    const agora = Date.now();
    setAgoraMillis(agora);
    // Sem "Minhas Vendas": so' os ultimos 30 dias (o banco ja' filtra pela data).
    const desde = temMinhasVendas ? null : agora - DIAS_RECENTES_SEM_MINHAS_VENDAS * 24 * 60 * 60 * 1000;
    garantirCarregados(PAGINA_MEUS_PEDIDOS, geracao, desde)
      .catch((erro) => {
        console.error('Erro ao carregar meus pedidos:', erro);
        if (geracao === geracaoRef.current) setErroCarga('Não foi possível carregar seus pedidos agora. Verifique a internet e tente de novo.');
      })
      .finally(() => { if (geracao === geracaoRef.current) setCarregando(false); });
    return () => { geracaoRef.current += 1; };
    // garantirCarregados le o estado pelas refs; recarrega so' quando muda quem esta logado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, currentUser, temMinhasVendas]);

  const verMais = async () => {
    if (carregandoMais) return;
    const alvo = visiveis + PAGINA_MEUS_PEDIDOS;
    setCarregandoMais(true);
    try {
      const desde = temMinhasVendas ? null : agoraMillis - DIAS_RECENTES_SEM_MINHAS_VENDAS * 24 * 60 * 60 * 1000;
      await garantirCarregados(alvo, geracaoRef.current, desde);
      setVisiveis(alvo);
    } catch (erro) {
      console.error('Erro ao carregar mais pedidos:', erro);
      showError('Não foi possível carregar mais', 'Verifique a internet e tente de novo.');
    } finally {
      setCarregandoMais(false);
    }
  };

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
            const mostraEmitirNota = podeEmitirNota && item.tipo === 'Pedido' && item.status === STATUS_FINALIZADA && item.comNotaFiscal !== false;
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

        {!carregando && !erroCarga && lista.length > 0 && temMaisMeusPedidos({ totalNaLista: lista.length, visiveis, fontesEsgotadas }) && (
          <button
            type="button"
            onClick={() => { void verMais(); }}
            disabled={carregandoMais}
            style={{ height: '44px', borderRadius: '12px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '14px', fontWeight: 700, cursor: carregandoMais ? 'default' : 'pointer', opacity: carregandoMais ? 0.7 : 1 }}
          >
            {carregandoMais ? 'Carregando...' : 'Ver mais'}
          </button>
        )}
      </div>
    </div>
  );
};

export default VendedorMeusPedidos;
