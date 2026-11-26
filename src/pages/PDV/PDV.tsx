import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Banknote, ClipboardList, FileText, History, Loader2, LockKeyhole, Maximize2, MonitorDown, PackageSearch, Store, X } from 'lucide-react';
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
import { CAMINHO_INSTALACAO_CAIXA, CAMINHO_LOGIN_CAIXA, MODULO_DO_CAIXA, ehAppDoCaixa, nomeDoOperador, podeUsarFrenteDeCaixa } from '../../utils/frenteDeCaixaDomain';
import { chaveDoUltimoFechamento, lerUltimoFechamento, type TerminalDoCaixa } from '../../utils/terminalCaixaDomain';
import { lerTerminalGuardado } from '../../utils/terminalCaixaStorage';
import { estaInstalado } from '../../utils/pwaInstalado';
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
import { resumoDaGaveta, sangriaParaDeposito, type ResumoDaGaveta } from '../../services/caixasService';
import {
  calcularEsperadoDoFechamento,
  ErroDoFechamento,
  escolherDataDoFechamento,
  gravarFechamentoDoCaixa,
  mandarAoCofreDepoisDeFechar,
  mensagemDoErroDeFechamento,
  mensagemDoFechamento,
  pedirValorContado,
  type EsperadoDoFechamento,
} from '../../services/fechamentoCaixaPdvService';
import { aberturaConfereComAGaveta, avisoDaAbertura, lerConfigGaveta } from '../../utils/gavetaDinheiroDomain';
import { finalizarVendaNoServidor, VendaServidorError } from '../../services/vendaServidorService';
import { mensagemDaTravaDoBalanco } from '../../services/travaBalancoService';
import { STATUS_PEDIR_DE_NOVO } from '../../utils/conferenciaDescontoDomain';
import { erroDaFormaDoVendedor, erroDoAPrazoNoCaixa, parseAPrazoNaFrenteDeCaixa, parseVendaPeloServidor, PERMISSAO_TROCAR_FORMA_DO_VENDEDOR } from '../../utils/vendaFechamentoDomain';
import { hasTenantFullAccess } from '../../utils/roles';
import { parseConfigBancoPadrao, type ConfigBancoPadrao } from '../../utils/formasPagamentoDomain';
import {
  CAMPO_CREDITO_VERSAO,
  MENSAGEM_CREDITO_CONCORRENTE,
  creditoFoiAlteradoDurante,
  excedeLimiteCredito,
  parseCreditoVersao,
  parseTrabalhaComLimiteCredito,
} from '../../utils/creditoDomain';
import { situacaoEmAbertoDoCliente } from '../../utils/contasReceberQuery';
import { PARAMETROS_VENDA_PADRAO, bloqueioPorAtraso, parseParametrosVenda, type ParametrosVenda } from '../../utils/parametrosVendaDomain';
import { DEFAULT_PRODUCT_SEARCH_MODE, findEmbalagemIdByExactCode, type ProductSearchMode } from '../../utils/productSearch';
import { isValidSaleQuantity } from '../../utils/saleQuantity';
import { mensagemQuantidadeInteira } from '../../utils/vendaFracionadaDomain';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { useTenantCollection } from '../../hooks/useTenantCollection';
import CartPanel from './components/CartPanel';
import ClientModal from './components/ClientModal';
import DiscountModal from './components/DiscountModal';
import PaymentModal from './components/PaymentModal';
import PdvSummary from './components/PdvSummary';
import ProductSearch from './components/ProductSearch';
import SangriaModal from './components/SangriaModal';
import PreVendasModal from './components/PreVendasModal';
import VersaoDoSistema from '../../components/common/VersaoDoSistema';
import { mostrarAlertaDoCliente } from '../../components/common/AlertaDoCliente';
import { useTravaDeEdicao } from '../../hooks/useTravaDeEdicao';
import { avisoFaturarSemConferencia, conferenciaPendenteParaFaturar } from '../../utils/conferenciaDomain';
import { MENSAGEM_VENDA_DE_OUTRO_USUARIO, TITULO_VENDA_DE_OUTRO_USUARIO, isVendaDoUsuario } from '../../utils/visibilidadeVendasDomain';
import { formatDateInputPtBr } from '../../utils/dateTime';
import { MENSAGEM_SEM_PERMISSAO_NFCE, acaoDeReimpressao, documentoDoCupomDoCaixa, podeEmitirCupomFiscal, type VendaDoCaixa } from '../../utils/cupomDoCaixaDomain';
import { emitirCupomFiscalDoCaixa, imprimirCupomNaoFiscal, reabrirCupomFiscal } from './cupomDoCaixa';
import VendasDoCaixaModal from './components/VendasDoCaixaModal';
import RelatorioDoCaixaModal from './components/RelatorioDoCaixaModal';
import { empresaDoRelatorio, imprimirRelatorioDoCaixa, lerLancamentosDoCaixa, sangriasDoCaixa } from './relatorioDoCaixa';
import type { DadosDoRelatorioDoCaixa } from '../../utils/relatorioDoCaixaBobinaDomain';
import { avisarSemPermissao } from '../../hooks/usePodePermissao';
import { PERMISSAO_VENDAS } from '../../utils/permissoesNovasDomain';
import {
  ONDE_FATURAR_NO_SISTEMA,
  carregarPreVendaNoCaixa,
  corpoDoFaturamentoNoCaixa,
  descontoDaPreVendaParaOLimite,
  linhasDoCupomDaPreVenda,
  podeFaturarPreVendaNoCaixa,
  reprecificarPreVenda,
  totaisDaPreVenda,
  type ItemDaPreVenda,
  type PreVendaCarregada,
  type PreVendaDoCaixa,
} from '../../utils/preVendaNoCaixaDomain';
import {
  sessaoDoDocumento,
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
import { FORMAS_A_VISTA_PADRAO, ROTULO_CONDICAO, condicaoDoPagamento, parseFormasAVista, precoAutomatico } from '../../utils/precoVendaDomain';
import { FORMA_PAGAMENTO_CASHBACK, cashbackDisponivelParaVenda, formatarCashback, lerResumoCashback, type CashbackDisponivel } from '../../utils/cashbackDomain';
import {
  DEFAULT_VENDER_POR_EMBALAGEM,
  buildOpcoesUnidadeVenda,
  findOpcaoUnidadeVenda,
  opcaoInicialDaTela,
  vendeSoNaEmbalagem,
  toBaseQuantity,
  toStockAdjustmentItems,
  type OpcaoUnidadeVenda,
  linhaNaUnidadeDoEstoque,
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
import { obterCatalogo, obterCatalogoEstoque } from '../../services/catalogoEstoqueService';

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
  const location = useLocation();
  /** Computador ativado como caixa (22/11/2026): cada funcionario entra com codigo e senha. So' no app do caixa. */
  const [terminalDoCaixa, setTerminalDoCaixa] = useState<TerminalDoCaixa | null>(null);
  const noAppDoCaixa = ehAppDoCaixa(location.pathname);
  useEffect(() => {
    if (!noAppDoCaixa) return;
    let ativo = true;
    void lerTerminalGuardado().then((terminal) => { if (ativo) setTerminalDoCaixa(terminal); });
    return () => { ativo = false; };
  }, [noAppDoCaixa]);
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
    trabalhaComPreVenda,
    vendasVisiveisDeUsuarioId,
    conferenciaMercadoriaAtiva,
    controlaFiscal,
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
  // "Nota" na Frente de Caixa (25/11/2026): caixa de marcar da filial.
  const [aPrazoNoCaixa, setAPrazoNoCaixa] = useState(false);
  // Banco padrao por forma (25/11/2026): Pix e cartao ja' vem com o banco da filial.
  const [configBancoPadrao, setConfigBancoPadrao] = useState<ConfigBancoPadrao>(() => parseConfigBancoPadrao(null));
  const [regrasDoAPrazo, setRegrasDoAPrazo] = useState<{ trabalhaComLimite: boolean; parametros: ParametrosVenda; noGrupo: boolean }>({
    trabalhaComLimite: false, parametros: PARAMETROS_VENDA_PADRAO, noGrupo: false,
  });
  // Id da venda gerado na tela: reenviar o mesmo cupom nao duplica no servidor.
  const idVendaServidorRef = useRef('');
  const [venderPorEmbalagem, setVenderPorEmbalagem] = useState(DEFAULT_VENDER_POR_EMBALAGEM);
  const [limiteDescontoPdv, setLimiteDescontoPdv] = useState<LimiteDescontoConfig | null>(null);
  // Cadastro da empresa (cabecalho do cupom) e quais documentos fiscais ela emite (cupomDoCaixaDomain).
  const [configDaEmpresa, setConfigDaEmpresa] = useState<Record<string, unknown> | null>(null);
  // Limite do Pedido de Venda: e' o que vale para a pre-venda faturada aqui (o desconto foi dado la').
  const [limiteDescontoPedido, setLimiteDescontoPedido] = useState<LimiteDescontoConfig | null>(null);
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
  // PRE-VENDA NO CAIXA (23/11/2026, preVendaNoCaixaDomain.ts): quem pode
  // transformar pre-venda em venda puxa uma pre-venda em aberto para o cupom,
  // recebe e fatura sobre ela, pelo servidor. Itens, cliente, descontos e
  // VENDEDOR sao os da pre-venda: no caixa so' entra o pagamento.
  const [preVenda, setPreVenda] = useState<PreVendaCarregada | null>(null);
  const [preVendasModalOpen, setPreVendasModalOpen] = useState(false);
  const [puxandoPreVenda, setPuxandoPreVenda] = useState(false);
  // Base e desconto (com o que o preco esta' abaixo do sistema) da liberacao pedida para a pre-venda.
  const [liberacaoDaPreVenda, setLiberacaoDaPreVenda] = useState<{ baseCentavos: number; descontoCentavos: number; percentual: number } | null>(null);
  const podePreVendaNoCaixa = podeFaturarPreVendaNoCaixa({ trabalhaComPreVenda, role: userRole, isOwner, permissoes: userPermissions });
  // Trava de edicao (um documento aberto por vez): a pre-venda no caixa fica com este operador.
  const travaDaPreVenda = useTravaDeEdicao({ tipo: 'pedido_venda', registroId: preVenda?.id, ativa: Boolean(preVenda) });
  const { tabelaDe, quantidadeLiberada, promocoes, hoje: hojeDasPromocoes, vendidoPorPromocao } = usePromocoesVigentes(tenantId, preVenda?.id);
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
    const vendaEmAndamento = preVenda
      ? ` A pré-venda #${preVenda.numeroPedido} que está no caixa continua em aberto, sem alteração.`
      : cartItemsRef.current.length > 0
        ? ' A venda em andamento, que ainda não foi finalizada, é perdida.'
        : '';
    // Troca de usuario rapida (22/11/2026): no computador ativado, quem sai
    // volta para o codigo e a senha do proximo funcionario.
    const proximo = terminalDoCaixa
      ? 'O próximo funcionário entra com o código e a senha dele.'
      : 'Abre a tela de login para outra pessoa entrar.';
    if (!session) {
      const resposta = await NexusSwal.fire({
        title: 'Trocar de usuário ou sair?',
        text: `O caixa está fechado. ${proximo}${vendaEmAndamento}`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Trocar usuário',
        cancelButtonText: 'Voltar',
      });
      if (!resposta.isConfirmed) return;
    } else {
      const resposta = await NexusSwal.fire({
        title: 'O caixa está aberto',
        text: `Feche o seu caixa agora (contagem do dinheiro e fechamento) ou troque de usuário deixando o caixa aberto, para voltar a ele depois. ${proximo}${vendaEmAndamento}`,
        icon: 'question',
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: 'Fechar caixa e trocar usuário',
        denyButtonText: 'Trocar usuário, caixa aberto',
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
    // Pre-venda: a conta do servidor (desconto geral e frete da pre-venda), nao a do cupom.
    () => (preVenda ? totaisDaPreVenda(preVenda) : calculatePdvTotals(cartItems, saleDiscountCents)),
    [cartItems, saleDiscountCents, preVenda],
  );

  // Nivel 2 (sistema): desconto TOTAL do cupom (itens + desconto geral)
  // contra o limite configurado pro PDV.
  const checagemLimiteDesconto = useMemo(
    // Ate o percentual do cadastro do cliente o desconto passa direto --
    // e' autorizacao ja dada pelo dono. Acima disso vale o limite do PDV.
    () => checarLimiteComCliente(
      preVenda ? limiteDescontoPedido : limiteDescontoPdv,
      totals.subtotalCentavos,
      totals.descontoTotalCentavos,
      descontoPadraoDoCliente(selectedClient),
    ),
    [preVenda, limiteDescontoPedido, limiteDescontoPdv, totals.subtotalCentavos, totals.descontoTotalCentavos, selectedClient],
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
          obterCatalogoEstoque(tenantId),
          obterCatalogo('clientes', tenantId),
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
              venderSoNaEmbalagem: data.venderSoNaEmbalagem === true,
              descontoMaximoPercentual: data.descontoMaximoPercentual,
              ...(data.atacado ? { atacado: data.atacado } : {}),
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
        setAPrazoNoCaixa(parseAPrazoNaFrenteDeCaixa(configData?.aPrazoNaFrenteDeCaixa));
        setConfigBancoPadrao(parseConfigBancoPadrao(configData));
        setRegrasDoAPrazo({
          trabalhaComLimite: parseTrabalhaComLimiteCredito(configData?.trabalhaComLimiteCredito),
          parametros: parseParametrosVenda(configData?.parametrosVenda),
          noGrupo: Boolean(configData?.grupoId),
        });
        setFormasPrecoAVista(parseFormasAVista(configData?.formasPrecoAVista));
        setVenderPorEmbalagem(configData?.venderPorEmbalagem ?? DEFAULT_VENDER_POR_EMBALAGEM);
        setLimiteDescontoPdv(parseLimiteDescontoConfig(configData?.limiteDescontoPdv));
        setLimiteDescontoPedido(parseLimiteDescontoConfig(configData?.limiteDescontoPedido));
        setModoLimiteDesconto(parseModoLimiteDesconto(configData?.modoLimiteDesconto));
        setProductSearchMode(configData?.buscaProdutoModo === 'exata' ? 'exata' : DEFAULT_PRODUCT_SEARCH_MODE);
        setFinanceConfig(buildPdvFinanceConfig(configData));
        setConfigDaEmpresa(configData);
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
    // Pre-venda que estava no caixa: so' sai da tela (continua em aberto; a trava e' solta sozinha).
    setPreVenda(null);
    setLiberacaoDaPreVenda(null);
    setPreVendasModalOpen(false);
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

    // Um caixa aberto por pessoa (22/11/2026): quem ja' tem um (em outro
    // computador, ou que ficou aberto) continua nele -- dois caixas abertos da
    // mesma pessoa dividiriam as vendas e o fechamento nao bateria.
    try {
      const jaAberto = await getDocs(query(
        collection(db, 'caixas_pdv'),
        where('tenantId', '==', tenantId),
        where('operadorId', '==', currentUser.uid),
        where('status', '==', 'aberto'),
        limit(1),
      ));
      if (!jaAberto.empty) {
        const documento = jaAberto.docs[0];
        const sessaoAberta = sessaoDoDocumento(documento.id, documento.data());
        const onde = typeof documento.data().terminalNome === 'string' && documento.data().terminalNome
          ? ` no computador "${documento.data().terminalNome}"`
          : '';
        const desde = horaDeAbertura(sessaoAberta.abertoEm);
        const resposta = await NexusSwal.fire({
          title: 'Você já tem um caixa aberto',
          text: `Ele foi aberto${onde}${desde ? ` às ${desde}` : ''} e ainda não foi fechado. Continue nele: as vendas e o fechamento ficam juntos.`,
          icon: 'info',
          showCancelButton: true,
          confirmButtonText: 'Continuar nesse caixa',
          cancelButtonText: 'Voltar',
        });
        if (!resposta.isConfirmed) return;
        setSession(sessaoAberta);
        localStorage.setItem(sessionStorageKey, JSON.stringify(sessaoAberta));
        showSuccess('Caixa retomado');
        return;
      }
    } catch (error) {
      console.error('Erro ao conferir se já existe caixa aberto:', error);
    }

    let saldoAnteriorSugeridoCentavos: number | null = null;
    // Computador ativado: o dinheiro que ficou na gaveta DESTE computador no
    // ultimo fechamento (de qualquer operador) e' o que o proximo encontra.
    let ultimoFechamentoDaGaveta: { saldoCentavos: number; operadorNome: string } | null = null;
    if (terminalDoCaixa) {
      try { ultimoFechamentoDaGaveta = lerUltimoFechamento(localStorage.getItem(chaveDoUltimoFechamento(terminalDoCaixa.terminalId))); } catch { /* sem armazenamento local */ }
    }
    if (ultimoFechamentoDaGaveta) saldoAnteriorSugeridoCentavos = ultimoFechamentoDaGaveta.saldoCentavos;
    // Dinheiro das vendas na gaveta ligado e nenhum outro caixa aberto (24/11/2026): a abertura
    // confere contra o saldo da gaveta; a diferenca entra no extrato do CAIXA em nome do operador.
    let gavetaNaAbertura: (ResumoDaGaveta & { saldoCentavos: number }) | null = null;
    try {
      const configSnap = await getDoc(doc(db, 'configuracoes', tenantId));
      if (lerConfigGaveta(configSnap.exists() ? configSnap.data() : null).ativo) {
        const resumo = await resumoDaGaveta();
        if (aberturaConfereComAGaveta(resumo) && resumo.saldoCentavos !== null) gavetaNaAbertura = { ...resumo, saldoCentavos: resumo.saldoCentavos };
      }
    } catch (error) {
      // Sem o saldo da gaveta a abertura segue como sempre (sugestao do ultimo fechamento).
      console.error('Erro ao consultar o saldo da gaveta na abertura do caixa:', error);
    }
    if (gavetaNaAbertura) saldoAnteriorSugeridoCentavos = Math.max(0, gavetaNaAbertura.saldoCentavos);
    if (!ultimoFechamentoDaGaveta && !gavetaNaAbertura) try {
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
      text: gavetaNaAbertura
        ? `Pelo sistema, o ${gavetaNaAbertura.caixaNome || 'CAIXA'} tem ${currency.format(fromCents(gavetaNaAbertura.saldoCentavos))} na gaveta. Conte o dinheiro e informe quanto há de fato.`
        : ultimoFechamentoDaGaveta
        ? `Ficou na gaveta deste computador no último fechamento${ultimoFechamentoDaGaveta.operadorNome ? ` (${ultimoFechamentoDaGaveta.operadorNome})` : ''}: ${currency.format(fromCents(ultimoFechamentoDaGaveta.saldoCentavos))}. Confirme ou ajuste o saldo inicial em dinheiro.`
        : saldoAnteriorSugeridoCentavos !== null
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
    const avisoDaGaveta = gavetaNaAbertura ? avisoDaAbertura(gavetaNaAbertura.saldoCentavos, saldoInicialCentavos) : '';
    if (avisoDaGaveta) {
      const confirmacao = await NexusSwal.fire({
        title: 'O dinheiro não bate com o sistema',
        text: avisoDaGaveta,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Abrir caixa assim',
        cancelButtonText: 'Contar de novo',
      });
      if (!confirmacao.isConfirmed) return;
    }

    try {
      const novaSessaoRef = await addDoc(collection(db, 'caixas_pdv'), {
        tenantId,
        operadorId: currentUser.uid,
        operadorNome: operatorName,
        status: 'aberto',
        saldoInicialCentavos,
        saldoAnteriorSugeridoCentavos,
        saldoAnteriorConfirmado,
        ...(gavetaNaAbertura ? {
          aberturaPelaGaveta: true,
          saldoDaGavetaNaAberturaCentavos: gavetaNaAbertura.saldoCentavos,
          diferencaAberturaCentavos: saldoInicialCentavos - gavetaNaAbertura.saldoCentavos,
        } : {}),
        // Computador onde o caixa foi aberto (relatorio e aviso de caixa ja' aberto).
        ...(terminalDoCaixa ? { terminalId: terminalDoCaixa.terminalId, terminalNome: terminalDoCaixa.nome } : {}),
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
        descricao: `Caixa aberto por ${operatorName} com saldo inicial de ${currency.format(fromCents(saldoInicialCentavos))}.`
          + `${gavetaNaAbertura && saldoInicialCentavos !== gavetaNaAbertura.saldoCentavos ? ` A gaveta tinha ${currency.format(fromCents(gavetaNaAbertura.saldoCentavos))} pelo sistema; a diferença foi para o extrato do CAIXA.` : ''}`,
        registroRelacionadoId: novaSessaoRef.id,
        status: 'sucesso',
      });
    } catch (error) {
      console.error('Erro ao abrir caixa:', error);
      showError('Erro ao abrir caixa', 'Não foi possível abrir o caixa. Tente novamente.');
    }
  }, [currentUser, operatorName, sessionStorageKey, tenantId, terminalDoCaixa]);

  // ------------------------------------------------------------------ Relatorio do caixa (26/11/2026)
  // Parcial (botao "Relatório" e F10, sem fechar o caixa) e o do fechamento, que
  // sai sozinho ao fechar. Na bobina do cupom. Regra em relatorioDoCaixaBobinaDomain.ts.
  // Dono sempre pode; o resto pelas permissoes efetivas (as do pacote 'pdv-1' vem com o PDV).
  const podeRelatorioDoCaixa = hasTenantFullAccess(userRole, isOwner) || userPermissions.includes(PERMISSAO_VENDAS.pdvRelatorioCaixa);
  const [relatorioModalOpen, setRelatorioModalOpen] = useState(false);

  /** O que passou pelo caixa agora: vendas e sangrias lidas do banco e, se pedido, o esperado do fechamento. */
  const dadosDoCaixa = useCallback(async (sessao: PdvSession, calcularEsperado = true): Promise<DadosDoRelatorioDoCaixa> => {
    if (!tenantId) throw new Error('Entre de novo no sistema para tirar o relatório do caixa.');
    const [lancamentos, caixaSnap] = await Promise.all([
      lerLancamentosDoCaixa(tenantId, sessao.id),
      getDoc(doc(db, 'caixas_pdv', sessao.id)).catch((erro) => {
        console.error('Relatório do caixa: não foi possível reler o caixa; vale o que está na tela.', erro);
        return null;
      }),
    ]);
    const gravado = caixaSnap?.exists() ? caixaSnap.data() : null;
    const sangriasBrutas: CaixaSangria[] = Array.isArray(gravado?.sangrias) ? gravado.sangrias : sessao.sangrias;
    const saldoInicialCentavos = Number(gravado?.saldoInicialCentavos ?? sessao.saldoInicialCentavos) || 0;
    const sangrias = sangriasDoCaixa(sangriasBrutas);
    let esperado: DadosDoRelatorioDoCaixa['esperado'] = null;
    if (calcularEsperado) {
      try {
        const conta = await calcularEsperadoDoFechamento(tenantId, {
          id: sessao.id,
          saldoInicialCentavos,
          totalSangriasCentavos: sangrias.reduce((soma, g) => soma + g.valorCentavos, 0),
          sangrias: sangriasBrutas,
        });
        esperado = { saldoEsperadoCentavos: conta.saldoEsperadoCentavos, modo: conta.modo, explicacao: conta.explicacao };
      } catch (erro) {
        // Sem o esperado, o papel sai com a conta do caixa (saldo inicial + dinheiro - sangrias).
        console.error('Relatório do caixa: não foi possível calcular o esperado.', erro);
      }
    }
    return {
      tipo: 'parcial',
      empresa: empresaDoRelatorio(configDaEmpresa),
      // Como no topo: o caixa e' deste usuario -> o nome do cadastro dele.
      operadorNome: sessao.operadorId === currentUser?.uid ? operatorName : (sessao.operadorNome || operatorName),
      impressoPorNome: operatorName,
      abertoEm: sessao.abertoEm ? new Date(sessao.abertoEm) : null,
      emitidoEm: new Date(),
      saldoInicialCentavos,
      lancamentos,
      sangrias,
      esperado,
      fechamento: null,
      listarVendas: false,
    };
  }, [configDaEmpresa, currentUser?.uid, operatorName, tenantId]);

  const carregarRelatorioParcial = useCallback(() => {
    if (!session) return Promise.reject(new Error('Abra o caixa para tirar o relatório.'));
    return dadosDoCaixa(session);
  }, [dadosDoCaixa, session]);

  const imprimirRelatorioParcial = useCallback(async (dados: DadosDoRelatorioDoCaixa) => {
    if (!session || !tenantId) return;
    try {
      await imprimirRelatorioDoCaixa({ ...dados, tenantId, sessaoId: session.id, lancamentos: [...dados.lancamentos] });
    } catch (erro) {
      console.error('Erro ao imprimir o relatório do caixa:', erro);
      showError('Relatório não impresso', `${erro instanceof Error && erro.message ? erro.message : 'Não foi possível imprimir.'} Confira a impressora e tente de novo.`);
    }
  }, [session, tenantId]);

  const abrirRelatorioDoCaixa = useCallback(() => {
    if (!session) return;
    if (!podeRelatorioDoCaixa) {
      avisarSemPermissao(PERMISSAO_VENDAS.pdvRelatorioCaixa, 'tirar o relatório parcial do caixa');
      return;
    }
    setRelatorioModalOpen(true);
  }, [podeRelatorioDoCaixa, session, setRelatorioModalOpen]);

  /** Papel do fechamento: sai sempre que o caixa fecha. Falhar aqui nao desfaz o fechamento. */
  const imprimirRelatorioDoFechamento = async (args: {
    sessao: PdvSession;
    esperado: EsperadoDoFechamento;
    contadoCentavos: number;
    diferencaCentavos: number;
    cofre: { ok: boolean; paraCofreCentavos: number | null; trocoCentavos: number | null } | null;
  }) => {
    if (!tenantId) return;
    try {
      const dados = await dadosDoCaixa(args.sessao, false);
      const dia = args.esperado.dataDoFechamento;
      await imprimirRelatorioDoCaixa({
        ...dados,
        tenantId,
        sessaoId: args.sessao.id,
        lancamentos: [...dados.lancamentos],
        tipo: 'fechamento',
        esperado: { saldoEsperadoCentavos: args.esperado.saldoEsperadoCentavos, modo: args.esperado.modo, explicacao: args.esperado.explicacao },
        fechamento: {
          fechadoEm: dia ? new Date(`${dia}T23:59:00`) : new Date(),
          contadoCentavos: args.contadoCentavos,
          diferencaCentavos: args.diferencaCentavos,
          trocoCentavos: args.cofre?.ok ? args.cofre.trocoCentavos : null,
          paraCofreCentavos: args.cofre?.ok ? args.cofre.paraCofreCentavos : null,
        },
        listarVendas: true,
      });
    } catch (erro) {
      console.error('Erro ao imprimir o relatório do fechamento:', erro);
      showWarning('O caixa foi fechado, mas o relatório do fechamento não saiu na impressora. Imprima de novo em Financeiro › Caixa (Sessões PDV), no botão de impressora da sessão fechada.');
    }
  };

  /** Devolve true quando o caixa foi fechado (o X do topo so' sai depois disso). */
  const closeSession = async (): Promise<boolean> => {
    if (!session || !currentUser || !tenantId) return false;

    if (cartItems.length > 0) {
      const confirmation = await NexusSwal.fire({
        title: 'Fechar caixa?',
        text: preVenda
          ? `A pré-venda #${preVenda.numeroPedido} está no caixa e ainda não foi faturada. Ela sai da tela e continua em aberto.`
          : 'Existe uma venda em andamento. Ela será limpa antes do fechamento.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Fechar caixa',
        cancelButtonText: 'Voltar',
      });
      if (!confirmation.isConfirmed) return false;
    }

    // Conta e gravacao em services/fechamentoCaixaPdvService (23/11/2026): a mesma
    // do fechamento pela tela Caixa (Sessoes PDV). Com "dinheiro das vendas na
    // gaveta" ligado, o esperado e' o saldo da gaveta.
    // Caixa esquecido aberto de um dia para o outro (24/11/2026): escolhe com que data fecha.
    const dataDoFechamento = await escolherDataDoFechamento(new Date(session.abertoEm));
    if (dataDoFechamento === null) return false;

    let esperado: EsperadoDoFechamento;
    try {
      esperado = await calcularEsperadoDoFechamento(tenantId, session, dataDoFechamento);
    } catch (error) {
      console.error('Erro ao calcular saldo esperado do caixa:', error);
      showError('Não foi possível calcular o saldo esperado', mensagemDoErroDeFechamento(error));
      return false;
    }

    const contagem = await pedirValorContado(esperado, 'Fechar caixa', '', session.saldoInicialCentavos);
    if (contagem === null) return false;
    const saldoFinalInformadoCentavos = contagem.contadoCentavos;

    const limparCaixaDaTela = () => {
      resetSale();
      setSession(null);
      localStorage.removeItem(sessionStorageKey);
    };

    try {
      const diferencaCentavos = await gravarFechamentoDoCaixa({
        tenantId,
        sessaoId: session.id,
        usuarioId: currentUser.uid,
        usuarioEmail: currentUser.email || '',
        fechadoPorNome: operatorName,
        esperado,
        saldoInformadoCentavos: saldoFinalInformadoCentavos,
      });

      limparCaixaDaTela();
      // Gaveta ligada: o contado menos o troco vai para o COFRE (24/11/2026).
      const cofre = contagem.trocoCentavos !== null ? await mandarAoCofreDepoisDeFechar(session.id, contagem.trocoCentavos) : null;
      if (terminalDoCaixa) {
        try {
          // Na gaveta fica o troco (gaveta ligada) ou o que foi contado.
          const ficouNaGaveta = cofre?.ok && contagem.trocoCentavos !== null ? contagem.trocoCentavos : saldoFinalInformadoCentavos;
          localStorage.setItem(chaveDoUltimoFechamento(terminalDoCaixa.terminalId), JSON.stringify({ saldoCentavos: ficouNaGaveta, operadorNome: operatorName }));
        } catch { /* sem armazenamento local: so' perde a sugestao */ }
      }
      if (cofre && !cofre.ok) showWarning(`${mensagemDoFechamento(diferencaCentavos, esperado.modo)} ${cofre.texto}`);
      else showSuccess(mensagemDoFechamento(diferencaCentavos, esperado.modo, cofre?.texto || ''));
      // Relatorio do fechamento para entregar ao administrador (26/11/2026).
      await imprimirRelatorioDoFechamento({ sessao: session, esperado, contadoCentavos: saldoFinalInformadoCentavos, diferencaCentavos, cofre });
      return true;
    } catch (error) {
      if (error instanceof ErroDoFechamento) {
        // Fechado por outra tela (dono/administrador em Caixa (Sessoes PDV)): este computador so' sai do caixa.
        limparCaixaDaTela();
        showWarning('Este caixa já tinha sido fechado pela tela Caixa (Sessões PDV). Abra um caixa novo para continuar vendendo.');
        return true;
      }
      console.error('Erro ao fechar caixa:', error);
      showError('Erro ao fechar caixa', 'Não foi possível fechar o caixa. Tente novamente.');
      return false;
    }
  };

  /**
   * Troca de turno (22/11/2026, decisao do dono: "fecha e o proximo abre"): no
   * computador ativado, quem fecha o caixa sai, e a tela volta para o codigo
   * e a senha do proximo funcionario.
   */
  const fecharCaixaDoBotao = async () => {
    const fechou = await closeSession();
    if (!fechou || !terminalDoCaixa) return;
    await logout();
    navigate(CAMINHO_LOGIN_CAIXA, { replace: true });
  };

  const [sangriaModalOpen, setSangriaModalOpen] = useState(false);

  const registrarSangria = useCallback(async (valorCentavos: number, motivo: string, bancoId?: string) => {
    if (!session || !currentUser || !tenantId) return;

    // Sangria "para deposito" (21/10/2026, decisao do dono): o banco escolhido
    // e' creditado na hora pelo servidor; so' depois a sangria e' registrada.
    let bancoNome = '';
    if (bancoId) {
      try {
        bancoNome = (await sangriaParaDeposito({ bancoId, valorCentavos, sessaoId: session.id, data: getDateInputInTimeZone() })).bancoNome;
      } catch (erro) {
        showError('Não foi possível lançar o depósito', erro instanceof Error ? erro.message : 'Tente de novo.');
        return;
      }
    }

    const novaSangria: CaixaSangria = {
      id: crypto.randomUUID(),
      valorCentavos,
      motivo,
      registradoEm: new Date().toISOString(),
      registradoPor: currentUser.uid,
      registradoPorNome: operatorName,
      ...(bancoId ? { bancoId, bancoNome } : {}),
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
      showSuccess(bancoNome ? `Sangria registrada e depósito lançado no banco ${bancoNome}.` : 'Sangria registrada');

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
        : mensagemQuantidadeInteira(product.nome, sigla));
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
    // A quantidade da linha decide a faixa de atacado (precoVendaDomain).
    return camposDePrecoDoItem(tabela, CONDICAO_PDV, undefined, quantidadeTotal);
  }, [tabelaDe, quantidadeLiberada]);

  const addProductToCart = useCallback((product: PdvProduct, quantity = 1, opcao?: OpcaoUnidadeVenda) => {
    if (!session) {
      void openSession();
      return;
    }
    if (preVenda) {
      showWarning('Pré-venda no caixa', `Os itens são os da pré-venda #${preVenda.numeroPedido}. Para incluir ou tirar item, edite a pré-venda em ${ONDE_FATURAR_NO_SISTEMA}; para fazer outra venda, solte a pré-venda.`);
      return;
    }

    // Sem unidade bipada: a do cadastro, ou a primeira embalagem do produto que so' vende embalado (24/11/2026).
    const opcaoFinal = opcao || opcaoInicialDaTela(product, venderPorEmbalagem);
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
  }, [openSession, session, validateQuantity, precificarLinha, preVenda, venderPorEmbalagem]);

  const updateItemQuantity = useCallback((itemId: string, quantity: number) => {
    // Quantidade nova pode entrar (ou sair) da faixa de atacado e da quota da
    // promocao: o preco automatico acompanha. Preco digitado nao muda.
    // Calculado fora do updater (StrictMode roda o updater duas vezes).
    const itemAtual = cartItemsRef.current.find((entry) => entry.id === itemId);
    const produtoAtual = itemAtual ? products.find((entry) => entry.id === itemAtual.productId) : undefined;
    const precificacao = itemAtual && produtoAtual && quantity > 0 && itemAtual.tabelaPreco && itemAtual.origemPreco !== 'manual'
      ? precificarLinha(produtoAtual, findOpcaoUnidadeVenda(buildOpcoesUnidadeVenda(produtoAtual), itemAtual.embalagemId), quantity, itemAtual.id)
      : null;
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
        ...(precificacao
          ? { precoUnitarioCentavos: toCents(precificacao.preco), promocaoId: undefined, promocaoNome: undefined, ...precificacao.campos }
          : {}),
      }];
    }));
  }, [products, validateQuantity, precificarLinha]);

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

  /** Linhas em que o seletor nao oferece a unidade solta: produto que so' vende
   * na embalagem (24/11/2026). Linha que ja' esta' na unidade solta (pre-venda
   * antiga) continua podendo ficar nela. */
  const semUnidadeSoltaByItemId = useMemo(() => {
    if (!venderPorEmbalagem) return {};
    return cartItems.reduce<Record<string, boolean>>((mapa, item) => {
      const product = products.find((entry) => entry.id === item.productId);
      if (product && item.embalagemId && vendeSoNaEmbalagem(product)) mapa[item.id] = true;
      return mapa;
    }, {});
  }, [cartItems, products, venderPorEmbalagem]);

  /** Troca a unidade de uma linha ja lancada. Se ja existir outra linha na
   * unidade de destino, as duas seriam a mesma coisa -- em vez de criar id
   * duplicado, recusa e explica. */
  /** Linha de meio metro/lata vira a unidade do estoque ao gravar (embalagemDomain.linhaNaUnidadeDoEstoque). */
  const linhaGravada = useCallback((item: PdvCartItem) => {
    const produto = products.find((p) => p.id === item.productId);
    const base = buildOpcoesUnidadeVenda(produto)[0];
    return linhaNaUnidadeDoEstoque({ ...item, precoUnitario: fromCents(item.precoUnitarioCentavos) }, { sigla: base.sigla, casasDecimais: base.casasDecimais });
  }, [products]);

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
    if (preVenda) {
      const soltar = await NexusSwal.fire({
        title: `Soltar a pré-venda #${preVenda.numeroPedido}?`,
        text: 'Ela sai do caixa e continua em aberto, do jeito que estava. Nada é cancelado nem faturado.',
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Soltar pré-venda',
        cancelButtonText: 'Voltar',
      });
      if (soltar.isConfirmed) resetSale();
      return;
    }
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
    if (!selectedItem || preVenda) return;
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
  }, [selectedItem, updateItemQuantity, preVenda]);

  // ------------------------------------------------------------------ Pre-venda no caixa (23/11/2026)

  const produtosPorId = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);

  /** Poe a pre-venda (ou os itens dela com o preco recalculado) no cupom, so' para mostrar. */
  const mostrarPreVendaNoCupom = useCallback((carregada: PreVendaCarregada) => {
    const linhas: PdvCartItem[] = linhasDoCupomDaPreVenda(carregada.itens, produtosPorId);
    setPreVenda(carregada);
    setCartItems(linhas);
    setSelectedItemId('');
    setSaleDiscountCents(0);
  }, [produtosPorId]);

  /** F8 / botao "Pré-vendas": so' com o caixa aberto e o cupom vazio. */
  const abrirPreVendas = useCallback(() => {
    if (!podePreVendaNoCaixa) return;
    if (!session) {
      void openSession();
      return;
    }
    if (!vendaPeloServidor) {
      showError('Pré-venda no caixa indisponível', `Faturar pré-venda na Frente de Caixa depende da "Venda pelo servidor" ligada para a empresa. Peça ao suporte para ligar. Enquanto isso, fature em ${ONDE_FATURAR_NO_SISTEMA}.`);
      return;
    }
    if (preVenda) {
      showWarning('Já há uma pré-venda no caixa', `Fature ou solte a pré-venda #${preVenda.numeroPedido} antes de puxar outra.`);
      return;
    }
    if (cartItemsRef.current.length > 0) {
      showWarning('Venda em andamento', 'Finalize ou limpe a venda que está no cupom antes de puxar uma pré-venda.');
      return;
    }
    setPreVendasModalOpen(true);
  }, [openSession, podePreVendaNoCaixa, preVenda, session, vendaPeloServidor]);

  /** Le a pre-venda de novo (a lista pode estar velha) e poe no cupom. */
  const puxarPreVenda = useCallback(async (linha: PreVendaDoCaixa) => {
    if (!tenantId || !session || puxandoPreVenda) return;
    setPuxandoPreVenda(true);
    try {
      const snap = await getDoc(doc(db, 'pedidos_venda', linha.id));
      const dados = snap.exists() && snap.data().tenantId === tenantId ? snap.data() : null;
      // Visibilidade de vendas: quem so' ve as proprias nao puxa a do colega pelo caixa.
      if (dados && vendasVisiveisDeUsuarioId && !isVendaDoUsuario(dados, vendasVisiveisDeUsuarioId)) {
        showError(TITULO_VENDA_DE_OUTRO_USUARIO, MENSAGEM_VENDA_DE_OUTRO_USUARIO);
        return;
      }
      const idDoVendedor = String(dados?.vendedorId || dados?.usuarioResponsavelId || '');
      const resultado = carregarPreVendaNoCaixa(linha.id, dados, idDoVendedor && linha.vendedorNome !== 'Não identificado' ? { [idDoVendedor]: linha.vendedorNome } : {});
      if ('erro' in resultado) {
        showError('Esta pré-venda não pode ser faturada no caixa', resultado.erro);
        return;
      }
      const carregada = resultado.preVenda;
      const cliente = carregada.clienteId
        ? clients.find((c) => c.id === carregada.clienteId) || { id: carregada.clienteId, nome: carregada.clienteNome }
        : null;
      setSearch('');
      setSelectedProduct(null);
      setSelectedClient(cliente);
      mostrarPreVendaNoCupom(carregada);
      setPreVendasModalOpen(false);
      if (cliente) mostrarAlertaDoCliente(cliente);
    } catch (error) {
      console.error('Erro ao abrir a pré-venda no caixa:', error);
      showError('Não foi possível abrir a pré-venda', 'Confira a conexão e puxe a pré-venda de novo.');
    } finally {
      setPuxandoPreVenda(false);
    }
  }, [clients, mostrarPreVendaNoCupom, puxandoPreVenda, session, tenantId, vendasVisiveisDeUsuarioId]);

  /** Cupom nao fiscal na bobina (2a via quando vem do historico). Erro so' avisa: a venda ja' esta' gravada. */
  const imprimirNaoFiscalDaVenda = useCallback(async (venda: { pedidoId: string; numeroPedido: string; clienteId: string | null }, segundaVia = false) => {
    const documentoDoCliente = venda.clienteId ? (clients.find((c) => c.id === venda.clienteId)?.documento || '') : '';
    try {
      await imprimirCupomNaoFiscal({ pedidoId: venda.pedidoId, empresa: configDaEmpresa, documentoDoCliente, operador: operatorName, segundaVia });
    } catch (erro) {
      console.error('Erro ao imprimir o cupom não fiscal:', erro);
      showError('Cupom não impresso', `A venda #${venda.numeroPedido} está gravada. ${erro instanceof Error ? erro.message : 'Confira a impressora e reimprima pelas Vendas do caixa (F9).'}`);
    }
  }, [clients, configDaEmpresa, operatorName]);

  const podeEmitirFiscal = podeEmitirCupomFiscal({ role: userRole, isOwner, permissoes: userPermissions });
  const documentoDaEmpresa = documentoDoCupomDoCaixa({ controlaFiscal, documentosFiscais: configDaEmpresa, comNotaFiscal: null });
  // Muda a cada NFC-e emitida: o historico le de novo a situacao das notas.
  const [versaoDasNotas, setVersaoDasNotas] = useState(0);

  /**
   * Emite a NFC-e de uma venda gravada. Devolve null quando deu certo (autorizada
   * ou aguardando a SEFAZ) ou o motivo, em portugues, quando nao saiu.
   * Sem "Fiscal: Emitir Nota Fiscal" nem tenta: o servidor recusaria (spedyAcesso.js).
   */
  const emitirFiscalDaVenda = useCallback(async (venda: { pedidoId: string; numeroPedido: string }): Promise<string | null> => {
    if (!tenantId || !currentUser) return 'Sua sessão expirou. Entre de novo no caixa.';
    if (!podeEmitirFiscal) return MENSAGEM_SEM_PERMISSAO_NFCE;
    void NexusSwal.fire({
      title: 'Emitindo cupom fiscal (NFC-e)...',
      text: `Venda #${venda.numeroPedido}: enviando para a SEFAZ.`,
      allowOutsideClick: false,
      showConfirmButton: false,
      didOpen: () => NexusSwal.showLoading(),
    });
    try {
      const resultado = await emitirCupomFiscalDoCaixa({ pedidoId: venda.pedidoId, tenantId, usuario: { uid: currentUser.uid, email: currentUser.email } });
      NexusSwal.close();
      setVersaoDasNotas((n) => n + 1);
      if (resultado.situacao === 'autorizado') {
        showSuccess(`Cupom fiscal ${resultado.numero ? `nº ${resultado.numero} ` : ''}autorizado`);
        return null;
      }
      if (resultado.situacao === 'aguardando') {
        showWarning('Cupom fiscal aguardando a SEFAZ', `A venda #${venda.numeroPedido} está gravada e o cupom foi enviado, mas a SEFAZ ainda não respondeu. Reimprima pelas Vendas do caixa (F9) daqui a pouco.`);
        return null;
      }
      return `A SEFAZ rejeitou o cupom fiscal: ${resultado.motivo}`;
    } catch (erro) {
      console.error('Erro ao emitir a NFC-e na Frente de Caixa:', erro);
      NexusSwal.close();
      setVersaoDasNotas((n) => n + 1);
      return erro instanceof Error && erro.message ? erro.message : 'Não foi possível transmitir o cupom fiscal.';
    }
  }, [currentUser, podeEmitirFiscal, tenantId]);

  /** Cupom fiscal falhou: a venda segue gravada; oferece o nao fiscal para o cliente nao sair sem papel. */
  const oferecerNaoFiscalNaFalha = useCallback(async (venda: { pedidoId: string; numeroPedido: string; clienteId: string | null }, falha: string) => {
    const resposta = await NexusSwal.fire({
      title: 'Cupom fiscal não emitido',
      text: `${falha} A venda #${venda.numeroPedido} está gravada; emita o cupom fiscal depois em Vendas do caixa (F9). Imprimir agora o cupom não fiscal para o cliente?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Imprimir cupom não fiscal',
      cancelButtonText: 'Não imprimir',
    });
    if (resposta.isConfirmed) await imprimirNaoFiscalDaVenda(venda);
  }, [imprimirNaoFiscalDaVenda]);

  /**
   * CUPOM NO FIM DA VENDA (23/11/2026, cupomDoCaixaDomain.ts): NFC-e quando a
   * empresa emite cupom fiscal; senao (ou venda "Sem nota fiscal"), o cupom nao
   * fiscal sai na bobina. Roda DEPOIS de a venda estar gravada e o caixa limpo:
   * falha aqui nunca desfaz a venda, so' avisa o que fazer.
   */
  const entregarCupom = useCallback(async (venda: { pedidoId: string; numeroPedido: string; clienteId: string | null; comNotaFiscal: boolean | null }) => {
    if (!tenantId || !currentUser) return;
    const documento = documentoDoCupomDoCaixa({ controlaFiscal, documentosFiscais: configDaEmpresa, comNotaFiscal: venda.comNotaFiscal });
    if (documento === 'nao_fiscal') {
      await imprimirNaoFiscalDaVenda(venda);
      return;
    }
    const falha = await emitirFiscalDaVenda(venda);
    if (falha) await oferecerNaoFiscalNaFalha(venda, falha);
  }, [configDaEmpresa, controlaFiscal, currentUser, emitirFiscalDaVenda, imprimirNaoFiscalDaVenda, oferecerNaoFiscalNaFalha, tenantId]);

  // ------------------------------------------------------------------ Vendas do caixa (F9): reimprimir

  const [vendasModalOpen, setVendasModalOpen] = useState(false);
  const [ocupadoNoHistorico, setOcupadoNoHistorico] = useState<string | null>(null);

  const reimprimirVenda = useCallback(async (venda: VendaDoCaixa) => {
    const acao = acaoDeReimpressao(venda);
    if (acao.tipo === 'bloqueada') {
      showWarning('Cupom não reimpresso', acao.motivo);
      return;
    }
    setOcupadoNoHistorico(venda.id);
    try {
      if (acao.tipo === 'pdf_nfce') {
        if (!podeEmitirFiscal) {
          showError('Cupom fiscal não reaberto', `A venda #${venda.numeroPedido} tem cupom fiscal (NFC-e). ${MENSAGEM_SEM_PERMISSAO_NFCE}`);
          return;
        }
        try {
          await reabrirCupomFiscal(acao.spedyId);
        } catch (erro) {
          console.error('Erro ao reabrir o cupom fiscal:', erro);
          showError('Cupom fiscal não reaberto', `${erro instanceof Error && erro.message ? erro.message : 'Não foi possível baixar o cupom fiscal.'} A venda #${venda.numeroPedido} continua com a nota; tente de novo em instantes.`);
        }
        return;
      }
      await imprimirNaoFiscalDaVenda({ pedidoId: venda.id, numeroPedido: venda.numeroPedido, clienteId: venda.clienteId }, true);
    } finally {
      setOcupadoNoHistorico(null);
    }
  }, [imprimirNaoFiscalDaVenda, podeEmitirFiscal]);

  const emitirFiscalDoHistorico = useCallback(async (venda: VendaDoCaixa) => {
    setOcupadoNoHistorico(venda.id);
    try {
      const falha = await emitirFiscalDaVenda({ pedidoId: venda.id, numeroPedido: venda.numeroPedido });
      if (falha) showError('Cupom fiscal não emitido', `${falha} A venda #${venda.numeroPedido} continua gravada.`);
    } finally {
      setOcupadoNoHistorico(null);
    }
  }, [emitirFiscalDaVenda]);

  // Outra pessoa abriu (ou um gerente liberou) a pre-venda: ela sai do caixa, sem faturar.
  useEffect(() => {
    if (!preVenda || travaDaPreVenda.situacao !== 'de_outro') return;
    showError('Pré-venda aberta por outra pessoa', travaDaPreVenda.mensagem || 'Outra pessoa está com esta pré-venda aberta. Espere ela terminar e puxe a pré-venda de novo.');
    resetSale();
  }, [preVenda, travaDaPreVenda.situacao, travaDaPreVenda.mensagem, resetSale]);

  /**
   * Recebe e fatura a pre-venda que esta' no caixa, SOBRE a propria pre-venda
   * (pedidoId + pdvSessionId), pelo servidor. O vendedor enviado e' o da
   * pre-venda -- nunca o operador -- e o servidor ainda usa o do pedido gravado.
   */
  const faturarPreVenda = async (carregada: PreVendaCarregada, drafts: PaymentDraft[], observation: string, trocoCentavos = 0) => {
    if (saleLockRef.current) return;
    if (!currentUser || !tenantId || !session) return;
    const erroDoAPrazo = erroDoAPrazoNoCaixa(drafts.map((d) => d.forma), { ativo: aPrazoNoCaixa, clienteId: carregada.clienteId });
    if (erroDoAPrazo) {
      showError('Pagamento a prazo', erroDoAPrazo);
      return;
    }
    // Forma escolhida pelo vendedor no app (25/11/2026): trocar so' com permissao (o servidor confere de novo).
    const erroDaForma = erroDaFormaDoVendedor({
      formaDoVendedor: carregada.formaDoVendedor,
      formasDaVenda: drafts.map((d) => d.forma),
      podeTrocar: hasTenantFullAccess(userRole, isOwner) || userPermissions.includes(PERMISSAO_TROCAR_FORMA_DO_VENDEDOR),
      numeroPedido: carregada.numeroPedido,
    });
    if (erroDaForma) {
      showError('Forma de pagamento do vendedor', erroDaForma);
      return;
    }
    const travaDoBalanco = await mensagemDaTravaDoBalanco(tenantId, 'finalizar a venda no PDV');
    if (travaDoBalanco) {
      showError('Balanço em andamento', travaDoBalanco);
      return;
    }

    // O preco acompanha a forma de pagamento (a vista / a prazo), pela mesma
    // regra do Pedido de Venda -- e nunca em silencio: a pessoa escolhe
    // recalcular e confere o total de novo.
    const condicaoEscolhida = condicaoDoPagamento(drafts, formasPrecoAVista);
    const reprecificada = reprecificarPreVenda(carregada.itens, condicaoEscolhida);
    if (reprecificada.alterados > 0) {
      const valor = currency.format(fromCents(Math.abs(reprecificada.diferencaCentavos)));
      const escolha = await NexusSwal.fire({
        title: condicaoEscolhida === 'vista' ? 'Pagamento à vista' : 'Pagamento a prazo',
        text: `${reprecificada.alterados} item(ns) da pré-venda têm outro preço ${ROTULO_CONDICAO[condicaoEscolhida]}. Com este pagamento o total ${reprecificada.diferencaCentavos >= 0 ? 'sobe' : 'cai'} ${valor}. Recalcular os preços e abrir o pagamento de novo?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Recalcular preços',
        cancelButtonText: 'Voltar',
      });
      if (escolha.isConfirmed) {
        mostrarPreVendaNoCupom({ ...carregada, itens: reprecificada.itens });
        setPaymentModalOpen(false);
        showWarning(`Preços recalculados para ${ROTULO_CONDICAO[condicaoEscolhida]}`, 'Confira o total e abra o pagamento de novo (F6).');
      }
      return;
    }

    // Desconto: vale o limite do PEDIDO DE VENDA (onde ele foi dado), com o que o
    // preco esta' abaixo do sistema -- a mesma conta do servidor.
    const paraOLimite = descontoDaPreVendaParaOLimite({
      preVenda: carregada, produtos: produtosPorId, promocoes, hoje: hojeDasPromocoes, condicao: condicaoEscolhida, vendidoPorPromocao,
    });
    const checagem = checarLimiteComCliente(limiteDescontoPedido, paraOLimite.baseCentavos, paraOLimite.descontoCentavos, descontoPadraoDoCliente(selectedClient));
    if (checagem.excedeu) {
      const percentual = checagem.percentualAplicado.toFixed(1);
      if (modoLimiteDesconto === 'bloquear') {
        showError('Desconto acima do limite', `O desconto da pré-venda #${carregada.numeroPedido} (${percentual}%) passa do limite configurado para Pedido de Venda. Reduza o desconto da pré-venda em ${ONDE_FATURAR_NO_SISTEMA} e puxe de novo.`);
        return;
      }
      if (modoLimiteDesconto === 'senha' && !aprovacaoDesconto) {
        setLiberacaoDaPreVenda({ ...paraOLimite, percentual: checagem.percentualAplicado });
        setShowAprovacaoDesconto(true);
        return;
      }
      if (modoLimiteDesconto === 'avisar') {
        const confirma = await NexusSwal.fire({
          title: 'Desconto acima do limite',
          text: `O desconto da pré-venda #${carregada.numeroPedido} (${percentual}%) passa do limite configurado para Pedido de Venda. Faturar mesmo assim?`,
          icon: 'warning',
          showCancelButton: true,
          confirmButtonText: 'Faturar mesmo assim',
          cancelButtonText: 'Voltar',
        });
        if (!confirma.isConfirmed) return;
      }
    }

    // Mercadoria ainda nao conferida pela expedicao: avisa, como no Pedido de Venda.
    if (conferenciaPendenteParaFaturar(conferenciaMercadoriaAtiva, carregada.statusConferencia)) {
      const aviso = avisoFaturarSemConferencia(carregada.statusConferencia);
      const semConferencia = await NexusSwal.fire({
        title: aviso.title,
        text: aviso.text,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: aviso.confirmButtonText,
        cancelButtonText: 'Voltar',
        confirmButtonColor: '#f59e0b',
        reverseButtons: true,
      });
      if (!semConferencia.isConfirmed) return;
    }

    const totalDaPreVenda = totaisDaPreVenda(carregada).totalCentavos;
    try {
      normalizePayments(totalDaPreVenda, drafts, {
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

    const fatorDoItem = (item: ItemDaPreVenda) => (Number(item.fatorConversao) > 0 ? Number(item.fatorConversao) : undefined);
    saleLockRef.current = true;
    setSaving(true);
    try {
      // Lote e Validade: so' o produto que controla lote entra; os demais seguem so' com o estoque.
      const planoLotes = await prepararBaixaDeLotes({
        db,
        tenantId,
        linhas: linhasParaLote(carregada.itens.map((item) => ({ id: item.id, nome: item.nome, quantidade: item.quantidade, fatorConversao: fatorDoItem(item) }))),
        modo: loteModoSaida,
        avisarVencido: loteAvisarVencido,
      });
      if (planoLotes === null) return; // quem recebe cancelou a escolha do lote

      const resposta = await finalizarVendaNoServidor(corpoDoFaturamentoNoCaixa({
        preVenda: carregada,
        pdvSessionId: session.id,
        // Vale o dia do faturamento (decisao do dono de 15/10/2026), como no Pedido de Venda.
        dataVenda: getDateInputInTimeZone(),
        pagamentos: drafts,
        observacao: observation,
        lotesDoItem: (indice) => camposDeLoteDoItem(planoLotes, String(indice)),
        excedeuLimite: checagem.excedeu,
        aprovacao: checagem.excedeu ? aprovacaoDesconto : null,
      }));

      // Espelha na tela a baixa (e a reserva consumida) que o servidor gravou.
      const vendidoPorProduto = new Map<string, number>();
      carregada.itens.forEach((item) => {
        vendidoPorProduto.set(item.id, (vendidoPorProduto.get(item.id) || 0) + toBaseQuantity(item.quantidade, fatorDoItem(item)));
      });
      setProducts((current) => current.map((product) => {
        const vendido = vendidoPorProduto.get(product.id) || 0;
        if (!(vendido > 0)) return product;
        return {
          ...product,
          quantidade: Math.max(0, product.quantidade - vendido),
          ...(carregada.estoqueReservado ? { quantidadeReservada: Math.max(0, Number(product.quantidadeReservada || 0) - vendido) } : {}),
        };
      }));
      showSuccess(`Pré-venda #${resposta.numeroPedido} faturada. Vendedor: ${resposta.vendedorNome}${textoDoTroco(trocoCentavos)}`);
      resetSale();
      void entregarCupom({ pedidoId: resposta.pedidoId, numeroPedido: resposta.numeroPedido, clienteId: carregada.clienteId, comNotaFiscal: carregada.comNotaFiscal });
    } catch (error) {
      console.error('Erro ao faturar a pré-venda no caixa:', error);
      // Liberacao que o servidor nao aceitou (vencida, usada, de outro valor): o proximo Finalizar pede de novo.
      if (error instanceof VendaServidorError && error.status === STATUS_PEDIR_DE_NOVO) setAprovacaoDesconto(null);
      showError(
        'Erro ao faturar a pré-venda',
        describeTransactionError(error) || (error instanceof Error ? error.message : 'Tente novamente.'),
      );
    } finally {
      setSaving(false);
      saleLockRef.current = false;
    }
  };

  /** Troco (25/11/2026): repetido no aviso de venda finalizada. */
  const textoDoTroco = (trocoCentavos: number): string => (
    trocoCentavos > 0 ? ` — troco ${currency.format(fromCents(trocoCentavos))}` : ''
  );

  /**
   * Venda a prazo gravada pela tela: bloqueio por atraso e limite de credito,
   * como no Pedido de Venda (25/11/2026). Devolve o erro em portugues ou a
   * versao do credito lida, que a transacao reconfere.
   */
  const conferirCreditoDoAPrazo = async (
    clienteId: string,
    clienteNome: string,
    totalCentavos: number,
  ): Promise<{ erro: string | null; guarda: { clienteId: string; versaoNaChecagem: number } | null }> => {
    if (!tenantId) return { erro: null, guarda: null };
    const { parametros, trabalhaComLimite, noGrupo } = regrasDoAPrazo;
    if (!parametros.bloqueioAtraso.ativo && !trabalhaComLimite) return { erro: null, guarda: null };
    const situacao = await situacaoEmAbertoDoCliente(tenantId, clienteId, noGrupo);
    if (parametros.bloqueioAtraso.ativo) {
      const bloqueio = bloqueioPorAtraso(parametros, situacao.maiorAtrasoDias, clienteNome);
      if (bloqueio) return { erro: bloqueio, guarda: null };
    }
    if (!trabalhaComLimite) return { erro: null, guarda: null };
    // Depois do saldo, nunca antes (creditoDomain.ts): o que foi gravado ate'
    // aqui ja' esta' no saldo OU na versao.
    const clienteSnap = await getDoc(doc(db, 'clientes', clienteId));
    const cliente = clienteSnap.exists() ? clienteSnap.data() : null;
    const limite = cliente && cliente.limiteDeCredito != null ? Math.round(Number(cliente.limiteDeCredito) * 100) : null;
    const checagem = excedeLimiteCredito(limite, situacao.saldoCentavos, totalCentavos);
    if (checagem.bloqueado) {
      return {
        erro: checagem.motivo === 'sem_limite'
          ? `O cliente "${clienteNome}" não tem limite de crédito cadastrado. Cadastre o limite em Clientes ou receba de outra forma.`
          : `Esta venda ultrapassaria o limite de crédito de "${clienteNome}" (saldo em aberto + valor desta venda). Receba de outra forma ou aumente o limite em Clientes.`,
        guarda: null,
      };
    }
    return { erro: null, guarda: { clienteId, versaoNaChecagem: parseCreditoVersao(cliente?.[CAMPO_CREDITO_VERSAO]) } };
  };

  const finalizeSale = async (drafts: PaymentDraft[], observation: string, trocoCentavos = 0) => {
    // Pre-venda no caixa: fatura sobre ela, com o vendedor dela (faturarPreVenda).
    if (preVenda) {
      await faturarPreVenda(preVenda, drafts, observation, trocoCentavos);
      return;
    }
    // Cashback so' e' consumido pelo servidor: gravado pela tela, o cupom nao
    // pode levar essa forma (o saldo do cliente ficaria sem baixa).
    if (!vendaPeloServidor && drafts.some((d) => d.forma === FORMA_PAGAMENTO_CASHBACK)) {
      showError('Cashback indisponível', 'Pagar com cashback só funciona com a venda pelo servidor ligada para a empresa. Troque a forma de pagamento.');
      return;
    }
    if (saleLockRef.current) return;
    if (!currentUser || !tenantId || !session) return;
    const erroDoAPrazo = erroDoAPrazoNoCaixa(drafts.map((d) => d.forma), {
      ativo: aPrazoNoCaixa, clienteId: selectedClient?.id, clienteEhPadrao: selectedClient?.isPadrao,
    });
    if (erroDoAPrazo) {
      showError('Pagamento a prazo', erroDoAPrazo);
      return;
    }
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
        const auto = precoAutomatico(item.tabelaPreco, condicaoEscolhida, item.quantidade);
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

    // Venda a prazo gravada pela tela (25/11/2026): as mesmas conferencias do
    // Pedido de Venda e da OS -- bloqueio por atraso e limite de credito. Pelo
    // servidor, quem confere e' o servidor (vendaFechamento.js).
    const vendaAPrazo = summarizePayments(paymentRecords).paymentCondition === 'aprazo';
    let guardaDoCredito: { clienteId: string; versaoNaChecagem: number } | null = null;
    if (!vendaPeloServidor && vendaAPrazo && selectedClient?.id && !selectedClient.isPadrao) {
      try {
        const conferido = await conferirCreditoDoAPrazo(selectedClient.id, selectedClient.nome, totals.totalCentavos);
        if (conferido.erro) {
          showError('Venda a prazo não liberada', conferido.erro);
          return;
        }
        guardaDoCredito = conferido.guarda;
      } catch (erro) {
        console.error('Erro ao conferir o crédito do cliente:', erro);
        showError('Não foi possível conferir o crédito do cliente', 'Confira a internet e tente de novo. Se continuar, faça esta venda a prazo pelo Pedido de Venda.');
        return;
      }
    }

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
          itens: cartItems.map((item, indiceDoItem) => {
            // Meio metro, lata: grava na unidade do estoque (1 M3 a R$ 220 = 2 meio metros a R$ 110).
            const naBase = linhaGravada(item);
            return {
              id: item.productId,
              nome: item.nome,
              precoUnitario: naBase ? naBase.precoUnitario : fromCents(item.precoUnitarioCentavos),
              quantidade: naBase ? naBase.quantidade : item.quantidade,
              desconto: fromCents(item.descontoCentavos),
              ...(naBase
                ? { unidadeMedidaSigla: naBase.unidadeMedidaSigla, unidadeMedidaCasasDecimais: naBase.unidadeMedidaCasasDecimais, embalagemDeOrigem: naBase.embalagemDeOrigem }
                : item.unidadeMedidaSigla ? { unidadeMedidaSigla: item.unidadeMedidaSigla, unidadeMedidaCasasDecimais: item.unidadeMedidaCasasDecimais ?? 0 } : {}),
              ...(item.origemPreco ? { origemPreco: item.origemPreco } : {}),
              ...(item.promocaoId ? { promocaoId: item.promocaoId, promocaoNome: item.promocaoNome || '' } : {}),
              ...camposDeLoteDoItem(planoLotes, String(indiceDoItem)),
              ...(item.embalagemId && !naBase ? { embalagemId: item.embalagemId, fatorConversao: item.fatorConversao, quantidadeBase: item.quantidadeBase } : {}),
            };
          }),
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
        showSuccess(`Venda PDV #${resposta.numeroPedido} finalizada${textoDoTroco(trocoCentavos)}`);
        espelharBaixaNaTela();
        const clienteDoCupom = selectedClient?.id || null;
        resetSale();
        void entregarCupom({ pedidoId: resposta.pedidoId, numeroPedido: resposta.numeroPedido, clienteId: clienteDoCupom, comNotaFiscal: null });
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

        // Venda a prazo: outra venda do mesmo cliente nao pode ter passado no
        // meio (mesma guarda da OS e do Pedido de Venda, creditoDomain.ts).
        const clienteDoCreditoRef = guardaDoCredito ? doc(db, 'clientes', guardaDoCredito.clienteId) : null;
        let creditoVersaoAtual = 0;
        if (clienteDoCreditoRef && guardaDoCredito) {
          const clienteSnap = await transaction.get(clienteDoCreditoRef);
          creditoVersaoAtual = parseCreditoVersao(clienteSnap.data()?.[CAMPO_CREDITO_VERSAO]);
          if (creditoFoiAlteradoDurante(guardaDoCredito.versaoNaChecagem, creditoVersaoAtual)) throw new Error(MENSAGEM_CREDITO_CONCORRENTE);
        }

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
          // Meio metro, lata: grava na unidade do estoque (o total da linha nao muda).
          const naBase = linhaGravada(item);
          return {
            id: item.productId,
            nome: item.nome,
            precoUnitario: naBase ? naBase.precoUnitario : fromCents(item.precoUnitarioCentavos),
            precoUnitarioCentavos: naBase ? toCents(naBase.precoUnitario) : item.precoUnitarioCentavos,
            quantidade: naBase ? naBase.quantidade : item.quantidade,
            desconto: fromCents(totalDiscountCents),
            descontoCentavos: totalDiscountCents,
            subtotal: fromCents(subtotalCents),
            subtotalCentavos: subtotalCents,
            unidadeMedidaSigla: naBase ? naBase.unidadeMedidaSigla : item.unidadeMedidaSigla,
            unidadeMedidaCasasDecimais: naBase ? naBase.unidadeMedidaCasasDecimais : item.unidadeMedidaCasasDecimais,
            ...(naBase ? { embalagemDeOrigem: naBase.embalagemDeOrigem } : {}),
            // De onde veio o preco (a vista / promocao), como no Pedido de Venda.
            ...(item.origemPreco ? { origemPreco: item.origemPreco } : {}),
            ...(item.promocaoId ? { promocaoId: item.promocaoId, promocaoNome: item.promocaoNome || '' } : {}),
            ...camposDeLoteDoItem(planoLotes, String(indiceDoItem)),
            // Mesmo contrato do Pedido de Venda: item na unidade base nao
            // ganha campo de embalagem, para nao mudar o formato historico.
            ...(item.embalagemId && !naBase
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
        if (clienteDoCreditoRef) transaction.update(clienteDoCreditoRef, { [CAMPO_CREDITO_VERSAO]: creditoVersaoAtual + 1, updatedAt: serverTimestamp() });

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
        // Ligado ao pedido (09/11/2026): aparece no Historico de alteracoes da venda.
        ...(newPedidoId ? { registroRelacionadoId: newPedidoId } : {}),
        documentoTipo: 'pedido',
        documentoNumero: `Pedido ${finalNumeroPedido}`,
        status: 'sucesso',
      });

      // Cashback (20/10/2026): pelo servidor ele ja' gera; gravada pela tela, a
      // venda avisa o servidor, que confere se esta' paga e gera (idempotente).
      if (!vendaPeloServidor && newPedidoId) void gerarCashbackSemFalhar(newPedidoId);

      showSuccess(`Venda PDV #${finalNumeroPedido} finalizada${textoDoTroco(trocoCentavos)}`);
      espelharBaixaNaTela();
      const clienteDoCupom = selectedClient?.id || null;
      resetSale();
      if (newPedidoId) void entregarCupom({ pedidoId: newPedidoId, numeroPedido: finalNumeroPedido, clienteId: clienteDoCupom, comNotaFiscal: null });
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
        if (paymentModalOpen || discountModalOpen || clientModalOpen || preVendasModalOpen || vendasModalOpen || relatorioModalOpen) {
          setPaymentModalOpen(false);
          setDiscountModalOpen(false);
          setClientModalOpen(false);
          if (!puxandoPreVenda) setPreVendasModalOpen(false);
          if (!ocupadoNoHistorico) setVendasModalOpen(false);
          setRelatorioModalOpen(false);
        }
        return;
      }

      if (!hasPdvAccess) return;
      // Com a pre-venda no caixa, cliente, desconto e quantidade sao os dela: os atalhos nao mexem.
      if (event.key === 'F2') { event.preventDefault(); if (!preVenda) setClientModalOpen(true); }
      if (event.key === 'F3') { event.preventDefault(); productInputRef.current?.focus(); }
      if (event.key === 'F4') { event.preventDefault(); if (cartItems.length > 0 && !preVenda) setDiscountModalOpen(true); }
      if (event.key === 'F5') { event.preventDefault(); void askSelectedItemQuantity(); }
      if (event.key === 'F8' && podePreVendaNoCaixa) { event.preventDefault(); abrirPreVendas(); }
      // Vendas deste caixa (23/11/2026): reimprimir o cupom.
      if (event.key === 'F9' && session) { event.preventDefault(); setVendasModalOpen(true); }
      // Relatorio parcial do caixa (26/11/2026): sem fechar o caixa.
      if (event.key === 'F10' && session) { event.preventDefault(); abrirRelatorioDoCaixa(); }
      if (event.key === 'F6' || event.key === 'F7') {
        event.preventDefault();
        if (cartItems.length > 0 && session) setPaymentModalOpen(true);
      }
    };

    window.addEventListener('keydown', handleShortcuts);
    return () => window.removeEventListener('keydown', handleShortcuts);
  }, [abrirPreVendas, abrirRelatorioDoCaixa, askSelectedItemQuantity, cartItems.length, clientModalOpen, discountModalOpen, hasPdvAccess, ocupadoNoHistorico, paymentModalOpen, podePreVendaNoCaixa, preVenda, preVendasModalOpen, puxandoPreVenda, relatorioModalOpen, session, vendasModalOpen]);

  const preVendaNoResumo = useMemo(
    () => (preVenda ? { numeroPedido: preVenda.numeroPedido, clienteNome: preVenda.clienteNome, vendedorNome: preVenda.vendedorNome } : null),
    [preVenda],
  );
  // Liberacao de desconto: a da pre-venda vale para o Pedido de Venda (com a
  // diferenca de preco conferida ao faturar); a da venda direta, para o PDV.
  const liberacaoAtual = preVenda && liberacaoDaPreVenda
    ? { tela: 'pedido' as const, baseCentavos: liberacaoDaPreVenda.baseCentavos, descontoCentavos: liberacaoDaPreVenda.descontoCentavos, percentual: liberacaoDaPreVenda.percentual }
    : { tela: (preVenda ? 'pedido' : 'pdv') as 'pedido' | 'pdv', baseCentavos: totals.subtotalCentavos, descontoCentavos: totals.descontoTotalCentavos, percentual: checagemLimiteDesconto.percentualAplicado };

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
          <VersaoDoSistema style={{ alignSelf: 'flex-end', marginBottom: '3px' }} />
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
              {podePreVendaNoCaixa && (
                <button type="button" className="pdv-topbar-button" onClick={abrirPreVendas} title="Ver as pré-vendas em aberto e puxar uma para receber (F8)">
                  <ClipboardList size={16} aria-hidden="true" /> Pré-vendas
                </button>
              )}
              <button type="button" className="pdv-topbar-button" onClick={() => setVendasModalOpen(true)} title="Ver as vendas deste caixa e reimprimir o cupom (F9)">
                <History size={16} aria-hidden="true" /> Vendas
              </button>
              {podeRelatorioDoCaixa && (
                <button type="button" className="pdv-topbar-button" onClick={abrirRelatorioDoCaixa} title="Ver e imprimir o que já passou pelo caixa (vendas, dinheiro e sangrias), sem fechar (F10)">
                  <FileText size={16} aria-hidden="true" /> Relatório
                </button>
              )}
              <button type="button" className="pdv-topbar-button" onClick={() => setSangriaModalOpen(true)} title="Registrar sangria">
                <Banknote size={16} aria-hidden="true" /> Sangria
              </button>
              <button
                type="button"
                className="pdv-topbar-button"
                onClick={() => void fecharCaixaDoBotao()}
                title={terminalDoCaixa ? 'Contar o dinheiro e fechar o seu caixa; depois o próximo funcionário entra com o código e a senha dele' : 'Contar o dinheiro e fechar o caixa'}
              >
                Fechar caixa
              </button>
            </>
          ) : (
            <button type="button" className="pdv-topbar-button pdv-topbar-button--primary" onClick={openSession} disabled={loading}>
              Abrir caixa
            </button>
          )}
          {!estaInstalado() && (
            // App separado do sistema completo (17/11/2026): a pagina propria
            // (caixa.html) tem o manifest do "Hennder Caixa" e o botao Instalar.
            <button
              type="button"
              className="pdv-topbar-icon"
              title="Instalar a Frente de Caixa como app no computador (separado do sistema)"
              aria-label="Instalar a Frente de Caixa como app"
              onClick={() => window.open(CAMINHO_INSTALACAO_CAIXA, '_blank', 'noopener')}
            >
              <MonitorDown size={18} />
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
              disabled={!session || Boolean(preVenda)}
              onChange={(texto) => { setSearch(texto); if (!texto.trim()) setSelectedProduct(null); }}
              onSelect={(product) => addProductToCart(product, 1, resolveScannedUnit(product))}
              onDestacado={setSelectedProduct}
            />

            {preVenda && (
              <div className="pdv-prevenda-faixa" role="status">
                <ClipboardList size={20} aria-hidden="true" />
                <div>
                  <strong>Pré-venda #{preVenda.numeroPedido} · Vendedor: {preVenda.vendedorNome}</strong>
                  <span>
                    {preVenda.dataDaPreVenda ? `Gravada em ${formatDateInputPtBr(preVenda.dataDaPreVenda)}. ` : ''}
                    Itens, preços, descontos e vendedor são os da pré-venda: no caixa você só recebe.
                    {preVenda.pagamentoCombinado ? ` Pagamento anotado na pré-venda: ${preVenda.pagamentoCombinado}.` : ''}
                    {preVenda.pedidoBonificacaoId ? ` Esta venda tem um pedido de bonificação, que é faturado em ${ONDE_FATURAR_NO_SISTEMA}.` : ''}
                  </span>
                </div>
              </div>
            )}

            <CartPanel
              items={cartItems}
              selectedItemId={selectedItemId}
              onSelectItem={setSelectedItemId}
              onQuantityChange={updateItemQuantity}
              onDiscountChange={updateItemDiscount}
              onRemoveItem={removeItem}
              unitOptionsByItemId={unitOptionsByItemId}
              semUnidadeSoltaByItemId={semUnidadeSoltaByItemId}
              onUnitChange={venderPorEmbalagem && !preVenda ? changeItemUnit : undefined}
              somenteLeitura={Boolean(preVenda)}
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
            preVenda={preVendaNoResumo}
            atalhoPreVendas={podePreVendaNoCaixa}
            atalhoRelatorio={podeRelatorioDoCaixa && Boolean(session)}
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

      <RelatorioDoCaixaModal
        open={relatorioModalOpen}
        carregar={carregarRelatorioParcial}
        onClose={() => setRelatorioModalOpen(false)}
        onImprimir={imprimirRelatorioParcial}
      />

      <SangriaModal
        open={sangriaModalOpen}
        onClose={() => setSangriaModalOpen(false)}
        onConfirm={registrarSangria}
        bancos={bancosDisponiveis.filter((b) => b.ativo !== false).map((b) => ({ id: b.id, nome: b.nome }))}
      />

      <SolicitarAprovacaoDescontoModal
        open={showAprovacaoDesconto}
        tenantId={tenantId}
        motivo={preVenda
          ? `Desconto de ${liberacaoAtual.percentual.toFixed(1)}% na pré-venda #${preVenda.numeroPedido}, acima do limite configurado para Pedido de Venda. Confirme com a senha de um aprovador para faturar.`
          : `Desconto de ${checagemLimiteDesconto.percentualAplicado.toFixed(1)}% neste cupom, acima do limite configurado. Confirme com a senha de um aprovador para finalizar.`}
        onClose={() => setShowAprovacaoDesconto(false)}
        onAprovado={(aprovacao) => setAprovacaoDesconto(aprovacao)}
        liberacaoNoServidor={vendaPeloServidor
          ? { tela: liberacaoAtual.tela, baseCentavos: liberacaoAtual.baseCentavos, descontoCentavos: liberacaoAtual.descontoCentavos }
          : null}
        pedirAoGerente={{
          tela: liberacaoAtual.tela, baseCentavos: liberacaoAtual.baseCentavos, descontoCentavos: liberacaoAtual.descontoCentavos,
          documento: preVenda ? `Pré-venda #${preVenda.numeroPedido} — ${preVenda.clienteNome}` : `Cupom no PDV — ${selectedClient?.nome || 'CONSUMIDOR FINAL'}`,
          itens: cartItems.map((i) => ({ nome: i.nome, quantidade: i.quantidade, totalCentavos: Math.round(i.precoUnitarioCentavos * i.quantidade) - (i.descontoCentavos || 0) })),
        }}
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
        aPrazoAtivo={aPrazoNoCaixa}
        configBancoPadrao={configBancoPadrao}
        formaInicial={preVenda?.formaDoVendedor || ''}
        observacaoInicial={preVenda?.observacao || ''}
        rotuloFinalizar={preVenda ? 'Receber e faturar' : undefined}
        onClose={() => setPaymentModalOpen(false)}
        onFinalize={finalizeSale}
      />

      <VendasDoCaixaModal
        open={vendasModalOpen}
        tenantId={tenantId}
        sessaoId={session?.id || null}
        documentoDaEmpresa={documentoDaEmpresa}
        ocupadoId={ocupadoNoHistorico}
        versaoDasNotas={versaoDasNotas}
        onClose={() => setVendasModalOpen(false)}
        onReimprimir={(venda) => void reimprimirVenda(venda)}
        onEmitirFiscal={(venda) => void emitirFiscalDoHistorico(venda)}
      />

      <PreVendasModal
        open={preVendasModalOpen}
        tenantId={tenantId}
        puxando={puxandoPreVenda}
        onClose={() => setPreVendasModalOpen(false)}
        onEscolher={(linha) => void puxarPreVenda(linha)}
      />
    </div>
  );
};

export default PDV;
