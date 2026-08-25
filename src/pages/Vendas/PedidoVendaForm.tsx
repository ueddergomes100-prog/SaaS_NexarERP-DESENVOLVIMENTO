import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ShoppingCart, User, Package, Trash2, XCircle, Printer, Eye, Receipt, RefreshCw, X, Truck, RotateCcw, Undo2, AlertTriangle, Save } from 'lucide-react';
import { collection, addDoc, doc, getDoc, getDocs, updateDoc, getCountFromServer, serverTimestamp, query, where, orderBy, limit, runTransaction } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError, NexusSwal } from '../../utils/alerts';
import { spedyService } from '../../services/spedyService';
import { applyStockAdjustments, applyStockFieldDeltas, formatSequenceValue, getCurrentMaxSequence, getNextTenantSequenceValue, writeTenantSequenceValue } from '../../utils/firestoreAtomic';
import { isPlatformAdminRole } from '../../utils/roles';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import ProductAutocomplete from '../../components/common/ProductAutocomplete';
import ProductSearchModal from '../../components/common/ProductSearchModal';
import ClientAutocomplete from '../../components/common/ClientAutocomplete';
import { DEFAULT_PRODUCT_SEARCH_MODE, type ProductSearchMode } from '../../utils/productSearch';
import { DEFAULT_IMPRIMIR_MINUTA_APOS_VENDA, type StatusConferencia } from '../../utils/conferenciaDomain';
import { isValidSaleQuantity } from '../../utils/saleQuantity';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardFlow';
import { useTenantCollection } from '../../hooks/useTenantCollection';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import PaymentsEditor, { type PaymentFinanceConfig } from '../../components/finance/PaymentsEditor';
import DevolucaoVendaModal from './DevolucaoVendaModal';
import {
  buildCardFeeSchedulesByBrand,
  buildCommissionSnapshot,
  cancelCommissionSnapshot,
  computeBankCreditsMap,
  createEmptyPaymentDraft,
  explodeInstallmentPaymentRecords,
  fromCents,
  normalizeCreditCardFeeSchedule,
  normalizePayments,
  parseCreditTerms,
  recalculateCommissionAfterReturn,
  summarizePayments,
  toCents,
  transactionMovesPhysicalCash,
  type PaymentDraft,
  type PaymentMethod,
  type PaymentRecord,
} from '../../utils/financeDomain';
import { isExportCfop, resolveInvoiceDestination, resolveInvoiceUnitFields } from '../../utils/fiscalDomain';
import {
  DEFAULT_ALTERAR_PAGAMENTO_VENDA_FINALIZADA,
  DEFAULT_TRABALHA_COM_PRE_VENDA,
  isPedidoAberto,
  parseAlterarPagamentoVendaFinalizada,
  parseTrabalhaComPreVenda,
  resolveOrigemPedido,
  STATUS_CANCELADA,
  STATUS_PRE_VENDA,
  type OrigemPedido,
} from '../../utils/preVendaDomain';
import {
  DEFAULT_EXIGIR_IDENTIFICACAO_VENDEDOR,
  parseExigirIdentificacaoVendedor,
  type VendedorIdentificado,
} from '../../utils/vendedorPinDomain';
import IdentificarVendedorModal from '../../components/common/IdentificarVendedorModal';
import {
  isVendaDoUsuario,
  MENSAGEM_VENDA_DE_OUTRO_USUARIO,
  TITULO_VENDA_DE_OUTRO_USUARIO,
} from '../../utils/visibilidadeVendasDomain';
import {
  computeReservationCommit,
  computeReservationDelta,
  computeReservationRelease,
} from '../../utils/estoqueReservaDomain';
import {
  DEFAULT_VENDER_POR_EMBALAGEM,
  buildOpcoesUnidadeVenda,
  findOpcaoUnidadeVenda,
  toBaseQuantity,
  toStockAdjustmentItems,
} from '../../utils/embalagemDomain';
import {
  calcularDescontoCents,
  checarLimiteTotal,
  excedeLimiteItem,
  parseLimiteDescontoConfig,
  parseModoLimiteDesconto,
  type LimiteDescontoConfig,
  type ModoLimiteDesconto,
} from '../../utils/descontoDomain';
import {
  DEFAULT_MODO_VALIDACAO_CLIENTE,
  parseModoValidacaoCliente,
  resolverAcaoValidacaoCliente,
  type ModoValidacaoCliente,
} from '../../utils/clienteValidacaoDomain';
import { excedeLimiteCredito, parseTrabalhaComLimiteCredito } from '../../utils/creditoDomain';
import { calcularSaldoEmAbertoClienteCents } from '../../utils/contasReceberQuery';
import { getProximoCodigoCliente } from '../../utils/clienteCodigo';
import CadastroRapidoClienteModal, { type ClienteCadastradoRapido } from '../../components/common/CadastroRapidoClienteModal';
import DescontoInput, { type DescontoInputValue } from '../../components/finance/DescontoInput';
import SolicitarAprovacaoDescontoModal, { type AprovacaoDesconto } from '../../components/common/SolicitarAprovacaoDescontoModal';
import Swal from 'sweetalert2';
import '../OS/OS.css'; // Reusing OS styles for layout consistency

interface ClienteBasico { id: string; nome: string; telefone: string; codigo?: string; limiteDeCredito?: number | null; }
interface VendedorBasico { id: string; nome: string; email?: string; }
interface BandeiraCartao {
  id: string;
  nome: string;
  taxaDebitoPercentual?: number;
  taxasCreditoPorParcela?: Record<string, number>;
  prazoRecebimentoCreditoDias?: number;
  prazoRecebimentoDebitoDias?: number;
}
interface ProdutoEstoque {
  id: string;
  nome: string;
  precoVenda: number;
  quantidade: number;
  codigo: string;
  unidadeMedidaSigla?: string;
  unidadeMedidaCasasDecimais?: number;
  unidadeMedidaFracionado?: boolean;
  embalagens?: unknown;
  descontoMaximoPercentual?: number;
}
interface ItemVenda {
  id: string;
  nome: string;
  precoUnitario: number;
  quantidade: number;
  desconto: number;
  subtotal: number;
  quantidadeJaDevolvida?: number;
  unidadeMedidaSigla?: string;
  unidadeMedidaCasasDecimais?: number;
  /** Embalagem escolhida na venda. Ausente = vendido na unidade base do
   * produto, que e o comportamento de todo item gravado antes desta feature. */
  embalagemId?: string;
  /** Quantas unidades base cada unidade vendida consome (20 = saco de 20kg).
   * E' o que converte `quantidade` em baixa de estoque. */
  fatorConversao?: number;
  /** quantidade x fatorConversao, gravado so para auditoria/conferencia --
   * a baixa de estoque recalcula pelo fator, nao confia neste campo. */
  quantidadeBase?: number;
}

interface LinkedNfe {
  id: string;
  spedyId: string;
  status: string;
  number: number | null;
  accessKey?: string;
}

interface DevolucaoVenda {
  id: string;
  valorTotalDevolvido: number;
  destinoValor: 'credito' | 'caixa';
  motivo: string;
  status: 'concluida' | 'estornada';
  createdAt?: { seconds?: number };
  itensDevolvidos: Array<{ id: string; nome: string; quantidadeDevolvida: number; fatorConversao?: number }>;
}

const renderProdutoRow = (p: ProdutoEstoque) => (
  <>
    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.nome} {p.codigo && <span style={{ color: 'var(--text-muted)' }}>[{p.codigo}]</span>}</span>
    <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexShrink: 0 }}>
      <span style={{ color: p.quantidade > 0 ? '#10b981' : '#ef4444' }}>
        Est: {p.quantidade.toFixed(p.unidadeMedidaCasasDecimais ?? 0)} {p.unidadeMedidaSigla || 'UN'}
      </span>
      <span style={{ color: '#10b981', fontWeight: 600 }}>R$ {p.precoVenda.toFixed(2)}</span>
    </div>
  </>
);

const toSpedyPaymentMethod = (method: string) => {
  if (method === 'Pix') return 'pix';
  if (method.includes('Crédito')) return 'creditCard';
  if (method.includes('Débito')) return 'debitCard';
  if (method === 'Dinheiro') return 'money';
  return 'other';
};

const PedidoVendaForm: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams(); // Para modo Visualização
  const isViewing = !!id;

  const [nfeDoc, setNfeDoc] = useState<LinkedNfe | null>(null);
  const [clienteNome, setClienteNome] = useState('');
  const [formaPagamento, setFormaPagamento] = useState('Dinheiro');
  const [dataVenda, setDataVenda] = useState(() => getDateInputInTimeZone());
  const paymentDraftCounter = useRef(1);
  const submitLockRef = useRef(false);
  const produtoBuscaInputRef = useRef<HTMLInputElement>(null);
  const clienteInputRef = useRef<HTMLInputElement>(null);
  const produtoDescontoInputRef = useRef<HTMLInputElement>(null);
  const pagamentoSectionRef = useRef<HTMLDivElement>(null);
  const [paymentDrafts, setPaymentDrafts] = useState<PaymentDraft[]>([
    createEmptyPaymentDraft('pagamento-1', 0),
  ]);
  const [financeConfig, setFinanceConfig] = useState<PaymentFinanceConfig>({
    defaultTermDays: 30,
    maxCreditInstallments: 12,
    creditFeePercentByInstallment: normalizeCreditCardFeeSchedule(null),
    debitFeePercent: 0,
    creditSettlementDays: 30,
    debitSettlementDays: 1,
  });
  const [numeroPedido, setNumeroPedido] = useState('');
  const [status, setStatus] = useState('Aberta');
  const [itens, setItens] = useState<ItemVenda[]>([]);
  const [orcamentoId, setOrcamentoId] = useState('');
  const [showDevolucaoModal, setShowDevolucaoModal] = useState(false);
  const [devolucoes, setDevolucoes] = useState<DevolucaoVenda[]>([]);
  const [estornandoDevolucaoId, setEstornandoDevolucaoId] = useState<string | null>(null);

  const [vendedoresDisponiveis, setVendedoresDisponiveis] = useState<VendedorBasico[]>([]);
  const [vendedorId, setVendedorId] = useState('');
  const [produtosCatalogo, setProdutosCatalogo] = useState<ProdutoEstoque[]>([]);

  const [produtoBusca, setProdutoBusca] = useState('');
  const [produtoQtd, setProdutoQtd] = useState<number | string>(1);
  const [produtoDescontoInput, setProdutoDescontoInput] = useState<DescontoInputValue>({ tipo: 'valor', valor: '' });
  const [produtoPreco, setProdutoPreco] = useState<number>(0);
  const [produtoSelecionado, setProdutoSelecionado] = useState<ProdutoEstoque | null>(null);
  /** Embalagem escolhida para o proximo item. Vazio = unidade base. */
  const [embalagemSelecionadaId, setEmbalagemSelecionadaId] = useState('');
  const [isProdutoSearchModalOpen, setIsProdutoSearchModalOpen] = useState(false);
  const [selectedItemIndex, setSelectedItemIndex] = useState<number | null>(null);


  const [frete, setFrete] = useState<number>(0);
  const [encargos, setEncargos] = useState<number>(0);

  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingData, setIsFetchingData] = useState(true);
  const [permitirVendaSemEstoque, setPermitirVendaSemEstoque] = useState(false);
  const [produtoSearchMode, setProdutoSearchMode] = useState<ProductSearchMode>(DEFAULT_PRODUCT_SEARCH_MODE);
  const [conferenciaMercadoriaAtiva, setConferenciaMercadoriaAtiva] = useState(false);
  const [venderPorEmbalagem, setVenderPorEmbalagem] = useState(DEFAULT_VENDER_POR_EMBALAGEM);
  const [descontoGeralInput, setDescontoGeralInput] = useState<DescontoInputValue>({ tipo: 'valor', valor: '' });
  const [limiteDescontoPedido, setLimiteDescontoPedido] = useState<LimiteDescontoConfig | null>(null);
  const [modoLimiteDesconto, setModoLimiteDesconto] = useState<ModoLimiteDesconto>('avisar');
  const [modoValidacaoCliente, setModoValidacaoCliente] = useState<ModoValidacaoCliente>(DEFAULT_MODO_VALIDACAO_CLIENTE);
  const [trabalhaComLimiteCredito, setTrabalhaComLimiteCredito] = useState(false);
  const [cadastroRapidoAberto, setCadastroRapidoAberto] = useState(false);
  const [showAprovacaoDesconto, setShowAprovacaoDesconto] = useState(false);
  const [aprovacaoDesconto, setAprovacaoDesconto] = useState<AprovacaoDesconto | null>(null);
  const [imprimirMinutaAposVendaAtiva, setImprimirMinutaAposVendaAtiva] = useState(false);
  const [trabalhaComPreVenda, setTrabalhaComPreVenda] = useState(DEFAULT_TRABALHA_COM_PRE_VENDA);
  const [alterarPagamentoAtivo, setAlterarPagamentoAtivo] = useState(DEFAULT_ALTERAR_PAGAMENTO_VENDA_FINALIZADA);
  const [exigirIdentificacaoVendedor, setExigirIdentificacaoVendedor] = useState(DEFAULT_EXIGIR_IDENTIFICACAO_VENDEDOR);
  const [identificacaoAberta, setIdentificacaoAberta] = useState(false);
  const [descricaoIdentificacao, setDescricaoIdentificacao] = useState('');
  /**
   * Vendedor identificado para a venda EM ANDAMENTO.
   *
   * Guardado em ref, nao em state, de proposito: quem identifica dispara a
   * acao (finalizar/gravar) no mesmo instante, e um `setState` ainda nao
   * teria chegado no closure da funcao -- a venda sairia carimbada no
   * vendedor errado. Ref e' lida na hora.
   *
   * Zerado ao concluir a operacao: a proxima venda pede identificacao de
   * novo, que e' justamente o pedido do balcao.
   */
  const vendedorIdentificadoRef = useRef<VendedorIdentificado | null>(null);
  const acaoAposIdentificarRef = useRef<(() => void) | null>(null);
  /** Destrava a secao de pagamento numa venda JA finalizada. Fora deste modo
   * a venda finalizada continua somente-leitura, como sempre foi. */
  const [editandoPagamento, setEditandoPagamento] = useState(false);
  // Origem do pedido CARREGADO (so faz sentido em modo visualizacao). Pedido
  // novo na tela ainda nao tem origem gravada -- nasce 'balcao' quando alguem
  // grava a pre-venda.
  const [origemPedido, setOrigemPedido] = useState<OrigemPedido>('balcao');
  // A reserva ja aplicada no estoque NAO vira state de tela de proposito:
  // ela e' lida do proprio documento dentro da transacao que a reconcilia
  // (gravar/finalizar/cancelar). State aqui seria uma segunda copia da
  // verdade, que envelhece se outra aba mexer na mesma pre-venda.

  const { currentUser, tenantId, userRole, userPermissions, isOwner, vendasVisiveisDeUsuarioId } = useAuth();
  const canEditVenda = isOwner || isPlatformAdminRole(userRole) || (userPermissions && userPermissions.includes('vendas.alterar'));
  const canReturnVenda = isOwner || isPlatformAdminRole(userRole) || (userPermissions && userPermissions.includes('vendas.devolucao'));
  // Pedido pendente do agente de WhatsApp: nasce com status "Em Analise"
  // (nenhuma tela deste sistema grava esse texto). Fica editavel/finalizavel
  // atras da permissao mestre; as 4 granulares abaixo so controlam campos
  // especificos -- nao existem em firestore.rules (decisao deliberada, ver
  // docs/PLANO_EVOLUCAO_NEXAR.md).
  // ESTADO x ORIGEM -- duas coisas diferentes, antes coladas numa flag so.
  //
  //   estado  = o pedido esta em aberto (nao faturou, so reservou estoque)
  //   origem  = quem criou: o agente de WhatsApp ou o balcao (pre-venda)
  //
  // O estado governa o COMPORTAMENTO (nao gera financeiro, nao entra em
  // faturamento, reserva estoque); a origem governa QUAIS PERMISSOES o
  // usuario precisa ter. Colar os dois faria quem cuida da pre-venda do
  // balcao herdar acesso aos pedidos do WhatsApp sem ninguem ter decidido.
  const pedidoEstaAberto = isViewing && isPedidoAberto(status);
  const isPendingFromAgent = pedidoEstaAberto && origemPedido === 'agente';
  const isPreVendaAberta = pedidoEstaAberto && origemPedido === 'balcao';

  const temPermissao = (permissao: string) => (
    isOwner || isPlatformAdminRole(userRole) || Boolean(userPermissions && userPermissions.includes(permissao))
  );

  // Pedido pendente do agente de WhatsApp: nasce com status "Em Analise".
  // Fica editavel/finalizavel atras da permissao mestre; as 4 granulares
  // abaixo so controlam campos especificos -- nao existem em
  // firestore.rules (decisao deliberada, ver docs/PLANO_EVOLUCAO_NEXAR.md).
  const canEditAgentOrder = isPendingFromAgent && temPermissao('vendas.pedidos_pendentes_editar');

  // Pre-venda do balcao: uma permissao por acao do ciclo de vida. Gravar e'
  // criar; editar e' mexer numa ja gravada; finalizar e' o que vira venda
  // de verdade (baixa estoque + gera financeiro), por isso separado.
  const canCriarPreVenda = trabalhaComPreVenda && temPermissao('vendas.pre_venda_criar');
  const canEditarPreVenda = isPreVendaAberta && trabalhaComPreVenda && temPermissao('vendas.pre_venda_editar');
  const canFinalizarPreVenda = isPreVendaAberta && trabalhaComPreVenda && temPermissao('vendas.pre_venda_finalizar');
  const canCancelarPreVenda = isPreVendaAberta && trabalhaComPreVenda && temPermissao('vendas.pre_venda_cancelar');

  // Alterar forma de pagamento de venda finalizada. Mesma hierarquia:
  // config libera pra empresa, permissao decide quem. As duas travas
  // seguintes NAO passam por permissao nenhuma -- ver o comentario em
  // handleSalvarPagamentoAlterado.
  const nfceAutorizada = Boolean(nfeDoc && nfeDoc.status === 'authorized');
  const vendaTemDevolucao = itens.some((item) => (item.quantidadeJaDevolvida || 0) > 0);
  const canAlterarPagamentoFinalizada = isViewing
    && status === 'Finalizada'
    && alterarPagamentoAtivo
    && temPermissao('vendas.alterar_pagamento_finalizada');
  const motivoBloqueioAlterarPagamento = nfceAutorizada
    ? 'Venda com cupom fiscal (NFC-e) autorizado não pode ser alterada'
    : vendaTemDevolucao
      ? 'Venda com itens devolvidos não pode ter o pagamento alterado'
      : '';

  // Guarda-chuva consumido pela UI de edicao do pedido aberto (os campos
  // sao os mesmos nos dois casos). Na pre-venda, `vendas.pre_venda_editar`
  // ja libera o pedido inteiro -- as 4 permissoes granulares de campo valem
  // so pro pedido do agente, onde a loja quis controle fino sobre o que
  // pode ser mexido num pedido feito pelo proprio cliente.
  const canEditPendingOrder = canEditAgentOrder || canEditarPreVenda;
  const canEditPendingCliente = isPreVendaAberta
    ? canEditarPreVenda
    : canEditAgentOrder && temPermissao('vendas.pedidos_pendentes_editar_cliente');
  const canEditPendingQtd = isPreVendaAberta
    ? canEditarPreVenda
    : canEditAgentOrder && temPermissao('vendas.pedidos_pendentes_alterar_qtd');
  const canAddPendingItem = isPreVendaAberta
    ? canEditarPreVenda
    : canEditAgentOrder && temPermissao('vendas.pedidos_pendentes_adicionar_item');
  const canDeletePendingItem = isPreVendaAberta
    ? canEditarPreVenda
    : canEditAgentOrder && temPermissao('vendas.pedidos_pendentes_excluir_item');
  const { items: bandeirasCartao } = useTenantCollection<BandeiraCartao>('bandeiras_cartao', tenantId);
  const { items: clientesDisponiveis } = useTenantCollection<ClienteBasico>('clientes', tenantId);
  const cardFeeSchedulesByBrand = buildCardFeeSchedulesByBrand(bandeirasCartao);

  useEffect(() => {
    if (currentUser && !vendedorId) setVendedorId(currentUser.uid);
  }, [currentUser, vendedorId]);

  useEffect(() => {
    const isConsumidorFinal = clienteNome.toLowerCase().includes('consumidor final');
    if (!isConsumidorFinal) return;

    setPaymentDrafts((current) => current.map((payment) => (
      payment.forma === 'Dinheiro' || payment.forma === 'Pix'
        ? payment
        : { ...payment, forma: 'Dinheiro', parcelas: '1', dataVencimento: '' }
    )));
  }, [clienteNome]);


  const fetchDevolucoes = async (pedidoId: string) => {
    try {
      const qDevolucoes = query(collection(db, 'devolucoes_venda'), where('pedidoVendaId', '==', pedidoId));
      const snap = await getDocs(qDevolucoes);
      const lista: DevolucaoVenda[] = snap.docs.map((docSnap) => ({
        id: docSnap.id,
        valorTotalDevolvido: docSnap.data().valorTotalDevolvido || 0,
        destinoValor: docSnap.data().destinoValor,
        motivo: docSnap.data().motivo || '',
        status: docSnap.data().status || 'concluida',
        createdAt: docSnap.data().createdAt,
        itensDevolvidos: docSnap.data().itensDevolvidos || [],
      }));
      lista.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setDevolucoes(lista);
    } catch (err) {
      console.error('Erro ao buscar devoluções do pedido:', err);
    }
  };

  useEffect(() => {
    const fetchInitialData = async () => {
      if (!currentUser || !tenantId) return;

      const qU = query(collection(db, 'usuarios'), where('tenantId', '==', tenantId));
      const snapU = await getDocs(qU);
      const dataU: VendedorBasico[] = [];
      snapU.forEach((document) => {
        const user = document.data();
        dataU.push({
          id: document.id,
          nome: user.nome || user.nomeResponsavel || user.email || 'Usuário sem nome',
          email: user.email,
        });
      });
      dataU.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      // Funcionario restrito so pode vender em nome dele: lancar a venda
      // no nome de um colega criaria um pedido que ele mesmo nao
      // conseguiria mais abrir.
      setVendedoresDisponiveis(
        vendasVisiveisDeUsuarioId
          ? dataU.filter((seller) => seller.id === vendasVisiveisDeUsuarioId)
          : dataU,
      );

      // Fetch Estoque
      const qE = query(collection(db, 'estoque'), where('tenantId', '==', tenantId));
      const snapE = await getDocs(qE);
      const dataE: ProdutoEstoque[] = [];
      snapE.forEach((doc) => dataE.push({
        id: doc.id,
        nome: doc.data().nome,
        precoVenda: doc.data().precoVenda,
        quantidade: doc.data().quantidade || 0,
        codigo: doc.data().codigo || '',
        unidadeMedidaSigla: doc.data().unidadeMedidaSigla,
        unidadeMedidaCasasDecimais: doc.data().unidadeMedidaCasasDecimais,
        unidadeMedidaFracionado: doc.data().unidadeMedidaFracionado,
        embalagens: doc.data().embalagens,
        descontoMaximoPercentual: doc.data().descontoMaximoPercentual
      }));
      setProdutosCatalogo(dataE);

      // Fetch Configurações
      try {
        const configRef = doc(db, 'configuracoes', tenantId);
        const configSnap = await getDoc(configRef);
        if (configSnap.exists()) {
          const config = configSnap.data();
          setPermitirVendaSemEstoque(config.venderSemEstoque === true);
          setProdutoSearchMode(config.buscaProdutoModo === 'exata' ? 'exata' : DEFAULT_PRODUCT_SEARCH_MODE);
          setConferenciaMercadoriaAtiva(config.conferenciaMercadoria === true);
          setTrabalhaComPreVenda(parseTrabalhaComPreVenda(config.trabalhaComPreVenda));
          setAlterarPagamentoAtivo(parseAlterarPagamentoVendaFinalizada(config.alterarPagamentoVendaFinalizada));
          setExigirIdentificacaoVendedor(parseExigirIdentificacaoVendedor(config.exigirIdentificacaoVendedor));
          setVenderPorEmbalagem(config.venderPorEmbalagem ?? DEFAULT_VENDER_POR_EMBALAGEM);
          setLimiteDescontoPedido(parseLimiteDescontoConfig(config.limiteDescontoPedido));
          setModoLimiteDesconto(parseModoLimiteDesconto(config.modoLimiteDesconto));
          setModoValidacaoCliente(parseModoValidacaoCliente(config.modoValidacaoCliente));
          setTrabalhaComLimiteCredito(parseTrabalhaComLimiteCredito(config.trabalhaComLimiteCredito));
          setImprimirMinutaAposVendaAtiva(config.imprimirMinutaAposVenda ?? DEFAULT_IMPRIMIR_MINUTA_APOS_VENDA);
          const configuredTerms = parseCreditTerms(config.diasCrediario);
          const defaultTermDays = configuredTerms[0] || 30;
          const creditSettlementDays = config.prazoRecebimentoCartaoCreditoDias ?? 30;
          const debitSettlementDays = config.prazoRecebimentoCartaoDebitoDias ?? 1;
          setFinanceConfig({
            defaultTermDays,
            maxCreditInstallments: Math.min(12, Math.max(1, Number(config.maxParcelasCartao ?? 12) || 12)),
            creditFeePercentByInstallment: normalizeCreditCardFeeSchedule(
              config.taxasCartaoCreditoPorParcela,
              config.taxaCartaoCreditoPercentual || 0,
            ),
            debitFeePercent: Math.max(0, Number(config.taxaCartaoDebitoPercentual || 0)),
            creditSettlementDays: creditSettlementDays === ''
              ? 30
              : Math.max(0, Number(creditSettlementDays)),
            debitSettlementDays: debitSettlementDays === ''
              ? 1
              : Math.max(0, Number(debitSettlementDays)),
          });
          setPaymentDrafts((current) => current.map((payment) => ({
            ...payment,
            prazoDias: payment.prazoDias === '30' ? String(defaultTermDays) : payment.prazoDias,
          })));
        }
      } catch (err) { console.error(err); }

      // Fetch Pedido se for Visualização
      if (isViewing && id) {
        try {
          const docRef = doc(db, 'pedidos_venda', id);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const p = docSnap.data();
            // Visibilidade de vendas: esconder da lista nao basta, o link
            // direto continuaria abrindo a venda do colega. Ver
            // src/utils/visibilidadeVendasDomain.ts.
            if (vendasVisiveisDeUsuarioId && !isVendaDoUsuario(p, vendasVisiveisDeUsuarioId)) {
              showError(TITULO_VENDA_DE_OUTRO_USUARIO, MENSAGEM_VENDA_DE_OUTRO_USUARIO);
              navigate('/pedidos-venda');
              setIsFetchingData(false);
              return;
            }
            setClienteNome(p.clienteNome || '');
            setVendedorId(p.vendedorId || p.usuarioResponsavelId || currentUser.uid);
            setFormaPagamento(p.formaPagamento || 'Dinheiro');
            setDataVenda(p.dataVenda || getDateInputInTimeZone(p.createdAt?.toDate?.() || new Date()));
            setNumeroPedido(p.numeroPedido || '');
            setStatus(p.status || 'Finalizada');
            setOrigemPedido(resolveOrigemPedido(p));
            setItens(p.itens || []);
            setOrcamentoId(p.orcamentoId || '');
            setFrete(p.frete || 0);
            setEncargos(p.encargos || 0);
            if (Array.isArray(p.pagamentos) && p.pagamentos.length > 0) {
              setPaymentDrafts(p.pagamentos.map((payment: PaymentRecord, index: number) => ({
                id: payment.id || `pagamento-${index + 1}`,
                forma: payment.formaPagamento || 'Outros',
                valor: fromCents(Number(payment.valorCentavos ?? toCents(payment.valor))).toFixed(2),
                prazoDias: String(payment.prazoDias || ''),
                dataVencimento: payment.dataVencimento || '',
                bandeira: payment.cartao?.bandeira || '',
                operadora: payment.cartao?.operadora || '',
                autorizacao: payment.cartao?.autorizacao || '',
                parcelas: String(payment.cartao?.parcelas || 1),
                dataPrevistaRecebimento: payment.dataPrevistaRecebimento || payment.cartao?.dataPrevistaRecebimento || '',
                bancoId: payment.bancoId || '',
                bancoNome: payment.bancoNome || '',
              })));
              paymentDraftCounter.current = p.pagamentos.length;
            } else {
              setPaymentDrafts([{
                ...createEmptyPaymentDraft('pagamento-1', toCents(p.valorTotal || 0)),
                forma: (p.formaPagamento || 'Outros') as PaymentMethod,
              }]);
            }

            // Busca nota fiscal vinculada a esta venda
            try {
              const qNota = query(
                collection(db, 'notas_fiscais'),
                where('pedidoId', '==', id),
                where('tipo', '==', 'NFC-e')
              );
              const snapNota = await getDocs(qNota);
              if (!snapNota.empty) {
                const docNota = snapNota.docs[0];
                setNfeDoc({
                  id: docNota.id,
                  spedyId: docNota.data().spedyId,
                  status: docNota.data().status,
                  number: docNota.data().number,
                  accessKey: docNota.data().accessKey
                });
              }
            } catch (err) {
              console.error("Erro ao buscar nota fiscal vinculada:", err);
            }

            await fetchDevolucoes(id);
          } else {
            showError('Erro', 'Pedido não encontrado.');
            navigate('/pedidos-venda');
          }
        } catch (error) {
          console.error("Erro ao carregar pedido:", error);
        } finally {
          setIsFetchingData(false);
        }
      } else {
        // Novo Pedido - Buscar Próximo Número
        try {
          const qLast = query(collection(db, 'pedidos_venda'), where('tenantId', '==', tenantId), orderBy('numeroPedido', 'desc'), limit(1));
          const snapP = await getDocs(qLast);
          let nextNum = '0001';
          if (!snapP.empty) {
            const lastNum = parseInt(snapP.docs[0].data().numeroPedido) || 0;
            nextNum = String(lastNum + 1).padStart(4, '0');
          }
          setNumeroPedido(nextNum);
        } catch (err) {
          console.error("Erro ao buscar sequencia", err);
          const snapP = await getCountFromServer(query(collection(db, 'pedidos_venda'), where('tenantId', '==', tenantId)));
          setNumeroPedido(String(snapP.data().count + 1).padStart(4, '0'));
        }
        setIsFetchingData(false);
      }
    };
    fetchInitialData();
  }, [id, isViewing, navigate, currentUser, tenantId, vendasVisiveisDeUsuarioId]);

  // Snapshot dos campos de negocio, reaproveitado tanto pro snapshot
  // inicial quanto pro atual (evita falso-positivo de "sujo" por ordem
  // de chave diferente no JSON.stringify). So os ~9 campos que realmente
  // persistem na venda -- os demais useState deste arquivo sao estado
  // so-de-UI (busca de produto, modal aberto, indice selecionado etc.)
  // e ficam de fora de proposito. Em modo visualizacao (isViewing) todo
  // campo fica desabilitado, entao isso nunca muda e isDirty fica falso
  // sozinho, sem precisar de um caso especial aqui.
  const buildDirtySnapshot = () => JSON.stringify({
    clienteNome, formaPagamento, dataVenda, itens, orcamentoId, vendedorId, frete, encargos, paymentDrafts,
  });
  const initialSnapshotRef = useRef<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  useEffect(() => {
    if (isFetchingData) return;
    if (initialSnapshotRef.current === null) {
      initialSnapshotRef.current = buildDirtySnapshot();
      setIsDirty(false);
    } else {
      setIsDirty(buildDirtySnapshot() !== initialSnapshotRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFetchingData, clienteNome, formaPagamento, dataVenda, itens, orcamentoId, vendedorId, frete, encargos, paymentDrafts]);

  /** Opcoes do seletor "Unidade": a base do produto sempre, mais as
   * embalagens ativas quando a chave venderPorEmbalagem esta ligada. Com a
   * chave desligada so existe a base -- exatamente o comportamento antigo. */
  const opcoesUnidadeVenda = useMemo(() => {
    const opcoes = buildOpcoesUnidadeVenda(produtoSelecionado);
    return venderPorEmbalagem ? opcoes : opcoes.slice(0, 1);
  }, [produtoSelecionado, venderPorEmbalagem]);
  const opcaoUnidadeSelecionada = findOpcaoUnidadeVenda(opcoesUnidadeVenda, embalagemSelecionadaId);

  /** Trocar de embalagem repoe o preco da opcao escolhida. Nao preserva um
   * preco digitado a mao de proposito: o preco do saco nao tem relacao com o
   * preco do quilo que o operador possa ter ajustado antes. */
  const handleSelecionarEmbalagem = (embalagemId: string) => {
    setEmbalagemSelecionadaId(embalagemId);
    setProdutoPreco(findOpcaoUnidadeVenda(opcoesUnidadeVenda, embalagemId).precoVenda);
  };

  const handleAddItem = () => {
    if (!produtoBusca) {
      showError('Atenção', 'Selecione ou digite o nome de um produto.');
      return;
    }
    const qtdNum = Number(produtoQtd) || 0;
    if (qtdNum <= 0) {
      showError('Atenção', 'A quantidade deve ser maior que zero.');
      return;
    }

    // Tenta achar o produto no catálogo para pegar o ID real
    const produtoEncontrado = produtoSelecionado || produtosCatalogo.find(p => p.nome.toLowerCase() === produtoBusca.toLowerCase() || p.codigo === produtoBusca);

    // Produto achado por texto (sem passar pelo autocomplete) nao tem opcao de
    // embalagem selecionada -- cai na unidade base dele, nao na do produto que
    // por acaso estivesse selecionado antes.
    const opcaoUnidade = produtoEncontrado === produtoSelecionado
      ? opcaoUnidadeSelecionada
      : buildOpcoesUnidadeVenda(produtoEncontrado)[0];
    const fatorConversao = opcaoUnidade?.fatorConversao ?? 1;
    // Estoque e sempre debitado na unidade base: 2 sacos de 20kg = 40kg.
    const quantidadeBase = toBaseQuantity(qtdNum, fatorConversao);

    if (produtoEncontrado) {
      if (!permitirVendaSemEstoque && quantidadeBase > (produtoEncontrado.quantidade || 0)) {
        const sigla = produtoEncontrado.unidadeMedidaSigla || 'UN';
        showError('Estoque Insuficiente', fatorConversao === 1
          ? `Você tem apenas ${produtoEncontrado.quantidade || 0} de ${produtoEncontrado.nome} em estoque. Venda sem estoque desativada.`
          : `${qtdNum} ${opcaoUnidade.sigla} consome ${quantidadeBase} ${sigla}, mas você tem apenas ${produtoEncontrado.quantidade || 0} ${sigla} de ${produtoEncontrado.nome} em estoque.`);
        return;
      }

      // Validação de Venda Fracionada -- contra a unidade REALMENTE vendida.
      // Um saco continua indivisível mesmo num produto fracionável em quilo.
      if (!isValidSaleQuantity(qtdNum, opcaoUnidade.permiteFracionado, opcaoUnidade.casasDecimais)) {
        showError('Operação Bloqueada', opcaoUnidade.permiteFracionado
          ? `A quantidade de ${produtoEncontrado.nome} aceita no máximo ${opcaoUnidade.casasDecimais ?? 0} casa(s) decimal(is), conforme a unidade ${opcaoUnidade.sigla}.`
          : `${produtoEncontrado.nome} está sendo vendido na unidade ${opcaoUnidade.sigla}, que NÃO permite venda fracionada. Utilize uma quantidade inteira.`);
        return;
      }
    }

    const precoFinal = produtoPreco > 0 ? produtoPreco : (opcaoUnidade?.precoVenda || produtoEncontrado?.precoVenda || 0);
    const precoCheioCents = toCents(precoFinal * qtdNum);
    const descontoItemCents = calcularDescontoCents(produtoDescontoInput.tipo, produtoDescontoInput.valor, precoCheioCents);

    // Nivel 1 (produto): se o PRODUTO define seu proprio limite de desconto,
    // ele e' o piso -- sempre bloqueia, independente do modo configurado no
    // sistema. Sem esse campo no produto, nao ha checagem aqui (so o total
    // da venda e' checado, no finalizar).
    if (produtoEncontrado && excedeLimiteItem(produtoEncontrado, descontoItemCents, precoCheioCents)) {
      showError(
        'Desconto acima do limite do produto',
        `${produtoEncontrado.nome} aceita no máximo ${produtoEncontrado.descontoMaximoPercentual}% de desconto, definido no próprio cadastro.`,
      );
      return;
    }

    const produtoDesconto = fromCents(descontoItemCents);
    const subtotal = (precoFinal * qtdNum) - produtoDesconto;

    const novoItem: ItemVenda = {
      id: produtoEncontrado?.id || 'avulso',
      nome: produtoEncontrado?.nome || produtoBusca,
      precoUnitario: precoFinal,
      quantidade: qtdNum,
      desconto: produtoDesconto,
      subtotal: Math.max(0, subtotal),
      unidadeMedidaSigla: opcaoUnidade?.sigla || produtoEncontrado?.unidadeMedidaSigla || 'UN',
      unidadeMedidaCasasDecimais: opcaoUnidade?.casasDecimais ?? produtoEncontrado?.unidadeMedidaCasasDecimais ?? 0,
      // Item vendido na unidade base nao ganha campo nenhum de embalagem --
      // fica byte a byte igual ao que o sistema sempre gravou.
      ...(opcaoUnidade?.embalagemId
        ? { embalagemId: opcaoUnidade.embalagemId, fatorConversao, quantidadeBase }
        : {}),
    };

    setItens([...itens, novoItem]);
    setProdutoBusca('');
    setProdutoQtd(1);
    setProdutoDescontoInput({ tipo: 'valor', valor: '' });
    setProdutoPreco(0);
    setProdutoSelecionado(null);
    setEmbalagemSelecionadaId('');
    produtoBuscaInputRef.current?.focus();
  };

  const handleClearProdutoSelecionado = () => {
    setProdutoBusca('');
    setProdutoPreco(0);
    setProdutoSelecionado(null);
    setEmbalagemSelecionadaId('');
  };

  const handleRemoveItem = (index: number) => {
    setItens(itens.filter((_, i) => i !== index));
    setSelectedItemIndex((current) => (current === index ? null : current));
  };

  const askSelectedItemQuantity = async () => {
    if (selectedItemIndex === null) return;
    const item = itens[selectedItemIndex];
    if (!item) return;

    const produtoCatalogo = produtosCatalogo.find((p) => p.id === item.id);
    // A unidade que vale aqui e a do ITEM (a embalagem escolhida quando ele
    // foi adicionado), nao a unidade base do produto no catalogo.
    const opcaoItem = findOpcaoUnidadeVenda(buildOpcoesUnidadeVenda(produtoCatalogo), item.embalagemId);
    const fatorItem = item.fatorConversao ?? opcaoItem.fatorConversao ?? 1;
    const siglaItem = item.unidadeMedidaSigla || opcaoItem.sigla;

    // step: 'any' evita o bug de precisao de ponto flutuante do <input
    // type=number> nativo com step fracionario fixo (ex: '0.001' rejeitava
    // "3" como invalido) -- a validacao de casas decimais de verdade fica
    // por conta de isValidSaleQuantity logo abaixo, com a mensagem de erro.
    const result = await NexusSwal.fire({
      title: 'Alterar quantidade',
      text: `${item.nome} (${siglaItem})`,
      input: 'number',
      inputValue: String(item.quantidade),
      inputAttributes: { min: '0', step: opcaoItem.permiteFracionado ? 'any' : '1' },
      showCancelButton: true,
      confirmButtonText: 'Aplicar',
      cancelButtonText: 'Cancelar',
    });
    if (!result.isConfirmed) return;

    const novaQtd = Number(result.value) || 0;
    if (novaQtd <= 0) {
      showError('Atenção', 'A quantidade deve ser maior que zero.');
      return;
    }
    if (!isValidSaleQuantity(novaQtd, opcaoItem.permiteFracionado, opcaoItem.casasDecimais)) {
      showError('Operação Bloqueada', opcaoItem.permiteFracionado
        ? `A quantidade de ${item.nome} aceita no máximo ${opcaoItem.casasDecimais ?? 0} casa(s) decimal(is), conforme a unidade ${siglaItem}.`
        : `${item.nome} está sendo vendido na unidade ${siglaItem}, que NÃO permite venda fracionada. Utilize uma quantidade inteira.`);
      return;
    }
    const novaQtdBase = toBaseQuantity(novaQtd, fatorItem);
    if (produtoCatalogo && !permitirVendaSemEstoque && novaQtdBase > (produtoCatalogo.quantidade || 0)) {
      const siglaBase = produtoCatalogo.unidadeMedidaSigla || 'UN';
      showError('Estoque Insuficiente', fatorItem === 1
        ? `Você tem apenas ${produtoCatalogo.quantidade || 0} de ${produtoCatalogo.nome} em estoque. Venda sem estoque desativada.`
        : `${novaQtd} ${siglaItem} consome ${novaQtdBase} ${siglaBase}, mas você tem apenas ${produtoCatalogo.quantidade || 0} ${siglaBase} em estoque.`);
      return;
    }

    setItens((current) => current.map((it, idx) => (
      idx === selectedItemIndex
        ? {
            ...it,
            quantidade: novaQtd,
            subtotal: Math.max(0, it.precoUnitario * novaQtd - it.desconto),
            ...(it.embalagemId ? { quantidadeBase: novaQtdBase } : {}),
          }
        : it
    )));
  };

  const focusPagamentoSection = () => {
    pagamentoSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    pagamentoSectionRef.current?.querySelector<HTMLElement>('input, select, button')?.focus();
  };

  useKeyboardShortcuts([
    { key: 'F2', when: !isViewing || canEditPendingCliente, handler: () => clienteInputRef.current?.focus() },
    { key: 'F3', when: !isViewing || canAddPendingItem, handler: () => produtoBuscaInputRef.current?.focus() },
    { key: 'F4', when: !isViewing || canAddPendingItem, handler: () => produtoDescontoInputRef.current?.focus() },
    { key: 'F5', when: (!isViewing || canEditPendingQtd) && selectedItemIndex !== null, handler: () => { void askSelectedItemQuantity(); } },
    { key: 'F6', when: !isViewing || canEditPendingOrder, handler: focusPagamentoSection },
    { key: 'F7', when: !isViewing || canEditPendingOrder, handler: focusPagamentoSection },
  ]);

  // Fatia 4/4 de Pedidos Pendentes: um pedido do agente pode ficar dias
  // parado ate a equipe revisar -- avisa (sem bloquear, a validacao de
  // estoque real ja acontece em handleFinalizarVenda/handleAddItem) se
  // estoque ou preco mudaram desde que o agente gravou o item.
  const pendingOrderStockWarnings = canEditPendingOrder
    ? itens.reduce<string[]>((warnings, item) => {
        if (item.id === 'avulso') return warnings;
        const produtoAtual = produtosCatalogo.find((p) => p.id === item.id);
        if (!produtoAtual) {
          warnings.push(`${item.nome}: produto não encontrado mais no catálogo.`);
          return warnings;
        }
        if (!permitirVendaSemEstoque && produtoAtual.quantidade < item.quantidade) {
          warnings.push(`${item.nome}: estoque atual (${produtoAtual.quantidade}) é menor que a quantidade do pedido (${item.quantidade}).`);
        }
        if (Math.abs(produtoAtual.precoVenda - item.precoUnitario) > 0.001) {
          warnings.push(`${item.nome}: preço mudou de R$ ${item.precoUnitario.toFixed(2)} para R$ ${produtoAtual.precoVenda.toFixed(2)}.`);
        }
        return warnings;
      }, [])
    : [];

  const valorTotalItens = itens.reduce((acc, curr) => acc + (curr.precoUnitario * curr.quantidade), 0);
  const valorTotalDescontosItens = itens.reduce((acc, curr) => acc + curr.desconto, 0);
  // Desconto geral incide sobre o subtotal JA COM os descontos de item
  // aplicados (mesma base que o PDV usa pro desconto do cupom) -- nao sobre
  // frete/encargos, que sao acrescimos, nao parte do preco da mercadoria.
  const subtotalAposDescontosItensCents = toCents(Math.max(0, valorTotalItens - valorTotalDescontosItens));
  const descontoGeralCents = calcularDescontoCents(descontoGeralInput.tipo, descontoGeralInput.valor, subtotalAposDescontosItensCents);
  const descontoGeral = fromCents(descontoGeralCents);
  const valorTotalDescontos = valorTotalDescontosItens + descontoGeral;
  const valorTotalPedido = Math.max(0, valorTotalItens - valorTotalDescontos + Number(frete || 0) + Number(encargos || 0));
  const valorTotalPedidoCentavos = toCents(valorTotalPedido);
  const checagemLimiteDesconto = checarLimiteTotal(limiteDescontoPedido, toCents(valorTotalItens), toCents(valorTotalDescontos));

  useEffect(() => {
    if ((isViewing && !canEditPendingOrder) || paymentDrafts.length !== 1) return;
    const expectedValue = fromCents(valorTotalPedidoCentavos).toFixed(2);
    setPaymentDrafts((current) => (
      current.length === 1 && current[0].valor !== expectedValue
        ? [{ ...current[0], valor: expectedValue }]
        : current
    ));
  }, [isViewing, canEditPendingOrder, paymentDrafts.length, valorTotalPedidoCentavos]);

  // Uma aprovacao de senha vale so pro estado do carrinho no momento em que
  // foi dada -- mudar item ou desconto depois invalida, senao um desconto
  // maior poderia se aproveitar de uma aprovacao de um valor menor.
  const primeiraRenderAprovacaoRef = useRef(true);
  useEffect(() => {
    if (primeiraRenderAprovacaoRef.current) {
      primeiraRenderAprovacaoRef.current = false;
      return;
    }
    setAprovacaoDesconto(null);
  }, [itens, descontoGeralInput]);

  const updatePaymentDraft = (id: string, updates: Partial<PaymentDraft>) => {
    setPaymentDrafts((current) => current.map((payment) => (
      payment.id === id ? { ...payment, ...updates } : payment
    )));
  };

  const addPaymentDraft = () => {
    const usedCents = paymentDrafts.reduce((sum, payment) => sum + toCents(payment.valor), 0);
    const remainingCents = Math.max(0, valorTotalPedidoCentavos - usedCents);
    paymentDraftCounter.current += 1;
    setPaymentDrafts((current) => [
      ...current,
      createEmptyPaymentDraft(
        `pagamento-${paymentDraftCounter.current}`,
        remainingCents,
        financeConfig.defaultTermDays,
      ),
    ]);
  };

  const removePaymentDraft = (id: string) => {
    setPaymentDrafts((current) => current.length > 1
      ? current.filter((payment) => payment.id !== id)
      : current);
  };

  /** Devolve true/false (sucesso) -- usado tanto pelo clique do botao
   * quanto pelo useUnsavedChangesGuard (fechar aba -> "Salvar e fechar").
   * `saveSucceeded` marca o ponto em que a venda ja foi persistida de
   * verdade (fim da transacao); o resto da funcao (perguntar se emite
   * NFC-e/imprime recibo) continua rodando igual ao fluxo normal do
   * botao -- so o valor de retorno no final e novo. */
  /**
   * Trava de identificacao do vendedor.
   *
   * Devolve `true` quando pode seguir; `false` quando abriu o popup -- e ai
   * a acao original e' re-disparada por `onIdentificado`, sem que a tela
   * perca NADA do que estava montado. Esse detalhe e' requisito, nao
   * refinamento: um carrinho de 30 itens refeito na frente do cliente por
   * causa de um erro de senha seria inaceitavel no balcao.
   */
  const garantirVendedorIdentificado = (acao: () => void, descricao: string): boolean => {
    if (!exigirIdentificacaoVendedor) return true;
    if (vendedorIdentificadoRef.current) return true;

    acaoAposIdentificarRef.current = acao;
    setDescricaoIdentificacao(descricao);
    setIdentificacaoAberta(true);
    return false;
  };

  /** Chamado ao concluir a operacao: a proxima venda pede identificacao de
   *  novo. E' isto que faz o fluxo ser "por venda", nao "por sessao". */
  const esquecerVendedorIdentificado = () => {
    vendedorIdentificadoRef.current = null;
  };

  const handleVendedorIdentificado = (vendedor: VendedorIdentificado) => {
    vendedorIdentificadoRef.current = vendedor;
    // Espelha no state so pra UI mostrar quem e' -- quem manda na gravacao
    // e' a ref, lida na hora.
    setVendedorId(vendedor.vendedorId);
    const acao = acaoAposIdentificarRef.current;
    acaoAposIdentificarRef.current = null;
    if (acao) acao();
  };

  /**
   * Grava a PRE-VENDA: o pedido passa a existir em aberto, reservando
   * estoque, sem gerar nada de financeiro.
   *
   * O que este fluxo deliberadamente NAO faz, comparado a finalizar a venda:
   * nao cria transacao em `transacoes`, nao credita banco, nao apura
   * comissao, nao emite cupom fiscal e nao entra em conferencia. Nada disso
   * existe ainda -- a venda nao aconteceu, so foi separada. Por isso tambem
   * nao ha checagem de limite de credito nem de forma de pagamento aqui:
   * pagamento so e' definido na finalizacao, e e' la que essas travas rodam.
   *
   * Serve tanto pra criar quanto pra regravar uma pre-venda ja aberta -- no
   * segundo caso a reserva de estoque e' RECONCILIADA (delta entre o que ja
   * estava reservado e o que ficou), nunca somada por cima.
   */
  const handleGravarPreVenda = async (): Promise<boolean> => {
    if (submitLockRef.current) return false;
    if (!currentUser || !tenantId) return false;
    if (itens.length === 0) {
      showError('Atenção', 'Adicione pelo menos um item à pré-venda.');
      return false;
    }

    // A pre-venda ja carimba vendedorId, e a comissao nasce dali -- entao ela
    // pede identificacao igual a venda.
    if (!garantirVendedorIdentificado(
      () => { void handleGravarPreVenda(); },
      `Gravar pré-venda de ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valorTotalPedido)}`,
    )) return false;

    let finalClienteNome = clienteNome.trim().toUpperCase();
    if (!finalClienteNome) {
      finalClienteNome = 'CONSUMIDOR FINAL';
      setClienteNome('CONSUMIDOR FINAL');
    }
    const nomeClienteDigitadoOriginal = clienteNome.trim();
    const clienteEncontrado = clientesDisponiveis.find(c => c.nome.toUpperCase() === finalClienteNome);

    // Mesma validacao de cliente da venda: se a empresa exige cliente
    // cadastrado, exige na pre-venda tambem -- senao o cadastro furado so
    // apareceria la na frente, na hora de faturar.
    const acaoValidacaoCliente = resolverAcaoValidacaoCliente(modoValidacaoCliente, !!clienteEncontrado, nomeClienteDigitadoOriginal);
    if (acaoValidacaoCliente.tipo === 'bloquear') {
      showError('Cliente não cadastrado', acaoValidacaoCliente.motivo);
      return false;
    }
    if (acaoValidacaoCliente.tipo === 'perguntar') {
      const confirmCadastro = await NexusSwal.fire({
        title: 'Cliente não cadastrado',
        text: `"${finalClienteNome}" ainda não tem cadastro. Deseja cadastrar agora?`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Cadastrar cliente',
        cancelButtonText: 'Cancelar',
      });
      if (confirmCadastro.isConfirmed) setCadastroRapidoAberto(true);
      return false;
    }

    submitLockRef.current = true;
    setIsLoading(true);
    let gravouComSucesso = false;
    let numeroGravado = numeroPedido;
    let preVendaId = id || '';

    try {
      let clienteIdParaSalvar: string | null = clienteEncontrado?.id || null;
      if (!clienteEncontrado) {
        const codigoCliente = await getProximoCodigoCliente(tenantId);
        const novoClienteRef = await addDoc(collection(db, 'clientes'), {
          codigo: codigoCliente,
          nome: finalClienteNome,
          isPadrao: finalClienteNome === 'CONSUMIDOR FINAL',
          tenantId: tenantId || '',
          createdAt: serverTimestamp(),
          ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
        });
        clienteIdParaSalvar = novoClienteRef.id;
      }

      // Regravando uma pre-venda que ja existe: mantem documento e numero.
      const regravando = isPreVendaAberta && Boolean(id);
      const currentMaxPedido = regravando
        ? 0
        : await getCurrentMaxSequence(db, 'pedidos_venda', tenantId, 'numeroPedido').catch(() => 0);

      await runTransaction(db, async (transaction) => {
        const nextPedido = regravando
          ? 0
          : await getNextTenantSequenceValue(transaction, db, tenantId, 'pedidos_venda', currentMaxPedido);

        // Vendedor identificado pelo popup vence o estado da tela: quando a
        // identificacao acabou de acontecer, o setState ainda nao chegou
        // neste closure, e usar o state vendedorId carimbaria a venda na
        // pessoa errada. Ver vendedorIdentificadoRef.
        const selectedSellerId = vendedorIdentificadoRef.current?.vendedorId || vendedorId || currentUser.uid;
        const sellerSnap = await transaction.get(doc(db, 'usuarios', selectedSellerId));
        const sellerProfile = sellerSnap.exists() ? sellerSnap.data() : {};
        if (!sellerSnap.exists() || sellerProfile.tenantId !== tenantId) {
          throw new Error('O vendedor selecionado não pertence à empresa ativa.');
        }
        const sellerName = sellerProfile.nome || sellerProfile.nomeResponsavel || currentUser.displayName || currentUser.email || 'Vendedor';

        const preVendaRef = regravando ? doc(db, 'pedidos_venda', id!) : doc(collection(db, 'pedidos_venda'));
        preVendaId = preVendaRef.id;

        // Toda leitura antes de qualquer escrita (regra do Firestore).
        const existingSnap = regravando ? await transaction.get(preVendaRef) : null;
        if (regravando && !existingSnap?.exists()) {
          throw new Error('Esta pré-venda não existe mais.');
        }
        const existingData = existingSnap?.data();
        if (regravando && !isPedidoAberto(existingData?.status)) {
          // Alguem finalizou ou cancelou esta pre-venda em outra tela/aba
          // enquanto ela estava aberta aqui. Regravar por cima
          // ressuscitaria um pedido ja faturado.
          throw new Error('Esta pré-venda não está mais em aberto. Recarregue a tela.');
        }

        const reservaAtual = existingData?.estoqueReservado === true
          ? toStockAdjustmentItems(existingData.itens || [])
          : [];
        const reservaNova = toStockAdjustmentItems(itens);

        if (!regravando) {
          numeroGravado = formatSequenceValue(nextPedido, 4);
        } else {
          numeroGravado = existingData?.numeroPedido || numeroPedido;
        }

        // Reconciliacao, nao soma: se o item ja estava reservado por esta
        // mesma pre-venda, so a DIFERENCA e' aplicada. Reservar de novo por
        // cima duplicaria a reserva a cada regravacao e o produto sumiria
        // do disponivel sem ninguem ter vendido nada.
        const deltasReserva = computeReservationDelta(reservaAtual, reservaNova);
        if (deltasReserva.length > 0) {
          await applyStockFieldDeltas(transaction, db, deltasReserva, permitirVendaSemEstoque);
        }

        if (!regravando) {
          writeTenantSequenceValue(transaction, db, tenantId, 'pedidos_venda', nextPedido);
        }

        const preVendaData = {
          numeroPedido: numeroGravado,
          clienteId: clienteIdParaSalvar,
          clienteNome: finalClienteNome,
          itens,
          valorTotalItens,
          valorTotalItensCentavos: toCents(valorTotalItens),
          valorTotalDescontos,
          valorTotalDescontosCentavos: toCents(valorTotalDescontos),
          descontoGeral: {
            tipo: descontoGeralInput.tipo,
            valorInformado: Number(descontoGeralInput.valor.replace(',', '.')) || 0,
            valorAplicadoCentavos: descontoGeralCents,
            excedeuLimite: checagemLimiteDesconto.excedeu,
          },
          frete: Number(frete || 0),
          encargos: Number(encargos || 0),
          valorTotal: valorTotalPedido,
          valorTotalCentavos: valorTotalPedidoCentavos,
          dataVenda,
          status: STATUS_PRE_VENDA,
          origem: 'balcao' as OrigemPedido,
          // O que separa pre-venda de venda: o estoque esta SEPARADO, nao
          // baixado. A baixa real acontece so na finalizacao, que consome
          // esta reserva.
          estoqueReservado: itens.length > 0,
          tenantId,
          usuarioResponsavelId: currentUser.uid,
          vendedorId: selectedSellerId,
          vendedorNome: sellerName,
          ...(regravando
            ? {
                createdAt: existingData?.createdAt ?? serverTimestamp(),
                criadoPor: existingData?.criadoPor ?? currentUser.uid,
                criadoEm: existingData?.criadoEm ?? serverTimestamp(),
                ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Pré-venda alterada'),
              }
            : {
                createdAt: serverTimestamp(),
                ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
              }),
        };

        transaction.set(preVendaRef, preVendaData);
      });

      try {
        const { createAuditLog } = await import('../../services/logService');
        createAuditLog({
          tenantId: tenantId || '',
          usuarioId: currentUser.uid,
          usuarioEmail: currentUser.email || currentUser.uid,
          modulo: 'vendas',
          acao: isPreVendaAberta ? 'edicao' : 'criacao',
          descricao: `Pré-venda #${numeroGravado} ${isPreVendaAberta ? 'alterada' : 'gravada'} no valor de R$ ${valorTotalPedido.toFixed(2)}. Cliente: ${finalClienteNome}`,
          registroRelacionadoId: preVendaId,
          status: 'sucesso',
        });
      } catch (err) {
        console.error('Erro ao registrar log da pré-venda:', err);
      }

      setNumeroPedido(numeroGravado);
      setStatus(STATUS_PRE_VENDA);
      setOrigemPedido('balcao');
      initialSnapshotRef.current = buildDirtySnapshot();
      setIsDirty(false);
      // Operacao concluida: a proxima venda pede identificacao de novo.
      esquecerVendedorIdentificado();
      gravouComSucesso = true;

      await showSuccess(`Pré-venda #${numeroGravado} gravada! O estoque foi reservado.`);
      if (!isPreVendaAberta) navigate(`/pedidos-venda/visualizar/${preVendaId}`);
    } catch (error) {
      console.error('Erro ao gravar pré-venda:', error);
      showError('Erro ao gravar pré-venda', error instanceof Error ? error.message : 'Tente novamente.');
    } finally {
      setIsLoading(false);
      submitLockRef.current = false;
    }

    return gravouComSucesso;
  };

  /**
   * Cancela uma pre-venda em aberto: libera a reserva de estoque e marca o
   * documento como Cancelada. Nao mexe em financeiro porque nunca houve --
   * e' justamente o que diferencia isto de estornar uma venda finalizada.
   */
  const handleCancelarPreVenda = async () => {
    if (!currentUser || !tenantId || !id) return;

    const confirm = await NexusSwal.fire({
      title: 'Cancelar esta pré-venda?',
      text: 'O estoque reservado volta a ficar disponível para venda. A pré-venda fica registrada como cancelada.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sim, cancelar',
      cancelButtonText: 'Voltar',
      confirmButtonColor: '#ef4444',
      reverseButtons: true,
    });
    if (!confirm.isConfirmed) return;

    setIsLoading(true);
    try {
      await runTransaction(db, async (transaction) => {
        const preVendaRef = doc(db, 'pedidos_venda', id);
        const snap = await transaction.get(preVendaRef);
        if (!snap.exists()) throw new Error('Esta pré-venda não existe mais.');
        const data = snap.data();
        if (!isPedidoAberto(data.status)) {
          throw new Error('Esta pré-venda não está mais em aberto. Recarregue a tela.');
        }

        if (data.estoqueReservado === true) {
          // Libera a reserva sem devolver quantidade: nada foi baixado do
          // estoque, entao nao ha o que devolver -- so soltar o que estava
          // separado.
          await applyStockFieldDeltas(
            transaction,
            db,
            computeReservationRelease(toStockAdjustmentItems(data.itens || [])),
            true
          );
        }

        transaction.update(preVendaRef, {
          status: STATUS_CANCELADA,
          estoqueReservado: false,
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Pré-venda cancelada'),
        });
      });

      try {
        const { createAuditLog } = await import('../../services/logService');
        createAuditLog({
          tenantId: tenantId || '',
          usuarioId: currentUser.uid,
          usuarioEmail: currentUser.email || currentUser.uid,
          modulo: 'vendas',
          acao: 'exclusao',
          descricao: `Pré-venda #${numeroPedido} cancelada. Estoque reservado liberado.`,
          registroRelacionadoId: id,
          status: 'sucesso',
        });
      } catch (err) {
        console.error('Erro ao registrar log de cancelamento da pré-venda:', err);
      }

      setIsDirty(false);
      await showSuccess('Pré-venda cancelada e estoque liberado.');
      navigate('/pedidos-venda');
    } catch (error) {
      console.error('Erro ao cancelar pré-venda:', error);
      showError('Erro ao cancelar', error instanceof Error ? error.message : 'Tente novamente.');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Corrige a FORMA DE PAGAMENTO de uma venda ja finalizada -- o caso real e'
   * "registrou dinheiro, era cartao". O valor total da venda NAO muda:
   * normalizePayments() e' chamado com o mesmo total, entao a soma dos
   * pagamentos continua batendo com a venda; o que muda e' so a composicao.
   *
   * Refaz junto o que a composicao antiga tinha gerado: os lancamentos em
   * `transacoes` e o credito nos bancos. Corrigir so o rotulo no pedido e
   * deixar o financeiro velho de pe seria pior que nao ter a funcao.
   *
   * TRAVAS (todas obrigatorias, nenhuma contornavel por permissao):
   *  - cupom fiscal autorizado bloqueia: NFC-e transmitida a SEFAZ e'
   *    imutavel, e a forma de pagamento vai dentro dela;
   *  - venda com devolucao bloqueia: o valor ja se moveu por outro caminho;
   *  - lancamento ja estornado bloqueia: mexer por cima de um estorno
   *    duplicaria historico. Nesses casos o caminho certo e' Estorno ou
   *    Devolucao, que preservam o que aconteceu de verdade.
   */
  const handleSalvarPagamentoAlterado = async () => {
    if (submitLockRef.current) return;
    if (!currentUser || !tenantId || !id) return;

    if (nfceAutorizada) {
      showError('Operação Bloqueada', 'Esta venda tem cupom fiscal (NFC-e) autorizado. A nota já foi transmitida à SEFAZ e não pode ser alterada. Para corrigir, cancele o cupom fiscal primeiro.');
      return;
    }
    if (vendaTemDevolucao) {
      showError('Operação Bloqueada', 'Esta venda tem itens devolvidos. Como o valor já se moveu pela devolução, a forma de pagamento não pode mais ser alterada por aqui.');
      return;
    }

    let paymentRecords: PaymentRecord[];
    try {
      paymentRecords = normalizePayments(valorTotalPedidoCentavos, paymentDrafts, {
        saleDate: dataVenda,
        maxCreditInstallments: financeConfig.maxCreditInstallments || undefined,
        creditFeePercentByInstallment: financeConfig.creditFeePercentByInstallment,
        debitFeePercent: financeConfig.debitFeePercent,
        creditSettlementDays: financeConfig.creditSettlementDays,
        debitSettlementDays: financeConfig.debitSettlementDays,
        cardFeeSchedulesByBrand,
      });
    } catch (error) {
      showError('Pagamento inválido', error instanceof Error ? error.message : 'Revise os dados do pagamento.');
      return;
    }
    paymentRecords = explodeInstallmentPaymentRecords(paymentRecords);
    const paymentSummary = summarizePayments(paymentRecords);

    const confirm = await NexusSwal.fire({
      title: 'Alterar forma de pagamento?',
      html: `O valor da venda continua <strong>${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valorTotalPedido)}</strong>.<br/><br/>Os lançamentos financeiros desta venda serão refeitos com a nova forma de pagamento, e o saldo dos bancos será ajustado.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sim, alterar',
      cancelButtonText: 'Cancelar',
      reverseButtons: true,
    });
    if (!confirm.isConfirmed) return;

    submitLockRef.current = true;
    setIsLoading(true);
    try {
      const saleRef = doc(db, 'pedidos_venda', id);
      // Refs dos lancamentos atuais levantados FORA da transacao (query nao
      // roda dentro dela) -- mesmo padrao do cancelamento de venda.
      const transacoesSnap = await getDocs(query(
        collection(db, 'transacoes'),
        where('tenantId', '==', tenantId),
        where('pedidoId', '==', id),
      ));
      const refsAntigas = transacoesSnap.empty
        ? [doc(db, 'transacoes', id)]
        : transacoesSnap.docs.map((documento) => documento.ref);

      const persistedPayments = paymentRecords.map((payment, index) => ({
        ...payment,
        transactionId: index === 0 ? id : `${id}_pag_${index + 1}`,
      }));

      await runTransaction(db, async (transaction) => {
        const saleSnap = await transaction.get(saleRef);
        if (!saleSnap.exists()) throw new Error('Esta venda não existe mais.');
        const saleData = saleSnap.data();
        if (saleData.status !== 'Finalizada') {
          throw new Error('Esta venda não está mais finalizada. Recarregue a tela.');
        }

        const snapshotsAntigos = await Promise.all(refsAntigas.map((ref) => transaction.get(ref)));
        const jaEstornada = snapshotsAntigos.some((snapshot) => snapshot.exists() && snapshot.data()?.estornada === true);
        if (jaEstornada) {
          throw new Error('Esta venda já tem lançamento estornado. Use Estorno ou Devolução em vez de alterar o pagamento.');
        }

        // Delta por banco: tira o que a composicao ANTIGA creditou e poe o
        // que a NOVA credita. Bancos que aparecem so de um lado entram com
        // um dos termos zerado, e o delta resolve sozinho.
        const creditosAntigos = computeBankCreditsMap(saleData.pagamentos || []);
        const creditosNovos = computeBankCreditsMap(persistedPayments);
        const saldosPorBanco = new Map<string, number>();
        for (const bancoId of new Set([...creditosAntigos.keys(), ...creditosNovos.keys()])) {
          const bancoSnap = await transaction.get(doc(db, 'bancos', bancoId));
          if (!bancoSnap.exists()) {
            if (creditosNovos.has(bancoId)) throw new Error('O banco de destino selecionado não foi encontrado.');
            continue; // banco do credito antigo nao existe mais: reversao segue sem quebrar
          }
          saldosPorBanco.set(bancoId, Number(bancoSnap.data().saldoCentavos || 0));
        }

        saldosPorBanco.forEach((saldoAtual, bancoId) => {
          const delta = (creditosNovos.get(bancoId) || 0) - (creditosAntigos.get(bancoId) || 0);
          if (delta === 0) return;
          transaction.update(doc(db, 'bancos', bancoId), {
            saldoCentavos: saldoAtual + delta,
            updatedAt: serverTimestamp(),
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), `Ajuste de forma de pagamento da venda #${numeroPedido}`),
          });
        });

        const idsNovos = new Set(persistedPayments.map((payment) => payment.transactionId));
        persistedPayments.forEach((payment) => {
          const parcelaLabel = payment.cartao?.numero
            ? ` (Parcela ${payment.cartao.numero}/${payment.cartao.totalParcelas})`
            : '';
          transaction.set(doc(db, 'transacoes', payment.transactionId), {
            descricao: `Venda Direta #${numeroPedido} - ${payment.formaPagamento}${parcelaLabel}`,
            categoria: 'Venda de Peças',
            valor: payment.valor,
            valorCentavos: payment.valorCentavos,
            valorBruto: payment.valor,
            valorBrutoCentavos: payment.valorCentavos,
            valorTaxa: payment.cartao?.valorTaxa || 0,
            valorTaxaCentavos: payment.cartao?.valorTaxaCentavos || 0,
            valorLiquido: payment.cartao?.valorLiquido ?? payment.valor,
            valorLiquidoCentavos: payment.cartao?.valorLiquidoCentavos ?? payment.valorCentavos,
            tipo: 'entrada',
            formaPagamento: payment.formaPagamento,
            condicaoPagamento: payment.condicaoPagamento,
            status: payment.status === 'confirmado' ? 'Paga' : 'Pendente',
            naturezaFinanceira: payment.naturezaFinanceira,
            movimentaCaixaFisico: payment.movimentaCaixaFisico,
            bancoId: payment.bancoId || null,
            bancoNome: payment.bancoNome || null,
            prazoDias: payment.prazoDias || null,
            data: payment.dataVencimento || saleData.dataVenda || dataVenda,
            dataVencimento: payment.dataVencimento || null,
            dataPrevistaRecebimento: payment.dataPrevistaRecebimento || null,
            cartao: payment.cartao || null,
            pedidoId: id,
            sourceType: 'pedido_venda',
            sourceId: id,
            paymentIndex: payment.indice,
            idempotencyKey: `pedido:${id}:pagamento:${payment.indice}`,
            clienteId: saleData.clienteId ?? null,
            clienteNome: saleData.clienteNome ?? clienteNome,
            usuarioResponsavelId: saleData.usuarioResponsavelId ?? currentUser.uid,
            vendedorId: saleData.vendedorId ?? vendedorId,
            tenantId,
            createdAt: saleData.createdAt ?? serverTimestamp(),
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Forma de pagamento corrigida'),
          });
        });

        // A composicao nova pode ter MENOS lancamentos que a antiga (ex:
        // 3 parcelas viraram 1 a vista). Os que sobraram tem que sumir,
        // senao a venda passaria a ter recebimento a mais no financeiro.
        snapshotsAntigos.forEach((snapshot) => {
          if (snapshot.exists() && !idsNovos.has(snapshot.id)) {
            transaction.delete(snapshot.ref);
          }
        });

        transaction.update(saleRef, {
          formaPagamento: paymentSummary.paymentMethodLabel,
          condicaoPagamento: paymentSummary.paymentCondition,
          pagamentos: persistedPayments,
          totalRecebido: paymentSummary.received,
          totalRecebidoCentavos: paymentSummary.receivedCents,
          totalPendente: paymentSummary.pending,
          totalPendenteCentavos: paymentSummary.pendingCents,
          totalTaxasPagamento: paymentSummary.cardFee,
          totalTaxasPagamentoCentavos: paymentSummary.cardFeeCents,
          totalLiquidoFinanceiro: paymentSummary.financialNet,
          totalLiquidoFinanceiroCentavos: paymentSummary.financialNetCents,
          pagamentoAlteradoEm: serverTimestamp(),
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Forma de pagamento alterada em venda finalizada'),
        });
      });

      try {
        const { createAuditLog } = await import('../../services/logService');
        createAuditLog({
          tenantId: tenantId || '',
          usuarioId: currentUser.uid,
          usuarioEmail: currentUser.email || currentUser.uid,
          modulo: 'vendas',
          acao: 'edicao',
          descricao: `Forma de pagamento da venda #${numeroPedido} alterada de "${formaPagamento}" para "${paymentSummary.paymentMethodLabel}". Valor mantido em R$ ${valorTotalPedido.toFixed(2)}.`,
          registroRelacionadoId: id,
          status: 'sucesso',
        });
      } catch (err) {
        console.error('Erro ao registrar log da alteração de pagamento:', err);
      }

      setFormaPagamento(paymentSummary.paymentMethodLabel);
      setEditandoPagamento(false);
      setIsDirty(false);
      showSuccess('Forma de pagamento alterada e financeiro refeito.');
    } catch (error) {
      console.error('Erro ao alterar forma de pagamento:', error);
      showError('Erro ao alterar pagamento', error instanceof Error ? error.message : 'Tente novamente.');
    } finally {
      setIsLoading(false);
      submitLockRef.current = false;
    }
  };

  const handleFinalizarVenda = async (): Promise<boolean> => {
    if (submitLockRef.current) return false;
    if (!currentUser || !tenantId) return false;
    if (itens.length === 0) {
      showError('Atenção', 'Adicione pelo menos um item à venda.');
      return false;
    }

    if (!garantirVendedorIdentificado(
      () => { void handleFinalizarVenda(); },
      `Finalizar venda de ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valorTotalPedido)}`,
    )) return false;

    // Nivel 2 (sistema): desconto TOTAL da venda contra o limite configurado
    // pra esta tela, reagindo conforme o modo escolhido em Configuracoes.
    if (checagemLimiteDesconto.excedeu) {
      if (modoLimiteDesconto === 'bloquear') {
        showError('Desconto acima do limite', `O desconto desta venda (${checagemLimiteDesconto.percentualAplicado.toFixed(1)}%) excede o limite configurado para Pedido de Venda. Reduza o desconto para continuar.`);
        return false;
      }
      if (modoLimiteDesconto === 'senha' && !aprovacaoDesconto) {
        setShowAprovacaoDesconto(true);
        return false;
      }
      if (modoLimiteDesconto === 'avisar') {
        const confirm = await NexusSwal.fire({
          title: 'Desconto acima do limite',
          text: `O desconto desta venda (${checagemLimiteDesconto.percentualAplicado.toFixed(1)}%) excede o limite configurado para Pedido de Venda. Deseja finalizar mesmo assim?`,
          icon: 'warning',
          showCancelButton: true,
          confirmButtonText: 'Finalizar mesmo assim',
          cancelButtonText: 'Revisar desconto',
        });
        if (!confirm.isConfirmed) return false;
      }
    }

    let paymentRecords: PaymentRecord[];
    try {
      paymentRecords = normalizePayments(valorTotalPedidoCentavos, paymentDrafts, {
        saleDate: dataVenda,
        maxCreditInstallments: financeConfig.maxCreditInstallments || undefined,
        creditFeePercentByInstallment: financeConfig.creditFeePercentByInstallment,
        debitFeePercent: financeConfig.debitFeePercent,
        creditSettlementDays: financeConfig.creditSettlementDays,
        debitSettlementDays: financeConfig.debitSettlementDays,
        cardFeeSchedulesByBrand,
      });
    } catch (error) {
      showError('Pagamento inválido', error instanceof Error ? error.message : 'Revise os dados do pagamento.');
      return false;
    }
    paymentRecords = explodeInstallmentPaymentRecords(paymentRecords);
    const paymentSummary = summarizePayments(paymentRecords);

    let finalClienteNome = clienteNome.trim().toUpperCase();
    const nomeClienteDigitadoOriginal = clienteNome.trim();
    if (!finalClienteNome) {
      finalClienteNome = 'CONSUMIDOR FINAL';
      setClienteNome('CONSUMIDOR FINAL');
    }

    const clienteEncontrado = clientesDisponiveis.find(c => c.nome.toUpperCase() === finalClienteNome);

    // Validacao de Cliente Cadastrado: decide ANTES de travar o botao se da
    // pra seguir digitando um nome sem cadastro (permitir), se bloqueia, ou
    // se pergunta antes de continuar.
    const acaoValidacaoCliente = resolverAcaoValidacaoCliente(modoValidacaoCliente, !!clienteEncontrado, nomeClienteDigitadoOriginal);
    if (acaoValidacaoCliente.tipo === 'bloquear') {
      showError('Cliente não cadastrado', acaoValidacaoCliente.motivo);
      return false;
    }
    if (acaoValidacaoCliente.tipo === 'perguntar') {
      const confirmCadastro = await NexusSwal.fire({
        title: 'Cliente não cadastrado',
        text: `"${finalClienteNome}" ainda não tem cadastro. Deseja cadastrar agora?`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Cadastrar cliente',
        cancelButtonText: 'Cancelar',
      });
      if (confirmCadastro.isConfirmed) setCadastroRapidoAberto(true);
      return false;
    }

    submitLockRef.current = true;
    setIsLoading(true);
    let saveSucceeded = false;

    try {
      // 1. Cadastrar Cliente (se não existir)
      let clienteIdParaSalvar: string | null = clienteEncontrado?.id || null;
      if (!clienteEncontrado) {
        const codigoCliente = await getProximoCodigoCliente(tenantId);
        const novoClienteRef = await addDoc(collection(db, 'clientes'), {
          codigo: codigoCliente,
          nome: finalClienteNome,
          isPadrao: finalClienteNome === 'CONSUMIDOR FINAL',
          tenantId: tenantId || '',
          createdAt: serverTimestamp(),
          ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
        });
        clienteIdParaSalvar = novoClienteRef.id;
      }

      // Limite de Credito: so entra em jogo em venda a prazo, com a config
      // ligada. Cliente sem limite cadastrado (inclusive um recem-criado
      // acima, ou "CONSUMIDOR FINAL") bloqueia por "sem_limite" -- nao ha
      // como fiar pra quem nao tem limite definido.
      if (trabalhaComLimiteCredito && paymentSummary.paymentCondition === 'aprazo') {
        const limiteDeCreditoCents = clienteEncontrado?.limiteDeCredito != null
          ? Math.round(clienteEncontrado.limiteDeCredito * 100)
          : null;
        const saldoEmAbertoCents = clienteIdParaSalvar
          ? await calcularSaldoEmAbertoClienteCents(tenantId, clienteIdParaSalvar)
          : 0;
        const checagemCredito = excedeLimiteCredito(limiteDeCreditoCents, saldoEmAbertoCents, valorTotalPedidoCentavos);
        if (checagemCredito.bloqueado) {
          const motivoTexto = checagemCredito.motivo === 'sem_limite'
            ? `O cliente "${finalClienteNome}" não tem limite de crédito cadastrado. Não é possível vender a prazo.`
            : `Esta venda ultrapassaria o limite de crédito do cliente (saldo em aberto + valor desta venda).`;
          throw new Error(motivoTexto);
        }
      }

      // Finalizando um pedido que JA EXISTE gravado (pre-venda do balcao ou
      // pedido do agente): o documento e o numero ja existem, entao nao
      // aloca sequencia nova -- senao os numeros ficariam pulados. Venda
      // direta (sem passar por pedido aberto) segue alocando como sempre.
      const finalizandoPedidoAberto = pedidoEstaAberto;
      const currentMaxPedido = finalizandoPedidoAberto
        ? 0
        : await getCurrentMaxSequence(db, 'pedidos_venda', tenantId, 'numeroPedido').catch(() => 0);
      let newPedidoId = '';
      let finalNumeroPedido = numeroPedido;

      const bankCreditsByBanco = new Map<string, number>();
      paymentRecords.forEach((payment) => {
        if (payment.status === 'confirmado' && payment.bancoId) {
          bankCreditsByBanco.set(payment.bancoId, (bankCreditsByBanco.get(payment.bancoId) || 0) + payment.valorCentavos);
        }
      });

      await runTransaction(db, async (transaction) => {
        const nextPedido = finalizandoPedidoAberto
          ? 0
          : await getNextTenantSequenceValue(transaction, db, tenantId, 'pedidos_venda', currentMaxPedido);
        // Vendedor identificado pelo popup vence o estado da tela: quando a
        // identificacao acabou de acontecer, o setState ainda nao chegou
        // neste closure, e usar o state vendedorId carimbaria a venda na
        // pessoa errada. Ver vendedorIdentificadoRef.
        const selectedSellerId = vendedorIdentificadoRef.current?.vendedorId || vendedorId || currentUser.uid;
        const sellerSnap = await transaction.get(doc(db, 'usuarios', selectedSellerId));
        const sellerProfile = sellerSnap.exists() ? sellerSnap.data() : {};
        if (!sellerSnap.exists() || sellerProfile.tenantId !== tenantId) {
          throw new Error('O vendedor selecionado não pertence à empresa ativa.');
        }
        const sellerName = sellerProfile.nome || sellerProfile.nomeResponsavel || currentUser.displayName || currentUser.email || 'Vendedor';

        const bankBalancesById = new Map<string, number>();
        for (const bancoId of bankCreditsByBanco.keys()) {
          const bancoSnap = await transaction.get(doc(db, 'bancos', bancoId));
          if (!bancoSnap.exists()) throw new Error('O banco de destino selecionado não foi encontrado.');
          bankBalancesById.set(bancoId, Number(bancoSnap.data().saldoCentavos || 0));
        }

        const newPedidoRef = finalizandoPedidoAberto ? doc(db, 'pedidos_venda', id!) : doc(collection(db, 'pedidos_venda'));
        newPedidoId = newPedidoRef.id;

        // Le o documento aberto ANTES de qualquer escrita da transacao
        // (regra do Firestore: toda leitura vem antes de qualquer escrita)
        // pra preservar createdAt/criadoPor/criadoEm originais -- finalizar
        // uma pre-venda ou um pedido do agente nao deve apagar quando ele
        // foi criado de verdade, so registrar quem finalizou.
        const existingPedidoSnap = finalizandoPedidoAberto ? await transaction.get(newPedidoRef) : null;
        if (finalizandoPedidoAberto && !existingPedidoSnap?.exists()) {
          throw new Error('Este pedido não existe mais.');
        }
        // Reserva conforme gravada NO BANCO (nao a da tela): e' o que
        // precisa ser liberado do estoque agora que a baixa vira real.
        const pedidoAbertoData = existingPedidoSnap?.data();
        const reservaGravada = pedidoAbertoData?.estoqueReservado === true
          ? toStockAdjustmentItems(pedidoAbertoData.itens || [])
          : [];

        if (!finalizandoPedidoAberto) {
          finalNumeroPedido = formatSequenceValue(nextPedido, 4);
        }

        if (reservaGravada.length > 0) {
          // Pre-venda finalizando: libera 100% da reserva e debita de
          // verdade os itens atuais. Os dois lados podem divergir -- o
          // usuario pode ter mexido nos itens na mesma tela que finaliza --
          // e computeReservationCommit trata exatamente esse caso.
          // Debitar direto aqui deixaria a reserva pendurada pra sempre,
          // inflando o "reservado" do produto sem nenhuma pre-venda viva.
          await applyStockFieldDeltas(
            transaction,
            db,
            computeReservationCommit(reservaGravada, toStockAdjustmentItems(itens)),
            permitirVendaSemEstoque
          );
        } else {
          await applyStockAdjustments(
            transaction,
            db,
            toStockAdjustmentItems(itens),
            'decrement',
            permitirVendaSemEstoque
          );
        }

        if (!finalizandoPedidoAberto) {
          writeTenantSequenceValue(transaction, db, tenantId, 'pedidos_venda', nextPedido);
        }

        const persistedPayments = paymentRecords.map((payment, index) => ({
          ...payment,
          transactionId: index === 0 ? newPedidoRef.id : `${newPedidoRef.id}_pag_${index + 1}`,
        }));
        const commissionBaseCents = itens.reduce((sum, item) => sum + toCents(item.subtotal), 0);
        const commissionSnapshot = buildCommissionSnapshot({
          sellerId: selectedSellerId,
          sellerName,
          baseCents: commissionBaseCents,
          profile: sellerProfile,
        });

        const pedidoData = {
          numeroPedido: finalNumeroPedido,
          clienteId: clienteIdParaSalvar,
          clienteNome: finalClienteNome,
          itens,
          valorTotalItens,
          valorTotalItensCentavos: toCents(valorTotalItens),
          valorTotalDescontos,
          valorTotalDescontosCentavos: toCents(valorTotalDescontos),
          // Snapshot do desconto GERAL (nao dos descontos de item, ja
          // embutidos em cada item de `itens`) -- usado pelo relatorio de
          // descontos concedidos (Fatia 6).
          descontoGeral: {
            tipo: descontoGeralInput.tipo,
            valorInformado: Number(descontoGeralInput.valor.replace(',', '.')) || 0,
            valorAplicadoCentavos: descontoGeralCents,
            excedeuLimite: checagemLimiteDesconto.excedeu,
            ...(checagemLimiteDesconto.excedeu && aprovacaoDesconto
              ? { aprovacao: { modo: 'senha' as const, ...aprovacaoDesconto, aprovadoEm: new Date().toISOString() } }
              : {}),
          },
          frete: Number(frete || 0),
          encargos: Number(encargos || 0),
          valorTotal: valorTotalPedido,
          valorTotalCentavos: valorTotalPedidoCentavos,
          formaPagamento: paymentSummary.paymentMethodLabel,
          condicaoPagamento: paymentSummary.paymentCondition,
          pagamentos: persistedPayments,
          totalRecebido: paymentSummary.received,
          totalRecebidoCentavos: paymentSummary.receivedCents,
          totalPendente: paymentSummary.pending,
          totalPendenteCentavos: paymentSummary.pendingCents,
          totalTaxasPagamento: paymentSummary.cardFee,
          totalTaxasPagamentoCentavos: paymentSummary.cardFeeCents,
          totalLiquidoFinanceiro: paymentSummary.financialNet,
          totalLiquidoFinanceiroCentavos: paymentSummary.financialNetCents,
          dataVenda,
          status: 'Finalizada',
          // Modulo 12 (Conferencia de mercadoria): so grava o campo quando a
          // chave-mestra esta ligada -- Firestore rejeita `undefined` como
          // valor de campo, entao o jeito de "nao gravar" e' nao incluir a
          // chave no objeto. Tenant com a config desligada continua
          // gravando exatamente o que gravava antes desta fatia.
          ...(conferenciaMercadoriaAtiva ? { statusConferencia: 'aguardando' as StatusConferencia } : {}),
          tenantId,
          usuarioResponsavelId: currentUser.uid,
          vendedorId: selectedSellerId,
          vendedorNome: sellerName,
          comissao: commissionSnapshot,
          // Origem preservada: uma venda que nasceu de pre-venda continua
          // sabendo que veio do balcao, e a que veio do WhatsApp continua
          // marcada como do agente depois de faturada.
          origem: finalizandoPedidoAberto ? origemPedido : 'balcao',
          // A reserva foi consumida pela baixa real logo acima -- o
          // documento nao pode continuar dizendo que reserva estoque, senao
          // um cancelamento futuro tentaria liberar reserva que nao existe
          // mais e devolveria quantidade a maior pro estoque.
          estoqueReservado: false,
          // Pedido aberto (pre-venda do balcao ou pendente do agente)
          // preserva createdAt/criadoPor/criadoEm originais -- quando o
          // pedido foi criado de verdade -- e so grava quem finalizou.
          // Firestore rejeita campo com valor undefined (quebraria a
          // transacao inteira), entao cai num fallback seguro se esses
          // campos nao estiverem gravados: no caso do agente, nao da pra
          // depender de uma integracao externa manter um contrato de
          // metadados a risca.
          ...(finalizandoPedidoAberto
            ? {
                createdAt: pedidoAbertoData?.createdAt ?? serverTimestamp(),
                criadoPor: pedidoAbertoData?.criadoPor ?? currentUser.uid,
                criadoEm: pedidoAbertoData?.criadoEm ?? serverTimestamp(),
                ...buildDocumentUpdateMetadata(
                  currentUser.uid,
                  serverTimestamp(),
                  isPendingFromAgent ? 'Pedido pendente do agente finalizado' : 'Pré-venda finalizada',
                ),
              }
            : {
                createdAt: serverTimestamp(),
                ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
              }),
        };

        transaction.set(newPedidoRef, pedidoData);

        bankCreditsByBanco.forEach((deltaCents, bancoId) => {
          transaction.update(doc(db, 'bancos', bancoId), {
            saldoCentavos: (bankBalancesById.get(bancoId) || 0) + deltaCents,
            updatedAt: serverTimestamp(),
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), `Crédito da venda #${finalNumeroPedido}`),
          });
        });

        persistedPayments.forEach((payment) => {
          const parcelaLabel = payment.cartao?.numero
            ? ` (Parcela ${payment.cartao.numero}/${payment.cartao.totalParcelas})`
            : '';
          transaction.set(doc(db, 'transacoes', payment.transactionId), {
            descricao: `Venda Direta #${finalNumeroPedido} - ${payment.formaPagamento}${parcelaLabel}`,
            categoria: 'Venda de Peças',
            valor: payment.valor,
            valorCentavos: payment.valorCentavos,
            valorBruto: payment.valor,
            valorBrutoCentavos: payment.valorCentavos,
            valorTaxa: payment.cartao?.valorTaxa || 0,
            valorTaxaCentavos: payment.cartao?.valorTaxaCentavos || 0,
            valorLiquido: payment.cartao?.valorLiquido ?? payment.valor,
            valorLiquidoCentavos: payment.cartao?.valorLiquidoCentavos ?? payment.valorCentavos,
            tipo: 'entrada',
            formaPagamento: payment.formaPagamento,
            condicaoPagamento: payment.condicaoPagamento,
            status: payment.status === 'confirmado' ? 'Paga' : 'Pendente',
            naturezaFinanceira: payment.naturezaFinanceira,
            movimentaCaixaFisico: payment.movimentaCaixaFisico,
            bancoId: payment.bancoId || null,
            bancoNome: payment.bancoNome || null,
            prazoDias: payment.prazoDias || null,
            data: payment.dataVencimento || dataVenda,
            dataVencimento: payment.dataVencimento || null,
            dataPrevistaRecebimento: payment.dataPrevistaRecebimento || null,
            cartao: payment.cartao || null,
            pedidoId: newPedidoRef.id,
            sourceType: 'pedido_venda',
            sourceId: newPedidoRef.id,
            paymentIndex: payment.indice,
            idempotencyKey: `pedido:${newPedidoRef.id}:pagamento:${payment.indice}`,
            clienteId: clienteIdParaSalvar,
            clienteNome: finalClienteNome,
            usuarioResponsavelId: currentUser.uid,
            vendedorId: selectedSellerId,
            tenantId,
            createdAt: serverTimestamp(),
            ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
          });
        });
      });

      setNumeroPedido(finalNumeroPedido);
      setFormaPagamento(paymentSummary.paymentMethodLabel);

      try {
        const { createAuditLog } = await import('../../services/logService');
        createAuditLog({
          tenantId: tenantId || '',
          usuarioId: currentUser.uid,
          usuarioEmail: currentUser.email || currentUser.uid,
          modulo: 'vendas',
          acao: 'criacao',
          descricao: `Venda Direta #${finalNumeroPedido} finalizada no valor de R$ ${valorTotalPedido.toFixed(2)}. Cliente: ${finalClienteNome || 'Geral'}`,
          registroRelacionadoId: newPedidoId,
          status: 'sucesso'
        });
      } catch (err) {
        console.error('Erro ao registrar log de criacao de venda:', err);
      }

      setIsLoading(false);
      // Operacao concluida: a proxima venda pede identificacao de novo.
      esquecerVendedorIdentificado();
      saveSucceeded = true;
      initialSnapshotRef.current = buildDirtySnapshot();
      setIsDirty(false);

      // Modulo 12 (Conferencia de mercadoria), Fatia 2/4: acrescenta UMA
      // etapa ao final do fluxo de recibo/NFC-e existente abaixo, sem
      // reorganiza-lo -- os 5 pontos de saida desse fluxo (sucesso NFC-e,
      // erro NFC-e com/sem fallback de recibo, Imprimir Recibo, Apenas
      // Concluir) passam a chamar isto em vez de `navigate` direto.
      const askMinutaAndNavigate = async (destino: string) => {
        if (conferenciaMercadoriaAtiva && imprimirMinutaAposVendaAtiva) {
          const minutaResult = await NexusSwal.fire({
            title: 'Imprimir minuta de entrega?',
            text: 'A minuta lista os itens do pedido, sem valores, para a separação no estoque.',
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Sim, imprimir minuta',
            cancelButtonText: 'Não'
          });
          if (minutaResult.isConfirmed) {
            navigate(`/operacoes/expedicao/minuta/${newPedidoId}`);
            return;
          }
        }
        navigate(destino);
      };

      // 5. Perguntar o que fazer
      const result = await NexusSwal.fire({
        title: 'Venda Finalizada com Sucesso!',
        text: 'O estoque foi atualizado e o financeiro lançado. O que deseja fazer agora?',
        icon: 'success',
        showDenyButton: true,
        confirmButtonText: 'Emitir Cupom Fiscal (NFC-e)',
        denyButtonText: 'Imprimir Recibo',
        cancelButtonText: 'Apenas Concluir',
        confirmButtonColor: '#10b981',
        denyButtonColor: '#3b82f6'
      });

      if (result.isConfirmed) {
        NexusSwal.fire({
          title: 'Emitindo Cupom Fiscal...',
          text: 'Enviando dados para a Spedy API / SEFAZ...',
          allowOutsideClick: false,
          didOpen: () => Swal.showLoading()
        });

        try {
          const runtimeConfig = await spedyService.getRuntimeConfig();
          if (!runtimeConfig.spedyEnabled || !runtimeConfig.spedyApiKeyConfigured) {
            throw new Error('A integração com a Spedy não está ativa ou configurada. Acesse as Configurações do sistema.');
          }

          const apiKey = '__backend_proxy__';
          const env = runtimeConfig.spedyEnvironment;

          // Prepara itens da NFC-e
          const payloadItems = [];
          for (const item of itens) {
            let ncm = '87082999'; // Default fallback para autopeças
            let cfop = 5102;      // Venda interna de mercadoria adquirida
            let csosn = 400;      // Isento Simples Nacional
            let origem = 0;       // Nacional

            let pesoLiquidoUnitarioKg = 0;

            if (item.id !== 'avulso') {
              const pRef = doc(db, 'estoque', item.id);
              const pSnap = await getDoc(pRef);
              if (pSnap.exists()) {
                const pData = pSnap.data();
                ncm = pData.ncm || ncm;
                cfop = Number(pData.cfop) || cfop;
                csosn = Number(pData.csosn) || csosn;
                origem = Number(pData.origem) || origem;
                pesoLiquidoUnitarioKg = Number(pData.pesoLiquidoUnitarioKg) || 0;
              }
            }

            const unitFields = resolveInvoiceUnitFields({
              cfop,
              unidadeComercial: item.unidadeMedidaSigla || 'UN',
              quantidadeComercial: item.quantidade,
              valorUnitarioComercial: item.precoUnitario,
              // O peso liquido do cadastro e por unidade BASE; quando o item foi
              // vendido em embalagem, cada unidade comercial pesa o fator vezes
              // mais (1 saco de 20kg = 20 x o peso do quilo).
              pesoLiquidoUnitarioKg: pesoLiquidoUnitarioKg * (item.fatorConversao ?? 1),
            });
            if (!unitFields.ok) {
              throw new Error(`${item.nome}: ${unitFields.error}`);
            }

            payloadItems.push({
              code: item.id === 'avulso' ? 'AVULSO' : item.id,
              description: item.nome,
              ncm,
              cfop,
              ...unitFields.fields!,
              totalAmount: item.precoUnitario * item.quantidade,
              makeupTotal: true,
              taxes: {
                icms: {
                  origin: origem,
                  csosn
                },
                pis: { cst: 7 },
                cofins: { cst: 7 }
              }
            });
          }

          // Prepara dados do destinatário (opcional para NFC-e se for Consumidor Final)
          let receiver = undefined;
          const isConsumidorFinal = finalClienteNome === 'CONSUMIDOR FINAL';

          if (!isConsumidorFinal) {
            const qClient = query(collection(db, 'clientes'), where('tenantId', '==', tenantId), where('nome', '==', finalClienteNome));
            const snapClient = await getDocs(qClient);
            if (!snapClient.empty) {
              const cData = snapClient.docs[0].data();
              const cDoc = (cData.documento || '').replace(/\D/g, '');
              const cCep = (cData.cep || '01001-000').replace(/\D/g, '');
              if (cDoc) {
                receiver = {
                  name: finalClienteNome,
                  federalTaxNumber: cDoc,
                  email: cData.email || undefined,
                  address: {
                    street: cData.endereco || 'Rua Principal',
                    number: cData.numero || '123',
                    district: cData.bairro || 'Centro',
                    postalCode: cCep,
                    city: {
                      code: cData.codigoIbge || '3550308',
                      name: cData.cidade || 'São Paulo',
                      state: cData.estado || 'SP'
                    }
                  }
                };
              }
            }
          }

          if (!receiver) {
            receiver = {
              name: 'Consumidor Final',
              federalTaxNumber: '12345678901', // CPF dummy para emissão anônima/teste
              address: {
                street: 'Rua Principal',
                number: '123',
                district: 'Centro',
                postalCode: '01001000',
                city: {
                  code: '3550308',
                  name: 'São Paulo',
                  state: 'SP'
                }
              }
            };
          }

          const spedyPayload = {
            isFinalCustomer: true,
            operationType: 'outgoing',
            destination: resolveInvoiceDestination(payloadItems.find((pi) => isExportCfop(pi.cfop))?.cfop, 'internal'),
            presenceType: 'presence',
            operationNature: 'Venda de Mercadoria',
            sendEmailToCustomer: false,
            integrationId: newPedidoId,
            receiver,
            items: payloadItems,
            payments: paymentRecords.map((payment) => ({
              method: toSpedyPaymentMethod(payment.formaPagamento),
              amount: payment.valor,
            })),
            total: {
              invoiceAmount: valorTotalPedido,
              productAmount: valorTotalItens
            }
          };

          const spedyNote = await spedyService.emitConsumerInvoice(apiKey, env, spedyPayload);

          // Polling para aguardar autorização (SEFAZ processa de forma assíncrona)
          NexusSwal.fire({
            title: 'Autorizando Cupom na SEFAZ...',
            text: 'Aguardando aprovação da nota fiscal eletrônica...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
          });

          let currentStatus = spedyNote.status;
          let finalNote = spedyNote;
          let attempts = 0;

          while (['enqueued', 'processing', 'created'].includes(currentStatus) && attempts < 10) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            try {
              finalNote = await spedyService.getConsumerInvoice(apiKey, env, spedyNote.id);
              currentStatus = finalNote.status;
            } catch (pollErr) {
              console.warn("Erro ao consultar status do cupom fiscal:", pollErr);
            }
            attempts++;
          }

          // Salva referência local no Firestore (com o status e número mais recente do polling)
          await addDoc(collection(db, 'notas_fiscais'), {
            spedyId: finalNote.id,
            number: finalNote.number,
            accessKey: finalNote.accessKey || null,
            tipo: 'NFC-e',
            clienteNome: finalClienteNome,
            valor: valorTotalPedido,
            status: finalNote.status,
            processingMessage: finalNote.processingDetail?.message || null,
            processingCode: finalNote.processingDetail?.code || null,
            tenantId,
            createdAt: serverTimestamp(),
            data: new Date().toISOString(),
            pedidoId: newPedidoId,
            ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
          });

          Swal.close();

          if (finalNote.status === 'authorized') {
            const printResult = await NexusSwal.fire({
              title: 'Cupom Fiscal Autorizado!',
              text: 'Deseja abrir o DANFE (Cupom) para impressão?',
              icon: 'success',
              showCancelButton: true,
              confirmButtonText: 'Sim, Abrir PDF',
              cancelButtonText: 'Fechar e Voltar'
            });

            if (printResult.isConfirmed) {
              await spedyService.openFiscalFile(finalNote.id, 'consumer', 'pdf');
            }
          } else if (['enqueued', 'processing', 'created'].includes(finalNote.status)) {
            await NexusSwal.fire({
              title: 'Cupom em Processamento',
              text: 'O cupom fiscal foi enviado com sucesso, mas o retorno da SEFAZ está demorando. Você poderá consultá-lo e imprimir o PDF mais tarde no menu Fiscal.',
              icon: 'info',
              confirmButtonText: 'Entendido'
            });
          } else {
            // Rejeitada / negada
            await NexusSwal.fire({
              title: 'Cupom Fiscal Rejeitado',
              text: `O cupom foi rejeitado pela SEFAZ: ${finalNote.processingDetail?.message || 'Motivo desconhecido.'} (Código: ${finalNote.processingDetail?.code || 'N/A'})`,
              icon: 'error',
              confirmButtonText: 'Entendido'
            });
          }

          await askMinutaAndNavigate('/pedidos-venda');

        } catch (err) {
          Swal.close();
          showError('Falha ao emitir NFC-e', (err as Error).message || 'Não foi possível transmitir o cupom fiscal.');

          const fallbackResult = await NexusSwal.fire({
            title: 'NFC-e não emitida',
            text: 'Ocorreu um erro ao emitir o cupom. Deseja imprimir o Recibo comum do pedido?',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Sim, Imprimir Recibo',
            cancelButtonText: 'Não, Apenas Sair'
          });
          if (fallbackResult.isConfirmed) {
            await askMinutaAndNavigate(`/pedidos-venda/print/${newPedidoId}`);
          } else {
            await askMinutaAndNavigate('/pedidos-venda');
          }
        }
      } else if (result.isDenied) {
        await askMinutaAndNavigate(`/pedidos-venda/print/${newPedidoId}`);
      } else {
        await askMinutaAndNavigate('/pedidos-venda');
      }

    } catch (error) {
      console.error('Erro ao finalizar venda:', error);
      const errorMessage = error instanceof Error ? error.message : '';
      showError('Erro', errorMessage ? `Não foi possível finalizar a venda. ${errorMessage}` : 'Não foi possível finalizar a venda.');
      setIsLoading(false);
    } finally {
      submitLockRef.current = false;
    }
    return saveSucceeded;
  };

  // Recusar um pedido pendente do agente -- so grava status: 'Cancelada' +
  // motivo, sem reverter estoque/financeiro (nada foi aplicado ainda pra um
  // pedido que nunca passou por handleFinalizarVenda). Mesmo padrao de
  // PedidoVendas.tsx (fila), so que a partir da tela de detalhe.
  const handleRecusarPendente = async () => {
    if (!currentUser || !tenantId || !id) return;

    const result = await NexusSwal.fire({
      title: 'Recusar Pedido Pendente?',
      html: `O pedido <strong>#${numeroPedido}</strong> veio de uma integração externa e ainda não gerou baixa de estoque nem lançamento financeiro — recusar só marca como cancelado, não reverte nada.<br/><br/>Digite o motivo (mínimo 8 caracteres):`,
      input: 'text',
      inputAttributes: { minlength: '8', required: 'true', placeholder: 'Motivo da recusa...' },
      showCancelButton: true,
      confirmButtonText: 'Confirmar Recusa',
      cancelButtonText: 'Voltar',
      confirmButtonColor: '#ef4444',
      preConfirm: (motivo) => {
        if (!motivo || motivo.trim().length < 8) {
          NexusSwal.showValidationMessage('O motivo deve ter pelo menos 8 caracteres.');
          return false;
        }
        return motivo;
      },
    });

    if (!result.isConfirmed) return;
    const motivo = (result.value as string).trim();

    try {
      await updateDoc(doc(db, 'pedidos_venda', id), {
        status: 'Cancelada',
        motivoRecusa: motivo,
        ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), `Pedido pendente recusado: ${motivo}`),
      });
      showSuccess('Pedido recusado.');
      navigate('/pedidos-venda');
    } catch {
      showError('Erro', 'Não foi possível recusar o pedido.');
    }
  };

  useUnsavedChangesGuard(isDirty, handleFinalizarVenda);

  const handleEmitirCupomVendaExistente = async () => {
    if (!currentUser || !tenantId || !id) return;

    setIsLoading(true);

    try {
      // 1. Verificar Integração Spedy
      const runtimeConfig = await spedyService.getRuntimeConfig();
      const spedyConfigured = runtimeConfig.spedyEnabled && runtimeConfig.spedyApiKeyConfigured;
      const apiKey = '__backend_proxy__';
      const env = runtimeConfig.spedyEnvironment;

      if (!spedyConfigured) {
        showError('Integração Inativa', 'O módulo da Spedy não está configurado ou ativado.');
        setIsLoading(false);
        return;
      }

      // 2. Montar os itens com a tributação do estoque
      const payloadItems = [];
      for (const item of itens) {
        let ncm = '87082999';
        let cfop = 5102;
        let csosn = 400;
        let origem = 0;

        let pesoLiquidoUnitarioKg = 0;

        if (item.id && item.id !== 'avulso') {
          try {
            const docRef = doc(db, 'estoque', item.id);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
              const pData = docSnap.data();
              ncm = pData.ncm || '87082999';
              cfop = Number(pData.cfop) || cfop;
              csosn = Number(pData.csosn) || csosn;
              origem = Number(pData.origem) || origem;
              pesoLiquidoUnitarioKg = Number(pData.pesoLiquidoUnitarioKg) || 0;
            }
          } catch (err) {
            console.error("Erro ao buscar dados fiscais do produto no estoque:", err);
          }
        }

        const unitFields = resolveInvoiceUnitFields({
          cfop,
          unidadeComercial: item.unidadeMedidaSigla || 'UN',
          quantidadeComercial: item.quantidade,
          valorUnitarioComercial: item.precoUnitario,
          // Mesma conversao do outro ponto de emissao: peso por unidade base
          // x fator da embalagem em que o item foi realmente vendido.
          pesoLiquidoUnitarioKg: pesoLiquidoUnitarioKg * (item.fatorConversao ?? 1),
        });
        if (!unitFields.ok) {
          throw new Error(`${item.nome}: ${unitFields.error}`);
        }

        payloadItems.push({
          code: item.id === 'avulso' ? 'AVULSO' : item.id,
          description: item.nome,
          ncm,
          cfop,
          ...unitFields.fields!,
          totalAmount: item.precoUnitario * item.quantidade,
          makeupTotal: true,
          taxes: {
            icms: {
              origin: origem,
              csosn
            },
            pis: { cst: 7 },
            cofins: { cst: 7 }
          }
        });
      }

      // 3. Destinatário
      let receiver = undefined;
      const isConsumidorFinal = clienteNome.toUpperCase() === 'CONSUMIDOR FINAL';

      if (!isConsumidorFinal) {
        const qClient = query(collection(db, 'clientes'), where('tenantId', '==', tenantId), where('nome', '==', clienteNome));
        const snapClient = await getDocs(qClient);
        if (!snapClient.empty) {
          const cData = snapClient.docs[0].data();
          const cDoc = (cData.documento || '').replace(/\D/g, '');
          const cCep = (cData.cep || '01001-000').replace(/\D/g, '');
          if (cDoc) {
            receiver = {
              name: clienteNome,
              federalTaxNumber: cDoc,
              email: cData.email || undefined,
              address: {
                street: cData.endereco || 'Rua Principal',
                number: cData.numero || '123',
                district: cData.bairro || 'Centro',
                postalCode: cCep,
                city: {
                  code: cData.codigoIbge || '3550308',
                  name: cData.cidade || 'São Paulo',
                  state: cData.estado || 'SP'
                }
              }
            };
          }
        }
      }

      if (!receiver) {
        receiver = {
          name: 'Consumidor Final',
          federalTaxNumber: '12345678901',
          address: {
            street: 'Rua Principal',
            number: '123',
            district: 'Centro',
            postalCode: '01001000',
            city: {
              code: '3550308',
              name: 'São Paulo',
              state: 'SP'
            }
          }
        };
      }

      const spedyPayload = {
        isFinalCustomer: true,
        operationType: 'outgoing',
        destination: resolveInvoiceDestination(payloadItems.find((pi) => isExportCfop(pi.cfop))?.cfop, 'internal'),
        presenceType: 'presence',
        operationNature: 'Venda de Mercadoria',
        sendEmailToCustomer: false,
        integrationId: id,
        receiver,
        items: payloadItems,
        payments: paymentDrafts.map((payment) => ({
          method: toSpedyPaymentMethod(payment.forma),
          amount: fromCents(toCents(payment.valor)),
        })),
        total: {
          invoiceAmount: valorTotalPedido,
          productAmount: valorTotalItens
        }
      };

      const spedyNote = await spedyService.emitConsumerInvoice(apiKey, env, spedyPayload);

      // Polling para aguardar autorização
      NexusSwal.fire({
        title: 'Autorizando Cupom na SEFAZ...',
        text: 'Aguardando aprovação da nota fiscal eletrônica...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
      });

      let currentStatus = spedyNote.status;
      let finalNote = spedyNote;
      let attempts = 0;

      while (['enqueued', 'processing', 'created'].includes(currentStatus) && attempts < 10) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        try {
          finalNote = await spedyService.getConsumerInvoice(apiKey, env, spedyNote.id);
          currentStatus = finalNote.status;
        } catch (pollErr) {
          console.warn("Erro ao consultar status do cupom fiscal:", pollErr);
        }
        attempts++;
      }

      // Salva referência local no Firestore
      const newDocRef = await addDoc(collection(db, 'notas_fiscais'), {
        spedyId: finalNote.id,
        number: finalNote.number,
        accessKey: finalNote.accessKey || null,
        tipo: 'NFC-e',
        clienteNome: clienteNome,
        valor: valorTotalPedido,
        status: finalNote.status,
        processingMessage: finalNote.processingDetail?.message || null,
        processingCode: finalNote.processingDetail?.code || null,
        tenantId,
        createdAt: serverTimestamp(),
        data: new Date().toISOString(),
        pedidoId: id,
        ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
      });

      // Atualiza o estado local
      setNfeDoc({
        id: newDocRef.id,
        spedyId: finalNote.id,
        status: finalNote.status,
        number: finalNote.number,
        accessKey: finalNote.accessKey
      });

      Swal.close();

      if (finalNote.status === 'authorized') {
        const printResult = await NexusSwal.fire({
          title: 'Cupom Fiscal Autorizado!',
          text: 'Deseja abrir o DANFE (Cupom) para impressão?',
          icon: 'success',
          showCancelButton: true,
          confirmButtonText: 'Sim, Abrir PDF',
          cancelButtonText: 'Fechar e Voltar'
        });

        if (printResult.isConfirmed) {
          await spedyService.openFiscalFile(finalNote.id, 'consumer', 'pdf');
        }
      } else if (['enqueued', 'processing', 'created'].includes(finalNote.status)) {
        await NexusSwal.fire({
          title: 'Cupom em Processamento',
          text: 'O cupom fiscal foi enviado com sucesso, mas o retorno da SEFAZ está demorando. Você poderá consultá-lo e imprimir o PDF mais tarde no menu Fiscal.',
          icon: 'info',
          confirmButtonText: 'Entendido'
        });
      } else {
        await NexusSwal.fire({
          title: 'Cupom Fiscal Rejeitado',
          text: `O cupom foi rejeitado pela SEFAZ: ${finalNote.processingDetail?.message || 'Motivo desconhecido.'} (Código: ${finalNote.processingDetail?.code || 'N/A'})`,
          icon: 'error',
          confirmButtonText: 'Entendido'
        });
      }

    } catch (err) {
      console.error(err);
      showError('Falha ao emitir NFC-e', (err as Error).message || 'Não foi possível transmitir o cupom fiscal.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenPdfCupom = async () => {
    if (!nfeDoc) return;
    try {
      await spedyService.openFiscalFile(nfeDoc.spedyId, 'consumer', 'pdf');
    } catch (err) {
      showError('Erro ao abrir PDF', (err as Error).message);
    }
  };

  const handleConsultarCupomExistente = async () => {
    if (!currentUser || !tenantId || !nfeDoc) return;
    setIsLoading(true);
    try {
      const runtimeConfig = await spedyService.getRuntimeConfig();
      if (!runtimeConfig.spedyEnabled || !runtimeConfig.spedyApiKeyConfigured) {
        showError('Integração Inativa', 'O módulo da Spedy não está configurado.');
        setIsLoading(false);
        return;
      }
      const apiKey = '__backend_proxy__';
      const env = runtimeConfig.spedyEnvironment;

      const spedyNote = await spedyService.getConsumerInvoice(apiKey, env, nfeDoc.spedyId);

      await updateDoc(doc(db, 'notas_fiscais', nfeDoc.id), {
        status: spedyNote.status,
        number: spedyNote.number,
        accessKey: spedyNote.accessKey || null,
        processingMessage: spedyNote.processingDetail?.message || null,
        processingCode: spedyNote.processingDetail?.code || null,
        ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Status da NFC-e consultado na Spedy'),
      });

      setNfeDoc({
        ...nfeDoc,
        status: spedyNote.status,
        number: spedyNote.number,
        accessKey: spedyNote.accessKey
      });

      showSuccess(`Status atualizado: ${spedyNote.status}`);
    } catch (err) {
      showError('Erro ao consultar', (err as Error).message || 'Erro ao atualizar nota.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelarVenda = async () => {
    if (submitLockRef.current) return;
    if (!currentUser || !tenantId || !id) return;

    const temDevolucao = itens.some(item => (item.quantidadeJaDevolvida || 0) > 0);
    if (temDevolucao) {
      showError('Operação Bloqueada', 'Não é possível cancelar uma venda que já possui itens devolvidos. O cancelamento só é permitido caso nenhuma devolução tenha sido feita.');
      return;
    }

    const confirm = await NexusSwal.fire({
      title: 'Cancelar Venda?',
      text: 'O estoque será devolvido e a transação financeira será estornada.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sim, Cancelar Venda',
      cancelButtonText: 'Manter Venda',
      confirmButtonColor: '#ef4444'
    });

    if (!confirm.isConfirmed) return;

    submitLockRef.current = true;
    setIsLoading(true);
    try {
      const saleRef = doc(db, 'pedidos_venda', id);
      const paymentTransactionsSnap = await getDocs(query(
        collection(db, 'transacoes'),
        where('tenantId', '==', tenantId),
        where('pedidoId', '==', id),
      ));
      const paymentRefs = paymentTransactionsSnap.empty
        ? [doc(db, 'transacoes', id)]
        : paymentTransactionsSnap.docs.map((paymentDocument) => paymentDocument.ref);

      await runTransaction(db, async (transaction) => {
        const saleSnap = await transaction.get(saleRef);
        if (!saleSnap.exists()) throw new Error('A venda não existe mais.');
        const saleData = saleSnap.data();
        if (saleData.status === 'Cancelada') {
          throw new Error('Esta venda já foi cancelada.');
        }

        // Reverte o credito bancario aplicado na criacao da venda (pagamento
        // Pix/Cartao/Transferencia) -- antes ficava pra sempre no saldo do
        // banco mesmo apos cancelar. So roda uma vez porque o cancelamento
        // em si ja e bloqueado contra repeticao (checagem de status acima).
        const bankDebitsByBanco = computeBankCreditsMap(saleData.pagamentos || []);
        const bankBalancesById = new Map<string, number>();
        for (const bancoId of bankDebitsByBanco.keys()) {
          const bancoSnap = await transaction.get(doc(db, 'bancos', bancoId));
          if (bancoSnap.exists()) bankBalancesById.set(bancoId, Number(bancoSnap.data().saldoCentavos || 0));
        }

        const paymentSnapshots = await Promise.all(paymentRefs.map((paymentRef) => transaction.get(paymentRef)));

        await applyStockAdjustments(
          transaction,
          db,
          toStockAdjustmentItems(itens),
          'increment',
          true
        );

        transaction.update(saleRef, {
          status: 'Cancelada',
          ...(saleSnap.data().comissao ? { comissao: cancelCommissionSnapshot(saleSnap.data().comissao) } : {}),
          canceladaEm: serverTimestamp(),
          updatedAt: serverTimestamp(),
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Venda cancelada'),
        });

        bankDebitsByBanco.forEach((deltaCents, bancoId) => {
          const currentBalance = bankBalancesById.get(bancoId);
          if (currentBalance === undefined) return;
          transaction.update(doc(db, 'bancos', bancoId), {
            saldoCentavos: currentBalance - deltaCents,
            updatedAt: serverTimestamp(),
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), `Estorno da venda #${numeroPedido} cancelada`),
          });
        });

        paymentSnapshots.forEach((paymentSnapshot) => {
          if (!paymentSnapshot.exists()) return;
          const paymentData = paymentSnapshot.data();
          if (paymentData.status === 'Paga') {
            const movesPhysicalCash = transactionMovesPhysicalCash(paymentData);
            transaction.update(paymentSnapshot.ref, {
              estornada: true,
              statusOperacional: 'Cancelada',
              estornadaEm: serverTimestamp(),
              updatedAt: serverTimestamp(),
              ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Estornada pelo cancelamento da venda'),
            });
            transaction.set(doc(db, 'transacoes', `estorno_cancelamento_${paymentSnapshot.id}`), {
              descricao: `Estorno do cancelamento da venda #${numeroPedido}`,
              categoria: 'Cancelamento de Venda',
              valor: Number(paymentData.valor || 0),
              valorCentavos: Number(paymentData.valorCentavos ?? toCents(paymentData.valor)),
              valorBruto: Number(paymentData.valorBruto ?? paymentData.valor ?? 0),
              valorBrutoCentavos: Number(paymentData.valorBrutoCentavos ?? paymentData.valorCentavos ?? toCents(paymentData.valor)),
              valorTaxa: Number(paymentData.valorTaxa ?? paymentData.cartao?.valorTaxa ?? 0),
              valorTaxaCentavos: Number(paymentData.valorTaxaCentavos ?? paymentData.cartao?.valorTaxaCentavos ?? 0),
              valorLiquido: Number(paymentData.valorLiquido ?? paymentData.cartao?.valorLiquido ?? paymentData.valor ?? 0),
              valorLiquidoCentavos: Number(paymentData.valorLiquidoCentavos ?? paymentData.cartao?.valorLiquidoCentavos ?? paymentData.valorCentavos ?? toCents(paymentData.valor)),
              cartao: paymentData.cartao || null,
              tipo: 'saida',
              formaPagamento: paymentData.formaPagamento || 'Outros',
              naturezaFinanceira: movesPhysicalCash
                ? 'caixa_fisico'
                : (paymentData.naturezaFinanceira || 'bancario_digital'),
              movimentaCaixaFisico: movesPhysicalCash,
              status: 'Paga',
              data: getDateInputInTimeZone(),
              pedidoId: id,
              sourceType: 'cancelamento_pedido_venda',
              sourceId: id,
              sourcePaymentTransactionId: paymentSnapshot.id,
              idempotencyKey: `cancelamento:${id}:transacao:${paymentSnapshot.id}`,
              clienteNome: saleSnap.data().clienteNome || clienteNome,
              usuarioResponsavelId: currentUser.uid,
              tenantId,
              createdAt: serverTimestamp(),
              ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
            }, { merge: true });
          } else {
            transaction.update(paymentSnapshot.ref, {
              status: 'Cancelada',
              movimentaCaixaFisico: false,
              estornadaEm: serverTimestamp(),
              updatedAt: serverTimestamp(),
              ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Cancelada junto com a venda'),
            });
          }
        });
      });

      try {
        const { createAuditLog } = await import('../../services/logService');
        createAuditLog({
          tenantId: tenantId || '',
          usuarioId: currentUser.uid,
          usuarioEmail: currentUser.email || currentUser.uid,
          modulo: 'vendas',
          acao: 'cancelamento',
          descricao: `Venda Direta #${numeroPedido} CANCELADA e estoque estornado.`,
          registroRelacionadoId: id,
          status: 'sucesso',
          critical: true
        });
      } catch (err) {
        console.error('Erro ao registrar log de cancelamento de venda:', err);
      }

      // 4. Reabrir Orçamento se houver orcamentoId
      if (orcamentoId) {
        try {
          await updateDoc(doc(db, 'orcamentos', orcamentoId), {
            status: 'Pendente',
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Reaberto pelo cancelamento da venda'),
          });
        } catch (err) {
          console.error("Erro ao reabrir orçamento:", err);
        }
      }

      showSuccess('Venda cancelada com sucesso!');
      setStatus('Cancelada');
    } catch (err) {
      console.error('Erro ao cancelar:', err);
      showError('Erro', err instanceof Error ? err.message : 'Não foi possível cancelar a venda.');
    } finally {
      submitLockRef.current = false;
      setIsLoading(false);
    }
  };

  const handleEstornarDevolucao = async (devolucao: DevolucaoVenda) => {
    if (!currentUser || !tenantId || !id || estornandoDevolucaoId) return;

    const confirm = await NexusSwal.fire({
      title: 'Estornar Devolução?',
      text: 'O estoque devolvido será retirado de novo e o crédito/caixa gerado será desfeito, se ainda não tiver sido usado.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sim, estornar',
      cancelButtonText: 'Manter',
      confirmButtonColor: '#ef4444',
    });
    if (!confirm.isConfirmed) return;

    setEstornandoDevolucaoId(devolucao.id);
    try {
      const saleRef = doc(db, 'pedidos_venda', id);
      const devolucaoRef = doc(db, 'devolucoes_venda', devolucao.id);

      await runTransaction(db, async (transaction) => {
        const [saleSnap, devolucaoSnap] = await Promise.all([
          transaction.get(saleRef),
          transaction.get(devolucaoRef),
        ]);
        if (!saleSnap.exists()) throw new Error('A venda não existe mais.');
        if (!devolucaoSnap.exists()) throw new Error('A devolução não existe mais.');
        const devolucaoData = devolucaoSnap.data();
        if (devolucaoData.status === 'estornada') throw new Error('Esta devolução já foi estornada.');

        const itensDevolvidos: Array<{ id: string; nome: string; quantidadeDevolvida: number; fatorConversao?: number }> = devolucaoData.itensDevolvidos || [];

        // So estorna o destino do valor se ele ainda nao foi usado --
        // credito ja parcialmente gasto em Contas a Receber nao pode ser
        // desfeito silenciosamente.
        let creditoRef = null;
        if (devolucaoData.destinoValor === 'credito') {
          creditoRef = doc(db, 'creditos_cliente', `devolucao_${devolucao.id}`);
          const creditoSnap = await transaction.get(creditoRef);
          if (creditoSnap.exists()) {
            const creditoData = creditoSnap.data();
            if (Number(creditoData.saldoDisponivel || 0) !== Number(creditoData.valorOriginal || 0)) {
              throw new Error('Este crédito já foi parcialmente utilizado e não pode mais ser estornado.');
            }
          }
        }

        const saleData = saleSnap.data();
        const storedItems = Array.isArray(saleData.itens) ? saleData.itens : [];
        const updatedItems = storedItems.map((storedItem: ItemVenda) => {
          const devolvido = itensDevolvidos.find((item) => item.id === storedItem.id && item.nome === storedItem.nome);
          if (!devolvido) return storedItem;
          const atual = Number(storedItem.quantidadeJaDevolvida || 0);
          return { ...storedItem, quantidadeJaDevolvida: Math.max(0, atual - devolvido.quantidadeDevolvida) };
        });

        await applyStockAdjustments(
          transaction,
          db,
          toStockAdjustmentItems(itensDevolvidos.map((item) => ({
            id: item.id,
            nome: item.nome,
            quantidade: item.quantidadeDevolvida,
            fatorConversao: item.fatorConversao,
          }))),
          'decrement',
          true,
        );

        const valorDevolvidoCentavos = toCents(devolucaoData.valorTotalDevolvido || 0);
        const savedCommission = saleData.comissao?.regraVersion
          ? recalculateCommissionAfterReturn(saleData.comissao, -valorDevolvidoCentavos)
          : null;

        transaction.update(saleRef, {
          itens: updatedItems,
          ...(savedCommission ? { comissao: savedCommission } : {}),
          updatedAt: serverTimestamp(),
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Devolução estornada'),
        });

        transaction.update(devolucaoRef, {
          status: 'estornada',
          estornadaEm: serverTimestamp(),
          updatedAt: serverTimestamp(),
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Devolução estornada'),
        });

        if (devolucaoData.destinoValor === 'caixa') {
          const caixaRef = doc(db, 'transacoes', `devolucao_${devolucao.id}`);
          transaction.update(caixaRef, {
            estornada: true,
            statusOperacional: 'Estornada',
            estornadaEm: serverTimestamp(),
            updatedAt: serverTimestamp(),
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Estorno da devolução'),
          });
          transaction.set(doc(db, 'transacoes', `estorno_devolucao_${devolucao.id}`), {
            descricao: `Estorno da devolução do pedido #${numeroPedido}`,
            categoria: 'Devolução de Venda',
            valor: Number(devolucaoData.valorTotalDevolvido || 0),
            valorCentavos: valorDevolvidoCentavos,
            tipo: 'entrada',
            formaPagamento: 'Dinheiro',
            naturezaFinanceira: 'caixa_fisico',
            movimentaCaixaFisico: true,
            status: 'Paga',
            data: getDateInputInTimeZone(),
            clienteNome,
            pedidoOrigemId: id,
            devolucaoId: devolucao.id,
            idempotencyKey: `estorno_devolucao:${devolucao.id}`,
            tenantId,
            createdAt: serverTimestamp(),
            ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
          }, { merge: true });
        } else if (creditoRef) {
          transaction.update(creditoRef, {
            status: 'cancelado',
            saldoDisponivel: 0,
            updatedAt: serverTimestamp(),
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Estorno da devolução'),
          });
        }
      });

      try {
        const { createAuditLog } = await import('../../services/logService');
        createAuditLog({
          tenantId,
          usuarioId: currentUser.uid,
          usuarioEmail: currentUser.email || currentUser.uid,
          modulo: 'vendas',
          acao: 'estorno_devolucao',
          descricao: `Devolução do pedido #${numeroPedido} estornada.`,
          registroRelacionadoId: devolucao.id,
          status: 'sucesso',
          critical: true,
        });
      } catch (logError) {
        console.error('Erro ao registrar auditoria do estorno de devolução:', logError);
      }

      showSuccess('Devolução estornada com sucesso!');
      await fetchDevolucoes(id);
    } catch (err) {
      console.error('Erro ao estornar devolução:', err);
      showError('Erro', err instanceof Error ? err.message : 'Não foi possível estornar a devolução.');
    } finally {
      setEstornandoDevolucaoId(null);
    }
  };

  if (isFetchingData) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-primary)' }}>Carregando dados da Venda...</div>;
  }

  return (
    <div className="os-page">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div className="header-title-group">
          <button className="icon-btn back-btn" onClick={() => navigate('/pedidos-venda')}><ArrowLeft size={20} /></button>
          <div>
            <h1 className="page-title">
              {isViewing
                ? `${isPreVendaAberta ? 'Pré-venda' : 'Pedido de Venda'} #${numeroPedido}`
                : 'Frente de Caixa (PDV)'}
            </h1>
            <p className="page-subtitle">
              {isViewing
                ? (status === 'Cancelada'
                  ? 'Esta venda foi CANCELADA'
                  : isPreVendaAberta
                    ? 'Pré-venda em aberto — estoque reservado, sem lançamento financeiro. Ainda não entra em faturamento.'
                    : isPendingFromAgent
                      ? (canEditPendingOrder ? 'Pedido pendente — edite e finalize a venda' : 'Pedido pendente de confirmação (fora de uma integração externa)')
                      : 'Detalhes do Pedido e Impressão')
                : 'Ponto de venda rápido para itens e produtos'}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          {isViewing && status === 'Finalizada' && (
            <>
              {/* Botão de NFC-e (Cupom Fiscal) */}
              {!nfeDoc ? (
                <button
                  className="btn-primary"
                  onClick={handleEmitirCupomVendaExistente}
                  disabled={isLoading}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#8b5cf6', borderColor: '#8b5cf6' }}
                >
                  <Receipt size={18} /> Emitir Cupom Fiscal (NFC-e)
                </button>
              ) : nfeDoc.status === 'authorized' ? (
                <button
                  className="btn-primary"
                  onClick={handleOpenPdfCupom}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#10b981', borderColor: '#10b981' }}
                >
                  <Eye size={18} /> Imprimir Cupom (NFC-e)
                </button>
              ) : (
                <button
                  className="btn-primary"
                  onClick={handleConsultarCupomExistente}
                  disabled={isLoading}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#f59e0b', borderColor: '#f59e0b' }}
                >
                  <RefreshCw size={18} /> Consultar Cupom (NFC-e)
                </button>
              )}

              <button className="btn-secondary" onClick={() => navigate(`/pedidos-venda/print/${id}`)} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Printer size={18} /> Imprimir Recibo
              </button>
              {canAlterarPagamentoFinalizada && !editandoPagamento && (
                <button
                  className="btn-secondary"
                  onClick={() => setEditandoPagamento(true)}
                  disabled={isLoading || Boolean(motivoBloqueioAlterarPagamento)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    color: motivoBloqueioAlterarPagamento ? 'var(--text-muted)' : '#f59e0b',
                    borderColor: motivoBloqueioAlterarPagamento ? 'var(--border-color)' : 'rgba(245,158,11,0.4)',
                    cursor: motivoBloqueioAlterarPagamento ? 'not-allowed' : 'pointer',
                  }}
                  title={motivoBloqueioAlterarPagamento || 'Corrigir a forma de pagamento sem alterar o valor da venda'}
                >
                  <RefreshCw size={18} /> Alterar Pagamento
                </button>
              )}
              {canEditVenda && (
                <button
                  className="btn-secondary"
                  onClick={handleCancelarVenda}
                  disabled={isLoading || itens.some(item => (item.quantidadeJaDevolvida || 0) > 0)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    color: itens.some(item => (item.quantidadeJaDevolvida || 0) > 0) ? 'var(--text-muted)' : '#ef4444',
                    borderColor: itens.some(item => (item.quantidadeJaDevolvida || 0) > 0) ? 'var(--border-color)' : 'rgba(239,68,68,0.3)',
                    cursor: itens.some(item => (item.quantidadeJaDevolvida || 0) > 0) ? 'not-allowed' : 'pointer'
                  }}
                  title={itens.some(item => (item.quantidadeJaDevolvida || 0) > 0) ? 'Não é possível cancelar: há itens devolvidos' : 'Cancelar Venda'}
                >
                  <XCircle size={18} /> Estornar/Cancelar
                </button>
              )}
              {canReturnVenda && (
                <button
                  className="btn-secondary"
                  onClick={() => setShowDevolucaoModal(true)}
                  disabled={isLoading || itens.every(item => (item.quantidade - (item.quantidadeJaDevolvida || 0)) <= 0)}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                  title="Devolução de itens deste pedido"
                >
                  <RotateCcw size={18} /> Devolução
                </button>
              )}
            </>
          )}
          {isPendingFromAgent && canEditPendingOrder && (
            <button className="btn-secondary" onClick={handleRecusarPendente} disabled={isLoading} style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}>
              <XCircle size={18} /> Recusar Pedido
            </button>
          )}
          {isPreVendaAberta && canCancelarPreVenda && (
            <button className="btn-secondary" onClick={handleCancelarPreVenda} disabled={isLoading} style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}>
              <XCircle size={18} /> Cancelar Pré-venda
            </button>
          )}
          {/* Gravar: cria a pre-venda (pedido novo) ou regrava uma ja
              aberta. Fica ao lado de Finalizar de proposito -- e' a escolha
              do operador entre separar agora e faturar agora. */}
          {((!isViewing && canCriarPreVenda) || (isPreVendaAberta && canEditarPreVenda)) && (
            <button
              className="btn-secondary"
              onClick={handleGravarPreVenda}
              disabled={isLoading}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#f59e0b', borderColor: 'rgba(245,158,11,0.4)' }}
              title="Grava o pedido em aberto e reserva o estoque, sem gerar financeiro"
            >
              <Save size={18} />
              {isLoading ? 'Gravando...' : (isPreVendaAberta ? 'Salvar Pré-venda' : 'Gravar Pré-venda')}
            </button>
          )}
          {(!isViewing || (isPendingFromAgent && canEditPendingOrder) || (isPreVendaAberta && canFinalizarPreVenda)) && (
            <button className="btn-primary" onClick={handleFinalizarVenda} disabled={isLoading} style={{ opacity: isLoading ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#10b981' }}>
              <ShoppingCart size={18} />
              {isLoading ? 'Finalizando...' : 'Finalizar Venda'}
            </button>
          )}
        </div>
      </div>

      {/* Identificacao do vendedor. Fechar ou errar aqui NAO mexe na venda:
          o modal so devolve quem e' o vendedor. */}
      <IdentificarVendedorModal
        open={identificacaoAberta}
        descricaoOperacao={descricaoIdentificacao}
        onClose={() => {
          setIdentificacaoAberta(false);
          acaoAposIdentificarRef.current = null;
        }}
        onIdentificado={handleVendedorIdentificado}
      />

      {pendingOrderStockWarnings.length > 0 && (
        <div className="card form-section" style={{ padding: '16px 24px', marginBottom: '24px', backgroundColor: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: '#f59e0b', fontWeight: 700 }}>
            <AlertTriangle size={18} />
            Estoque ou preço mudaram desde que este pedido foi criado
          </div>
          <ul style={{ margin: 0, paddingLeft: '20px', color: 'var(--text-secondary)', fontSize: '14px' }}>
            {pendingOrderStockWarnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {isViewing && devolucoes.length > 0 && (
        <div className="card form-section" style={{ padding: '24px', marginBottom: '24px' }}>
          <div className="section-header" style={{ marginBottom: '16px' }}>
            <RotateCcw size={20} className="section-icon" />
            <h3>Devoluções deste Pedido</h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {devolucoes.map((devolucao) => (
              <div key={devolucao.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px',
                padding: '12px 16px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '8px',
                border: '1px solid var(--border-color)', opacity: devolucao.status === 'estornada' ? 0.6 : 1,
              }}>
                <div>
                  <strong style={{ fontSize: '14px' }}>R$ {devolucao.valorTotalDevolvido.toFixed(2)}</strong>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: '8px' }}>
                    {devolucao.motivo} · {devolucao.destinoValor === 'credito' ? 'Crédito ao cliente' : 'Caixa'}
                    {devolucao.status === 'estornada' && ' · ESTORNADA'}
                  </span>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {devolucao.itensDevolvidos.map((item) => `${item.quantidadeDevolvida}x ${item.nome}`).join(', ')}
                  </div>
                </div>
                {canReturnVenda && devolucao.status === 'concluida' && (
                  <button
                    className="btn-secondary"
                    onClick={() => handleEstornarDevolucao(devolucao)}
                    disabled={estornandoDevolucaoId === devolucao.id}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)', whiteSpace: 'nowrap' }}
                  >
                    <Undo2 size={16} /> {estornandoDevolucaoId === devolucao.id ? 'Estornando...' : 'Estornar'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <SolicitarAprovacaoDescontoModal
        open={showAprovacaoDesconto}
        tenantId={tenantId}
        motivo={`Desconto de ${checagemLimiteDesconto.percentualAplicado.toFixed(1)}% neste pedido, acima do limite configurado. Confirme com a senha de um aprovador para finalizar.`}
        onClose={() => setShowAprovacaoDesconto(false)}
        onAprovado={(aprovacao) => setAprovacaoDesconto(aprovacao)}
      />

      <CadastroRapidoClienteModal
        open={cadastroRapidoAberto}
        nomeInicial={clienteNome}
        onClose={() => setCadastroRapidoAberto(false)}
        onCriado={(cliente: ClienteCadastradoRapido) => setClienteNome(cliente.nome)}
      />

      {showDevolucaoModal && (
        <DevolucaoVendaModal
          pedidoId={id!}
          numeroPedido={numeroPedido}
          clienteNome={clienteNome}
          itens={itens}
          onClose={() => setShowDevolucaoModal(false)}
          onSuccess={async () => {
            await fetchDevolucoes(id!);
            const saleSnap = await getDoc(doc(db, 'pedidos_venda', id!));
            if (saleSnap.exists()) {
              setItens(saleSnap.data().itens || []);
            }
          }}
        />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 350px', gap: '24px', alignItems: 'start' }}>

        {/* Lado Esquerdo: Carrinho e Busca */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

          {/* Seção Cliente */}
          <div className="card form-section" style={{ padding: '24px' }}>
            <div className="section-header" style={{ marginBottom: '16px' }}>
              <User size={20} className="section-icon" />
              <h3>Dados do Cliente</h3>
            </div>
            <div className="input-group" style={{ position: 'relative' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Nome do Cliente ou Consumidor Final *</label>
              <ClientAutocomplete
                value={clienteNome}
                onChange={setClienteNome}
                clients={clientesDisponiveis}
                onSelect={(c) => setClienteNome(c.nome)}
                disabled={isViewing && !canEditPendingCliente}
                inputRef={clienteInputRef}
                placeholder="Busque ou digite o nome do cliente..."
                ariaLabel="Buscar cliente"
                renderItem={(c) => (
                  <>
                    <span>{c.codigo ? `#${c.codigo} — ${c.nome}` : c.nome}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{c.telefone}</span>
                  </>
                )}
              />
              {!(isViewing && !canEditPendingCliente) && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setCadastroRapidoAberto(true)}
                  style={{ marginTop: '8px', fontSize: '13px', padding: '6px 12px' }}
                >
                  Cadastrar Cliente
                </button>
              )}
            </div>
            <div className="input-group" style={{ marginTop: '16px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Vendedor responsável *</label>
              <select
                value={vendedorId}
                onChange={(event) => setVendedorId(event.target.value)}
                // Com identificacao por codigo+senha ligada, escolher o
                // vendedor a mao derrubaria o proposito da trava: quem define
                // e' o popup, contra senha.
                disabled={(isViewing && !canEditPendingOrder) || exigirIdentificacaoVendedor}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)', width: '100%' }}
              >
                {vendedoresDisponiveis.map((seller) => (
                  <option key={seller.id} value={seller.id}>{seller.nome}</option>
                ))}
              </select>
              <span style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '6px' }}>
                {exigirIdentificacaoVendedor
                  ? 'O vendedor é definido pelo código e senha informados ao finalizar a venda. O usuário logado continua registrado como responsável pela operação.'
                  : 'O usuário logado continuará registrado como responsável pela operação.'}
              </span>
            </div>
          </div>

          {/* Seção Adicionar Produto */}
          {(!isViewing || canAddPendingItem) && (
            <div className="card form-section" style={{ padding: '24px' }}>
              <div className="section-header" style={{ marginBottom: '16px' }}>
                <Package size={20} className="section-icon" />
                <h3>Adicionar Produto</h3>
              </div>

              <div className="shortcuts-hint" style={{ marginBottom: '16px' }}>
                <span><kbd>F2</kbd> Cliente</span>
                <span><kbd>F3</kbd> Produto</span>
                <span><kbd>F4</kbd> Desconto</span>
                <span><kbd>F5</kbd> Qtd. item selecionado</span>
                <span><kbd>F6</kbd> Pagamento</span>
                <span><kbd>Esc</kbd> Fechar</span>
              </div>

              <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ flex: '2', position: 'relative', minWidth: '200px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Buscar Produto</label>
                  <div style={{ position: 'relative' }}>
                    <ProductAutocomplete
                      value={produtoBusca}
                      products={produtosCatalogo}
                      inputRef={produtoBuscaInputRef}
                      onChange={(value) => {
                        setProdutoBusca(value);
                        const exists = produtosCatalogo.find(p => p.nome.toLowerCase() === value.toLowerCase() || p.codigo === value);
                        if (exists) {
                          setProdutoPreco(exists.precoVenda);
                          setProdutoSelecionado(exists);
                        } else {
                          setProdutoSelecionado(null);
                        }
                        setEmbalagemSelecionadaId('');
                      }}
                      onSelect={(p) => {
                        setProdutoBusca(p.nome);
                        setProdutoPreco(p.precoVenda);
                        setProdutoSelecionado(p);
                        // Produto novo comeca sempre na unidade base.
                        setEmbalagemSelecionadaId('');
                      }}
                      mode={produtoSearchMode}
                      placeholder="Nome ou Código..."
                      ariaLabel="Buscar produto"
                      className="has-clear-btn"
                      onViewMore={() => setIsProdutoSearchModalOpen(true)}
                      renderItem={renderProdutoRow}
                    />
                    {produtoBusca && (
                      <button
                        type="button"
                        onClick={handleClearProdutoSelecionado}
                        className="clear-selection-btn"
                        title="Limpar seleção"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                  <ProductSearchModal
                    open={isProdutoSearchModalOpen}
                    onClose={() => setIsProdutoSearchModalOpen(false)}
                    products={produtosCatalogo}
                    onSelect={(p) => {
                      setProdutoBusca(p.nome);
                      setProdutoPreco(p.precoVenda);
                      setProdutoSelecionado(p);
                      setEmbalagemSelecionadaId('');
                    }}
                    mode={produtoSearchMode}
                    renderItem={renderProdutoRow}
                    initialQuery={produtoBusca}
                    title="Buscar produto"
                  />
                </div>

                {/* Seletor de embalagem: so aparece quando a chave esta ligada
                    E o produto tem mais de uma unidade de venda cadastrada.
                    Produto sem embalagem nao ganha um select de uma opcao so. */}
                {opcoesUnidadeVenda.length > 1 && (
                  <div style={{ flex: '0.7', minWidth: '110px' }}>
                    <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Unidade</label>
                    <select
                      value={embalagemSelecionadaId}
                      onChange={(e) => handleSelecionarEmbalagem(e.target.value)}
                      style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
                    >
                      {opcoesUnidadeVenda.map((opcao) => (
                        <option key={opcao.embalagemId || 'base'} value={opcao.embalagemId}>{opcao.label}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div style={{ flex: '0.5', minWidth: '85px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                    Qtd {produtoSelecionado ? `(${opcaoUnidadeSelecionada.sigla})` : ''}
                  </label>
                  <input
                    type="number"
                    min="0.001"
                    step={opcaoUnidadeSelecionada.permiteFracionado ? "any" : "1"}
                    value={produtoQtd}
                    onChange={(e) => setProdutoQtd(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddItem(); } }}
                    style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
                  />
                  {opcaoUnidadeSelecionada.fatorConversao !== 1 && Number(produtoQtd) > 0 && (
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      Baixa {toBaseQuantity(produtoQtd, opcaoUnidadeSelecionada.fatorConversao)} {produtoSelecionado?.unidadeMedidaSigla || 'UN'}
                    </span>
                  )}
                </div>

                <div style={{ flex: '0.8', minWidth: '100px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Preço Unt.</label>
                  <input type="number" step="0.01" value={produtoPreco} onChange={(e) => setProdutoPreco(Number(e.target.value))} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddItem(); } }} style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
                </div>

                <div style={{ flex: '0.9', minWidth: '130px' }}>
                  <DescontoInput
                    label="Desconto"
                    idPrefix="item-desconto"
                    value={produtoDescontoInput}
                    onChange={setProdutoDescontoInput}
                    inputRef={produtoDescontoInputRef}
                    onEnterKey={handleAddItem}
                  />
                </div>

                <button type="button" onClick={handleAddItem} className="btn-primary" style={{ padding: '12px 24px', whiteSpace: 'nowrap' }}>
                  Adicionar
                </button>
              </div>
            </div>
          )}

          {/* Carrinho de Compras */}
          <div className="card form-section" style={{ padding: '24px' }}>
            <h3 style={{ marginBottom: '16px', fontSize: '16px', fontWeight: 600 }}>Itens da Venda</h3>

            <div className="table-wrapper">
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '12px 8px' }}>Produto</th>
                    <th style={{ padding: '12px 8px', textAlign: 'center' }}>Qtd</th>
                    <th style={{ padding: '12px 8px', textAlign: 'right' }}>V. Unit</th>
                    <th style={{ padding: '12px 8px', textAlign: 'right' }}>Desc.</th>
                    <th style={{ padding: '12px 8px', textAlign: 'right' }}>Subtotal</th>
                    {(!isViewing || canDeletePendingItem) && <th style={{ padding: '12px 8px', textAlign: 'center' }}>Ação</th>}
                  </tr>
                </thead>
                <tbody>
                  {itens.length === 0 ? (
                    <tr>
                      <td colSpan={(!isViewing || canDeletePendingItem) ? 6 : 5} style={{ padding: '32px 8px', textAlign: 'center', color: 'var(--text-muted)' }}>
                        Nenhum produto adicionado à venda.
                      </td>
                    </tr>
                  ) : (
                    itens.map((item, index) => (
                      <tr
                        key={index}
                        onClick={() => setSelectedItemIndex(index)}
                        className={selectedItemIndex === index ? 'item-row-selectable selected' : 'item-row-selectable'}
                        style={{ borderBottom: '1px solid var(--border-color)' }}
                      >
                        <td style={{ padding: '12px 8px' }}>{item.nome}</td>
                        <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                          {item.quantidade.toFixed(item.unidadeMedidaCasasDecimais ?? 0)} {item.unidadeMedidaSigla || 'UN'}
                        </td>
                        <td style={{ padding: '12px 8px', textAlign: 'right' }}>R$ {item.precoUnitario.toFixed(2)}</td>
                        <td style={{ padding: '12px 8px', textAlign: 'right', color: '#ef4444' }}>{item.desconto > 0 ? `-R$ ${item.desconto.toFixed(2)}` : '-'}</td>
                        <td style={{ padding: '12px 8px', textAlign: 'right', fontWeight: 600 }}>R$ {item.subtotal.toFixed(2)}</td>
                        {(!isViewing || canDeletePendingItem) && (
                          <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                            <button onClick={(e) => { e.stopPropagation(); handleRemoveItem(index); }} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>
                              <Trash2 size={16} />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Lado Direito: Resumo e Pagamento */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

          <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '24px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>Resumo da Venda</h3>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', color: 'var(--text-secondary)', alignItems: 'center' }}>
              <span>Total Itens:</span>
              <span>R$ {valorTotalItens.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', color: '#ef4444', alignItems: 'center' }}>
              <span>Descontos:</span>
              <span>- R$ {valorTotalDescontos.toFixed(2)}</span>
            </div>

            {(!isViewing || canEditPendingOrder) && (
              <div style={{ marginBottom: '16px' }}>
                <DescontoInput
                  label="Desconto geral da venda"
                  idPrefix="desconto-geral"
                  value={descontoGeralInput}
                  onChange={setDescontoGeralInput}
                />
              </div>
            )}

            {checagemLimiteDesconto.excedeu && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', padding: '10px 12px', borderRadius: 'var(--radius-md)', backgroundColor: 'rgba(239, 68, 68, 0.12)', color: '#ef4444', fontSize: '12px' }}>
                <AlertTriangle size={16} />
                Desconto de {checagemLimiteDesconto.percentualAplicado.toFixed(1)}% acima do limite configurado para Pedido de Venda.
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '14px 16px', margin: '4px 0 16px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                <Truck size={14} />
                Frete e Encargos
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Frete (+)</span>
                {isViewing && !canEditPendingOrder ? (
                  <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>R$ {frete.toFixed(0)}</span>
                ) : (
                  <input
                    type="number"
                    step="1"
                    min="0"
                    placeholder="0"
                    inputMode="numeric"
                    value={frete || ''}
                    onChange={(e) => setFrete(Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
                    style={{ width: '100px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '6px 10px', color: 'var(--text-primary)', textAlign: 'right' }}
                  />
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Encargos (+)</span>
                {isViewing && !canEditPendingOrder ? (
                  <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>R$ {encargos.toFixed(0)}</span>
                ) : (
                  <input
                    type="number"
                    step="1"
                    min="0"
                    placeholder="0"
                    inputMode="numeric"
                    value={encargos || ''}
                    onChange={(e) => setEncargos(Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
                    style={{ width: '100px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '6px 10px', color: 'var(--text-primary)', textAlign: 'right' }}
                  />
                )}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px', paddingTop: '16px', borderTop: '1px dashed var(--border-color)', fontSize: '24px', fontWeight: 800, color: '#10b981' }}>
              <span>TOTAL:</span>
              <span>R$ {valorTotalPedido.toFixed(2)}</span>
            </div>
          </div>

          <div className="card" style={{ display: 'none', padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '16px', textTransform: 'uppercase', color: 'var(--accent-purple)' }}>Forma de Pagamento</h3>

            {isViewing ? (
               <div style={{ padding: '16px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '8px', fontSize: '16px', fontWeight: 600, textAlign: 'center' }}>
                 {formaPagamento}
               </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px' }}>
                {[
                  { value: 'Dinheiro', icon: '💵' },
                  { value: 'Pix', icon: '💠' },
                  { value: 'Cartão de Crédito', icon: '💳' },
                  { value: 'Cartão de Débito', icon: '💳' },
                  { value: 'Pagamento a Prazo', icon: '🤝' }
                ].filter(metodo => {
                  const isConsumidorFinal = clienteNome.toLowerCase().includes('consumidor final');
                  if (isConsumidorFinal) {
                    return metodo.value === 'Dinheiro' || metodo.value === 'Pix';
                  }
                  return true;
                }).map(metodo => (
                  <div
                    key={metodo.value}
                    onClick={() => setFormaPagamento(metodo.value)}
                    style={{
                      backgroundColor: formaPagamento === metodo.value ? 'rgba(16, 185, 129, 0.2)' : 'var(--bg-tertiary)',
                      border: `1px solid ${formaPagamento === metodo.value ? '#10b981' : 'var(--border-color)'}`,
                      padding: '12px 16px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      transition: 'all 0.2s',
                    }}
                  >
                    <span style={{ fontSize: '20px' }}>{metodo.icon}</span>
                    <span style={{ fontSize: '14px', fontWeight: formaPagamento === metodo.value ? 600 : 400, color: formaPagamento === metodo.value ? '#10b981' : 'var(--text-primary)' }}>{metodo.value}</span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '16px', textAlign: 'center' }}>
              {(formaPagamento === 'Dinheiro' || formaPagamento === 'Pix')
                ? <span style={{ color: '#10b981' }}>✓ Irá somar no Caixa Principal.</span>
                : <span style={{ color: '#f59e0b' }}>ℹ️ Irá para o Contas a Receber.</span>}
            </div>
          </div>

          {editandoPagamento && (
            <div className="card" style={{ padding: '16px 20px', marginBottom: '16px', backgroundColor: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.4)' }}>
              <strong style={{ color: '#f59e0b' }}>Corrigindo a forma de pagamento desta venda.</strong>
              <span style={{ color: 'var(--text-secondary)' }}>
                {' '}O valor total continua o mesmo — só muda como ele foi recebido. Os lançamentos financeiros e o saldo dos bancos são refeitos ao salvar.
              </span>
              <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
                <button className="btn-primary" onClick={handleSalvarPagamentoAlterado} disabled={isLoading} style={{ backgroundColor: '#f59e0b', borderColor: '#f59e0b' }}>
                  {isLoading ? 'Salvando...' : 'Salvar Novo Pagamento'}
                </button>
                <button className="btn-secondary" onClick={() => setEditandoPagamento(false)} disabled={isLoading}>
                  Cancelar
                </button>
              </div>
            </div>
          )}

          <div ref={pagamentoSectionRef}>
            <PaymentsEditor
              customerName={clienteNome}
              disabled={isViewing && !canEditPendingOrder && !editandoPagamento}
              drafts={paymentDrafts}
              financeConfig={financeConfig}
              idPrefix="sale-payment"
              onAddPayment={addPaymentDraft}
              onRemovePayment={removePaymentDraft}
              onTransactionDateChange={setDataVenda}
              onUpdatePayment={updatePaymentDraft}
              sourceLabel="venda"
              tenantId={tenantId}
              totalCents={valorTotalPedidoCentavos}
              transactionDate={dataVenda}
              transactionDateLabel="Data da venda"
            />
          </div>

          {((!isViewing && canCriarPreVenda) || (isPreVendaAberta && canEditarPreVenda)) && (
            <button
              className="btn-secondary"
              onClick={handleGravarPreVenda}
              disabled={isLoading}
              style={{ width: '100%', padding: '14px', fontSize: '15px', fontWeight: 700, marginBottom: '12px', color: '#f59e0b', borderColor: 'rgba(245,158,11,0.4)', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px' }}
            >
              <Save size={20} />
              {isPreVendaAberta ? 'SALVAR PRÉ-VENDA' : 'GRAVAR PRÉ-VENDA'}
            </button>
          )}

          {(!isViewing || (isPendingFromAgent && canEditPendingOrder) || (isPreVendaAberta && canFinalizarPreVenda)) && (
            <button className="btn-primary" onClick={handleFinalizarVenda} disabled={isLoading} style={{ width: '100%', padding: '16px', fontSize: '16px', fontWeight: 700, backgroundColor: '#10b981', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px' }}>
              <ShoppingCart size={24} />
              FINALIZAR VENDA
            </button>
          )}

        </div>

      </div>
    </div>
  );
};

export default PedidoVendaForm;
