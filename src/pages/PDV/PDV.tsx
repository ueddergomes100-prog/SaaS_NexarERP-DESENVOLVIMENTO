import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banknote, Loader2, LockKeyhole, Maximize2, PackageSearch, Store, X } from 'lucide-react';
import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { NexusSwal, showError, showSuccess, showWarning } from '../../utils/alerts';
import { conferirSaidaComReserva } from '../../services/reservaEstoqueService';
import { gerarCashbackSemFalhar } from '../../services/cashbackService';
import { CAMINHO_LOGIN_CAIXA, MODULO_DO_CAIXA, nomeDoOperador, podeUsarFrenteDeCaixa } from '../../utils/frenteDeCaixaDomain';
import {
  applyStockAdjustments,
  describeTransactionError,
  formatSequenceValue,
  getCurrentMaxSequence,
  getNextTenantSequenceValue,
  writeTenantSequenceValue,
} from '../../utils/firestoreAtomic';
import { baixarLotesNaTransacao, camposDeLoteDoItem, linhasParaLote, prepararBaixaDeLotes } from '../../services/loteBaixaService';
import {
  buildCardFeeSchedulesByBrand,
  buildCommissionSnapshot,
  explodeInstallmentPaymentRecords,
  fromCents,
  normalizePayments,
  resolveBancoPadraoSimplificado,
  summarizePayments,
  toCents,
  type PaymentDraft,
  type PaymentRecord,
} from '../../utils/financeDomain';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import { finalizarVendaNoServidor, VendaServidorError } from '../../services/vendaServidorService';
import { mensagemDaTravaDoBalanco } from '../../services/travaBalancoService';
import { STATUS_PEDIR_DE_NOVO } from '../../utils/conferenciaDescontoDomain';
import { parseVendaPeloServidor } from '../../utils/vendaFechamentoDomain';
import { DEFAULT_PRODUCT_SEARCH_MODE, findEmbalagemIdByExactCode, type ProductSearchMode } from '../../utils/productSearch';
import { isValidSaleQuantity } from '../../utils/saleQuantity';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { useTenantCollection } from '../../hooks/useTenantCollection';
import CartPanel from './components/CartPanel';
import ClientModal from './components/ClientModal';
import DiscountModal from './components/DiscountModal';
import PaymentModal from './components/PaymentModal';
import PdvSummary from './components/PdvSummary';
import ProductSearch from './components/ProductSearch';
import SangriaModal from './components/SangriaModal';
import {
  buildPdvFinanceConfig,
  calculatePdvTotals,
  clampDiscountCents,
  currency,
  defaultPdvFinanceConfig,
  fromCurrencyInput,
  makeCartItemFromProduct,
  makeCartLineId,
  makePdvSessionStorageKey,
  toCurrencyInput,
} from './pdvHelpers';
import { usePromocoesVigentes } from '../../hooks/usePromocoesVigentes';
import { camposDePrecoDoItem, type CamposDePrecoDoItem } from '../../utils/precoComPromocaoDomain';
import { FORMAS_A_VISTA_PADRAO, condicaoDoPagamento, parseFormasAVista, precoAutomatico } from '../../utils/precoVendaDomain';
import { FORMA_PAGAMENTO_CASHBACK, cashbackDisponivelParaVenda, formatarCashback, lerResumoCashback, type CashbackDisponivel } from '../../utils/cashbackDomain';
import {
  DEFAULT_VENDER_POR_EMBALAGEM,
  buildOpcoesUnidadeVenda,
  findOpcaoUnidadeVenda,
  toBaseQuantity,
  toStockAdjustmentItems,
  type OpcaoUnidadeVenda,
} from '../../utils/embalagemDomain';
import {
  DEFAULT_MODO_LIMITE_DESCONTO,
  checarLimiteComCliente,
  descontoPadraoDoCliente,
  excedeLimiteItem,
  parseLimiteDescontoConfig,
  parseModoLimiteDesconto,
  type LimiteDescontoConfig,
  type ModoLimiteDesconto,
} from '../../utils/descontoDomain';
import SolicitarAprovacaoDescontoModal, { type AprovacaoDesconto } from '../../components/common/SolicitarAprovacaoDescontoModal';
import type { CaixaSangria, PdvCartItem, PdvClient, PdvProduct, PdvSession } from './types';
import hennderIcon from '../../assets/hennder-icon.webp';
import './PDV.css';

interface BandeiraCartao {
  id: string;
  nome: string;
  taxaDebitoPercentual?: number;
  taxasCreditoPorParcela?: Record<string, number>;
  prazoRecebimentoCreditoDias?: number;
  prazoRecebimentoDebitoDias?: number;
}
interface Banco { id: string; nome: string; ativo: boolean; }

const normalizeText = (value: unknown) => String(value || '').trim();

/**
 * Frente de Caixa como app separado (19/10/2026): abre so' em /caixa, pela
 * casca CaixaShell.tsx -- sem seta de voltar ao sistema; o X encerra o login
 * do caixa.
 */
/** "14:53" da abertura do caixa, no fuso da loja; vazio se a data nao vier. */
const horaDeAbertura = (iso: string | null | undefined): string => {
  const data = iso ? new Date(iso) : null;
  if (!data || Number.isNaN(data.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(data);
};

const PDV: React.FC = () => {
  const navigate = useNavigate();
  const {
    currentUser,
    logout,
    tenantId,
    userRole,
    userPermissions,
    isOwner,
    isPlatformAdmin,
    blockedModules,
    selectedTenant,
    needsTenantSelection,
    loteModoSaida,
    loteAvisarVencido,
    configCashback,
  } = useAuth();
  const { items: bandeirasCartao } = useTenantCollection<BandeiraCartao>('bandeiras_cartao', tenantId);
  const { items: bancosDisponiveis } = useTenantCollection<Banco>('bancos', tenantId);
  const cardFeeSchedulesByBrand = buildCardFeeSchedulesByBrand(bandeirasCartao);
  const bancoPadraoSimplificado = resolveBancoPadraoSimplificado(bancosDisponiveis);

  const productInputRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [products, setProducts] = useState<PdvProduct[]>([]);
  const [clients, setClients] = useState<PdvClient[]>([]);
  const [allowNegativeStock, setAllowNegativeStock] = useState(false);
  // Chave "Venda pelo servidor" da empresa (SuperAdmin) -- fatia 3c, 19/10/2026.
  const [vendaPeloServidor, setVendaPeloServidor] = useState(false);
  // Id da venda gerado na tela: reenviar o mesmo cupom nao duplica no servidor.
  const idVendaServidorRef = useRef('');
  const [venderPorEmbalagem, setVenderPorEmbalagem] = useState(DEFAULT_VENDER_POR_EMBALAGEM);
  const [limiteDescontoPdv, setLimiteDescontoPdv] = useState<LimiteDescontoConfig | null>(null);
  const [modoLimiteDesconto, setModoLimiteDesconto] = useState<ModoLimiteDesconto>(DEFAULT_MODO_LIMITE_DESCONTO);
  const [showAprovacaoDesconto, setShowAprovacaoDesconto] = useState(false);
  const [aprovacaoDesconto, setAprovacaoDesconto] = useState<AprovacaoDesconto | null>(null);
  const [productSearchMode, setProductSearchMode] = useState<ProductSearchMode>(DEFAULT_PRODUCT_SEARCH_MODE);
  const [financeConfig, setFinanceConfig] = useState(defaultPdvFinanceConfig);
  const [session, setSession] = useState<PdvSession | null>(null);
  const [search, setSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<PdvProduct | null>(null);
  const [cartItems, setCartItems] = useState<PdvCartItem[]>([]);
  // Promocoes e preco a vista no caixa (2026-10-06). O PDV e' venda a vista
  // por padrao (Dinheiro, Pix, debito, credito 1x), entao o item entra com a
  // tabela na condicao 'vista' -- promocao de hoje e preco a vista do
  // cadastro. Pagamento a prazo (credito parcelado, cheque) e' tratado em
  // finalizeSale: nunca muda o total em silencio.
  const CONDICAO_PDV = 'vista' as const;
  const [formasPrecoAVista, setFormasPrecoAVista] = useState<string[]>(FORMAS_A_VISTA_PADRAO);
  const { tabelaDe, quantidadeLiberada } = usePromocoesVigentes(tenantId);
  const cartItemsRef = useRef<PdvCartItem[]>([]);
  useEffect(() => { cartItemsRef.current = cartItems; }, [cartItems]);
  const [selectedItemId, setSelectedItemId] = useState('');
  const [selectedClient, setSelectedClient] = useState<PdvClient | null>(null);
  const [saleDiscountCents, setSaleDiscountCents] = useState(0);
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [discountModalOpen, setDiscountModalOpen] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  // Cashback (20/10/2026): saldo do cliente lido ao escolher o cliente (selo
  // na coluna do total) e de novo ao abrir o pagamento (o cadastro carregado na
  // abertura do caixa pode estar velho). So' pelo servidor.
  const [cashbackDoCliente, setCashbackDoCliente] = useState<CashbackDisponivel | null>(null);
  useEffect(() => {
    if (!vendaPeloServidor || !configCashback.ativo || !selectedClient || selectedClient.isPadrao) {
      setCashbackDoCliente(null);
      return undefined;
    }
    let ativo = true;
    getDoc(doc(db, 'clientes', selectedClient.id)).then((snap) => {
      if (!ativo) return;
      setCashbackDoCliente(snap.exists() ? cashbackDisponivelParaVenda(configCashback, lerResumoCashback(snap.data().cashback)) : null);
    }).catch((error) => {
      console.error('Erro ao ler o cashback do cliente:', error);
      if (ativo) setCashbackDoCliente(null);
    });
    return () => { ativo = false; };
  }, [paymentModalOpen, vendaPeloServidor, configCashback, selectedClient]);

  // Quem usa o caixa: PDV ou "So' a Frente de Caixa", dono e administrador (frenteDeCaixaDomain).
  const hasPdvAccess = podeUsarFrenteDeCaixa({ role: userRole, isOwner, permissoes: userPermissions });

  // O PDV vive fora do sistema de abas/TabPane (ver App.tsx), entao nao
  // herda automaticamente a checagem de blockedModules que toda outra tela
  // ganha de graca -- sem isso, bloquear o modulo "comercial.pedidos" pelo
  // SuperAdmin nao tinha nenhum efeito aqui (auditoria 2026-08-05).
  const isPdvModuleBlocked = !isPlatformAdmin && blockedModules?.includes(MODULO_DO_CAIXA);

  /** App separado: o X encerra o login do caixa (o sistema, se aberto, fica em outra aba). */
  // X do topo (decisao do dono, 20/10/2026): com o caixa aberto, pergunta se
  // fecha agora (vai para o fechamento, com a contagem do dinheiro) ou sai e
  // deixa aberto para o proximo login.
  const sairDoCaixa = async () => {
    const vendaEmAndamento = cartItemsRef.current.length > 0
      ? ' A venda em andamento, que ainda não foi finalizada, é perdida.'
      : '';
    if (!session) {
      const resposta = await NexusSwal.fire({
        title: 'Sair da Frente de Caixa?',
        text: `O caixa está fechado.${vendaEmAndamento}`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Sair',
        cancelButtonText: 'Voltar',
      });
      if (!resposta.isConfirmed) return;
    } else {
      const resposta = await NexusSwal.fire({
        title: 'O caixa está aberto',
        text: `Feche o caixa agora (contagem do dinheiro e fechamento) ou saia e deixe o caixa aberto para o próximo login.${vendaEmAndamento}`,
        icon: 'question',
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: 'Fechar o caixa agora',
        denyButtonText: 'Sair e manter aberto',
        // Sair mantendo aberto e' normal (troca de turno), nao e' perigo: cor neutra.
        denyButtonColor: '#475569',
        cancelButtonText: 'Voltar',
      });
      if (resposta.isDismissed) return;
      if (resposta.isConfirmed) {
        const fechou = await closeSession();
        if (!fechou) return;
      }
    }
    await logout();
    navigate(CAMINHO_LOGIN_CAIXA, { replace: true });
  };

  const sessionStorageKey = useMemo(
    () => makePdvSessionStorageKey(tenantId, currentUser?.uid),
    [currentUser?.uid, tenantId],
  );

  // Nome do operador = o do cadastro do usuario (20/10/2026), nunca o login.
  const [nomeDoCadastro, setNomeDoCadastro] = useState('');
  useEffect(() => {
    if (!currentUser?.uid) return undefined;
    let ativo = true;
    getDoc(doc(db, 'usuarios', currentUser.uid))
      .then((snap) => { if (ativo) setNomeDoCadastro(nomeDoOperador(snap.exists() ? snap.data() : null, '')); })
      .catch(() => { /* sem o cadastro, fica o login */ });
    return () => { ativo = false; };
  }, [currentUser?.uid]);
  const operatorName = nomeDoCadastro || currentUser?.displayName || currentUser?.email?.split('@')[0] || 'Operador';

  const totals = useMemo(
    () => calculatePdvTotals(cartItems, saleDiscountCents),
    [cartItems, saleDiscountCents],
  );

  // Nivel 2 (sistema): desconto TOTAL do cupom (itens + desconto geral)
  // contra o limite configurado pro PDV.
  const checagemLimiteDesconto = useMemo(
    // Ate o percentual do cadastro do cliente o desconto passa direto --
    // e' autorizacao ja dada pelo dono. Acima disso vale o limite do PDV.
    () => checarLimiteComCliente(
      limiteDescontoPdv,
      totals.subtotalCentavos,
      totals.descontoTotalCentavos,
      descontoPadraoDoCliente(selectedClient),
    ),
    [limiteDescontoPdv, totals.subtotalCentavos, totals.descontoTotalCentavos, selectedClient],
  );

  // Uma aprovacao de senha so vale pro carrinho do momento -- mudar item ou
  // desconto depois invalida.
  const primeiraRenderAprovacaoRef = useRef(true);
  // Trava sincrona de duplo-clique. O estado `saving` desabilita o botao,
  // mas so no render seguinte -- dois cliques dentro do mesmo frame passam
  // os dois e gravam duas vendas. Mesmo padrao de submitLockRef no
  // PedidoVendaForm e returnLockRef no DevolucaoVendaModal.
  const saleLockRef = useRef(false);
  useEffect(() => {
    if (primeiraRenderAprovacaoRef.current) {
      primeiraRenderAprovacaoRef.current = false;
      return;
    }
    setAprovacaoDesconto(null);
  }, [cartItems, saleDiscountCents]);

  const selectedItem = useMemo(
    () => cartItems.find((item) => item.id === selectedItemId) || cartItems[cartItems.length - 1] || null,
    [cartItems, selectedItemId],
  );

  useEffect(() => {
    if (!currentUser || !tenantId || needsTenantSelection) return;

    let active = true;
    const loadData = async () => {
      setLoading(true);
      try {
        const [productsSnap, clientsSnap, configSnap] = await Promise.all([
          getDocs(query(collection(db, 'estoque'), where('tenantId', '==', tenantId))),
          getDocs(query(collection(db, 'clientes'), where('tenantId', '==', tenantId))),
          getDoc(doc(db, 'configuracoes', tenantId)),
        ]);

        if (!active) return;

        const nextProducts = productsSnap.docs
          .map((document) => {
            const data = document.data();
            return {
              id: document.id,
              nome: normalizeText(data.nome),
              codigo: normalizeText(data.codigo),
              codigoBarras: normalizeText(data.codigoBarras),
              referencia: normalizeText(data.referencia),
              skuSistema: normalizeText(data.skuSistema || data.ecommerce?.skuSistema),
              categoria: normalizeText(data.categoria),
              precoVenda: Number(data.precoVenda ?? data.precos?.venda ?? 0),
              precoAVista: Number(data.precoAVista ?? 0),
              quantidade: Number(data.quantidade ?? data.estoque?.quantidadeAtual ?? 0),
              quantidadeReservada: Number(data.quantidadeReservada ?? 0),
              filialOrigem: normalizeText(data.filialOrigem),
              imagemProduto: normalizeText(data.imagemProduto),
              unidadeMedidaSigla: normalizeText(data.unidadeMedidaSigla) || 'UN',
              unidadeMedidaCasasDecimais: Number(data.unidadeMedidaCasasDecimais ?? 0),
              unidadeMedidaFracionado: data.unidadeMedidaFracionado,
              statusAtivo: data.statusAtivo ?? data.ativo ?? true,
              produtoRevenda: data.produtoRevenda,
              temGrade: data.temGrade === true,
              bloquearVendaSemEstoque: data.bloquearVendaSemEstoque === true,
              embalagens: data.embalagens,
              descontoMaximoPercentual: data.descontoMaximoPercentual,
            } as PdvProduct;
          })
          // produtoRevenda === false = item de uso interno (peca de veiculo,
          // embalagem, insumo a granel...), nunca aparece pra venda -- so o
          // "false" explicito exclui; ausente/true continua vendavel. O principal
          // de uma grade (temGrade) tambem fica fora: quem se vende e' a variacao.
          .filter((product) => product.nome && product.statusAtivo !== false && product.produtoRevenda !== false && product.temGrade !== true)
          .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

        const nextClients = clientsSnap.docs
          .map((document) => {
            const data = document.data();
            return {
              id: document.id,
              nome: normalizeText(data.nome),
              telefone: normalizeText(data.telefone),
              documento: normalizeText(data.documento),
              email: normalizeText(data.email),
              codigo: normalizeText(data.codigo) || undefined,
              fantasia: normalizeText(data.fantasia),
              celular: normalizeText(data.celular),
              cidade: normalizeText(data.cidade),
              estado: normalizeText(data.estado),
              bairro: normalizeText(data.bairro),
              endereco: normalizeText(data.endereco),
              numero: normalizeText(data.numero),
              ativo: data.ativo !== false,
              alertaAtivo: data.alertaAtivo === true,
              alertaTexto: normalizeText(data.alertaTexto),
              descontoPadraoPercentual: Number(data.descontoPadraoPercentual) || 0,
              isPadrao: Boolean(data.isPadrao),
            } as PdvClient;
          })
          .filter((client) => client.nome)
          .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

        const configData = configSnap.exists() ? configSnap.data() : null;
        setProducts(nextProducts);
        setClients(nextClients);
        setAllowNegativeStock(configData?.venderSemEstoque === true);
        setVendaPeloServidor(parseVendaPeloServidor(configData?.vendaPeloServidor));
        setFormasPrecoAVista(parseFormasAVista(configData?.formasPrecoAVista));
        setVenderPorEmbalagem(configData?.venderPorEmbalagem ?? DEFAULT_VENDER_POR_EMBALAGEM);
        setLimiteDescontoPdv(parseLimiteDescontoConfig(configData?.limiteDescontoPdv));
        setModoLimiteDesconto(parseModoLimiteDesconto(configData?.modoLimiteDesconto));
        setProductSearchMode(configData?.buscaProdutoModo === 'exata' ? 'exata' : DEFAULT_PRODUCT_SEARCH_MODE);
        setFinanceConfig(buildPdvFinanceConfig(configData));
      } catch (error) {
        console.error('Erro ao carregar dados do PDV:', error);
        showError('Erro ao carregar PDV', 'Não foi possível buscar produtos, clientes e configurações.');
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadData();
    const savedSession = localStorage.getItem(sessionStorageKey);
    if (savedSession) {
      try {
        const cachedSession = JSON.parse(savedSession) as PdvSession;
        // Mostra o cache local otimisticamente (evita bloquear o mount numa
        // rodada de rede), mas a fonte da verdade e o Firestore -- confirma
        // em paralelo que a sessao continua aberta no servidor (pode ter
        // sido fechada em outro dispositivo/aba).
        setSession(cachedSession);
        void (async () => {
          try {
            const snapAtual = await getDoc(doc(db, 'caixas_pdv', cachedSession.id));
            if (!active) return;
            if (!snapAtual.exists() || snapAtual.data().status !== 'aberto') {
              setSession(null);
              localStorage.removeItem(sessionStorageKey);
            }
          } catch (error) {
            console.error('Erro ao validar sessão de caixa aberta:', error);
          }
        })();
      } catch {
        localStorage.removeItem(sessionStorageKey);
      }
    }

    return () => {
      active = false;
    };
  }, [currentUser, needsTenantSelection, sessionStorageKey, tenantId]);

  useEffect(() => {
    productInputRef.current?.focus();
  }, [cartItems.length, paymentModalOpen]);

  const resetSale = useCallback(() => {
    idVendaServidorRef.current = '';
    setSearch('');
    setSelectedProduct(null);
    setCartItems([]);
    setSelectedItemId('');
    setSelectedClient(null);
    setSaleDiscountCents(0);
    setPaymentModalOpen(false);
    setDiscountModalOpen(false);
    setClientModalOpen(false);
  }, []);

  const openSession = useCallback(async () => {
    if (!currentUser || !tenantId) return;

    let saldoAnteriorSugeridoCentavos: number | null = null;
    try {
      const qUltimoFechamento = query(
        collection(db, 'caixas_pdv'),
        where('tenantId', '==', tenantId),
        where('operadorId', '==', currentUser.uid),
        where('status', '==', 'fechado'),
        orderBy('fechadoEm', 'desc'),
        limit(1),
      );
      const snapUltimo = await getDocs(qUltimoFechamento);
      if (!snapUltimo.empty) {
        saldoAnteriorSugeridoCentavos = Number(snapUltimo.docs[0].data().saldoFinalInformadoCentavos ?? 0);
      }
    } catch (error) {
      console.error('Erro ao buscar saldo anterior do caixa:', error);
    }

    const result = await NexusSwal.fire({
      title: 'Abrir caixa',
      text: saldoAnteriorSugeridoCentavos !== null
        ? `Saldo do último fechamento: ${currency.format(fromCents(saldoAnteriorSugeridoCentavos))}. Confirme ou ajuste o saldo inicial em dinheiro.`
        : 'Informe o saldo inicial em dinheiro.',
      input: 'number',
      inputValue: saldoAnteriorSugeridoCentavos !== null ? toCurrencyInput(saldoAnteriorSugeridoCentavos) : '0.00',
      inputAttributes: { min: '0', step: '0.01' },
      showCancelButton: true,
      confirmButtonText: 'Abrir caixa',
      cancelButtonText: 'Cancelar',
    });

    if (!result.isConfirmed) return;

    const saldoInicialCentavos = fromCurrencyInput(result.value || 0);
    const saldoAnteriorConfirmado = saldoAnteriorSugeridoCentavos !== null && saldoInicialCentavos === saldoAnteriorSugeridoCentavos;

    try {
      const novaSessaoRef = await addDoc(collection(db, 'caixas_pdv'), {
        tenantId,
        operadorId: currentUser.uid,
        operadorNome: operatorName,
        status: 'aberto',
        saldoInicialCentavos,
        saldoAnteriorSugeridoCentavos,
        saldoAnteriorConfirmado,
        fechadoEm: null,
        saldoFinalInformadoCentavos: null,
        saldoEsperadoCentavos: null,
        diferencaCentavos: null,
        sangrias: [],
        totalSangriasCentavos: 0,
        createdAt: serverTimestamp(),
        ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
      });

      const nextSession: PdvSession = {
        id: novaSessaoRef.id,
        tenantId,
        operadorId: currentUser.uid,
        operadorNome: operatorName,
        status: 'aberto',
        saldoInicialCentavos,
        saldoAnteriorSugeridoCentavos,
        saldoAnteriorConfirmado,
        abertoEm: new Date().toISOString(),
        fechadoEm: null,
        saldoFinalInformadoCentavos: null,
        saldoEsperadoCentavos: null,
        diferencaCentavos: null,
        sangrias: [],
        totalSangriasCentavos: 0,
      };
      setSession(nextSession);
      localStorage.setItem(sessionStorageKey, JSON.stringify(nextSession));
      showSuccess('Caixa aberto');

      const { createAuditLog } = await import('../../services/logService');
      createAuditLog({
        tenantId,
        usuarioId: currentUser.uid,
        usuarioEmail: currentUser.email || '',
        modulo: 'financeiro',
        acao: 'abrir_caixa',
        descricao: `Caixa aberto por ${operatorName} com saldo inicial de ${currency.format(fromCents(saldoInicialCentavos))}.`,
        registroRelacionadoId: novaSessaoRef.id,
        status: 'sucesso',
      });
    } catch (error) {
      console.error('Erro ao abrir caixa:', error);
      showError('Erro ao abrir caixa', 'Não foi possível abrir o caixa. Tente novamente.');
    }
  }, [currentUser, operatorName, sessionStorageKey, tenantId]);

  /** Devolve true quando o caixa foi fechado (o X do topo so' sai depois disso). */
  const closeSession = async (): Promise<boolean> => {
    if (!session || !currentUser || !tenantId) return false;

    if (cartItems.length > 0) {
      const confirmation = await NexusSwal.fire({
        title: 'Fechar caixa?',
        text: 'Existe uma venda em andamento. Ela será limpa antes do fechamento.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Fechar caixa',
        cancelButtonText: 'Voltar',
      });
      if (!confirmation.isConfirmed) return false;
    }

    let saldoEsperadoCentavos = session.saldoInicialCentavos - session.totalSangriasCentavos;
    try {
      const qVendasEmDinheiro = query(
        collection(db, 'transacoes'),
        where('tenantId', '==', tenantId),
        where('pdvSessionId', '==', session.id),
        where('movimentaCaixaFisico', '==', true),
      );
      const snapVendas = await getDocs(qVendasEmDinheiro);
      snapVendas.forEach((docSnap) => {
        const t = docSnap.data();
        // Venda cancelada nesta sessao: o dinheiro voltou ao cliente (19/10/2026).
        if (t.estornada === true || t.status === 'Cancelada') return;
        saldoEsperadoCentavos += Number(t.valorCentavos || 0);
      });
    } catch (error) {
      console.error('Erro ao calcular saldo esperado do caixa:', error);
    }

    const result = await NexusSwal.fire({
      title: 'Fechar caixa',
      text: `Saldo esperado em dinheiro: ${currency.format(fromCents(saldoEsperadoCentavos))}. Informe o valor contado fisicamente no caixa.`,
      input: 'number',
      inputValue: toCurrencyInput(saldoEsperadoCentavos),
      inputAttributes: { min: '0', step: '0.01' },
      showCancelButton: true,
      confirmButtonText: 'Fechar caixa',
      cancelButtonText: 'Cancelar',
    });

    if (!result.isConfirmed) return false;

    const saldoFinalInformadoCentavos = fromCurrencyInput(result.value || 0);
    const diferencaCentavos = saldoFinalInformadoCentavos - saldoEsperadoCentavos;

    try {
      await updateDoc(doc(db, 'caixas_pdv', session.id), {
        status: 'fechado',
        fechadoEm: serverTimestamp(),
        saldoFinalInformadoCentavos,
        saldoEsperadoCentavos,
        diferencaCentavos,
        updatedAt: serverTimestamp(),
        ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Caixa fechado'),
      });

      const { createAuditLog } = await import('../../services/logService');
      createAuditLog({
        tenantId,
        usuarioId: currentUser.uid,
        usuarioEmail: currentUser.email || '',
        modulo: 'financeiro',
        acao: 'fechar_caixa',
        descricao: `Caixa fechado por ${operatorName}. Esperado: ${currency.format(fromCents(saldoEsperadoCentavos))}, informado: ${currency.format(fromCents(saldoFinalInformadoCentavos))}, diferença: ${currency.format(fromCents(diferencaCentavos))}.`,
        registroRelacionadoId: session.id,
        status: 'sucesso',
      });

      resetSale();
      setSession(null);
      localStorage.removeItem(sessionStorageKey);
      showSuccess('Caixa fechado');
      return true;
    } catch (error) {
      console.error('Erro ao fechar caixa:', error);
      showError('Erro ao fechar caixa', 'Não foi possível fechar o caixa. Tente novamente.');
      return false;
    }
  };

  const [sangriaModalOpen, setSangriaModalOpen] = useState(false);

  const registrarSangria = useCallback(async (valorCentavos: number, motivo: string) => {
    if (!session || !currentUser || !tenantId) return;

    const novaSangria: CaixaSangria = {
      id: crypto.randomUUID(),
      valorCentavos,
      motivo,
      registradoEm: new Date().toISOString(),
      registradoPor: currentUser.uid,
      registradoPorNome: operatorName,
    };

    try {
      await updateDoc(doc(db, 'caixas_pdv', session.id), {
        sangrias: arrayUnion(novaSangria),
        totalSangriasCentavos: increment(valorCentavos),
        updatedAt: serverTimestamp(),
        ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), `Sangria de ${currency.format(fromCents(valorCentavos))}`),
      });

      const nextSession: PdvSession = {
        ...session,
        sangrias: [...session.sangrias, novaSangria],
        totalSangriasCentavos: session.totalSangriasCentavos + valorCentavos,
      };
      setSession(nextSession);
      localStorage.setItem(sessionStorageKey, JSON.stringify(nextSession));
      showSuccess('Sangria registrada');

      const { createAuditLog } = await import('../../services/logService');
      createAuditLog({
        tenantId,
        usuarioId: currentUser.uid,
        usuarioEmail: currentUser.email || '',
        modulo: 'financeiro',
        acao: 'sangria_caixa',
        descricao: `Sangria de ${currency.format(fromCents(valorCentavos))} (${motivo}) registrada por ${operatorName}.`,
        registroRelacionadoId: session.id,
        status: 'sucesso',
      });
    } catch (error) {
      console.error('Erro ao registrar sangria:', error);
      showError('Erro ao registrar sangria', 'Não foi possível registrar a sangria. Tente novamente.');
    }
  }, [currentUser, operatorName, session, sessionStorageKey, tenantId]);

  /** Valida contra a unidade REALMENTE vendida: um saco continua indivisivel
   * mesmo num produto fracionavel em quilo, e o estoque e sempre comparado
   * na unidade base (2 sacos de 20kg exigem 40kg de saldo). */
  const validateQuantity = useCallback((product: PdvProduct, nextQuantity: number, opcao?: OpcaoUnidadeVenda, outrasLinhasBase = 0) => {
    if (nextQuantity <= 0) return false;
    const permiteFracionado = opcao ? opcao.permiteFracionado : product.unidadeMedidaFracionado;
    const casasDecimais = opcao?.casasDecimais ?? product.unidadeMedidaCasasDecimais;
    const sigla = opcao?.sigla || product.unidadeMedidaSigla || 'UN';
    if (!isValidSaleQuantity(nextQuantity, permiteFracionado, casasDecimais)) {
      showError('Operação bloqueada', permiteFracionado
        ? `A quantidade de ${product.nome} aceita no máximo ${casasDecimais ?? 0} casa(s) decimal(is), conforme a unidade ${sigla}.`
        : `${product.nome} está sendo vendido na unidade ${sigla}, que não permite quantidade fracionada.`);
      return false;
    }
    const quantidadeBase = toBaseQuantity(nextQuantity, opcao?.fatorConversao);
    // Reserva na venda (13/10/2026): conta o produto no cupom inteiro (outras
    // linhas em outra unidade somam) e o que esta reservado em pre-venda,
    // condicional, OS ou troca. Empresa que nao vende sem estoque trava;
    // a que vende so' recebe o aviso.
    const totalBase = quantidadeBase + Math.max(0, outrasLinhasBase);
    const reserva = conferirSaidaComReserva({ tenantId, produto: product, pedida: totalBase, permiteVendaSemEstoque: allowNegativeStock });
    if (reserva === false) return false;
    if (reserva === 'sem_estoque') {
      const siglaBase = product.unidadeMedidaSigla || 'UN';
      const emEstoque = Number(product.quantidade || 0).toLocaleString('pt-BR');
      const outras = outrasLinhasBase > 0 ? ` O cupom já tem ${outrasLinhasBase.toLocaleString('pt-BR')} ${siglaBase} deste produto em outra linha.` : '';
      showError('Estoque insuficiente', (opcao?.fatorConversao ?? 1) === 1
        ? `Disponível: ${emEstoque}.${outras}`
        : `${nextQuantity} ${sigla} consome ${quantidadeBase} ${siglaBase}, mas há apenas ${emEstoque} ${siglaBase}.${outras}`);
      return false;
    }
    return true;
  }, [allowNegativeStock, tenantId]);

  /** Quanto do produto ja' esta nas OUTRAS linhas do cupom, na unidade base. */
  const baseNasOutrasLinhas = (linhas: PdvCartItem[], productId: string, linhaIgnorada: string): number => linhas
    .filter((linha) => linha.productId === productId && linha.id !== linhaIgnorada)
    .reduce((total, linha) => total + (linha.quantidadeBase ?? toBaseQuantity(linha.quantidade, linha.fatorConversao)), 0);

  /** Quando o termo pesquisado e' o codigo de barras de uma embalagem, o item
   * entra ja naquela unidade -- bipar o saco lanca 1 SC (e baixa 20 kg), nao
   * 1 kg. Termo que nao bate com EAN de embalagem devolve undefined e o
   * produto cai na unidade base, como sempre. */
  const resolveScannedUnit = useCallback((product: PdvProduct): OpcaoUnidadeVenda | undefined => {
    if (!venderPorEmbalagem) return undefined;
    const embalagemId = findEmbalagemIdByExactCode(product, search);
    if (!embalagemId) return undefined;
    return findOpcaoUnidadeVenda(buildOpcoesUnidadeVenda(product), embalagemId);
  }, [search, venderPorEmbalagem]);

  /** Preco da linha pela tabela (a vista/promocao), respeitando quota e limite por venda da promocao. */
  const precificarLinha = useCallback((product: PdvProduct, opcao: OpcaoUnidadeVenda, quantidadeTotal: number, linhaId?: string): { preco: number; campos: CamposDePrecoDoItem } => {
    let tabela = tabelaDe(product, { fatorConversao: opcao.fatorConversao, precoProprio: opcao.precoVendaProprio, precoAVistaProprio: opcao.precoAVistaProprio });
    if (tabela.promocao) {
      const promoId = tabela.promocao.id;
      const jaNestaVenda = cartItemsRef.current
        .filter((item) => item.productId === product.id && item.id !== linhaId && item.promocaoId === promoId)
        .reduce((total, item) => total + (item.quantidadeBase ?? item.quantidade), 0);
      const quota = quantidadeLiberada(product, jaNestaVenda);
      const base = opcao.embalagemId ? toBaseQuantity(quantidadeTotal, opcao.fatorConversao) : quantidadeTotal;
      if (quota && quota.liberada !== null && base > quota.liberada) {
        tabela = { ...tabela, promocao: null };
        showWarning(`${product.nome}: fora da promoção`, quota.liberada > 0
          ? `A promoção "${quota.promo.nome}" só libera mais ${quota.liberada} unidade(s) nesta venda. O item entrou no preço normal.`
          : `A quantidade da promoção "${quota.promo.nome}" acabou. O item entrou no preço normal.`);
      }
    }
    return camposDePrecoDoItem(tabela, CONDICAO_PDV);
  }, [tabelaDe, quantidadeLiberada]);

  const addProductToCart = useCallback((product: PdvProduct, quantity = 1, opcao?: OpcaoUnidadeVenda) => {
    if (!session) {
      void openSession();
      return;
    }

    const opcaoFinal = opcao || buildOpcoesUnidadeVenda(product)[0];
    const lineId = makeCartLineId(product.id, opcaoFinal.embalagemId);
    // Fora do updater de proposito (ele pode rodar duas vezes no StrictMode e o aviso de quota sairia dobrado).
    const linhaAntes = cartItemsRef.current.find((item) => item.id === lineId);
    const precificacao = precificarLinha(product, opcaoFinal, (linhaAntes?.quantidade || 0) + quantity, linhaAntes?.id);

    setCartItems((current) => {
      // Funde por LINHA (produto + embalagem), nao por produto: bipar o saco
      // depois de ja ter vendido a granel nao pode somar na linha do quilo.
      const existing = current.find((item) => item.id === lineId);
      const nextQuantity = (existing?.quantidade || 0) + quantity;
      if (!validateQuantity(product, nextQuantity, opcaoFinal, baseNasOutrasLinhas(current, product.id, lineId))) return current;

      if (existing) {
        setSelectedItemId(existing.id);
        return current.map((item) => item.id === existing.id
          ? {
              ...item,
              quantidade: nextQuantity,
              ...(item.embalagemId ? { quantidadeBase: toBaseQuantity(nextQuantity, item.fatorConversao) } : {}),
              // A quota da promocao pode acabar ao somar: o preco acompanha a quantidade nova.
              precoUnitarioCentavos: toCents(precificacao.preco),
              promocaoId: undefined,
              promocaoNome: undefined,
              ...precificacao.campos,
            }
          : item);
      }

      const nextItem = makeCartItemFromProduct(product, quantity, opcaoFinal, precificacao);
      setSelectedItemId(nextItem.id);
      return [...current, nextItem];
    });

    // Item lancado: a consulta some e a busca fica pronta para o proximo.
    setSelectedProduct(null);
    setSearch('');
  }, [openSession, session, validateQuantity, precificarLinha]);

  const updateItemQuantity = useCallback((itemId: string, quantity: number) => {
    setCartItems((current) => current.flatMap((item) => {
      if (item.id !== itemId) return [item];
      if (quantity <= 0) return [];
      const product = products.find((entry) => entry.id === item.productId);
      const opcao = product
        ? findOpcaoUnidadeVenda(buildOpcoesUnidadeVenda(product), item.embalagemId)
        : undefined;
      if (product && !validateQuantity(product, quantity, opcao, baseNasOutrasLinhas(current, product.id, item.id))) return [item];
      return [{
        ...item,
        quantidade: quantity,
        ...(item.embalagemId ? { quantidadeBase: toBaseQuantity(quantity, item.fatorConversao) } : {}),
      }];
    }));
  }, [products, validateQuantity]);

  /** Opcoes de unidade por linha do carrinho, so quando a chave esta ligada.
   * Desligada = mapa vazio, e o CartPanel nem renderiza o seletor. */
  const unitOptionsByItemId = useMemo(() => {
    if (!venderPorEmbalagem) return {};
    return cartItems.reduce<Record<string, OpcaoUnidadeVenda[]>>((mapa, item) => {
      const product = products.find((entry) => entry.id === item.productId);
      if (product) mapa[item.id] = buildOpcoesUnidadeVenda(product);
      return mapa;
    }, {});
  }, [cartItems, products, venderPorEmbalagem]);

  /** Troca a unidade de uma linha ja lancada. Se ja existir outra linha na
   * unidade de destino, as duas seriam a mesma coisa -- em vez de criar id
   * duplicado, recusa e explica. */
  const changeItemUnit = useCallback((itemId: string, embalagemId: string) => {
    const itemAtual = cartItemsRef.current.find((entry) => entry.id === itemId);
    const produtoAtual = itemAtual ? products.find((entry) => entry.id === itemAtual.productId) : undefined;
    const precificacao = itemAtual && produtoAtual
      ? precificarLinha(produtoAtual, findOpcaoUnidadeVenda(buildOpcoesUnidadeVenda(produtoAtual), embalagemId), itemAtual.quantidade, itemAtual.id)
      : null;
    setCartItems((current) => {
      const item = current.find((entry) => entry.id === itemId);
      if (!item) return current;
      const product = products.find((entry) => entry.id === item.productId);
      if (!product) return current;

      const opcao = findOpcaoUnidadeVenda(buildOpcoesUnidadeVenda(product), embalagemId);
      const novoId = makeCartLineId(item.productId, opcao.embalagemId);
      if (novoId === item.id) return current;
      if (current.some((entry) => entry.id === novoId)) {
        showError('Unidade já lançada', `${product.nome} já está no cupom em ${opcao.sigla}. Altere a quantidade daquela linha.`);
        return current;
      }
      if (!validateQuantity(product, item.quantidade, opcao, baseNasOutrasLinhas(current, product.id, item.id))) return current;

      setSelectedItemId(novoId);
      return current.map((entry) => entry.id !== itemId ? entry : {
        ...entry,
        id: novoId,
        // O preco acompanha a unidade -- o saco nao custa o mesmo que o quilo.
        precoUnitarioCentavos: toCents(precificacao ? precificacao.preco : opcao.precoVenda),
        promocaoId: undefined,
        promocaoNome: undefined,
        ...(precificacao ? precificacao.campos : {}),
        // Desconto em reais foi calculado sobre o preco antigo; mante-lo aqui
        // aplicaria um abatimento sem relacao com o novo valor da linha.
        descontoCentavos: 0,
        unidadeMedidaSigla: opcao.sigla,
        unidadeMedidaCasasDecimais: opcao.casasDecimais,
        unidadeMedidaFracionado: opcao.permiteFracionado,
        embalagemId: opcao.embalagemId || undefined,
        fatorConversao: opcao.embalagemId ? opcao.fatorConversao : undefined,
        quantidadeBase: opcao.embalagemId ? toBaseQuantity(entry.quantidade, opcao.fatorConversao) : undefined,
      });
    });
  }, [products, validateQuantity, precificarLinha]);

  const updateItemDiscount = useCallback((itemId: string, discountCents: number) => {
    setCartItems((current) => current.map((item) => {
      if (item.id !== itemId) return item;
      const lineGross = Math.round(item.precoUnitarioCentavos * item.quantidade);
      const clamped = clampDiscountCents(discountCents, lineGross);
      // Nivel 1 (produto): se o PRODUTO define seu proprio limite, ele e' o
      // piso -- sempre bloqueia, independente do modo configurado.
      const produto = products.find((p) => p.id === item.productId);
      if (produto && excedeLimiteItem(produto, clamped, lineGross)) {
        showError(
          'Desconto acima do limite do produto',
          `${item.nome} aceita no máximo ${produto.descontoMaximoPercentual}% de desconto, definido no próprio cadastro.`,
        );
        return item;
      }
      return { ...item, descontoCentavos: clamped };
    }));
  }, [products]);

  const removeItem = useCallback((itemId: string) => {
    setCartItems((current) => current.filter((item) => item.id !== itemId));
    if (selectedItemId === itemId) setSelectedItemId('');
    // Lixeira (bug do dono, 20/10/2026): limpa consulta e busca juntas e volta
    // o foco para a busca -- antes o produto continuava "selecionado" e a
    // busca podia ficar presa esperando o X.
    setSelectedProduct(null);
    setSearch('');
    productInputRef.current?.focus();
  }, [selectedItemId]);

  const clearSale = async () => {
    if (cartItems.length === 0) return;
    const result = await NexusSwal.fire({
      title: 'Limpar venda?',
      text: 'Todos os itens e pagamentos desta venda serão removidos.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Limpar',
      cancelButtonText: 'Cancelar',
    });
    if (result.isConfirmed) resetSale();
  };

  const askSelectedItemQuantity = useCallback(async () => {
    if (!selectedItem) return;
    const result = await NexusSwal.fire({
      title: 'Alterar quantidade',
      text: selectedItem.nome,
      input: 'number',
      inputValue: String(selectedItem.quantidade),
      inputAttributes: { min: '0', step: selectedItem.unidadeMedidaFracionado === true ? 'any' : '1' },
      showCancelButton: true,
      confirmButtonText: 'Aplicar',
      cancelButtonText: 'Cancelar',
    });
    if (result.isConfirmed) {
      updateItemQuantity(selectedItem.id, Number(result.value || 0));
    }
  }, [selectedItem, updateItemQuantity]);

  const finalizeSale = async (drafts: PaymentDraft[], observation: string) => {
    // Cashback so' e' consumido pelo servidor: gravado pela tela, o cupom nao
    // pode levar essa forma (o saldo do cliente ficaria sem baixa).
    if (!vendaPeloServidor && drafts.some((d) => d.forma === FORMA_PAGAMENTO_CASHBACK)) {
      showError('Cashback indisponível', 'Pagar com cashback só funciona com a venda pelo servidor ligada para a empresa. Troque a forma de pagamento.');
      return;
    }
    if (saleLockRef.current) return;
    if (!currentUser || !tenantId || !session) return;
    if (cartItems.length === 0) {
      showError('Venda vazia', 'Adicione pelo menos um produto.');
      return;
    }
    // Balanco aberto com as vendas travadas (21/10/2026).
    const travaDoBalanco = await mensagemDaTravaDoBalanco(tenantId, 'finalizar a venda no PDV');
    if (travaDoBalanco) {
      showError('Balanço em andamento', travaDoBalanco);
      return;
    }

    if (checagemLimiteDesconto.excedeu) {
      if (modoLimiteDesconto === 'bloquear') {
        showError('Desconto acima do limite', `O desconto deste cupom (${checagemLimiteDesconto.percentualAplicado.toFixed(1)}%) excede o limite configurado. Reduza o desconto para continuar.`);
        return;
      }
      if (modoLimiteDesconto === 'senha' && !aprovacaoDesconto) {
        setShowAprovacaoDesconto(true);
        return;
      }
      if (modoLimiteDesconto === 'avisar') {
        const confirm = await NexusSwal.fire({
          title: 'Desconto acima do limite',
          text: `O desconto deste cupom (${checagemLimiteDesconto.percentualAplicado.toFixed(1)}%) excede o limite configurado. Deseja finalizar mesmo assim?`,
          icon: 'warning',
          showCancelButton: true,
          confirmButtonText: 'Finalizar mesmo assim',
          cancelButtonText: 'Revisar desconto',
        });
        if (!confirm.isConfirmed) return;
      }
    }

    // Os itens entraram com preco a vista / promocao (CONDICAO_PDV). Pagamento
    // a prazo (credito parcelado, cheque) muda o preco -- nunca em silencio:
    // a pessoa escolhe recalcular e confere o total de novo.
    const condicaoEscolhida = condicaoDoPagamento(drafts, formasPrecoAVista);
    if (condicaoEscolhida === 'prazo') {
      let alterados = 0;
      let diferencaCentavos = 0;
      const reprecificados = cartItems.map((item) => {
        if (!item.tabelaPreco || item.origemPreco === 'manual') return item;
        const auto = precoAutomatico(item.tabelaPreco, condicaoEscolhida);
        const centavos = toCents(auto.preco);
        if (centavos === item.precoUnitarioCentavos) return item;
        alterados += 1;
        diferencaCentavos += Math.round((centavos - item.precoUnitarioCentavos) * item.quantidade);
        return {
          ...item,
          precoUnitarioCentavos: centavos,
          origemPreco: auto.origem,
          promocaoId: undefined,
          promocaoNome: undefined,
          ...(auto.origem === 'promocao' && item.tabelaPreco.promocao ? { promocaoId: item.tabelaPreco.promocao.id, promocaoNome: item.tabelaPreco.promocao.nome } : {}),
        };
      });
      if (alterados > 0) {
        const valor = fromCents(Math.abs(diferencaCentavos)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        const escolha = await NexusSwal.fire({
          title: 'Pagamento a prazo',
          text: `${alterados} item(ns) estão com preço à vista ou promoção só à vista. Com este pagamento o total ${diferencaCentavos >= 0 ? 'sobe' : 'cai'} ${valor}. Recalcular os preços e abrir o pagamento de novo?`,
          icon: 'warning',
          showCancelButton: true,
          confirmButtonText: 'Recalcular preços',
          cancelButtonText: 'Voltar',
        });
        if (escolha.isConfirmed) {
          setCartItems(reprecificados);
          setPaymentModalOpen(false);
          showWarning('Preços recalculados para a prazo', 'Confira o total e abra o pagamento de novo (F6).');
        }
        return;
      }
    }

    let paymentRecords: PaymentRecord[];
    try {
      paymentRecords = normalizePayments(totals.totalCentavos, drafts, {
        saleDate: getDateInputInTimeZone(),
        operationLabel: 'venda PDV',
        maxCreditInstallments: financeConfig.maxCreditInstallments || undefined,
        creditFeePercentByInstallment: financeConfig.creditFeePercentByInstallment,
        debitFeePercent: financeConfig.debitFeePercent,
        creditSettlementDays: financeConfig.creditSettlementDays,
        debitSettlementDays: financeConfig.debitSettlementDays,
        cardFeeSchedulesByBrand,
        pagamentoCartaoSimplificadoAtivo: financeConfig.pagamentoCartaoSimplificadoAtivo,
        bancoPadraoSimplificado,
      });
    } catch (error) {
      showError('Pagamento inválido', error instanceof Error ? error.message : 'Revise os pagamentos.');
      return;
    }
    paymentRecords = explodeInstallmentPaymentRecords(paymentRecords);

    saleLockRef.current = true;
    setSaving(true);
    try {
      // Lote e Validade: so' o produto que controla lote entra; os demais seguem so' com o estoque.
      const planoLotes = await prepararBaixaDeLotes({
        db,
        tenantId,
        linhas: linhasParaLote(cartItems.map((item) => ({ id: item.productId, nome: item.nome, quantidade: item.quantidade, fatorConversao: item.fatorConversao }))),
        modo: loteModoSaida,
        avisarVencido: loteAvisarVencido,
      });
      if (planoLotes === null) return; // quem vende cancelou a escolha do lote

      // Espelha na tela a baixa que acabou de ser gravada. Soma TODAS as linhas
      // do mesmo produto (ele pode aparecer em quilo e em saco ao mesmo tempo) e
      // sempre na unidade base.
      const espelharBaixaNaTela = () => setProducts((current) => current.map((product) => {
        const vendidoBase = cartItems
          .filter((item) => item.productId === product.id)
          .reduce((soma, item) => soma + toBaseQuantity(item.quantidade, item.fatorConversao), 0);
        return vendidoBase > 0
          ? { ...product, quantidade: Math.max(0, product.quantidade - vendidoBase) }
          : product;
      }));

      if (vendaPeloServidor) {
        // Fatia 3c (19/10/2026): o servidor confere o caixa aberto, refaz totais,
        // pagamentos e comissao e grava venda, estoque, lotes, lancamentos e saldo
        // do banco numa transacao so' (server/services/vendaFechamento.js).
        if (!idVendaServidorRef.current) idVendaServidorRef.current = doc(collection(db, 'pedidos_venda')).id;
        const resposta = await finalizarVendaNoServidor({
          idDocumento: idVendaServidorRef.current,
          pdvSessionId: session.id,
          dataVenda: getDateInputInTimeZone(),
          vendedorId: currentUser.uid,
          clienteId: selectedClient?.id || null,
          clienteNome: selectedClient?.nome || 'CONSUMIDOR FINAL',
          observacao: observation.trim(),
          itens: cartItems.map((item, indiceDoItem) => ({
            id: item.productId,
            nome: item.nome,
            precoUnitario: fromCents(item.precoUnitarioCentavos),
            quantidade: item.quantidade,
            desconto: fromCents(item.descontoCentavos),
            ...(item.unidadeMedidaSigla ? { unidadeMedidaSigla: item.unidadeMedidaSigla, unidadeMedidaCasasDecimais: item.unidadeMedidaCasasDecimais ?? 0 } : {}),
            ...(item.origemPreco ? { origemPreco: item.origemPreco } : {}),
            ...(item.promocaoId ? { promocaoId: item.promocaoId, promocaoNome: item.promocaoNome || '' } : {}),
            ...camposDeLoteDoItem(planoLotes, String(indiceDoItem)),
            ...(item.embalagemId ? { embalagemId: item.embalagemId, fatorConversao: item.fatorConversao, quantidadeBase: item.quantidadeBase } : {}),
          })),
          descontoGeral: {
            tipo: 'valor',
            valorInformado: fromCents(totals.vendaDescontoCentavos),
            excedeuLimite: checagemLimiteDesconto.excedeu,
            ...(checagemLimiteDesconto.excedeu && aprovacaoDesconto ? { aprovacao: aprovacaoDesconto } : {}),
          },
          frete: 0,
          encargos: 0,
          pagamentos: drafts,
        });
        idVendaServidorRef.current = '';
        showSuccess(`Venda PDV #${resposta.numeroPedido} finalizada`);
        espelharBaixaNaTela();
        resetSale();
        setPaymentModalOpen(false);
        return;
      }

      const currentMaxPedido = await getCurrentMaxSequence(db, 'pedidos_venda', tenantId, 'numeroPedido').catch(() => 0);
      let finalNumeroPedido = '';
      let newPedidoId = '';
      const paymentSummary = summarizePayments(paymentRecords);
      const saleDate = getDateInputInTimeZone();

      const bankCreditsByBanco = new Map<string, number>();
      paymentRecords.forEach((payment) => {
        if (payment.status === 'confirmado' && payment.bancoId) {
          bankCreditsByBanco.set(payment.bancoId, (bankCreditsByBanco.get(payment.bancoId) || 0) + payment.valorCentavos);
        }
      });

      await runTransaction(db, async (transaction) => {
        const nextPedido = await getNextTenantSequenceValue(transaction, db, tenantId, 'pedidos_venda', currentMaxPedido);
        const sellerSnap = await transaction.get(doc(db, 'usuarios', currentUser.uid));
        const sellerProfile = sellerSnap.exists() ? sellerSnap.data() : {};
        if (!sellerSnap.exists() || sellerProfile.tenantId !== tenantId) {
          throw new Error('O operador não pertence à empresa ativa.');
        }
        const sellerName = sellerProfile.nome || sellerProfile.nomeResponsavel || operatorName;

        const bankBalancesById = new Map<string, number>();
        for (const bancoId of bankCreditsByBanco.keys()) {
          const bancoSnap = await transaction.get(doc(db, 'bancos', bancoId));
          if (!bancoSnap.exists()) throw new Error('O banco de destino selecionado não foi encontrado.');
          bankBalancesById.set(bancoId, Number(bancoSnap.data().saldoCentavos || 0));
        }

        finalNumeroPedido = formatSequenceValue(nextPedido, 4);
        const newPedidoRef = doc(collection(db, 'pedidos_venda'));
        newPedidoId = newPedidoRef.id;

        await applyStockAdjustments(
          transaction,
          db,
          toStockAdjustmentItems(cartItems.map((item) => ({
            id: item.productId,
            nome: item.nome,
            quantidade: item.quantidade,
            fatorConversao: item.fatorConversao,
          }))),
          'decrement',
          allowNegativeStock,
          { respeitarReserva: true },
        );
        baixarLotesNaTransacao(transaction, db, planoLotes);

        writeTenantSequenceValue(transaction, db, tenantId, 'pedidos_venda', nextPedido);

        const persistedPayments = paymentRecords.map((payment, index) => ({
          ...payment,
          transactionId: index === 0 ? newPedidoRef.id : `${newPedidoRef.id}_pag_${index + 1}`,
        }));
        const saleDiscountShare = totals.vendaDescontoCentavos;
        const grossItemsCents = Math.max(1, totals.subtotalCentavos);
        const itens = cartItems.map((item, indiceDoItem) => {
          const lineGrossCents = Math.round(item.precoUnitarioCentavos * item.quantidade);
          const proportionalSaleDiscount = Math.round(saleDiscountShare * (lineGrossCents / grossItemsCents));
          const totalDiscountCents = Math.min(lineGrossCents, item.descontoCentavos + proportionalSaleDiscount);
          const subtotalCents = Math.max(0, lineGrossCents - totalDiscountCents);
          return {
            id: item.productId,
            nome: item.nome,
            precoUnitario: fromCents(item.precoUnitarioCentavos),
            precoUnitarioCentavos: item.precoUnitarioCentavos,
            quantidade: item.quantidade,
            desconto: fromCents(totalDiscountCents),
            descontoCentavos: totalDiscountCents,
            subtotal: fromCents(subtotalCents),
            subtotalCentavos: subtotalCents,
            unidadeMedidaSigla: item.unidadeMedidaSigla,
            unidadeMedidaCasasDecimais: item.unidadeMedidaCasasDecimais,
            // De onde veio o preco (a vista / promocao), como no Pedido de Venda.
            ...(item.origemPreco ? { origemPreco: item.origemPreco } : {}),
            ...(item.promocaoId ? { promocaoId: item.promocaoId, promocaoNome: item.promocaoNome || '' } : {}),
            ...camposDeLoteDoItem(planoLotes, String(indiceDoItem)),
            // Mesmo contrato do Pedido de Venda: item na unidade base nao
            // ganha campo de embalagem, para nao mudar o formato historico.
            ...(item.embalagemId
              ? {
                  embalagemId: item.embalagemId,
                  fatorConversao: item.fatorConversao,
                  quantidadeBase: item.quantidadeBase,
                }
              : {}),
          };
        });

        const commissionSnapshot = buildCommissionSnapshot({
          sellerId: currentUser.uid,
          sellerName,
          baseCents: itens.reduce((sum, item) => sum + Number(item.subtotalCentavos || toCents(item.subtotal)), 0),
          profile: sellerProfile,
        });
        const clienteNome = selectedClient?.nome || 'CONSUMIDOR FINAL';

        transaction.set(newPedidoRef, {
          numeroPedido: finalNumeroPedido,
          // Promocoes do cupom: e' por aqui que a quota (vendidoNaPromocao) conta a venda do PDV.
          promocaoIds: [...new Set(itens.map((item) => item.promocaoId).filter((p): p is string => Boolean(p)))],
          // O 'pdv' ja era gravado em cada TRANSACOES de pagamento (F16),
          // mas nunca no documento da venda em si -- sem isso, nao ha como
          // distinguir uma venda de balcao de um Pedido de Venda comum so
          // olhando pedidos_venda/{id}. Achado montando o relatorio da
          // Fatia 6 (Descontos Concedidos), que precisa separar as origens.
          sourceOrigin: 'pdv',
          clienteId: selectedClient?.id || null,
          clienteNome,
          itens,
          valorTotalItens: fromCents(totals.subtotalCentavos),
          valorTotalItensCentavos: totals.subtotalCentavos,
          valorTotalDescontos: fromCents(totals.descontoTotalCentavos),
          valorTotalDescontosCentavos: totals.descontoTotalCentavos,
          descontoItensCentavos: totals.itensDescontoCentavos,
          descontoVendaCentavos: totals.vendaDescontoCentavos,
          // Snapshot no mesmo formato usado por Pedido/OS/Orcamento, pro
          // relatorio de descontos concedidos (Fatia 6) ler os 4 de igual
          // pra igual. DiscountModal so devolve o valor final em centavos
          // (nao guarda se o operador escolheu % ou R$), entao aqui sempre
          // registra como 'valor' -- o total concedido fica certo mesmo
          // assim, so o "tipo" nao reflete a escolha original do operador.
          descontoGeral: {
            tipo: 'valor' as const,
            valorInformado: fromCents(totals.descontoTotalCentavos),
            valorAplicadoCentavos: totals.descontoTotalCentavos,
            excedeuLimite: checagemLimiteDesconto.excedeu,
            ...(checagemLimiteDesconto.excedeu && aprovacaoDesconto
              ? { aprovacao: { modo: 'senha' as const, ...aprovacaoDesconto, aprovadoEm: new Date().toISOString() } }
              : {}),
          },
          frete: 0,
          encargos: 0,
          valorTotal: fromCents(totals.totalCentavos),
          valorTotalCentavos: totals.totalCentavos,
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
          dataVenda: saleDate,
          status: 'Finalizada',
          origem: 'pdv',
          pdvSessionId: session.id,
          observacao: observation.trim(),
          tenantId,
          usuarioResponsavelId: currentUser.uid,
          vendedorId: currentUser.uid,
          vendedorNome: sellerName,
          comissao: commissionSnapshot,
          createdAt: serverTimestamp(),
          ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
        });

        bankCreditsByBanco.forEach((deltaCents, bancoId) => {
          transaction.update(doc(db, 'bancos', bancoId), {
            saldoCentavos: (bankBalancesById.get(bancoId) || 0) + deltaCents,
            updatedAt: serverTimestamp(),
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), `Crédito da venda PDV #${finalNumeroPedido}`),
          });
        });

        persistedPayments.forEach((payment) => {
          const parcelaLabel = payment.cartao?.numero
            ? ` (Parcela ${payment.cartao.numero}/${payment.cartao.totalParcelas})`
            : '';
          transaction.set(doc(db, 'transacoes', payment.transactionId), {
            descricao: `PDV #${finalNumeroPedido} - ${payment.formaPagamento}${parcelaLabel}`,
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
            data: payment.dataVencimento || saleDate,
            dataVencimento: payment.dataVencimento || null,
            dataPrevistaRecebimento: payment.dataPrevistaRecebimento || null,
            cartao: payment.cartao || null,
            pedidoId: newPedidoRef.id,
            sourceType: 'pedido_venda',
            sourceId: newPedidoRef.id,
            sourceOrigin: 'pdv',
            pdvSessionId: session.id,
            paymentIndex: payment.indice,
            idempotencyKey: `pdv:${newPedidoRef.id}:pagamento:${payment.indice}`,
            clienteId: selectedClient?.id || null,
            clienteNome,
            usuarioResponsavelId: currentUser.uid,
            vendedorId: currentUser.uid,
            tenantId,
            createdAt: serverTimestamp(),
            ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
          });
        });
      });

      const { createAuditLog } = await import('../../services/logService');
      createAuditLog({
        tenantId,
        usuarioId: currentUser.uid,
        usuarioEmail: currentUser.email || '',
        modulo: 'vendas',
        acao: 'criar_pdv',
        descricao: `Venda PDV #${finalNumeroPedido} finalizada no valor de ${toCurrencyInput(totals.totalCentavos)}.`,
        status: 'sucesso',
      });

      // Cashback (20/10/2026): pelo servidor ele ja' gera; gravada pela tela, a
      // venda avisa o servidor, que confere se esta' paga e gera (idempotente).
      if (!vendaPeloServidor && newPedidoId) void gerarCashbackSemFalhar(newPedidoId);

      showSuccess(`Venda PDV #${finalNumeroPedido} finalizada`);
      espelharBaixaNaTela();
      resetSale();
      setPaymentModalOpen(false);
      if (newPedidoId) {
        console.info('Venda PDV criada:', newPedidoId);
      }
    } catch (error) {
      console.error('Erro ao finalizar PDV:', error);
      // Liberacao que o servidor nao aceitou (vencida, usada, de outro valor): o proximo Finalizar pede de novo.
      if (error instanceof VendaServidorError && error.status === STATUS_PEDIR_DE_NOVO) setAprovacaoDesconto(null);
      // Ver describeTransactionError: disputa entre operadores e queda de
      // conexao ganham recado proprio, em vez do texto cru do Firestore.
      showError(
        'Erro ao finalizar venda',
        describeTransactionError(error) || (error instanceof Error ? error.message : 'Tente novamente.')
      );
    } finally {
      setSaving(false);
      saleLockRef.current = false;
    }
  };

  useEffect(() => {
    const handleShortcuts = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (paymentModalOpen || discountModalOpen || clientModalOpen) {
          setPaymentModalOpen(false);
          setDiscountModalOpen(false);
          setClientModalOpen(false);
        }
        return;
      }

      if (!hasPdvAccess) return;
      if (event.key === 'F2') { event.preventDefault(); setClientModalOpen(true); }
      if (event.key === 'F3') { event.preventDefault(); productInputRef.current?.focus(); }
      if (event.key === 'F4') { event.preventDefault(); if (cartItems.length > 0) setDiscountModalOpen(true); }
      if (event.key === 'F5') { event.preventDefault(); void askSelectedItemQuantity(); }
      if (event.key === 'F6' || event.key === 'F7') {
        event.preventDefault();
        if (cartItems.length > 0 && session) setPaymentModalOpen(true);
      }
    };

    window.addEventListener('keydown', handleShortcuts);
    return () => window.removeEventListener('keydown', handleShortcuts);
  }, [askSelectedItemQuantity, cartItems.length, clientModalOpen, discountModalOpen, hasPdvAccess, paymentModalOpen, session]);

  if (needsTenantSelection) {
    return (
      <div className="pdv-access-state">
        <LockKeyhole size={42} />
        <h1>Selecione uma empresa ativa</h1>
        <p>O PDV precisa de uma base de empresa antes de abrir o caixa.</p>
      </div>
    );
  }

  if (isPdvModuleBlocked) {
    return (
      <div className="pdv-access-state">
        <LockKeyhole size={42} />
        <h1>Módulo não disponível</h1>
        <p>O módulo de Pedidos de Venda está desativado para a sua conta. Entre em contato com o administrador do sistema para atualizar o plano.</p>
      </div>
    );
  }

  if (!hasPdvAccess) {
    return (
      <div className="pdv-access-state">
        <LockKeyhole size={42} />
        <h1>Acesso não permitido</h1>
        <p>Seu usuário precisa da permissão de pedidos de venda para usar o PDV.</p>
      </div>
    );
  }

  return (
    <div className="pdv-shell">
      <header className="pdv-topbar">
        <div className="pdv-brand">
          <img src={hennderIcon} alt="Hennder ERP" className="pdv-logo" />
          <span>
            <small>{selectedTenant?.nomeOficina || 'Hennder Company'}</small>
            <strong>Frente de Caixa</strong>
          </span>
        </div>
        <div className="pdv-window-actions">
          <div className={session ? 'pdv-status' : 'pdv-status pdv-status--fechado'}>
            {loading ? <Loader2 className="spin-animation" size={16} /> : <Store size={16} aria-hidden="true" />}
            <span>{session
              ? `Caixa aberto · ${session.operadorId === currentUser?.uid ? operatorName : session.operadorNome}${horaDeAbertura(session.abertoEm) ? ` · desde ${horaDeAbertura(session.abertoEm)}` : ''}`
              : 'Caixa fechado'}</span>
          </div>
          {session ? (
            <>
              <button type="button" className="pdv-topbar-button" onClick={() => setSangriaModalOpen(true)} title="Registrar sangria">
                <Banknote size={16} aria-hidden="true" /> Sangria
              </button>
              <button type="button" className="pdv-topbar-button" onClick={() => void closeSession()} title="Contar o dinheiro e fechar o caixa">
                Fechar caixa
              </button>
            </>
          ) : (
            <button type="button" className="pdv-topbar-button pdv-topbar-button--primary" onClick={openSession} disabled={loading}>
              Abrir caixa
            </button>
          )}
          <button type="button" className="pdv-topbar-icon" title="Tela cheia" aria-label="Tela cheia" onClick={() => document.documentElement.requestFullscreen?.()}>
            <Maximize2 size={18} />
          </button>
          <button type="button" className="pdv-topbar-icon" title="Sair da Frente de Caixa" aria-label="Sair da Frente de Caixa" onClick={() => void sairDoCaixa()}>
            <X size={20} />
          </button>
        </div>
      </header>

      {loading ? (
        <div className="pdv-loading">
          <Loader2 className="spin-animation" size={34} />
          <span>Carregando PDV...</span>
        </div>
      ) : (
        <main className="pdv-main">
          <div className="pdv-left">
            <ProductSearch
              value={search}
              products={products}
              selectedProduct={selectedProduct}
              itemSelecionado={selectedItem ? { item: selectedItem, produto: products.find((p) => p.id === selectedItem.productId) || null } : null}
              inputRef={productInputRef}
              mode={productSearchMode}
              disabled={!session}
              onChange={(texto) => { setSearch(texto); if (!texto.trim()) setSelectedProduct(null); }}
              onSelect={(product) => addProductToCart(product, 1, resolveScannedUnit(product))}
              onDestacado={setSelectedProduct}
            />

            <CartPanel
              items={cartItems}
              selectedItemId={selectedItemId}
              onSelectItem={setSelectedItemId}
              onQuantityChange={updateItemQuantity}
              onDiscountChange={updateItemDiscount}
              onRemoveItem={removeItem}
              unitOptionsByItemId={unitOptionsByItemId}
              onUnitChange={venderPorEmbalagem ? changeItemUnit : undefined}
            />

            {!session && (
              <div className="pdv-closed-overlay">
                <PackageSearch size={30} />
                <strong>Abra o caixa para iniciar as vendas</strong>
                <button type="button" className="btn-primary" onClick={openSession}>Abrir caixa</button>
              </div>
            )}
          </div>

          <PdvSummary
            totals={totals}
            client={selectedClient}
            session={session}
            disabled={cartItems.length === 0}
            discountWarning={checagemLimiteDesconto.excedeu ? `Desconto de ${checagemLimiteDesconto.percentualAplicado.toFixed(1)}% acima do limite configurado.` : undefined}
            cashbackTexto={cashbackDoCliente ? formatarCashback(cashbackDoCliente.modelo, cashbackDoCliente.saldoCentavos, cashbackDoCliente.saldoPontos) : null}
            onOpenClient={() => setClientModalOpen(true)}
            onOpenDiscount={() => setDiscountModalOpen(true)}
            onOpenPayment={() => setPaymentModalOpen(true)}
            onClearSale={clearSale}
          />
        </main>
      )}

      <ClientModal
        open={clientModalOpen}
        clients={clients}
        selectedClient={selectedClient}
        onClose={() => setClientModalOpen(false)}
        onSelect={setSelectedClient}
      />

      <SangriaModal
        open={sangriaModalOpen}
        onClose={() => setSangriaModalOpen(false)}
        onConfirm={registrarSangria}
      />

      <SolicitarAprovacaoDescontoModal
        open={showAprovacaoDesconto}
        tenantId={tenantId}
        motivo={`Desconto de ${checagemLimiteDesconto.percentualAplicado.toFixed(1)}% neste cupom, acima do limite configurado. Confirme com a senha de um aprovador para finalizar.`}
        onClose={() => setShowAprovacaoDesconto(false)}
        onAprovado={(aprovacao) => setAprovacaoDesconto(aprovacao)}
        liberacaoNoServidor={vendaPeloServidor
          ? { tela: 'pdv', baseCentavos: totals.subtotalCentavos, descontoCentavos: totals.descontoTotalCentavos }
          : null}
      />

      <DiscountModal
        open={discountModalOpen}
        subtotalCents={totals.subtotalCentavos}
        itemDiscountCents={totals.itensDescontoCentavos}
        saleDiscountCents={saleDiscountCents}
        onClose={() => setDiscountModalOpen(false)}
        onApply={setSaleDiscountCents}
      />

      <PaymentModal
        open={paymentModalOpen}
        totalCents={totals.totalCentavos}
        financeConfig={financeConfig}
        tenantId={tenantId}
        saving={saving}
        cashbackDisponivel={cashbackDoCliente}
        onClose={() => setPaymentModalOpen(false)}
        onFinalize={finalizeSale}
      />
    </div>
  );
};

export default PDV;
