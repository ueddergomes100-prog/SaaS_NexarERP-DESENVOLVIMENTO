import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { usePodeLiberarTrava, useTravaDeEdicao } from '../../hooks/useTravaDeEdicao';
import TravaDeEdicaoAviso from '../../components/common/TravaDeEdicaoAviso';
import { ArrowLeft, Save, User, Car, FileText, Loader2, Plus, Trash2, Activity, Package, Gauge, Fuel, CalendarDays, ClipboardList, X, History, Truck, Camera } from 'lucide-react';
import { collection, addDoc, doc, getDoc, getDocs, getCountFromServer, serverTimestamp, query, where, orderBy, limit, runTransaction } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { NexusSwal, showSuccess, showError, showWarning } from '../../utils/alerts';
import { conferirSaidaComReserva } from '../../services/reservaEstoqueService';
import { getServiceHours, getServiceTotal } from '../../utils/osServicePricing';
import { linhasParaLote, prepararBaixaDeLotes } from '../../services/loteBaixaService';
import { type PlanoDeLotes } from '../../utils/loteDomain';
import { applyStockFieldDeltas, describeTransactionError, formatSequenceValue, getCurrentMaxSequence, getNextTenantSequenceValue, writeTenantSequenceValue } from '../../utils/firestoreAtomic';
import {
  computeReservationDelta,
  computeReservationRelease,
  DEFAULT_MOMENTO_BAIXA_ESTOQUE,
  type MomentoBaixaEstoque,
} from '../../utils/estoqueReservaDomain';
import { isPlatformAdminRole, isTenantManagerRole, hasModuleAccess } from '../../utils/roles';
import HistoricoAuditoriaModal from '../../components/common/HistoricoAuditoriaModal';
import { isRegistroDeVendedor } from '../../utils/vendedorCadastroDomain';
import {
  calcularDescontoCents,
  DEFAULT_TIPO_DESCONTO_PADRAO,
  descontoInicial,
  parseLimiteDescontoConfig,
  parseModoLimiteDesconto,
  parseTipoDescontoPadrao,
  type DescontoTipo,
  type LimiteDescontoConfig,
  type ModoLimiteDesconto,
  checarLimiteComCliente,
  descontoPadraoDoCliente,
} from '../../utils/descontoDomain';
import {
  DEFAULT_MODO_VALIDACAO_CLIENTE,
  parseModoValidacaoCliente,
  resolverAcaoValidacaoCliente,
  type ModoValidacaoCliente,
} from '../../utils/clienteValidacaoDomain';
import {
  CAMPO_CREDITO_VERSAO,
  excedeLimiteCredito,
  parseCreditoVersao,
  parseTrabalhaComLimiteCredito,
} from '../../utils/creditoDomain';
import { calcularSaldoEmAbertoClienteCents, situacaoEmAbertoDoCliente } from '../../utils/contasReceberQuery';
import { PARAMETROS_VENDA_PADRAO, bloqueioPorAtraso, parseParametrosVenda, type ParametrosVenda } from '../../utils/parametrosVendaDomain';
import { getProximoCodigoCliente } from '../../utils/clienteCodigo';
import CadastroRapidoClienteModal, { type ClienteCadastradoRapido } from '../../components/common/CadastroRapidoClienteModal';
import DescontoInput, { type DescontoInputValue } from '../../components/finance/DescontoInput';
import SolicitarAprovacaoDescontoModal, { type AprovacaoDesconto } from '../../components/common/SolicitarAprovacaoDescontoModal';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import ProductAutocomplete from '../../components/common/ProductAutocomplete';
import ProductSearchModal from '../../components/common/ProductSearchModal';
import ClientAutocomplete from '../../components/common/ClientAutocomplete';
import { DEFAULT_PRODUCT_SEARCH_MODE, type ProductSearchMode } from '../../utils/productSearch';
import { isValidSaleQuantity } from '../../utils/saleQuantity';
import {
  avisoUnidadeMedidaAusente,
  resolveUnidadeMedidaProduto,
  temUnidadeMedidaCadastrada,
  UNIDADE_MEDIDA_FALLBACK,
} from '../../utils/unidadeMedidaDomain';
import { getProximoCodigoProduto } from '../../utils/estoqueCodigo';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { useEscapeLayer, useKeyboardShortcuts } from '../../hooks/useKeyboardFlow';
import { useTenantCollection } from '../../hooks/useTenantCollection';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import {
  DEFAULT_PERMITIR_DIVIDIR_PAGAMENTO,
  formaDoDocumentoSemPagamentos,
  formaInicialConfigurada,
  formasDaEmpresa,
  parseFormasOcultas,
  parseOrdemFormasPagamento,
  parsePermitirDividirPagamento,
} from '../../utils/formasPagamentoDomain';
import PaymentsEditor, { type PaymentFinanceConfig } from '../../components/finance/PaymentsEditor';
import {
  buildCardFeeSchedulesByBrand,
  createEmptyPaymentDraft,
  DEFAULT_EXIGIR_ESCOLHA_FORMA_PAGAMENTO,
  formaPagamentoInicial,
  parseExigirEscolhaFormaPagamento,
  explodeInstallmentPaymentRecords,
  fromCents,
  normalizeCreditCardFeeSchedule,
  normalizePayments,
  parseCreditTerms,
  parsePagamentoCartaoSimplificadoAtivo,
  resolveBancoPadraoSimplificado,
  summarizePayments,
  toCents,
  type PaymentDraft,
  type PaymentMethod,
  type PaymentRecord,
} from '../../utils/financeDomain';
import { usePromocoesVigentes } from '../../hooks/usePromocoesVigentes';
import { camposDePrecoDoItem, precoSugeridoDoItem } from '../../utils/precoComPromocaoDomain';
import { conferirPrecos } from '../../utils/conferenciaPrecoDomain';
import { mensagemDaTravaDoBalanco } from '../../services/travaBalancoService';
import { FORMAS_A_VISTA_PADRAO, ROTULO_CONDICAO, condicaoDoPagamento, parseFormasAVista, precoAutomatico, type OrigemPreco, type TabelaDePrecoDoItem } from '../../utils/precoVendaDomain';
import { aplicarCaixaAltaCadastro } from '../../utils/textoCadastroDomain';
import './OS.css';
import { renderProdutoOpcaoBusca } from '../../components/common/ProdutoOpcaoBusca';
import { useModoOficina } from '../../hooks/useModoOficina';
import { MOTIVO_CANCELAMENTO_MAXIMO, erroDoMotivoDoCancelamento } from '../../utils/cancelamentoVendaDomain';
import { parseVendaPeloServidor } from '../../utils/vendaFechamentoDomain';
import {
  STATUS_OS_CANCELADA,
  STATUS_OS_FINALIZADA,
  STATUS_OS_REABERTA_PADRAO,
  assinaturaDaCobrancaDaOs,
  camposDescritivosDaOs,
  corDoStatusDaOs,
  erroDasNotasParaCancelarOs,
  mensagemOsCanceladaNaoReabre,
} from '../../utils/osFechamentoDomain';
import { cancelarOsPelaTela, finalizarOsPelaTela, reabrirOsPelaTela } from '../../services/osFechamentoService';
import { cancelarOsNoServidor, finalizarOsNoServidor, reabrirOsNoServidor, OsServidorError } from '../../services/osServidorService';
import { STATUS_PEDIR_DE_NOVO } from '../../utils/conferenciaDescontoDomain';
import { DESLOCAMENTO_VAZIO, aplicarDeslocamentoNosServicos, identificacaoCurta, kmDoDeslocamento, parseDeslocamento, temDeslocamento, validarIdentificacaoEquipamento, valorDeslocamentoCentavos, type Deslocamento } from '../../utils/oficinaDomain';
import { AVISO_OS_EM_ATENDIMENTO_NO_CAMPO, STATUS_OS_AGUARDANDO_CONFERENCIA, STATUS_OS_EM_ATENDIMENTO, osEmAtendimentoNoCampo, type AssinaturaOS, type FotoOS } from '../../utils/osCampoDomain';

interface ClienteBasico { id: string; nome: string; telefone: string; codigo?: string; limiteDeCredito?: number | null; descontoPadraoPercentual?: number | null; }
interface Banco { id: string; nome: string; ativo: boolean; }
interface BandeiraCartao {
  id: string;
  nome: string;
  taxaDebitoPercentual?: number;
  taxasCreditoPorParcela?: Record<string, number>;
  prazoRecebimentoCreditoDias?: number;
  prazoRecebimentoDebitoDias?: number;
}
interface ServicoData { id: string; nome: string; preco: number; comissaoPercentual?: number; }
interface ServicoSelecionado { id: string; nome: string; preco: number; quantidade: number; detalhamento?: string; tempoHoras?: number; }
interface PecaData {
  id: string;
  /** Filiais: onde o cadastro nasceu (filtro "Itens desta filial"). */
  filialOrigem?: string;
  nome: string;
  precoVenda: number;
  precoAVista?: number;
  quantidade?: number;
  /** Preso em pre-venda, condicional, OS ou troca (estoqueReservaDomain.ts). */
  quantidadeReservada?: number;
  codigo?: string;
  codigoBarras?: string;
  unidadeMedidaSigla?: string;
  unidadeMedidaFracionado?: boolean;
  unidadeMedidaCasasDecimais?: number;
  /** Comissao propria da peca -- vence o percentual do mecanico/sistema
   * quando configurada. Ver resolveComissaoPercentual em financeDomain.ts. */
  comissaoPercentual?: number;
  /** `false` = produto inativado -- searchProducts() ja exclui isso da
   * busca (src/utils/productSearch.ts), precisa vir junto do Firestore. */
  ativo?: boolean;
  /** `true` = principal de uma grade (gradeProdutosDomain.ts): sem estoque,
   * quem se vende sao as variacoes -- searchProducts() tambem exclui. */
  temGrade?: boolean;
  /** Trava do produto mesmo com "Permitir venda sem estoque" ligado (estoqueReservaDomain.ts). */
  bloquearVendaSemEstoque?: boolean;
}
interface PecaSelecionada {
  id: string;
  nome: string;
  preco: number;
  quantidade: number;
  unidadeMedidaSigla?: string;
  unidadeMedidaFracionado?: boolean;
  unidadeMedidaCasasDecimais?: number;
  /** De onde veio o preco (tabela/promocao), como no Pedido de Venda (2026-10-06). */
  tabelaPreco?: TabelaDePrecoDoItem;
  origemPreco?: OrigemPreco;
  promocaoId?: string;
  promocaoNome?: string;
}

// A linha de produto e a MESMA nas quatro telas de busca -- antes cada uma
// desenhava a sua, com informacao diferente (a OS nem mostrava estoque).
// Ver src/components/common/ProdutoOpcaoBusca.tsx.
const renderPecaRow = renderProdutoOpcaoBusca;
interface VeiculoBasico {
  id: string;
  placa: string;
  modelo: string;
  marca: string;
  ano: string;
  cor: string;
  kmAtual: number;
  renavam: string;
  combustivel: string;
  clienteId: string;
  /** Maquinas pesadas (oficinaDomain.ts). */
  frota?: string;
  serie?: string;
  horimetro?: number;
  tipoEquipamento?: string;
}

const getLocalDateInputValue = (date = new Date()) => {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
};

/** Quanto a OS ja' tem de uma peca nas linhas, sem a linha `indiceIgnorado`. */
const quantidadeDaPecaNaOs = (pecas: Array<{ id: string; quantidade: number }>, pecaId: string, indiceIgnorado?: number): number => pecas
  .reduce((total, p, i) => (i === indiceIgnorado || p.id !== pecaId ? total : total + (Number(p.quantidade) || 0)), 0);

/** Reserva por peca a partir das pecas gravadas da OS. */
const mapaDaReservaDaOs = (pecas: unknown): Map<string, number> => {
  const mapa = new Map<string, number>();
  (Array.isArray(pecas) ? pecas : []).forEach((p: { id?: string; quantidade?: number }) => {
    if (p?.id) mapa.set(p.id, (mapa.get(p.id) || 0) + (Number(p.quantidade) || 0));
  });
  return mapa;
};

const OSForm: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams(); // Para modo Edição
  const isEditing = !!id;
  // Trava de edicao (fase 2, 16/10/2026): um documento aberto por vez.
  const trava = useTravaDeEdicao({ tipo: 'ordem_servico', registroId: id, ativa: isEditing });
  const podeLiberarTrava = usePodeLiberarTrava();
  
  const [formData, setFormData] = useState({
    clienteNome: '', clienteTelefone: '',
    placa: '', modelo: '', marca: '', ano: '', cor: '',
    renavam: '', quilometragem: '', combustivel: '',
    frota: '', serie: '', horimetro: '', tipoEquipamento: '',
    dataEntrada: getLocalDateInputValue(), dataSaida: '',
    horaEntrada: '', horaSaida: '',
    defeitoRelatado: '', relatorioTecnico: '',
    materiaisCliente: '', condicoesPagamento: '', observacoes: '',
    status: 'Orçamento Pendente', // Status padrão na criação
    numeroOS: '',
    estoqueBaixado: false,
    estoqueReservado: false,
    formaPagamento: 'Dinheiro',
    statusPagamento: 'Pendente',
    mecanicoId: '',
    mecanicoNome: '',
    orcamentoId: '',
  });
  const paymentDraftCounter = useRef(1);
  const submitLockRef = useRef(false);
  /** Como a OS abriu (fatia 3d): decide se salvar so' grava os dados, reabre ou refaz a cobranca. */
  const statusGravadoRef = useRef<string | null>(null);
  const estoqueBaixadoGravadoRef = useRef(false);
  /** Finalizada agora ou antes de ser reaberta: so' essa pode ter nota fiscal (a NF-e/NFS-e sai de OS finalizada). */
  const osJaFoiFinalizadaRef = useRef(false);
  const assinaturaCarregadaRef = useRef<string | null>(null);
  const rascunhosCarregadosRef = useRef<string | null>(null);
  /** Chave "Venda pelo servidor" (SuperAdmin): finalizar/reabrir/cancelar pelo servidor. */
  const [vendaPeloServidor, setVendaPeloServidor] = useState(false);
  const servicoNomeInputRef = useRef<HTMLInputElement>(null);
  const pecaNomeInputRef = useRef<HTMLInputElement | null>(null);
  const clienteInputRef = useRef<HTMLInputElement>(null);
  const pagamentoSectionRef = useRef<HTMLDivElement>(null);
  const statusSelectRef = useRef<HTMLSelectElement>(null);
  const pecaQtdLastRowRef = useRef<HTMLInputElement | null>(null);
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
  /** Configuracoes: obriga escolher a forma antes de finalizar -- ver
   *  DEFAULT_EXIGIR_ESCOLHA_FORMA_PAGAMENTO em financeDomain.ts. */
  const [exigirEscolhaFormaPagamento, setExigirEscolhaFormaPagamento] = useState(DEFAULT_EXIGIR_ESCOLHA_FORMA_PAGAMENTO);

  const [mecanicosDisponiveis, setMecanicosDisponiveis] = useState<{id: string, nome: string}[]>([]);
  /** Ultimo nivel da hierarquia de comissao (produto/servico > mecanico >
   * sistema) -- undefined quando a empresa nunca configurou nada aqui. Ver
   * resolveComissaoPercentual em financeDomain.ts. */
  const [comissaoPadraoPecas, setComissaoPadraoPecas] = useState<number | undefined>(undefined);
  const [comissaoPadraoServicos, setComissaoPadraoServicos] = useState<number | undefined>(undefined);

  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingOS, setIsFetchingOS] = useState(isEditing);
  // Decoupled de isFetchingOS (que so controla o spinner de tela cheia)
  // -- marca quando o carregamento inicial de verdade terminou (edicao
  // OU criacao, que tambem busca o proximo numero de OS de forma
  // assincrona), pra so entao capturar o snapshot que decide se a aba
  // esta "suja".
  const [formReady, setFormReady] = useState(false);
  const [veiculosDisponiveis, setVeiculosDisponiveis] = useState<VeiculoBasico[]>([]);
  const [veiculosDoCliente, setVeiculosDoCliente] = useState<VeiculoBasico[]>([]);
  const [isVeiculoDropdownOpen, setIsVeiculoDropdownOpen] = useState(false);
  
  const [servicosCatalogo, setServicosCatalogo] = useState<ServicoData[]>([]);
  const [servicoNomeInput, setServicoNomeInput] = useState('');
  const [servicoPrecoInput, setServicoPrecoInput] = useState('');
  const [servicosSelecionados, setServicosSelecionados] = useState<ServicoSelecionado[]>([]);

  const [pecasEstoque, setPecasEstoque] = useState<PecaData[]>([]);
  /**
   * Reserva que ESTA OS ja' segura gravada, por peca. Nao conta contra a
   * propria OS na conferencia do disponivel (reserva na venda, 13/10/2026).
   */
  const reservaPropriaRef = useRef<Map<string, number>>(new Map());
  const [pecaNomeInput, setPecaNomeInput] = useState('');
  const [pecaPrecoInput, setPecaPrecoInput] = useState('');
  const [isPecaSearchModalOpen, setIsPecaSearchModalOpen] = useState(false);
  const [pecasSelecionadas, setPecasSelecionadas] = useState<PecaSelecionada[]>([]);
  const [permitirVendaSemEstoque, setPermitirVendaSemEstoque] = useState(false);
  const [formasPrecoAVista, setFormasPrecoAVista] = useState<string[]>(FORMAS_A_VISTA_PADRAO);
  const [pecaSearchMode, setPecaSearchMode] = useState<ProductSearchMode>(DEFAULT_PRODUCT_SEARCH_MODE);
  const [momentoBaixaEstoque, setMomentoBaixaEstoque] = useState<MomentoBaixaEstoque>(DEFAULT_MOMENTO_BAIXA_ESTOQUE);
  const [descontoInput, setDescontoInput] = useState<DescontoInputValue>({ tipo: 'valor', valor: '' });
  const [limiteDescontoOS, setLimiteDescontoOS] = useState<LimiteDescontoConfig | null>(null);
  /** Ordem/visibilidade das formas de pagamento e o botao de dividir, vindos
   *  de Configuracoes. Enquanto a config nao carrega valem os padroes -- a
   *  tela nunca fica sem forma de pagamento. */
  const [ordemFormasPagamento, setOrdemFormasPagamento] = useState<string[]>([]);
  const [formasPagamentoOcultas, setFormasPagamentoOcultas] = useState<string[]>([]);
  const [permitirDividirPagamento, setPermitirDividirPagamento] = useState(DEFAULT_PERMITIR_DIVIDIR_PAGAMENTO);
  const formasConfiguradas = formasDaEmpresa(ordemFormasPagamento, formasPagamentoOcultas);
  const [modoLimiteDesconto, setModoLimiteDesconto] = useState<ModoLimiteDesconto>('avisar');
  const [tipoDescontoPadrao, setTipoDescontoPadrao] = useState<DescontoTipo>(DEFAULT_TIPO_DESCONTO_PADRAO);

  // O tipo padrao vem da configuracao da empresa, que carrega DEPOIS do
  // primeiro render -- entao o campo abre em R$ e so aqui muda pro que a
  // empresa escolheu. So mexe no campo AINDA VAZIO: desconto ja digitado (ou
  // carregado de um documento salvo) mantem o tipo que tem, senao trocar a
  // configuracao reescreveria um desconto que alguem ja lancou.
  useEffect(() => {
    setDescontoInput((atual) => (atual.valor === '' ? descontoInicial(tipoDescontoPadrao) : atual));
  }, [tipoDescontoPadrao]);

  const [modoValidacaoCliente, setModoValidacaoCliente] = useState<ModoValidacaoCliente>(DEFAULT_MODO_VALIDACAO_CLIENTE);
  const [trabalhaComLimiteCredito, setTrabalhaComLimiteCredito] = useState(false);
  // Parametros de venda da filial (fase A, 2026-10-07): bloqueio por atraso.
  const [parametrosVenda, setParametrosVenda] = useState<ParametrosVenda>(PARAMETROS_VENDA_PADRAO);
  // Oficina de maquinas pesadas (fase 1, 2026-10-07): rotulos, identificacao do
  // equipamento e deslocamento com preco por km. Ver oficinaDomain.ts.
  const { modo: modoOficina, rotulos, configMaquinas } = useModoOficina();
  const [deslocamento, setDeslocamento] = useState<Deslocamento>(DESLOCAMENTO_VAZIO);
  // Atendimento feito pelo app do tecnico (fase 3): fotos e assinatura so' se consultam aqui.
  const [atendimentoCampo, setAtendimentoCampo] = useState<{ fotos: FotoOS[]; assinatura: AssinaturaOS | null } | null>(null);
  const [frotaEmpresa, setFrotaEmpresa] = useState<Array<{ id: string; nome: string }>>([]);
  /** Edita o deslocamento e refaz a linha de servico "Deslocamento -- N km" (idempotente). */
  const atualizarDeslocamento = (parte: Partial<Deslocamento>) => {
    const novo = { ...deslocamento, ...parte };
    setDeslocamento(novo);
    setServicosSelecionados((servicos) => aplicarDeslocamentoNosServicos(servicos, kmDoDeslocamento(novo), configMaquinas));
  };
  const [cadastroRapidoAberto, setCadastroRapidoAberto] = useState(false);
  const [showAprovacaoDesconto, setShowAprovacaoDesconto] = useState(false);
  const [aprovacaoDesconto, setAprovacaoDesconto] = useState<AprovacaoDesconto | null>(null);

  const { currentUser, tenantId, userRole, userPermissions, isOwner, loteModoSaida, loteAvisarVencido, grupo } = useAuth();
  // Veiculos da empresa (colecao frota) para o deslocamento -- so no modo maquinas.
  useEffect(() => {
    if (!tenantId || modoOficina !== 'maquinas_pesadas') return;
    getDocs(query(collection(db, 'frota'), where('tenantId', '==', tenantId)))
      .then((snap) => setFrotaEmpresa(snap.docs
        .filter((d) => d.data().ativo !== false)
        .map((d) => ({ id: d.id, nome: [d.data().placa, d.data().modelo].filter(Boolean).join(' - ') || d.id }))
        .sort((a, b) => a.nome.localeCompare(b.nome))))
      .catch(() => setFrotaEmpresa([]));
  }, [tenantId, modoOficina]);
  const canVerAuditoria = hasModuleAccess({ role: userRole, isOwner, permissions: userPermissions, requiredPermission: 'administrativo.logs' });
  const [auditoriaAberta, setAuditoriaAberta] = useState(false);
  const { items: bandeirasCartao } = useTenantCollection<BandeiraCartao>('bandeiras_cartao', tenantId);
  const { items: clientesDisponiveis } = useTenantCollection<ClienteBasico>('clientes', tenantId);
  const { items: bancosDisponiveis } = useTenantCollection<Banco>('bancos', tenantId);
  const cardFeeSchedulesByBrand = buildCardFeeSchedulesByBrand(bandeirasCartao);
  const [pagamentoCartaoSimplificadoAtivo, setPagamentoCartaoSimplificadoAtivo] = useState(false);
  const bancoPadraoSimplificado = resolveBancoPadraoSimplificado(bancosDisponiveis);

  const [isServicoDropdownOpen, setIsServicoDropdownOpen] = useState(false);
  const servicoDropdownRef = useRef<HTMLDivElement>(null);

  useEscapeLayer(isServicoDropdownOpen, () => setIsServicoDropdownOpen(false));
  useEscapeLayer(isVeiculoDropdownOpen, () => setIsVeiculoDropdownOpen(false));

  useEffect(() => {
    const isConsumidorFinal = formData.clienteNome.toLowerCase().includes('consumidor final');
    if (!isConsumidorFinal) return;
    // OS ja' finalizada: o pagamento gravado e' o que vale (trocar aqui refaria a cobranca ao salvar).
    if (statusGravadoRef.current === STATUS_OS_FINALIZADA) return;

    setPaymentDrafts((current) => current.map((payment) => (
      payment.forma === 'Dinheiro' || payment.forma === 'Pix'
        ? payment
        : { ...payment, forma: 'Dinheiro', parcelas: '1', dataVencimento: '' }
    )));
  }, [formData.clienteNome]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (servicoDropdownRef.current && !servicoDropdownRef.current.contains(event.target as Node)) {
        setIsServicoDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const fetchInitialData = async () => {
      if (!currentUser || !tenantId) return;


      // Fetch Veículos
      const qV = query(collection(db, 'veiculos'), where('tenantId', '==', tenantId));
      const snapV = await getDocs(qV);
      const dataV: VeiculoBasico[] = [];
      snapV.forEach((doc) => dataV.push({
        id: doc.id,
        // Campos opcionais no cadastro de veiculo (Ano, Cor) podem faltar no
        // documento -- sem o fallback, o autofill da OS copiava undefined
        // pro formData e o Firestore recusava o save inteiro na hora de
        // gravar a OS (regra 3 do CLAUDE.md: nunca gravar undefined).
        placa: doc.data().placa || '',
        modelo: doc.data().modelo || '',
        marca: doc.data().marca || '',
        ano: doc.data().ano || '',
        cor: doc.data().cor || '',
        kmAtual: Number(doc.data().kmAtual || 0),
        frota: doc.data().frota || '',
        serie: doc.data().serie || '',
        horimetro: Number(doc.data().horimetro || 0),
        tipoEquipamento: doc.data().tipoEquipamento || '',
        renavam: doc.data().renavam || '',
        combustivel: doc.data().combustivel || '',
        clienteId: doc.data().clienteId || '',
      }));
      setVeiculosDisponiveis(dataV);

      // Fetch Serviços
      const qS = query(collection(db, 'servicos'), where('tenantId', '==', tenantId));
      const snapS = await getDocs(qS);
      const dataS: ServicoData[] = [];
      snapS.forEach((doc) => {
        const dataDoc = doc.data();
        dataS.push({
          id: doc.id,
          nome: dataDoc.nome,
          preco: dataDoc.preco,
          // Comissao propria do servico e' opcional -- maioria nao tem.
          // handleAddServico espalha este objeto inteiro (`...servico`) pro
          // item selecionado, que vai direto pro Firestore em osData.servicos;
          // chave com valor undefined quebrava o save (regra 3 do CLAUDE.md).
          ...(dataDoc.comissaoPercentual !== undefined ? { comissaoPercentual: dataDoc.comissaoPercentual } : {}),
        });
      });
      setServicosCatalogo(dataS);

      // Fetch Estoque
      const qE = query(collection(db, 'estoque'), where('tenantId', '==', tenantId));
      const snapE = await getDocs(qE);
      const dataE: PecaData[] = [];
      snapE.forEach((doc) => {
        // produtoRevenda === false = item de uso interno (peca de veiculo,
        // embalagem, insumo a granel...) -- nunca entra em OS, so continua
        // no controle de estoque.
        if (doc.data().produtoRevenda === false) return;
        dataE.push({
          id: doc.id,
          nome: doc.data().nome,
          precoVenda: doc.data().precoVenda,
          precoAVista: Number(doc.data().precoAVista ?? 0),
          quantidade: doc.data().quantidade || 0,
          quantidadeReservada: Number(doc.data().quantidadeReservada || 0),
          filialOrigem: doc.data().filialOrigem || '',
          codigo: doc.data().codigo || '',
          codigoBarras: doc.data().codigoBarras || '',
          // De proposito CRU aqui, sem cair no fallback 'UN': e' em
          // handleAddPeca que o item ganha a unidade padrao, e la ainda
          // precisamos saber se ela veio do cadastro ou do fallback pra
          // avisar o usuario. Ver unidadeMedidaDomain.ts.
          unidadeMedidaSigla: doc.data().unidadeMedidaSigla,
          unidadeMedidaFracionado: doc.data().unidadeMedidaFracionado,
          unidadeMedidaCasasDecimais: doc.data().unidadeMedidaCasasDecimais,
          comissaoPercentual: doc.data().comissaoPercentual,
          ativo: doc.data().ativo ?? doc.data().statusAtivo ?? true,
          temGrade: doc.data().temGrade === true,
          bloquearVendaSemEstoque: doc.data().bloquearVendaSemEstoque === true,
        });
      });
      setPecasEstoque(dataE);

      // Fetch Configurações
      // Forma com que um pagamento sem forma gravada abre (ver formaInicialConfigurada).
      let formaInicialDaEmpresa: PaymentMethod | '' = 'Dinheiro';
      try {
        const configRef = doc(db, 'configuracoes', tenantId);
        const configSnap = await getDoc(configRef);
        if (configSnap.exists()) {
          const config = configSnap.data();
          setPermitirVendaSemEstoque(config.venderSemEstoque === true);
          setVendaPeloServidor(parseVendaPeloServidor(config.vendaPeloServidor));
          setFormasPrecoAVista(parseFormasAVista(config.formasPrecoAVista));
          setPagamentoCartaoSimplificadoAtivo(parsePagamentoCartaoSimplificadoAtivo(config.pagamentoCartaoSimplificadoAtivo));
          setPecaSearchMode(config.buscaProdutoModo === 'exata' ? 'exata' : DEFAULT_PRODUCT_SEARCH_MODE);
          setMomentoBaixaEstoque((config.momentoBaixaEstoque ?? DEFAULT_MOMENTO_BAIXA_ESTOQUE) as MomentoBaixaEstoque);
          setLimiteDescontoOS(parseLimiteDescontoConfig(config.limiteDescontoOS));
          setOrdemFormasPagamento(parseOrdemFormasPagamento(config.ordemFormasPagamento));
          setFormasPagamentoOcultas(parseFormasOcultas(config.formasPagamentoOcultas));
          setPermitirDividirPagamento(parsePermitirDividirPagamento(config.permitirDividirPagamento));
          setModoLimiteDesconto(parseModoLimiteDesconto(config.modoLimiteDesconto));
          setTipoDescontoPadrao(parseTipoDescontoPadrao(config.tipoDescontoPadrao));
          setModoValidacaoCliente(parseModoValidacaoCliente(config.modoValidacaoCliente));
          setTrabalhaComLimiteCredito(parseTrabalhaComLimiteCredito(config.trabalhaComLimiteCredito));
          setParametrosVenda(parseParametrosVenda(config.parametrosVenda));
          setComissaoPadraoPecas(typeof config.comissaoPadraoPecas === 'number' ? config.comissaoPadraoPecas : undefined);
          setComissaoPadraoServicos(typeof config.comissaoPadraoServicos === 'number' ? config.comissaoPadraoServicos : undefined);
          const configuredTerms = parseCreditTerms(config.diasCrediario);
          const defaultTermDays = configuredTerms[0] || 30;
          const creditSettlementDays = config.prazoRecebimentoCartaoCreditoDias ?? 30;
          const debitSettlementDays = config.prazoRecebimentoCartaoDebitoDias ?? 1;
          setExigirEscolhaFormaPagamento(parseExigirEscolhaFormaPagamento(config.exigirEscolhaFormaPagamento));
          formaInicialDaEmpresa = formaInicialConfigurada(
            parseExigirEscolhaFormaPagamento(config.exigirEscolhaFormaPagamento),
            formasDaEmpresa(parseOrdemFormasPagamento(config.ordemFormasPagamento), parseFormasOcultas(config.formasPagamentoOcultas)),
          );
          // A config chega DEPOIS do primeiro render, entao o rascunho ja
          // nasceu em Dinheiro. Troca aqui -- e so em documento NOVO: numa
          // edicao os pagamentos vem do que foi gravado, e apagar um Dinheiro
          // de verdade seria reescrever a venda de alguem.
          if (!isEditing && formaInicialDaEmpresa !== 'Dinheiro') {
            const forma = formaInicialDaEmpresa;
            setPaymentDrafts((atuais) => atuais.map((rascunho) => (
              rascunho.forma === 'Dinheiro' ? { ...rascunho, forma } : rascunho
            )));
          }
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

      // Fetch Mecânicos (agora todos os usuários do tenant)
      const qM = query(collection(db, 'usuarios'), where('tenantId', '==', tenantId));
      const snapM = await getDocs(qM);
      const dataM: {id: string, nome: string}[] = [];
      // Vendedor de balcao (cadastro sem login) fica de fora: ele existe pro
      // fluxo de identificacao por codigo+senha na venda, nao pra assumir
      // uma OS. Ver src/utils/vendedorCadastroDomain.ts.
      snapM.forEach((doc) => {
        if (isRegistroDeVendedor(doc.data())) return;
        dataM.push({ id: doc.id, nome: doc.data().nome || doc.data().nomeResponsavel || 'Administrador' });
      });
      setMecanicosDisponiveis(dataM);

      // Fetch OS se for Edição
      if (isEditing && id) {
        try {
          const docRef = doc(db, 'ordens_de_servico', id);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const os = docSnap.data();
            setFormData({
              clienteNome: os.clienteNome || '',
              clienteTelefone: os.clienteTelefone || '',
              placa: os.placa || '',
              modelo: os.modelo || '',
              marca: os.marca || '',
              ano: os.ano || '',
              cor: os.cor || '',
              renavam: os.renavam || '',
              quilometragem: os.quilometragem ? String(os.quilometragem) : '',
              frota: os.frota || '',
              serie: os.serie || '',
              horimetro: os.horimetro ? String(os.horimetro) : '',
              tipoEquipamento: os.tipoEquipamento || '',
              combustivel: os.combustivel || '',
              dataEntrada: os.dataEntrada || (os.createdAt?.toDate ? getLocalDateInputValue(os.createdAt.toDate()) : ''),
              dataSaida: os.dataSaida || '',
              horaEntrada: os.horaEntrada || '',
              horaSaida: os.horaSaida || '',
              defeitoRelatado: os.defeitoRelatado || '',
              relatorioTecnico: os.relatorioTecnico || '',
              materiaisCliente: os.materiaisCliente || '',
              condicoesPagamento: os.condicoesPagamento || '',
              observacoes: os.observacoes || '',
              status: os.status || 'Orçamento Pendente',
              numeroOS: os.numeroOS || '',
              estoqueBaixado: os.estoqueBaixado || false,
              estoqueReservado: os.estoqueReservado || false,
              formaPagamento: os.formaPagamento || 'Dinheiro',
              statusPagamento: os.statusPagamento || 'Pendente',
              mecanicoId: os.mecanicoId || '',
              mecanicoNome: os.mecanicoNome || '',
              orcamentoId: os.orcamentoId || '',
            });
            setServicosSelecionados(os.servicos || []);
            setDeslocamento(parseDeslocamento(os.deslocamento));
            setAtendimentoCampo({ fotos: Array.isArray(os.fotos) ? os.fotos : [], assinatura: os.assinaturaCliente || null });
            if (osEmAtendimentoNoCampo(os.status)) showWarning('OS em atendimento no campo', AVISO_OS_EM_ATENDIMENTO_NO_CAMPO);
            // OS antiga pode ter peca gravada sem unidade (documento salvo
            // antes da feature existir): completa com 'UN' na carga, pra
            // ficar consistente com o que o catalogo devolve hoje.
            reservaPropriaRef.current = os.estoqueReservado === true ? mapaDaReservaDaOs(os.pecas) : new Map();
            setPecasSelecionadas((os.pecas || []).map((peca: PecaSelecionada) => ({
              ...peca,
              ...resolveUnidadeMedidaProduto(peca),
            })));
            // O desconto ERA gravado (campo `desconto` la embaixo), mas nunca
            // voltava pro formulario ao reabrir a OS. Dois estragos: parecia
            // que nao tinha salvado, e -- pior -- salvar de novo (so pra mudar
            // o status, por exemplo) regravava com o campo vazio, apagando o
            // desconto e devolvendo o valorTotal cheio. Mesmo carregamento que
            // OrcamentoForm.tsx ja fazia.
            if (os.desconto) {
              setDescontoInput({
                tipo: os.desconto.tipo === 'percentual' ? 'percentual' : 'valor',
                valor: Number(os.desconto.valorInformado) > 0 ? String(os.desconto.valorInformado) : '',
              });
            }
            statusGravadoRef.current = os.status || 'Orçamento Pendente';
            estoqueBaixadoGravadoRef.current = os.estoqueBaixado === true;
            osJaFoiFinalizadaRef.current = os.status === STATUS_OS_FINALIZADA || Boolean(os.reabertaEm) || (Array.isArray(os.pagamentos) && os.pagamentos.length > 0);
            assinaturaCarregadaRef.current = assinaturaDaCobrancaDaOs(os);
            if (Array.isArray(os.pagamentos) && os.pagamentos.length > 0) {
              const rascunhos: PaymentDraft[] = os.pagamentos.map((payment: PaymentRecord, index: number) => ({
                id: payment.id || `pagamento-${index + 1}`,
                forma: payment.formaPagamento || 'Outros',
                valor: fromCents(Number(payment.valorCentavos ?? toCents(payment.valor))).toFixed(2),
                prazoDias: String(payment.prazoDias || ''),
                dataVencimento: payment.dataVencimento || '',
                bandeira: payment.cartao?.bandeira || '',
                operadora: payment.cartao?.operadora || '',
                autorizacao: payment.cartao?.autorizacao || '',
                parcelas: String(payment.cartao?.parcelas || 1),
                parcelasAPrazo: '1',
                dataPrevistaRecebimento: payment.dataPrevistaRecebimento || payment.cartao?.dataPrevistaRecebimento || payment.cheque?.dataCompensacao || '',
                bancoId: payment.bancoId || '',
                bancoNome: payment.bancoNome || '',
                chequeBancoEmissor: payment.cheque?.bancoEmissor || '',
                chequeAgencia: payment.cheque?.agencia || '',
                chequeTitular: payment.cheque?.titular || '',
                chequeEmitente: payment.cheque?.emitente || '',
                chequeDocumentoEmitente: payment.cheque?.documentoEmitente || '',
                chequeNumero: payment.cheque?.numeroCheque || '',
              }));
              setPaymentDrafts(rascunhos);
              rascunhosCarregadosRef.current = JSON.stringify(rascunhos);
              paymentDraftCounter.current = os.pagamentos.length;
            } else {
              // OS em aberto e' gravada sem forma de pagamento: abre como um
              // pagamento novo, conforme Configuracoes.
              const rascunhos: PaymentDraft[] = [{
                ...createEmptyPaymentDraft('pagamento-1', toCents(os.valorTotal || 0)),
                forma: formaDoDocumentoSemPagamentos(os.formaPagamento, formaInicialDaEmpresa),
              }];
              setPaymentDrafts(rascunhos);
              rascunhosCarregadosRef.current = JSON.stringify(rascunhos);
            }
          } else {
            showError('Erro', 'OS não encontrada.');
            navigate('/os');
          }
        } catch (error) {
          console.error("Erro ao carregar OS:", error);
        } finally {
          setIsFetchingOS(false);
          setFormReady(true);
        }
      } else {
        // Pre-fill mecanicoId with current user
        const loggedInUser = dataM.find(u => u.id === currentUser.uid);
        setFormData(prev => ({
          ...prev,
          mecanicoId: currentUser.uid,
          mecanicoNome: loggedInUser?.nome || 'Administrador'
        }));

        try {
          const qLast = query(collection(db, 'ordens_de_servico'), where('tenantId', '==', tenantId), orderBy('numeroOS', 'desc'), limit(1));
          const snapOS = await getDocs(qLast);
          let nextOsNum = '01';
          if (!snapOS.empty) {
            const lastNum = parseInt(snapOS.docs[0].data().numeroOS) || 0;
            nextOsNum = String(lastNum + 1).padStart(2, '0');
          }
          
          const currentUserObj = dataM.find(m => m.id === currentUser.uid);
          const defaultNome = currentUserObj ? currentUserObj.nome : (currentUser.displayName || '');
          
          setFormData(prev => ({ 
            ...prev, 
            numeroOS: nextOsNum,
            mecanicoId: currentUser.uid,
            mecanicoNome: defaultNome
          }));
        } catch (err) {
          console.error("Erro ao buscar sequencia de OS", err);
          // Fallback para contagem simples se falhar
          const snapCount = await getCountFromServer(query(collection(db, 'ordens_de_servico'), where('tenantId', '==', tenantId)));
          const fallbackNum = String(snapCount.data().count + 1).padStart(2, '0');
          
          const currentUserObj = dataM.find(m => m.id === currentUser.uid);
          const defaultNome = currentUserObj ? currentUserObj.nome : (currentUser.displayName || '');
          
          setFormData(prev => ({ 
            ...prev, 
            numeroOS: fallbackNum,
            mecanicoId: currentUser.uid,
            mecanicoNome: defaultNome
          }));
        }
        setIsFetchingOS(false);
        setFormReady(true);
      }
    };
    fetchInitialData();
  }, [id, isEditing, navigate, currentUser, tenantId]);

  // Snapshot dos campos de negocio (formData + pagamentos + servicos +
  // pecas), reaproveitado tanto pro snapshot inicial quanto pro atual --
  // evita falso-positivo de "sujo" por ordem de chave diferente no
  // JSON.stringify. Estado so-de-UI (busca, dropdown aberto, input de
  // preco/nome do item sendo adicionado) fica de fora de proposito.
  const buildDirtySnapshot = () => JSON.stringify({ formData, paymentDrafts, servicosSelecionados, pecasSelecionadas });
  const initialSnapshotRef = useRef<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  useEffect(() => {
    if (!formReady) return;
    if (initialSnapshotRef.current === null) {
      initialSnapshotRef.current = buildDirtySnapshot();
      setIsDirty(false);
    } else {
      setIsDirty(buildDirtySnapshot() !== initialSnapshotRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formReady, formData, paymentDrafts, servicosSelecionados, pecasSelecionadas]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name } = e.target;
    // Caixa alta na digitacao: o que se ve e o que se grava.
    // textarea, select, e-mail, senha e chave ficam de fora --
    // ver aplicarCaixaAltaCadastro.
    const value = aplicarCaixaAltaCadastro(e.target, e.target.value);
    if (name === 'mecanicoId') {
      const mecEncontrado = mecanicosDisponiveis.find(m => m.id === value);
      setFormData({ ...formData, mecanicoId: value, mecanicoNome: mecEncontrado ? mecEncontrado.nome : '' });
      return;
    }
    if (name === 'status') {
      setFormData({
        ...formData,
        status: value,
        dataSaida: value === 'Finalizada' && !formData.dataSaida
          ? getDateInputInTimeZone()
          : formData.dataSaida,
      });
      return;
    }
    setFormData({ ...formData, [name]: value });
  };

  const handleClearServicoInput = () => {
    setServicoNomeInput('');
    setServicoPrecoInput('');
    setIsServicoDropdownOpen(false);
  };

  const handleClearPecaInput = () => {
    setPecaNomeInput('');
    setPecaPrecoInput('');
  };

  const handleAddServico = async () => {
    if (!servicoNomeInput || !servicoPrecoInput) return;
    const precoNum = parseFloat(servicoPrecoInput.replace(',', '.'));
    
    let servico = servicosCatalogo.find(s => s.nome.toLowerCase() === servicoNomeInput.toLowerCase());
    
    if (!servico && currentUser) {
      setIsLoading(true);
      try {
        const q = query(collection(db, 'servicos'), where('tenantId', '==', tenantId));
        const snap = await getCountFromServer(q);
        const nextId = snap.data().count + 1;
        
        const newRef = await addDoc(collection(db, 'servicos'), {
          codigo: String(nextId),
          nome: servicoNomeInput,
          preco: precoNum,
          categoria: 'Geral',
          tenantId,
          createdAt: serverTimestamp(),
          ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
        });
        servico = { id: newRef.id, nome: servicoNomeInput, preco: precoNum };
        setServicosCatalogo([...servicosCatalogo, servico]);
        showSuccess('Serviço cadastrado no catálogo!');
      } catch {
        showError('Erro', 'Não foi possível cadastrar o serviço.');
      } finally {
        setIsLoading(false);
      }
    }
    
    if (servico) {
      setServicosSelecionados([
        ...servicosSelecionados,
        { ...servico, preco: precoNum, quantidade: 1, detalhamento: '', tempoHoras: 1 }
      ]);
      setServicoNomeInput('');
      setServicoPrecoInput('');
      servicoNomeInputRef.current?.focus();
    }
  };

  const handleRemoveServico = (index: number) => {
    const novos = [...servicosSelecionados];
    novos.splice(index, 1);
    setServicosSelecionados(novos);
  };

  const updatePrecoServico = (index: number, preco: number) => {
    const novos = [...servicosSelecionados];
    novos[index].preco = Math.max(0, preco);
    setServicosSelecionados(novos);
  };

  const updateDetalhamentoServico = (index: number, detalhamento: string) => {
    const novos = [...servicosSelecionados];
    novos[index].detalhamento = detalhamento;
    setServicosSelecionados(novos);
  };

  const updateTempoServico = (index: number, tempoHoras: number) => {
    const novos = [...servicosSelecionados];
    novos[index].tempoHoras = Math.max(0, tempoHoras);
    setServicosSelecionados(novos);
  };

  // Mesma checagem de bloquear/perguntar que ja rodava so no Salvar (ver
  // handleSubmit) -- disparada tambem ao sair do campo, pra nao deixar o
  // usuario preencher a OS inteira antes de descobrir que o cliente
  // digitado nao esta cadastrado.
  const handleClienteBlur = () => {
    const nomeDigitado = formData.clienteNome.trim();
    if (!nomeDigitado) return;
    const clienteEncontrado = clientesDisponiveis.some(c => c.nome.toUpperCase() === nomeDigitado.toUpperCase());
    const acao = resolverAcaoValidacaoCliente(modoValidacaoCliente, clienteEncontrado, nomeDigitado);
    if (acao.tipo === 'bloquear') {
      showError('Cliente não cadastrado', acao.motivo);
    } else if (acao.tipo === 'perguntar') {
      NexusSwal.fire({
        title: 'Cliente não cadastrado',
        text: `"${nomeDigitado.toUpperCase()}" ainda não tem cadastro. Deseja cadastrar agora?`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Cadastrar cliente',
        cancelButtonText: 'Cancelar',
      }).then((result) => {
        if (result.isConfirmed) setCadastroRapidoAberto(true);
      });
    }
  };

  // Promocoes e preco a vista na OS (2026-10-06), a mesma tabela do Pedido de
  // Venda: a condicao vem do pagamento escolhido (a prazo por padrao) e, quando
  // ela muda, as pecas com preco automatico sao recalculadas -- avisando.
  const condicaoPagamento = useMemo(() => condicaoDoPagamento(paymentDrafts, formasPrecoAVista), [paymentDrafts, formasPrecoAVista]);
  const { tabelaDe, promocoes, hoje: hojeParaPromocao, vendidoPorPromocao } = usePromocoesVigentes(tenantId, id);
  const pecasSelecionadasRef = useRef(pecasSelecionadas);
  useEffect(() => { pecasSelecionadasRef.current = pecasSelecionadas; }, [pecasSelecionadas]);
  useEffect(() => {
    let alterados = 0;
    const novas = pecasSelecionadasRef.current.map((peca) => {
      if (!peca.tabelaPreco || peca.origemPreco === 'manual') return peca;
      const auto = precoAutomatico(peca.tabelaPreco, condicaoPagamento);
      if (Math.abs(auto.preco - peca.preco) < 0.0001 && auto.origem === peca.origemPreco) return peca;
      alterados += 1;
      const nova: PecaSelecionada = { ...peca, preco: auto.preco, origemPreco: auto.origem };
      delete nova.promocaoId;
      delete nova.promocaoNome;
      if (auto.origem === 'promocao' && peca.tabelaPreco.promocao) {
        nova.promocaoId = peca.tabelaPreco.promocao.id;
        nova.promocaoNome = peca.tabelaPreco.promocao.nome;
      }
      return nova;
    });
    if (alterados > 0) {
      setPecasSelecionadas(novas);
      showWarning('Preço das peças recalculado', `${alterados} peça(s) mudaram de preço porque o pagamento ficou ${ROTULO_CONDICAO[condicaoPagamento]}.`);
    }
  }, [condicaoPagamento]);

  const handleAddPeca = async () => {
    if (!pecaNomeInput || !pecaPrecoInput) return;
    const precoNum = parseFloat(pecaPrecoInput.replace(',', '.'));
    
    let peca = pecasEstoque.find(p => p.nome.toLowerCase() === pecaNomeInput.toLowerCase());
    
    if (!peca && currentUser) {
      setIsLoading(true);
      try {
        const nextId = await getProximoCodigoProduto(tenantId || '');

        const newRef = await addDoc(collection(db, 'estoque'), {
          codigo: nextId,
          nome: pecaNomeInput,
          precoVenda: precoNum,
          categoria: 'Peças Adicionais',
          quantidade: 10, // Base default para não zerar logo de cara
          // Cadastro rapido nao pergunta unidade -- grava o padrao 'UN', o
          // mesmo que EstoqueForm.tsx grava quando nenhuma e' escolhida.
          // Sem isso o produto nascia sem os campos de unidade.
          ...UNIDADE_MEDIDA_FALLBACK,
          tenantId,
          createdAt: serverTimestamp(),
          ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
        });
        // Nasce ja com 'UN' -- igual ao que acabou de ser gravado no
        // estoque. Assim nao dispara o aviso de "sem unidade": nao e'
        // cadastro furado, e' o padrao aplicado na criacao.
        peca = { id: newRef.id, nome: pecaNomeInput, precoVenda: precoNum, ...UNIDADE_MEDIDA_FALLBACK };
        setPecasEstoque([...pecasEstoque, peca]);
        showSuccess('Peça adicionada ao estoque!');
      } catch {
        showError('Erro', 'Não foi possível cadastrar a peça no estoque.');
      } finally {
        setIsLoading(false);
      }
    }
    
    if (peca) {
      // Reserva na venda (13/10/2026): conta o que a OS ja' tem desta peca e
      // o que esta reservado em outros documentos.
      const reserva = conferirSaidaComReserva({
        tenantId,
        produto: peca,
        pedida: 1 + quantidadeDaPecaNaOs(pecasSelecionadas, peca.id),
        reservadoPeloDocumento: reservaPropriaRef.current.get(peca.id) || 0,
        documentoAtualId: id,
        permiteVendaSemEstoque: permitirVendaSemEstoque,
      });
      if (reserva === false) return;
      if (reserva === 'sem_estoque') {
        showError('Estoque Insuficiente', `A peça ${peca.nome} está sem estoque. Venda sem estoque desativada.`);
        return;
      }
      // Peca de cadastro antigo pode nao ter unidade nenhuma. Ela entra com
      // a unidade padrao 'UN' e o usuario e' avisado na hora, em portugues,
      // pra conseguir corrigir o cadastro sozinho -- sem ligar pro suporte
      // e sem a OS travar. Regra completa em unidadeMedidaDomain.ts.
      if (!temUnidadeMedidaCadastrada(peca)) {
        const aviso = avisoUnidadeMedidaAusente(peca.nome);
        showWarning(aviso.title, aviso.text);
      }
      // Preco digitado igual ao da tabela = automatico (com promocao, se houver); diferente = manual.
      const precificacao = camposDePrecoDoItem(tabelaDe(peca), condicaoPagamento, precoNum);
      setPecasSelecionadas([...pecasSelecionadas, {
        id: peca.id,
        nome: peca.nome,
        preco: precificacao.preco,
        quantidade: 1,
        ...resolveUnidadeMedidaProduto(peca),
        ...precificacao.campos,
      }]);
      setPecaNomeInput('');
      setPecaPrecoInput('');
      pecaNomeInputRef.current?.focus();
    }
  };

  const handleRemovePeca = (index: number) => {
    const novas = [...pecasSelecionadas];
    novas.splice(index, 1);
    setPecasSelecionadas(novas);
  };

  const updateQuantidadePeca = (index: number, qtd: number) => {
    const novas = [...pecasSelecionadas];
    const peca = novas[index];

    if (!isValidSaleQuantity(qtd, peca.unidadeMedidaFracionado, peca.unidadeMedidaCasasDecimais)) {
      showError('Operação Bloqueada', peca.unidadeMedidaFracionado
        ? `A quantidade de ${peca.nome} aceita no máximo ${peca.unidadeMedidaCasasDecimais ?? 0} casa(s) decimal(is), conforme a unidade ${peca.unidadeMedidaSigla || 'UN'}.`
        : `A peça ${peca.nome} está configurada na unidade ${peca.unidadeMedidaSigla || 'UN'}, que NÃO permite venda fracionada. Utilize uma quantidade inteira.`);
      return;
    }

    const pecaEstoque = pecasEstoque.find(p => p.id === peca.id);
    if (pecaEstoque) {
      const reserva = conferirSaidaComReserva({
        tenantId,
        produto: pecaEstoque,
        pedida: qtd + quantidadeDaPecaNaOs(pecasSelecionadas, peca.id, index),
        reservadoPeloDocumento: reservaPropriaRef.current.get(peca.id) || 0,
        documentoAtualId: id,
        permiteVendaSemEstoque: permitirVendaSemEstoque,
      });
      if (reserva === false) return;
      if (reserva === 'sem_estoque') {
        showError('Estoque Insuficiente', `Você tem apenas ${pecaEstoque.quantidade || 0} un. no estoque.`);
        return;
      }
    }

    novas[index].quantidade = qtd;
    setPecasSelecionadas(novas);
  };

  const updatePrecoPeca = (index: number, preco: number) => {
    const novas = [...pecasSelecionadas];
    novas[index].preco = Math.max(0, preco);
    setPecasSelecionadas(novas);
  };

  const focusPagamentoSection = () => {
    if (formData.status === 'Finalizada') {
      pagamentoSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      pagamentoSectionRef.current?.querySelector<HTMLElement>('input, select, button')?.focus();
    } else {
      statusSelectRef.current?.focus();
    }
  };

  useKeyboardShortcuts([
    { key: 'F2', handler: () => clienteInputRef.current?.focus() },
    { key: 'F3', handler: () => pecaNomeInputRef.current?.focus() },
    { key: 'F8', handler: () => servicoNomeInputRef.current?.focus() },
    { key: 'F5', handler: () => pecaQtdLastRowRef.current?.focus() },
    { key: 'F6', handler: focusPagamentoSection },
    { key: 'F7', handler: focusPagamentoSection },
  ]);

  const totalServicos = servicosSelecionados.reduce((acc, curr) => acc + getServiceTotal(curr), 0);
  const totalPecas = pecasSelecionadas.reduce((acc, curr) => acc + (curr.preco * curr.quantidade), 0);
  const subtotalOS = totalServicos + totalPecas;
  const subtotalOSCentavos = toCents(subtotalOS);
  const descontoCents = calcularDescontoCents(descontoInput.tipo, descontoInput.valor, subtotalOSCentavos);
  const desconto = fromCents(descontoCents);
  const totalOS = Math.max(0, subtotalOS - desconto);
  const totalOSCentavos = toCents(totalOS);
  /**
   * DESCONTO PADRAO DO CLIENTE (2026-09-21) -- ate esse percentual o desconto
   * passa direto, sem avisar nem pedir senha (autorizacao dada no cadastro).
   * Ver descontoDomain.ts.
   */
  const [descontoDoCliente, setDescontoDoCliente] = useState(0);
  useEffect(() => {
    const nome = String(formData.clienteNome || '').trim().toUpperCase();
    if (!nome) { setDescontoDoCliente(0); return; }
    const cliente = clientesDisponiveis.find((c) => String(c.nome || '').toUpperCase() === nome);
    setDescontoDoCliente(descontoPadraoDoCliente(cliente));
  }, [formData.clienteNome, clientesDisponiveis]);

  // Peca abaixo do preco do sistema: a diferenca conta como desconto da OS --
  // a mesma conta do servidor (conferenciaPrecoDomain.ts, decisao do dono de
  // 21/10/2026). Servico (mao de obra) fica de fora: valor livre.
  const pecasPorId = useMemo(() => Object.fromEntries(pecasEstoque.map((p) => [p.id, p])), [pecasEstoque]);
  const diferencaDePrecoCents = useMemo(() => conferirPrecos({
    itens: pecasSelecionadas.map((p) => ({ id: p.id, nome: p.nome, precoUnitario: p.preco, quantidade: p.quantidade })),
    produtos: pecasPorId,
    promocoes,
    hoje: hojeParaPromocao,
    condicao: condicaoPagamento,
    vendidoPorPromocao,
  }).diferencaTotalCentavos, [pecasSelecionadas, pecasPorId, promocoes, hojeParaPromocao, condicaoPagamento, vendidoPorPromocao]);
  const baseDoDescontoCents = subtotalOSCentavos + diferencaDePrecoCents;
  const descontoParaLimiteCents = descontoCents + diferencaDePrecoCents;
  const checagemLimiteDesconto = checarLimiteComCliente(limiteDescontoOS, baseDoDescontoCents, descontoParaLimiteCents, descontoDoCliente);
  const paymentDate = formData.dataSaida || getDateInputInTimeZone();

  // Uma aprovacao de senha so vale pro estado do momento -- mudar servico,
  // peca ou desconto depois invalida.
  const primeiraRenderAprovacaoRef = useRef(true);
  useEffect(() => {
    if (primeiraRenderAprovacaoRef.current) {
      primeiraRenderAprovacaoRef.current = false;
      return;
    }
    setAprovacaoDesconto(null);
  }, [servicosSelecionados, pecasSelecionadas, descontoInput]);

  useEffect(() => {
    if (paymentDrafts.length !== 1) return;
    const expectedValue = fromCents(totalOSCentavos).toFixed(2);
    setPaymentDrafts((current) => (
      current.length === 1 && current[0].valor !== expectedValue
        ? [{ ...current[0], valor: expectedValue }]
        : current
    ));
  }, [paymentDrafts.length, totalOSCentavos]);

  const updatePaymentDraft = (paymentId: string, updates: Partial<PaymentDraft>) => {
    setPaymentDrafts((current) => current.map((payment) => (
      payment.id === paymentId ? { ...payment, ...updates } : payment
    )));
  };

  const addPaymentDraft = () => {
    const usedCents = paymentDrafts.reduce((sum, payment) => sum + toCents(payment.valor), 0);
    const remainingCents = Math.max(0, totalOSCentavos - usedCents);
    paymentDraftCounter.current += 1;
    setPaymentDrafts((current) => [
      ...current,
      createEmptyPaymentDraft(
        `pagamento-${paymentDraftCounter.current}`,
        remainingCents,
        financeConfig.defaultTermDays,
        formaInicialConfigurada(exigirEscolhaFormaPagamento, formasConfiguradas),
      ),
    ]);
  };

  const removePaymentDraft = (paymentId: string) => {
    setPaymentDrafts((current) => current.length > 1
      ? current.filter((payment) => payment.id !== paymentId)
      : current);
  };


  /** Devolve true/false (sucesso) -- usado tanto pelo clique do botao
   * quanto pelo useUnsavedChangesGuard (fechar aba -> "Salvar e fechar").
   *
   * Fatia 3d (19/10/2026): salvar virou ate' quatro etapas, cada uma pelo
   * servidor (chave "Venda pelo servidor" ligada) ou pela tela (desligada),
   * sempre com o mesmo plano (osFechamentoDomain.ts):
   *   1. reabrir -- OS finalizada que vai mudar de situacao ou de cobranca;
   *   2. gravar a OS -- dados, servicos, pecas, desconto e reserva, sem dinheiro;
   *   3. finalizar -- estoque, lotes, comissao, lancamentos e banco;
   *   ou cancelar -- com motivo, direto sobre a OS gravada.
   * OS finalizada (ou cancelada) sem mudanca na cobranca so' grava os dados descritivos. */
  const saveOS = async (): Promise<boolean> => {
    if (submitLockRef.current) return false;
    if (!currentUser || !tenantId) return false;
    if (!formData.clienteNome) {
      showError('Campos incompletos', 'Por favor, preencha o Nome do Cliente.');
      return false;
    }
    // Oficina de veiculos: placa obrigatoria. Maquinas pesadas: frota, placa
    // ou serie/chassi -- trator nao tem placa (oficinaDomain.ts).
    const identificacao = validarIdentificacaoEquipamento(modoOficina, formData);
    if (!identificacao.ok) {
      showError('Campos incompletos', identificacao.erro);
      return false;
    }

    const alvo = formData.status;
    const nomeClienteFormatado = formData.clienteNome.toUpperCase().trim();
    const statusGravado = isEditing ? statusGravadoRef.current : null;
    if (statusGravado === STATUS_OS_CANCELADA && alvo !== STATUS_OS_CANCELADA) {
      showError('OS cancelada', mensagemOsCanceladaNaoReabre(formData.numeroOS));
      return false;
    }
    const eraFinalizada = statusGravado === STATUS_OS_FINALIZADA;
    const cobrancaMudou = eraFinalizada && (
      assinaturaDaCobrancaDaOs({
        servicos: servicosSelecionados,
        pecas: pecasSelecionadas,
        desconto: { tipo: descontoInput.tipo, valorInformado: descontoInput.valor },
        clienteNome: nomeClienteFormatado,
        mecanicoId: formData.mecanicoId,
        dataSaida: formData.dataSaida,
      }) !== assinaturaCarregadaRef.current
      || JSON.stringify(paymentDrafts) !== rascunhosCarregadosRef.current
    );
    const reabrir = eraFinalizada && alvo !== STATUS_OS_CANCELADA && (alvo !== STATUS_OS_FINALIZADA || cobrancaMudou);
    const soDescritivo = (eraFinalizada && alvo === STATUS_OS_FINALIZADA && !cobrancaMudou)
      || (statusGravado === STATUS_OS_CANCELADA && alvo === STATUS_OS_CANCELADA);
    const cancelar = isEditing && alvo === STATUS_OS_CANCELADA && statusGravado !== STATUS_OS_CANCELADA;
    const finalizar = alvo === STATUS_OS_FINALIZADA && !soDescritivo;
    // Balanco aberto com as vendas travadas (21/10/2026): OS nao fecha ate' ele acabar.
    if (finalizar && tenantId) {
      const travaDoBalanco = await mensagemDaTravaDoBalanco(tenantId, 'finalizar a OS');
      if (travaDoBalanco) {
        showError('Balanço em andamento', travaDoBalanco);
        return false;
      }
    }

    // Nivel 2 (sistema): so faz sentido checar o desconto no momento em que
    // a OS vira receita de verdade -- mesmo gate que ja existe pra validar
    // pagamento logo abaixo.
    if (finalizar && checagemLimiteDesconto.excedeu) {
      if (modoLimiteDesconto === 'bloquear') {
        showError('Desconto acima do limite', `O desconto desta OS (${checagemLimiteDesconto.percentualAplicado.toFixed(1)}%) excede o limite configurado. Reduza o desconto para continuar.`);
        return false;
      }
      if (modoLimiteDesconto === 'senha' && !aprovacaoDesconto) {
        setShowAprovacaoDesconto(true);
        return false;
      }
      if (modoLimiteDesconto === 'avisar') {
        const confirm = await NexusSwal.fire({
          title: 'Desconto acima do limite',
          text: `O desconto desta OS (${checagemLimiteDesconto.percentualAplicado.toFixed(1)}%) excede o limite configurado. Deseja finalizar mesmo assim?`,
          icon: 'warning',
          showCancelButton: true,
          confirmButtonText: 'Finalizar mesmo assim',
          cancelButtonText: 'Revisar desconto',
        });
        if (!confirm.isConfirmed) return false;
      }
    }

    let paymentRecords: PaymentRecord[] = [];
    let paymentSummary: ReturnType<typeof summarizePayments> | null = null;
    if (finalizar) {
      try {
        paymentRecords = normalizePayments(totalOSCentavos, paymentDrafts, {
          saleDate: paymentDate,
          operationLabel: 'OS',
          maxCreditInstallments: financeConfig.maxCreditInstallments || undefined,
          creditFeePercentByInstallment: financeConfig.creditFeePercentByInstallment,
          debitFeePercent: financeConfig.debitFeePercent,
          creditSettlementDays: financeConfig.creditSettlementDays,
          debitSettlementDays: financeConfig.debitSettlementDays,
          cardFeeSchedulesByBrand,
          pagamentoCartaoSimplificadoAtivo,
          bancoPadraoSimplificado,
        });
        paymentRecords = explodeInstallmentPaymentRecords(paymentRecords);
        paymentSummary = summarizePayments(paymentRecords);
      } catch (error) {
        showError('Pagamento inválido', error instanceof Error ? error.message : 'Revise os dados do pagamento.');
        return false;
      }
    }

    const clienteEncontrado = clientesDisponiveis.find(c => c.nome.toUpperCase() === nomeClienteFormatado);

    if (!soDescritivo && !cancelar) {
      const acaoValidacaoCliente = resolverAcaoValidacaoCliente(modoValidacaoCliente, !!clienteEncontrado, formData.clienteNome.trim());
      if (acaoValidacaoCliente.tipo === 'bloquear') {
        showError('Cliente não cadastrado', acaoValidacaoCliente.motivo);
        return false;
      }
      if (acaoValidacaoCliente.tipo === 'perguntar') {
        const confirmCadastro = await NexusSwal.fire({
          title: 'Cliente não cadastrado',
          text: `"${nomeClienteFormatado}" ainda não tem cadastro. Deseja cadastrar agora?`,
          icon: 'question',
          showCancelButton: true,
          confirmButtonText: 'Cadastrar cliente',
          cancelButtonText: 'Cancelar',
        });
        if (confirmCadastro.isConfirmed) setCadastroRapidoAberto(true);
        return false;
      }
    }

    // OS finalizada com cobranca mudada: avisa que ela sera' reaberta e finalizada de novo.
    if (reabrir && alvo === STATUS_OS_FINALIZADA) {
      const confirmar = await NexusSwal.fire({
        title: 'Refazer a cobrança desta OS?',
        text: `A OS #${formData.numeroOS} já está finalizada. Para gravar a mudança, ela é reaberta (os lançamentos são cancelados, o banco é estornado e as peças voltam ao estoque) e finalizada de novo com o que está na tela.`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Reabrir e finalizar de novo',
        cancelButtonText: 'Voltar',
      });
      if (!confirmar.isConfirmed) return false;
    }

    const ctx = { db, tenantId, usuarioId: currentUser.uid, usuarioNome: currentUser.displayName || currentUser.email || 'Usuário' };
    /** Log do que a TELA gravou. Finalizar/reabrir/cancelar pelo servidor: o servidor grava o log. */
    const registrarLog = async (acao: 'criacao' | 'edicao' | 'cancelamento', descricao: string, registroId: string, critical = false) => {
      try {
        const { createAuditLog } = await import('../../services/logService');
        createAuditLog({
          tenantId: tenantId || '',
          usuarioId: currentUser.uid,
          usuarioEmail: currentUser.email || currentUser.uid,
          modulo: 'mecanica',
          acao,
          descricao,
          registroRelacionadoId: registroId,
          status: 'sucesso',
          ...(critical ? { critical: true } : {}),
        });
      } catch (logError) {
        console.error('Erro ao registrar log de auditoria da OS:', logError);
      }
    };
    const terminar = () => {
      initialSnapshotRef.current = buildDirtySnapshot();
      setIsDirty(false);
    };

    // ------------------------------------------------------------------
    // CANCELAR: motivo, nota fiscal e "Retornar estoque?" (decisoes de 19/10).
    // ------------------------------------------------------------------
    if (cancelar && id) {
      if (!vendaPeloServidor && osJaFoiFinalizadaRef.current) {
        // Pelo servidor a nota e' conferida la' (sem depender da permissao fiscal de quem cancela).
        try {
          const snapNotas = await getDocs(query(collection(db, 'notas_fiscais'), where('tenantId', '==', tenantId), where('osId', '==', id)));
          const erroNota = erroDasNotasParaCancelarOs(snapNotas.docs.map((d) => ({ id: d.id, ...d.data() })), formData.numeroOS);
          if (erroNota) {
            showError('A OS tem nota fiscal', erroNota);
            return false;
          }
        } catch (erroNotas) {
          console.error('Erro ao conferir as notas da OS antes de cancelar:', erroNotas);
          showError('Não foi possível conferir a nota fiscal da OS', 'Para não cancelar uma OS com nota válida, o cancelamento não foi feito. Confira sua conexão e tente de novo. Se o seu usuário não tem acesso às Notas Fiscais, peça a quem emite as notas para cancelar a OS.');
          return false;
        }
      }
      const confirmacao = await NexusSwal.fire({
        title: `Cancelar a OS #${formData.numeroOS}?`,
        text: statusGravado === STATUS_OS_FINALIZADA ? 'Os lançamentos da OS serão estornados e a comissão cancelada.' : 'A OS fica registrada como cancelada.',
        icon: 'warning',
        input: 'textarea',
        inputLabel: 'Motivo do cancelamento',
        inputAttributes: { maxlength: String(MOTIVO_CANCELAMENTO_MAXIMO) },
        inputValidator: (valor) => erroDoMotivoDoCancelamento(valor) || undefined,
        showCancelButton: true,
        confirmButtonText: 'Sim, cancelar a OS',
        cancelButtonText: 'Manter a OS',
        confirmButtonColor: '#ef4444',
      });
      if (!confirmacao.isConfirmed) return false;
      const motivo = String(confirmacao.value || '').trim();

      let devolverEstoque = false;
      if (estoqueBaixadoGravadoRef.current) {
        const confirmRetorno = await NexusSwal.fire({
          title: 'Retornar Estoque?',
          text: 'Esta OS foi cancelada. Deseja retornar as peças utilizadas para o estoque?',
          icon: 'question',
          showCancelButton: true,
          confirmButtonText: 'Sim, retornar peças',
          cancelButtonText: 'Não, manter fora do estoque',
        });
        devolverEstoque = confirmRetorno.isConfirmed;
      }

      submitLockRef.current = true;
      setIsLoading(true);
      try {
        const resultado = vendaPeloServidor
          ? await cancelarOsNoServidor(id, motivo, devolverEstoque)
          : await cancelarOsPelaTela(ctx, id, motivo, devolverEstoque);
        if (!vendaPeloServidor) await registrarLog('cancelamento', `OS #${resultado.numeroOS} cancelada${resultado.devolveuEstoque ? ' e peças devolvidas ao estoque' : ''}. Motivo: ${motivo}.`, id, true);
        setFormData((prev) => ({ ...prev, statusPagamento: 'Cancelada', ...(resultado.devolveuEstoque ? { estoqueBaixado: false } : {}), estoqueReservado: false }));
        showSuccess('OS cancelada!');
        terminar();
        navigate('/os');
        return true;
      } catch (error) {
        console.error('Erro ao cancelar a OS:', error);
        showError('Não foi possível cancelar a OS', describeTransactionError(error) || (error instanceof Error && error.message ? error.message : 'Verifique a conexão e tente novamente.'));
        return false;
      } finally {
        submitLockRef.current = false;
        setIsLoading(false);
      }
    }

    // ------------------------------------------------------------------
    // SO' OS DADOS DESCRITIVOS: OS finalizada sem mudanca na cobranca, ou cancelada.
    // ------------------------------------------------------------------
    if (soDescritivo && id) {
      submitLockRef.current = true;
      setIsLoading(true);
      try {
        const osRef = doc(db, 'ordens_de_servico', id);
        await runTransaction(db, async (transaction) => {
          const atual = await transaction.get(osRef);
          if (!atual.exists() || atual.data().status !== statusGravado) {
            throw new Error(`A OS #${formData.numeroOS} mudou de situação enquanto você editava (talvez por outra pessoa). Atualize a tela.`);
          }
          transaction.update(osRef, {
            ...camposDescritivosDaOs(formData),
            deslocamento: temDeslocamento(deslocamento) ? deslocamento : null,
            updatedAt: serverTimestamp(),
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Dados da OS atualizados'),
          });
        });
        await registrarLog('edicao', `OS #${formData.numeroOS} atualizada (dados do atendimento; cobrança sem mudança).`, id);
        showSuccess('OS atualizada!');
        terminar();
        navigate('/os');
        return true;
      } catch (error) {
        console.error('Erro ao salvar OS:', error);
        showError('Erro ao salvar', describeTransactionError(error) || (error instanceof Error && error.message ? error.message : 'Verifique a conexão e tente novamente.'));
        return false;
      } finally {
        submitLockRef.current = false;
        setIsLoading(false);
      }
    }

    submitLockRef.current = true;
    setIsLoading(true);

    // Ate' onde chegou (para a mensagem de erro dizer em que estado a OS ficou).
    let etapa: 'nada' | 'reaberta' | 'gravada' = 'nada';
    const statusDoRascunho = alvo === STATUS_OS_FINALIZADA
      ? (statusGravado && statusGravado !== STATUS_OS_FINALIZADA ? statusGravado : STATUS_OS_REABERTA_PADRAO)
      : alvo;
    let savedOsId = id || '';
    let finalNumeroOS = formData.numeroOS;

    try {
      // 1. Check and Create Client if new
      let clienteIdParaSalvar: string | null = clienteEncontrado?.id || null;
      if (!clienteEncontrado && formData.clienteNome.trim()) {
        const codigoCliente = await getProximoCodigoCliente(tenantId);
        const novoClienteRef = await addDoc(collection(db, 'clientes'), {
          codigo: codigoCliente,
          nome: nomeClienteFormatado,
          telefone: formData.clienteTelefone,
          tenantId,
          createdAt: serverTimestamp(),
          ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
        });
        clienteIdParaSalvar = novoClienteRef.id;
      }

      // Limite de Credito: so entra em jogo quando a OS vira receita
      // (Finalizada) com condicao a prazo, e a config esta ligada.
      // O saldo em aberto vem de consulta na colecao `transacoes`, e o SDK
      // cliente nao aceita consulta dentro de transacao. A versao lida junto
      // com o saldo e' reconferida DENTRO da transacao -- e' o que impede
      // uma OS e uma venda a prazo do mesmo cliente, ao mesmo tempo, de
      // furarem o limite juntas. Ver creditoDomain.ts. Pelo servidor, o
      // servidor refaz as duas conferencias.
      // Parametros de venda (fase A): cliente com titulo vencido ha' mais de N
      // dias nao fecha OS a prazo -- independe do limite de credito estar ligado.
      if (finalizar && paymentSummary?.paymentCondition === 'aprazo' && parametrosVenda.bloqueioAtraso.ativo && clienteIdParaSalvar) {
        const situacao = await situacaoEmAbertoDoCliente(tenantId, clienteIdParaSalvar, Boolean(grupo));
        const bloqueioAtraso = bloqueioPorAtraso(parametrosVenda, situacao.maiorAtrasoDias, nomeClienteFormatado);
        if (bloqueioAtraso) throw new Error(bloqueioAtraso);
      }

      const osEhAprazo = finalizar
        && trabalhaComLimiteCredito
        && paymentSummary?.paymentCondition === 'aprazo';
      let creditoVersaoNaChecagem = 0;

      if (osEhAprazo) {
        const limiteDeCreditoCents = clienteEncontrado?.limiteDeCredito != null
          ? Math.round(clienteEncontrado.limiteDeCredito * 100)
          : null;
        const saldoEmAbertoCents = clienteIdParaSalvar
          ? await calcularSaldoEmAbertoClienteCents(tenantId, clienteIdParaSalvar, Boolean(grupo))
          : 0;
        // Depois do saldo, nunca antes: assim tudo que foi gravado ate aqui
        // ja esta refletido no saldo OU na versao.
        if (clienteIdParaSalvar) {
          const clienteSnapChecagem = await getDoc(doc(db, 'clientes', clienteIdParaSalvar));
          creditoVersaoNaChecagem = parseCreditoVersao(clienteSnapChecagem.data()?.[CAMPO_CREDITO_VERSAO]);
        }
        const checagemCredito = excedeLimiteCredito(limiteDeCreditoCents, saldoEmAbertoCents, totalOSCentavos);
        if (checagemCredito.bloqueado) {
          const motivoTexto = checagemCredito.motivo === 'sem_limite'
            ? `O cliente "${nomeClienteFormatado}" não tem limite de crédito cadastrado. Não é possível vender a prazo.`
            : 'Esta OS ultrapassaria o limite de crédito do cliente (saldo em aberto + valor desta OS).';
          throw new Error(motivoTexto);
        }
      }

      // 2. REABRIR (desfaz a finalizacao inteira; bloqueado com parcela ja' recebida).
      if (reabrir && id) {
        const statusDaReabertura = alvo === STATUS_OS_FINALIZADA ? STATUS_OS_REABERTA_PADRAO : alvo;
        const reaberta = vendaPeloServidor
          ? await reabrirOsNoServidor(id, statusDaReabertura)
          : await reabrirOsPelaTela(ctx, id, statusDaReabertura);
        etapa = 'reaberta';
        statusGravadoRef.current = statusDaReabertura;
        estoqueBaixadoGravadoRef.current = false;
        if (!vendaPeloServidor) await registrarLog('edicao', `OS #${reaberta.numeroOS} reaberta (situação "${statusDaReabertura}"). Lançamentos cancelados e crédito do banco estornado${reaberta.pecasDevolvidas ? '; peças de volta ao estoque' : ''}.`, id);
      }

      // 3. GRAVAR A OS: dados, servicos, pecas, desconto e reserva -- sem dinheiro.
      const currentMaxOs = !isEditing
        ? await getCurrentMaxSequence(db, 'ordens_de_servico', tenantId, 'numeroOS').catch(() => 0)
        : 0;
      let novoEstoqueReservado = false;
      let estoqueJaBaixado = false;

      await runTransaction(db, async (transaction) => {
        let nextOs: number | null = null;
        if (!isEditing) {
          nextOs = await getNextTenantSequenceValue(transaction, db, tenantId, 'ordens_de_servico', currentMaxOs);
          finalNumeroOS = formatSequenceValue(nextOs, 2);
        }

        const osRef = isEditing && id ? doc(db, 'ordens_de_servico', id) : doc(collection(db, 'ordens_de_servico'));
        savedOsId = osRef.id;
        const existingOsSnap = isEditing ? await transaction.get(osRef) : null;
        const existingOsData = existingOsSnap?.exists() ? existingOsSnap.data() : null;
        if (existingOsData && (existingOsData.status === STATUS_OS_FINALIZADA || existingOsData.status === STATUS_OS_CANCELADA)) {
          throw new Error(`A OS #${existingOsData.numeroOS || finalNumeroOS} mudou de situação enquanto você editava (talvez por outra pessoa). Atualize a tela.`);
        }

        // Reserva de estoque (Modulo 13, Fatia 1) -- so tem efeito real quando
        // momentoBaixaEstoque === 'pedido'. Reserva que sobrou de quando a
        // empresa reservava (ou de OS cancelada nesta gravacao) e' solta.
        const wasReserved = existingOsData?.estoqueReservado === true;
        const previousReserved = wasReserved ? (existingOsData.pecas || []) : [];
        estoqueJaBaixado = existingOsData?.estoqueBaixado === true;
        const pecasItems = pecasSelecionadas.map(peca => ({ id: peca.id, nome: peca.nome, quantidade: peca.quantidade }));
        if (statusDoRascunho !== STATUS_OS_CANCELADA && momentoBaixaEstoque === 'pedido' && !estoqueJaBaixado) {
          const deltas = computeReservationDelta(previousReserved, pecasItems);
          if (deltas.length) await applyStockFieldDeltas(transaction, db, deltas, permitirVendaSemEstoque);
          novoEstoqueReservado = pecasItems.length > 0;
        } else if (wasReserved && previousReserved.length > 0) {
          const deltas = computeReservationRelease(previousReserved);
          if (deltas.length) await applyStockFieldDeltas(transaction, db, deltas, true);
        }

        if (nextOs !== null) {
          writeTenantSequenceValue(transaction, db, tenantId, 'ordens_de_servico', nextOs);
        }

        const osData = {
          ...formData,
          status: statusDoRascunho,
          numeroOS: finalNumeroOS,
          clienteId: clienteIdParaSalvar,
          clienteNome: nomeClienteFormatado,
          servicos: servicosSelecionados,
          pecas: pecasSelecionadas,
          deslocamento: temDeslocamento(deslocamento) ? deslocamento : null,
          valorTotal: totalOS,
          valorTotalCentavos: totalOSCentavos,
          // Snapshot do desconto geral -- consumido pelo relatorio de
          // descontos concedidos (Fatia 6). OS nao tem desconto por item,
          // so esse (nao existia nenhum campo de desconto antes desta feature).
          desconto: {
            tipo: descontoInput.tipo,
            valorInformado: Number(descontoInput.valor.replace(',', '.')) || 0,
            valorAplicadoCentavos: descontoCents,
            excedeuLimite: checagemLimiteDesconto.excedeu,
            ...(checagemLimiteDesconto.excedeu && aprovacaoDesconto
              ? { aprovacao: { modo: 'senha' as const, ...aprovacaoDesconto, aprovadoEm: new Date().toISOString() } }
              : {}),
          },
          statusColor: corDoStatusDaOs(statusDoRascunho),
          // Estoque e pagamento sao do banco: so' finalizar/reabrir/cancelar mudam.
          estoqueBaixado: estoqueJaBaixado,
          estoqueReservado: novoEstoqueReservado,
          statusPagamento: statusDoRascunho === STATUS_OS_CANCELADA
            ? 'Cancelada'
            : String(existingOsData?.statusPagamento || formData.statusPagamento || 'Pendente'),
        };

        if (existingOsData) {
          transaction.update(osRef, {
            ...osData,
            updatedAt: serverTimestamp(),
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp()),
          });
        } else {
          transaction.set(osRef, {
            ...osData,
            tenantId,
            createdAt: serverTimestamp(),
            ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
          });
        }

        if (formData.orcamentoId) {
          transaction.update(doc(db, 'orcamentos', formData.orcamentoId), {
            status: statusDoRascunho === STATUS_OS_CANCELADA ? 'Pendente' : 'Finalizado',
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), `OS #${finalNumeroOS} atualizou o status`),
          });
        }
      });
      etapa = 'gravada';
      statusGravadoRef.current = statusDoRascunho;
      reservaPropriaRef.current = novoEstoqueReservado ? mapaDaReservaDaOs(pecasSelecionadas) : new Map();

      if (!finalizar) {
        await registrarLog(isEditing ? 'edicao' : 'criacao', `OS #${finalNumeroOS} ${isEditing ? 'atualizada' : 'criada'} (cliente: ${nomeClienteFormatado}).`, savedOsId);
        setFormData(prev => ({ ...prev, numeroOS: finalNumeroOS, estoqueReservado: novoEstoqueReservado }));
        showSuccess(`OS ${isEditing ? 'atualizada' : 'criada'}!`);
        terminar();
        navigate('/os');
        return true;
      }

      // 4. FINALIZAR: lotes escolhidos aqui; estoque, comissao, lancamentos e banco no plano.
      // A baixa de estoque da OS acontece ao FINALIZAR, entao e' ali que o lote sai.
      let planoLotes: PlanoDeLotes | null = { porLinha: {}, semLote: {}, vencidosUsados: [] };
      if (!estoqueJaBaixado && pecasSelecionadas.length > 0) {
        planoLotes = await prepararBaixaDeLotes({
          db,
          tenantId,
          linhas: linhasParaLote(pecasSelecionadas.map((peca) => ({ id: peca.id, nome: peca.nome, quantidade: peca.quantidade }))),
          modo: loteModoSaida,
          avisarVencido: loteAvisarVencido,
        });
        if (planoLotes === null) {
          throw new Error('A escolha do lote foi cancelada.');
        }
      }

      const finalizada = vendaPeloServidor
        ? await finalizarOsNoServidor({
          osId: savedOsId,
          dataSaida: paymentDate,
          pagamentos: paymentDrafts,
          lotes: planoLotes.porLinha,
          ...(aprovacaoDesconto?.comprovanteId ? { comprovanteAprovacaoId: aprovacaoDesconto.comprovanteId } : {}),
        })
        : await finalizarOsPelaTela(ctx, {
          osId: savedOsId,
          dataSaida: paymentDate,
          pagamentos: paymentRecords,
          lotesPorLinha: planoLotes.porLinha,
          permitirSemEstoque: permitirVendaSemEstoque,
          // Hierarquia da comissao, por item: servico/peca (comissao propria,
          // se configurada) > mecanico (cadastro, se "recebe comissao" = sim)
          // > padrao do sistema. Ver resolveComissaoPercentual em financeDomain.ts.
          percentualDoServico: (servicoId) => servicosCatalogo.find((s) => s.id === servicoId)?.comissaoPercentual,
          percentualDaPeca: (pecaId) => pecasEstoque.find((p) => p.id === pecaId)?.comissaoPercentual,
          comissaoPadraoServicos,
          comissaoPadraoPecas,
          guardaDoCredito: osEhAprazo && clienteIdParaSalvar ? { clienteId: clienteIdParaSalvar, versaoNaChecagem: creditoVersaoNaChecagem } : null,
        });
      statusGravadoRef.current = STATUS_OS_FINALIZADA;
      const reais = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(fromCents(finalizada.totalCentavos));
      if (!vendaPeloServidor) {
        await registrarLog(isEditing ? 'edicao' : 'criacao', `OS #${finalizada.numeroOS} ${isEditing ? '' : 'criada e '}finalizada no valor de ${reais} (${finalizada.formaPagamento}). Cliente: ${nomeClienteFormatado}.`, savedOsId);
      } else if (!isEditing) {
        await registrarLog('criacao', `OS #${finalizada.numeroOS} criada (cliente: ${nomeClienteFormatado}).`, savedOsId);
      }

      reservaPropriaRef.current = new Map();
      setFormData(prev => ({
        ...prev,
        numeroOS: finalNumeroOS,
        estoqueBaixado: true,
        estoqueReservado: false,
        ...(paymentSummary ? {
          dataSaida: paymentDate,
          formaPagamento: paymentSummary.paymentMethodLabel,
          statusPagamento: paymentSummary.pendingCents === 0
            ? 'Paga'
            : paymentSummary.receivedCents > 0
              ? 'Parcial'
              : 'Pendente',
        } : {}),
      }));

      showSuccess(`OS ${isEditing ? 'atualizada' : 'criada'}!`);
      terminar();

      // Mesma oferta da venda: fechou em boleto, pergunta se emite agora.
      // "Deixar pendente" nao trava nada -- fica em Financeiro > Boletos.
      if (paymentRecords.some((p) => p.formaPagamento === 'Boleto')) {
        const querEmitir = await NexusSwal.fire({
          title: 'Emitir o boleto agora?',
          text: 'Você pode emitir depois em Financeiro → Boletos, quando quiser.',
          icon: 'question',
          showCancelButton: true,
          confirmButtonText: 'Emitir agora',
          cancelButtonText: 'Deixar pendente',
        });
        if (querEmitir.isConfirmed) {
          navigate('/financeiro/boletos');
          return true;
        }
      }

      navigate('/os');
      return true;
    } catch (error) {
      console.error('Erro ao salvar OS:', error);
      // Liberacao que o servidor nao aceitou (vencida, usada, de outro valor): o proximo Salvar pede de novo.
      if (error instanceof OsServidorError && error.status === STATUS_PEDIR_DE_NOVO) setAprovacaoDesconto(null);
      // Erro de infraestrutura primeiro (disputa entre operadores, queda de
      // rede, permissao recusada): sem isto o texto cru do Firestore chegava
      // na tela -- foi assim que "Missing or insufficient permissions."
      // apareceu pro cliente. As mensagens de negocio lancadas aqui dentro
      // ("Estoque insuficiente para X") continuam vindo pelo fallback, que
      // sao sempre mais especificas do que qualquer texto generico.
      const motivo = describeTransactionError(error)
        || (error instanceof Error && error.message ? error.message : 'Verifique a conexão e tente novamente.');
      if (etapa === 'reaberta') {
        showError('A OS foi reaberta, mas não foi gravada', `${motivo} A OS #${formData.numeroOS} ficou reaberta ("${statusGravadoRef.current}"): os lançamentos foram cancelados e as peças voltaram ao estoque. Corrija e salve de novo.`);
      } else if (etapa === 'gravada' && finalizar) {
        showError('A OS foi gravada, mas não foi finalizada', `${motivo} A OS #${finalNumeroOS} ficou como "${statusDoRascunho}", sem mexer no dinheiro nem no estoque. Corrija e salve de novo como Finalizada.`);
        // OS nova: dali em diante a tela edita a OS que ja' existe (salvar de novo nao cria outra).
        if (!isEditing && savedOsId) navigate(`/os/editar/${savedOsId}`, { replace: true });
      } else {
        showError('Erro ao salvar', motivo);
      }
      return false;
    } finally {
      submitLockRef.current = false;
      setIsLoading(false);
    }
  };

  useUnsavedChangesGuard(isDirty, saveOS);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    saveOS();
  };

  if (isFetchingOS) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-primary)' }}>Carregando dados da Ordem de Serviço...</div>;
  }

  if (trava.situacao === 'de_outro') {
    return (
      <TravaDeEdicaoAviso
        rotulo="a OS"
        mensagem={trava.mensagem}
        onVoltar={() => navigate('/os')}
        onTentarDeNovo={trava.tentarDeNovo}
        onLiberar={podeLiberarTrava ? trava.liberarEAbrir : undefined}
      />
    );
  }

  return (
    <div className="os-page">
      <div className="page-header">
        <div className="header-title-group">
          <button className="icon-btn back-btn" onClick={() => navigate('/os')}><ArrowLeft size={20} /></button>
          <div>
            <h1 className="page-title">{isEditing ? 'Editar Ordem de Serviço' : 'Nova Ordem de Serviço'}</h1>
            {/* OS nova NAO mostra numero: ele so e' alocado ao salvar, dentro
                da transacao. Anunciar "OS #0042" aqui e gravar #0047 (porque
                outra pessoa salvou antes) faz o usuario achar que o sistema
                errou -- com varias pessoas emitindo ao mesmo tempo isso deixa
                de ser raro. Ver getNextTenantSequenceValue. */}
            <p className="page-subtitle">{isEditing ? `Gerenciando OS #${formData.numeroOS || id?.substring(0,6).toUpperCase()}` : 'Preencha os dados — o número da OS é definido ao salvar'}</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          {isEditing && canVerAuditoria && (
            <button className="btn-secondary" onClick={() => setAuditoriaAberta(true)} title="Ver histórico de auditoria">
              <History size={18} />
            </button>
          )}
          <button className="btn-primary" onClick={handleSave} disabled={isLoading} style={{ opacity: isLoading ? 0.7 : 1, display: 'flex', alignItems: 'center' }}>
            {isLoading ? <Loader2 size={18} className="spin-icon" style={{ marginRight: 8 }} /> : <Save size={18} style={{ marginRight: 8 }} />}
            {isLoading ? 'Salvando...' : 'Salvar OS'}
          </button>
        </div>
      </div>

      <HistoricoAuditoriaModal
        open={auditoriaAberta}
        onClose={() => setAuditoriaAberta(false)}
        tenantId={tenantId}
        registroId={id || ''}
        titulo={`Auditoria — OS #${formData.numeroOS || id?.substring(0, 6).toUpperCase() || ''}`}
      />

      <div className="form-grid">
        <div className="form-column">
          
          {/* Controle de Status */}
          <div className="card form-section os-status-card" style={{ borderColor: `${corDoStatusDaOs(formData.status)}50` }}>
             <div className="section-header">
              <Activity size={20} className="section-icon" style={{ color: corDoStatusDaOs(formData.status) }} />
              <h3>Status da Ordem de Serviço</h3>
            </div>
            <div className="input-group">
              <select
                name="status"
                value={formData.status}
                onChange={handleChange}
                ref={statusSelectRef}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)', fontWeight: 'bold' }}
              >
                <option value="Orçamento Pendente">Orçamento Pendente</option>
                <option value="Aguardando Peça">Aguardando Peça</option>
                <option value="Em Manutenção">Em Manutenção</option>
                <option value={STATUS_OS_EM_ATENDIMENTO}>Em atendimento (técnico no campo)</option>
                <option value={STATUS_OS_AGUARDANDO_CONFERENCIA}>Aguardando conferência (técnico concluiu)</option>
                <option value="Finalizada">Finalizada (Gera Receita no Caixa)</option>
                <option value="Cancelada">Cancelada</option>
              </select>
            </div>

            {formData.status === 'Finalizada' && (
              <div ref={pagamentoSectionRef} style={{ marginTop: '16px', padding: '16px', backgroundColor: 'rgba(16, 185, 129, 0.05)', borderRadius: 'var(--radius-md)', border: '1px dashed rgba(16, 185, 129, 0.3)' }}>
                <PaymentsEditor
                  customerName={formData.clienteNome}
                  drafts={paymentDrafts}
                  embedded
                  financeConfig={financeConfig}
                  idPrefix="service-order-payment"
                  onAddPayment={addPaymentDraft}
                  onRemovePayment={removePaymentDraft}
                  onTransactionDateChange={(date) => setFormData((current) => ({ ...current, dataSaida: date }))}
                  onUpdatePayment={updatePaymentDraft}
                  pagamentoCartaoSimplificadoAtivo={pagamentoCartaoSimplificadoAtivo}
                  formasConfiguradas={formasConfiguradas}
                  permitirDividirPagamento={permitirDividirPagamento}
                  sourceLabel="OS"
                  tenantId={tenantId}
                  totalCents={totalOSCentavos}
                  transactionDate={paymentDate}
                  transactionDateLabel="Data da finalização"
                />
              </div>
            )}
          </div>

          <div className="card form-section">
            <div className="section-header">
              <User size={20} className="section-icon" />
              <h3>Dados do Cliente</h3>
            </div>
            <div className="input-group" style={{ position: 'relative' }}>
              <label>Nome do Cliente *</label>
              <ClientAutocomplete
                value={formData.clienteNome}
                onChange={(value) => setFormData({ ...formData, clienteNome: value })}
                clients={clientesDisponiveis}
                inputRef={clienteInputRef}
                onBlur={handleClienteBlur}
                onSelect={(c) => {
                  const vDoCliente = veiculosDisponiveis.filter(v => v.clienteId === c.id);
                  if (vDoCliente.length === 1) {
                    const v = vDoCliente[0];
                    setFormData({
                      ...formData,
                      clienteNome: c.nome,
                      clienteTelefone: c.telefone || '',
                      placa: v.placa || '',
                      modelo: v.modelo || '',
                      marca: v.marca || '',
                      ano: v.ano || '',
                      cor: v.cor || '',
                      renavam: v.renavam || '',
                      quilometragem: v.kmAtual ? String(v.kmAtual) : '',
                      combustivel: v.combustivel || '',
                    });
                    setVeiculosDoCliente([]);
                    setIsVeiculoDropdownOpen(false);
                  } else if (vDoCliente.length > 1) {
                    setFormData({ ...formData, clienteNome: c.nome, clienteTelefone: c.telefone || '' });
                    setVeiculosDoCliente(vDoCliente);
                    setIsVeiculoDropdownOpen(true);
                  } else {
                    setFormData({ ...formData, clienteNome: c.nome, clienteTelefone: c.telefone || '' });
                    setVeiculosDoCliente([]);
                    setIsVeiculoDropdownOpen(false);
                  }
                }}
                placeholder="Busque ou digite novo..."
                ariaLabel="Buscar cliente"
                emptyHint={
                  modoValidacaoCliente === 'bloquear' ? (
                    <>Cliente não cadastrado. Use o botão "Cadastrar Cliente" abaixo.</>
                  ) : modoValidacaoCliente === 'perguntar' ? (
                    <>Cliente não cadastrado. Você será perguntado se quer cadastrar ao salvar.</>
                  ) : (
                    <>
                      <Plus size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
                      Cadastrar "{formData.clienteNome}" como novo cliente
                    </>
                  )
                }
                buscaDeCliente
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setCadastroRapidoAberto(true)}
                style={{ marginTop: '8px', fontSize: '13px', padding: '6px 12px' }}
              >
                Cadastrar Cliente
              </button>
            </div>
            <div className="input-group">
              <label>Telefone / WhatsApp</label>
              <input type="text" name="clienteTelefone" value={formData.clienteTelefone} onChange={handleChange} />
            </div>
          </div>

          <div className="card form-section">
            <div className="section-header">
              <Car size={20} className="section-icon" />
              <h3>{rotulos.dadosVeiculo}</h3>
            </div>
            
            {isVeiculoDropdownOpen && veiculosDoCliente.length > 1 && (
              <div style={{ padding: '16px', backgroundColor: 'rgba(59, 130, 246, 0.1)', border: '1px dashed #3b82f6', borderRadius: '8px', marginBottom: '16px' }}>
                <p style={{ color: '#3b82f6', marginBottom: '12px', fontWeight: 'bold' }}>Este cliente possui mais de um {rotulos.veiculo.toLowerCase()}. Selecione qual será atendido:</p>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {veiculosDoCliente.map(v => (
                    <button 
                      key={v.id} 
                      type="button"
                      onClick={() => {
                        setFormData(prev => ({
                          ...prev,
                          placa: v.placa || '',
                          modelo: v.modelo || '',
                          marca: v.marca || '',
                          ano: v.ano || '',
                          cor: v.cor || '',
                          renavam: v.renavam || '',
                          quilometragem: v.kmAtual ? String(v.kmAtual) : '',
                          combustivel: v.combustivel || '',
                          frota: v.frota || '',
                          serie: v.serie || '',
                          horimetro: v.horimetro ? String(v.horimetro) : '',
                          tipoEquipamento: v.tipoEquipamento || '',
                        }));
                        setIsVeiculoDropdownOpen(false);
                      }}
                      style={{ padding: '8px 16px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}
                    >
                      {identificacaoCurta(modoOficina, v)} - {v.modelo}
                    </button>
                  ))}
                  <button 
                    type="button" 
                    onClick={() => setIsVeiculoDropdownOpen(false)} 
                    style={{ padding: '8px 16px', backgroundColor: 'transparent', color: '#3b82f6', border: '1px solid #3b82f6', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}
                  >
                    Outro / Novo
                  </button>
                </div>
              </div>
            )}

            <div className="grid-2-col">
              {modoOficina === 'maquinas_pesadas' && (
                <>
                  <div className="input-group"><label>Nº de frota</label><input type="text" name="frota" value={formData.frota} onChange={handleChange} /></div>
                  <div className="input-group"><label>Série / Chassi</label><input type="text" name="serie" style={{ textTransform: 'uppercase' }} value={formData.serie} onChange={handleChange} /></div>
                  <div className="input-group">
                    <label>Tipo de equipamento</label>
                    <select name="tipoEquipamento" value={formData.tipoEquipamento} onChange={handleChange}>
                      <option value="">Não informado</option>
                      {configMaquinas.tiposEquipamento.map((tipo) => <option key={tipo} value={tipo}>{tipo}</option>)}
                      {formData.tipoEquipamento && !configMaquinas.tiposEquipamento.includes(formData.tipoEquipamento) && <option value={formData.tipoEquipamento}>{formData.tipoEquipamento}</option>}
                    </select>
                  </div>
                </>
              )}
              <div className="input-group"><label>{modoOficina === 'veiculos' ? 'Placa *' : rotulos.placa}</label><input type="text" name="placa" style={{ textTransform: 'uppercase' }} value={formData.placa} onChange={handleChange} /></div>
              <div className="input-group"><label>Modelo</label><input type="text" name="modelo" value={formData.modelo} onChange={handleChange} /></div>
              <div className="input-group"><label>Marca</label><input type="text" name="marca" value={formData.marca} onChange={handleChange} /></div>
              <div className="input-group"><label>Ano</label><input type="text" name="ano" value={formData.ano} onChange={handleChange} /></div>
              <div className="input-group"><label>Cor</label><input type="text" name="cor" value={formData.cor} onChange={handleChange} /></div>
              {modoOficina === 'veiculos' && (
                <div className="input-group"><label>RENAVAM</label><input type="text" name="renavam" value={formData.renavam} onChange={handleChange} /></div>
              )}
              {modoOficina === 'maquinas_pesadas' ? (
                <div className="input-group">
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Gauge size={14} /> Horímetro (h)</label>
                  <input type="number" name="horimetro" value={formData.horimetro} onChange={handleChange} min="0" step="0.1" />
                </div>
              ) : (
                <div className="input-group">
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Gauge size={14} /> Quilometragem</label>
                  <input type="number" name="quilometragem" value={formData.quilometragem} onChange={handleChange} min="0" />
                </div>
              )}
              <div className="input-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Fuel size={14} /> Combustível</label>
                <select name="combustivel" value={formData.combustivel} onChange={handleChange}>
                  <option value="">Não informado</option>
                  <option value="Gasolina">Gasolina</option>
                  <option value="Etanol">Etanol</option>
                  <option value="Flex">Flex</option>
                  <option value="Diesel">Diesel</option>
                  <option value="Elétrico">Elétrico</option>
                  <option value="Híbrido">Híbrido</option>
                  <option value="GNV">GNV</option>
                </select>
              </div>
            </div>

            <div className="grid-2-col" style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px dashed var(--border-color)' }}>
              <div className="input-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><CalendarDays size={14} /> Data de entrada</label>
                <input type="date" name="dataEntrada" value={formData.dataEntrada} onChange={handleChange} />
              </div>
              <div className="input-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><CalendarDays size={14} /> Saída prevista</label>
                <input type="date" name="dataSaida" value={formData.dataSaida} onChange={handleChange} />
              </div>
              <div className="input-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><CalendarDays size={14} /> Hora de entrada</label>
                <input type="time" name="horaEntrada" value={formData.horaEntrada} onChange={handleChange} />
              </div>
              <div className="input-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><CalendarDays size={14} /> Hora de saída</label>
                <input type="time" name="horaSaida" value={formData.horaSaida} onChange={handleChange} />
              </div>
            </div>
          </div>

          {modoOficina === 'maquinas_pesadas' && (
            <div className="card form-section">
              <div className="section-header">
                <Truck size={20} className="section-icon" />
                <h3>Deslocamento para atendimento ao cliente</h3>
              </div>
              <div className="grid-2-col">
                <div className="input-group"><label>KM inicial</label><input type="number" min="0" value={deslocamento.kmInicial ?? ''} onChange={(e) => atualizarDeslocamento({ kmInicial: e.target.value === '' ? null : Number(e.target.value) })} /></div>
                <div className="input-group"><label>KM final</label><input type="number" min="0" value={deslocamento.kmFinal ?? ''} onChange={(e) => atualizarDeslocamento({ kmFinal: e.target.value === '' ? null : Number(e.target.value) })} /></div>
                <div className="input-group">
                  <label>KM rodados</label>
                  <input type="number" min="0" step="0.1"
                    value={deslocamento.kmInicial !== null && deslocamento.kmFinal !== null ? kmDoDeslocamento(deslocamento) : (deslocamento.km || '')}
                    disabled={deslocamento.kmInicial !== null && deslocamento.kmFinal !== null}
                    title={deslocamento.kmInicial !== null && deslocamento.kmFinal !== null ? 'Calculado pelo KM inicial e final' : 'Informe os km rodados (ou preencha KM inicial e final)'}
                    onChange={(e) => atualizarDeslocamento({ km: Number(e.target.value) || 0 })} />
                </div>
                <div className="input-group"><label>Local</label><input type="text" value={deslocamento.local} onChange={(e) => atualizarDeslocamento({ local: e.target.value })} /></div>
                <div className="input-group"><label>Hora de saída</label><input type="time" value={deslocamento.horaSaida} onChange={(e) => atualizarDeslocamento({ horaSaida: e.target.value })} /></div>
                <div className="input-group"><label>Hora de chegada</label><input type="time" value={deslocamento.horaChegada} onChange={(e) => atualizarDeslocamento({ horaChegada: e.target.value })} /></div>
                <div className="input-group">
                  <label>Veículo da empresa</label>
                  <select value={deslocamento.veiculoEmpresa} onChange={(e) => atualizarDeslocamento({ veiculoEmpresa: e.target.value })}>
                    <option value="">Não informado</option>
                    {frotaEmpresa.map((v) => <option key={v.id} value={v.nome}>{v.nome}</option>)}
                    {deslocamento.veiculoEmpresa && !frotaEmpresa.some((v) => v.nome === deslocamento.veiculoEmpresa) && <option value={deslocamento.veiculoEmpresa}>{deslocamento.veiculoEmpresa}</option>}
                  </select>
                </div>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '12px 0 0' }}>
                {configMaquinas.precoKmCentavos > 0 || configMaquinas.valorVisitaCentavos > 0
                  ? `Com ${kmDoDeslocamento(deslocamento)} km, o deslocamento entra como serviço de ${(valorDeslocamentoCentavos(kmDoDeslocamento(deslocamento), configMaquinas) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} (preço do km em Configurações da filial → Oficina de máquinas pesadas).`
                  : 'Sem preço do km em Configurações da filial → Oficina de máquinas pesadas, o deslocamento fica só registrado; lance o serviço à mão se quiser cobrar.'}
              </p>
            </div>
          )}

          <div className="card form-section">
            <div className="section-header">
              <FileText size={20} className="section-icon" />
              <h3>Inclusão de Serviços e Mão de Obra</h3>
            </div>
            
            <div className="input-group" style={{ marginBottom: '20px', paddingBottom: '20px', borderBottom: '1px dashed var(--border-color)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {modoOficina === 'maquinas_pesadas' ? 'Técnico responsável' : 'Funcionário Responsável'}
              </label>
              <select 
                name="mecanicoId" 
                value={formData.mecanicoId} 
                onChange={(e) => {
                  const selectedId = e.target.value;
                  const selectedUser = mecanicosDisponiveis.find(m => m.id === selectedId);
                  setFormData({
                    ...formData,
                    mecanicoId: selectedId,
                    mecanicoNome: selectedUser?.nome || ''
                  });
                }} 
                disabled={!isTenantManagerRole(userRole) && !isPlatformAdminRole(userRole)}
                style={{ 
                  backgroundColor: 'var(--bg-tertiary)', 
                  border: '1px solid var(--border-color)', 
                  borderRadius: 'var(--radius-md)', 
                  padding: '12px 16px', 
                  color: 'var(--text-primary)', 
                  width: '100%',
                  opacity: (!isTenantManagerRole(userRole) && !isPlatformAdminRole(userRole)) ? 0.7 : 1,
                  cursor: (!isTenantManagerRole(userRole) && !isPlatformAdminRole(userRole)) ? 'not-allowed' : 'pointer'
                }}
              >
                <option value="">-- Selecione o Funcionário (Nenhum) --</option>
                {mecanicosDisponiveis.map(m => (
                  <option key={m.id} value={m.id}>{m.nome}</option>
                ))}
              </select>
            </div>

            <div className="item-add-container" style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
              <div style={{ flex: 2, position: 'relative' }} ref={servicoDropdownRef}>
                <input
                  type="text"
                  placeholder="Busque ou digite novo Serviço"
                  value={servicoNomeInput}
                  ref={servicoNomeInputRef}
                  onChange={(e) => {
                    setServicoNomeInput(aplicarCaixaAltaCadastro(e.target, e.target.value));
                    setIsServicoDropdownOpen(true);
                    const exists = servicosCatalogo.find(s => s.nome.toLowerCase() === e.target.value.toLowerCase());
                    if (exists) setServicoPrecoInput(String(exists.preco));
                  }}
                  onFocus={() => setIsServicoDropdownOpen(true)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleAddServico(); } }}
                  autoComplete="off"
                  style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 42px 12px 16px', color: 'var(--text-primary)' }}
                />
                {servicoNomeInput && (
                  <button
                    type="button"
                    onClick={handleClearServicoInput}
                    className="clear-selection-btn"
                    title="Limpar seleção"
                  >
                    <X size={16} />
                  </button>
                )}
                {isServicoDropdownOpen && servicosCatalogo.filter(s => s.nome.toLowerCase().includes(servicoNomeInput.toLowerCase())).length > 0 && (
                  <div className="select-dropdown">
                    {servicosCatalogo
                      .filter(s => s.nome.toLowerCase().includes(servicoNomeInput.toLowerCase()))
                      .map(s => (
                        <div 
                          key={s.id}
                          className="select-option"
                          onClick={() => {
                            setServicoNomeInput(s.nome);
                            setServicoPrecoInput(String(s.preco));
                            setIsServicoDropdownOpen(false);
                          }}
                        >
                          <span>{s.nome}</span>
                          <span>R$ {s.preco.toFixed(2)} / hora</span>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              <input
                type="number"
                title="R$ por hora"
                value={servicoPrecoInput}
                onChange={(e) => setServicoPrecoInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleAddServico(); } }}
                style={{ flex: 1, backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
              />
              
              <button className="btn-secondary" type="button" onClick={handleAddServico} disabled={!servicoNomeInput || !servicoPrecoInput}><Plus size={18} /></button>
            </div>
            
            {servicosSelecionados.length > 0 && (
              <div style={{ backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', padding: '12px' }}>
                <table style={{ width: '100%', fontSize: '13px' }}>
                  <tbody>
                    {servicosSelecionados.map((s, index) => (
                      <tr key={index} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '10px 10px 10px 0' }}>
                          <strong style={{ display: 'block', marginBottom: '7px' }}>{s.nome}</strong>
                          <input
                            type="text"
                            value={s.detalhamento || ''}
                            onChange={e => updateDetalhamentoServico(index, e.target.value)}
                            title="Detalhamento do serviço executado"
                            style={{ width: '100%', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '7px 9px', borderRadius: '4px', fontSize: '12px' }}
                          />
                          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginTop: '7px' }}>
                            <label style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Tempo (h)</label>
                            <input
                              type="number"
                              value={getServiceHours(s)}
                              onChange={e => updateTempoServico(index, Number(e.target.value))}
                              min="0"
                              step="0.1"
                              style={{ width: '90px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '6px', borderRadius: '4px', fontSize: '12px' }}
                            />
                          </div>
                        </td>
                        <td style={{ padding: '8px 0', width: '120px' }}>
                          <label style={{ display: 'block', marginBottom: '5px', color: 'var(--text-muted)', fontSize: '10px', textAlign: 'right' }}>Valor / hora</label>
                          <div style={{ display: 'flex', alignItems: 'center' }}>
                            <span style={{ color: 'var(--text-muted)', marginRight: '4px' }}>R$</span>
                            <input 
                              type="number" 
                              value={s.preco} 
                              onChange={e => updatePrecoServico(index, Number(e.target.value))}
                              style={{ width: '100%', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '6px', borderRadius: '4px', fontSize: '13px' }} 
                              min="0" 
                              step="0.01"
                            />
                          </div>
                          <div style={{ marginTop: '8px', color: '#10b981', fontSize: '12px', fontWeight: 700, textAlign: 'right' }}>
                            Total: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(getServiceTotal(s))}
                          </div>
                        </td>
                        <td style={{ textAlign: 'right', width: '40px' }}>
                          <button onClick={() => handleRemoveServico(index)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}><Trash2 size={16} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td style={{ padding: '12px 0 0', fontWeight: 'bold' }}>Subtotal Serviços:</td>
                      <td colSpan={2} style={{ textAlign: 'right', padding: '12px 0 0', fontWeight: 'bold', color: '#10b981', fontSize: '14px' }}>
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalServicos)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
          
          <div className="card form-section">
            <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Package size={20} className="section-icon" />
                <h3>Inclusão de Peças (Estoque)</h3>
              </div>
              {formData.estoqueBaixado && (
                <span style={{ fontSize: '11px', backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#10b981', padding: '4px 8px', borderRadius: '4px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                  Estoque Baixado
                </span>
              )}
              {formData.estoqueReservado && (
                <span style={{ fontSize: '11px', backgroundColor: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', padding: '4px 8px', borderRadius: '4px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                  Estoque Reservado
                </span>
              )}
            </div>

            <div className="shortcuts-hint" style={{ marginBottom: '16px' }}>
              <span><kbd>F2</kbd> Cliente</span>
              <span><kbd>F3</kbd> Peça</span>
              <span><kbd>F8</kbd> Serviço</span>
              <span><kbd>F5</kbd> Qtd. última peça</span>
              <span><kbd>F6</kbd> Pagamento</span>
              <span><kbd>Esc</kbd> Fechar</span>
            </div>

            <div className="item-add-container" style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
              <div style={{ flex: 2, position: 'relative' }}>
                <ProductAutocomplete
                  value={pecaNomeInput}
                  products={pecasEstoque}
                  inputRef={pecaNomeInputRef}
                  onChange={(value) => {
                    setPecaNomeInput(value);
                    const exists = pecasEstoque.find(p => p.nome.toLowerCase() === value.toLowerCase());
                    if (exists) setPecaPrecoInput(String(precoSugeridoDoItem(tabelaDe(exists), condicaoPagamento)));
                  }}
                  onSelect={(p) => {
                    setPecaNomeInput(p.nome);
                    setPecaPrecoInput(String(precoSugeridoDoItem(tabelaDe(p), condicaoPagamento)));
                  }}
                  mode={pecaSearchMode}
                  placeholder="Busque ou digite nova peça"
                  ariaLabel="Buscar peça"
                  className="has-clear-btn"
                  onViewMore={() => setIsPecaSearchModalOpen(true)}
                  renderItem={renderPecaRow}
                />
                {pecaNomeInput && (
                  <button
                    type="button"
                    onClick={handleClearPecaInput}
                    className="clear-selection-btn"
                    title="Limpar seleção"
                  >
                    <X size={16} />
                  </button>
                )}
                <ProductSearchModal
                  open={isPecaSearchModalOpen}
                  onClose={() => setIsPecaSearchModalOpen(false)}
                  products={pecasEstoque}
                  onSelect={(p) => {
                    setPecaNomeInput(p.nome);
                    setPecaPrecoInput(String(precoSugeridoDoItem(tabelaDe(p), condicaoPagamento)));
                  }}
                  mode={pecaSearchMode}
                  renderItem={renderPecaRow}
                  initialQuery={pecaNomeInput}
                  title="Buscar peça"
                />
              </div>

              <input
                type="number"
                title="R$ Valor"
                value={pecaPrecoInput}
                onChange={(e) => setPecaPrecoInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleAddPeca(); } }}
                style={{ flex: 1, backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
              />
              
              <button className="btn-secondary" type="button" onClick={handleAddPeca} disabled={!pecaNomeInput || !pecaPrecoInput}><Plus size={18} /></button>
            </div>
            
            {pecasSelecionadas.length > 0 && (
              <div style={{ backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', padding: '12px' }}>
                <table style={{ width: '100%', fontSize: '13px' }}>
                  <tbody>
                    {pecasSelecionadas.map((p, index) => (
                      <tr key={index} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '8px 0' }}>{p.nome}</td>
                        <td style={{ padding: '8px 0', width: '70px' }}>
                          <input
                            type="number"
                            value={p.quantidade}
                            ref={(el) => { if (index === pecasSelecionadas.length - 1) pecaQtdLastRowRef.current = el; }}
                            onChange={e => updateQuantidadePeca(index, Number(e.target.value))}
                            style={{ width: '100%', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '6px', borderRadius: '4px', fontSize: '13px' }}
                            min={p.unidadeMedidaFracionado ? '0.001' : '1'}
                            step={p.unidadeMedidaFracionado ? 'any' : '1'}
                          />
                        </td>
                        <td style={{ padding: '8px 0', width: '120px' }}>
                          <div style={{ display: 'flex', alignItems: 'center' }}>
                            <span style={{ color: 'var(--text-muted)', marginRight: '4px' }}>R$</span>
                            <input 
                              type="number" 
                              value={p.preco} 
                              onChange={e => updatePrecoPeca(index, Number(e.target.value))}
                              style={{ width: '100%', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '6px', borderRadius: '4px', fontSize: '13px' }} 
                              min="0" 
                              step="0.01"
                            />
                          </div>
                        </td>
                        <td style={{ textAlign: 'right', width: '40px' }}>
                          <button onClick={() => handleRemovePeca(index)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}><Trash2 size={16} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={2} style={{ padding: '12px 0 0', fontWeight: 'bold' }}>Subtotal Peças:</td>
                      <td colSpan={2} style={{ textAlign: 'right', padding: '12px 0 0', fontWeight: 'bold', color: '#10b981', fontSize: '14px' }}>
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalPecas)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
          
          <div className="card form-section">
            <div className="section-header">
              <ClipboardList size={20} className="section-icon" />
              <h3>Desconto</h3>
            </div>
            <div style={{ maxWidth: '260px' }}>
              <DescontoInput
                idPrefix="os-desconto"
                value={descontoInput}
                onChange={setDescontoInput}
              />
            </div>
            {checagemLimiteDesconto.excedeu && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', padding: '10px 12px', borderRadius: 'var(--radius-md)', backgroundColor: 'rgba(239, 68, 68, 0.12)', color: '#ef4444', fontSize: '12px' }}>
                Desconto de {checagemLimiteDesconto.percentualAplicado.toFixed(1)}% acima do limite configurado para OS.
              </div>
            )}
          </div>

          <div className="card form-section" style={{ backgroundColor: '#10b98115', border: '1px solid #10b98150' }}>
            <div className="total-os-container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '18px' }}>VALOR TOTAL DA OS</h3>
              <h2 style={{ margin: 0, fontSize: '24px', color: '#10b981' }}>
                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalOS)}
              </h2>
            </div>
          </div>
        </div>

        <SolicitarAprovacaoDescontoModal
          open={showAprovacaoDesconto}
          tenantId={tenantId}
          motivo={`Desconto de ${checagemLimiteDesconto.percentualAplicado.toFixed(1)}% nesta OS, acima do limite configurado. Confirme com a senha de um aprovador para finalizar.`}
          moduloLog="mecanica"
          onClose={() => setShowAprovacaoDesconto(false)}
          onAprovado={(aprovacao) => setAprovacaoDesconto(aprovacao)}
          liberacaoNoServidor={vendaPeloServidor
            ? { tela: 'os', baseCentavos: baseDoDescontoCents, descontoCentavos: descontoParaLimiteCents }
            : null}
          pedirAoGerente={{ tela: 'os', baseCentavos: baseDoDescontoCents, descontoCentavos: descontoParaLimiteCents, documento: formData.numeroOS ? `OS #${formData.numeroOS}` : 'OS nova' }}
        />

        <CadastroRapidoClienteModal
          open={cadastroRapidoAberto}
          nomeInicial={formData.clienteNome}
          onClose={() => setCadastroRapidoAberto(false)}
          onCriado={(cliente: ClienteCadastradoRapido) => setFormData({ ...formData, clienteNome: cliente.nome, clienteTelefone: cliente.telefone || formData.clienteTelefone })}
        />

        <div className="form-column">
          {atendimentoCampo && (atendimentoCampo.fotos.length > 0 || atendimentoCampo.assinatura) && (
            <div className="card form-section">
              <div className="section-header">
                <Camera size={20} className="section-icon" />
                <h3>Atendimento no campo (app do técnico)</h3>
              </div>
              {atendimentoCampo.fotos.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '10px', marginBottom: atendimentoCampo.assinatura ? '16px' : 0 }}>
                  {atendimentoCampo.fotos.map((foto, i) => (
                    <a key={foto.caminho} href={foto.url} target="_blank" rel="noreferrer" title={foto.legenda || `Foto ${i + 1}`} style={{ display: 'block' }}>
                      <img src={foto.url} alt={foto.legenda || `Foto ${i + 1}`} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: '8px', display: 'block' }} />
                      {foto.legenda && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>{foto.legenda}</div>}
                    </a>
                  ))}
                </div>
              )}
              {atendimentoCampo.assinatura && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <img src={atendimentoCampo.assinatura.url} alt="Assinatura do cliente" style={{ height: '70px', maxWidth: '280px', objectFit: 'contain', backgroundColor: '#f8fafc', borderRadius: '8px', padding: '6px' }} />
                  <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                    Assinado por <b style={{ color: 'var(--text-primary)' }}>{atendimentoCampo.assinatura.nomeAssinante || 'cliente'}</b><br />
                    {new Date(atendimentoCampo.assinatura.em).toLocaleString('pt-BR')} · colhida por {atendimentoCampo.assinatura.por}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="card form-section fill-height">
            <div className="section-header">
              <FileText size={20} className="section-icon" />
              <h3>Relatório Técnico (Impressão)</h3>
            </div>
            <div className="input-group">
              <label>{rotulos.defeito}{modoOficina === 'veiculos' ? ' (Cliente)' : ''}</label>
              <textarea name="defeitoRelatado" title={rotulos.defeitoPlaceholder} rows={3} value={formData.defeitoRelatado} onChange={handleChange}></textarea>
            </div>
            <div className="input-group" style={{ flex: 1 }}>
              <label>Relatório do Técnico (O que foi feito)</label>
              <textarea name="relatorioTecnico" title={rotulos.relatorioPlaceholder} rows={10} value={formData.relatorioTecnico} onChange={handleChange}></textarea>
            </div>
            <div className="input-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Package size={14} /> Materiais fornecidos pelo cliente</label>
              <textarea name="materiaisCliente" rows={3} value={formData.materiaisCliente} onChange={handleChange}></textarea>
            </div>
            <div className="input-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><ClipboardList size={14} /> Condições de pagamento</label>
              <textarea name="condicoesPagamento" rows={3} value={formData.condicoesPagamento} onChange={handleChange}></textarea>
            </div>
            <div className="input-group">
              <label>Observações do recibo</label>
              <textarea name="observacoes" title="Orientações, garantias específicas ou recomendações ao cliente..." rows={4} value={formData.observacoes} onChange={handleChange}></textarea>
            </div>
          </div>
        </div>
      </div>

      {/* Botão de Salvar no final da página, alinhado à direita */}
      <div className="save-os-container" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px', marginBottom: '40px' }}>
        <button 
          className="btn-primary" 
          onClick={handleSave} 
          disabled={isLoading} 
          style={{ 
            padding: '16px 32px', 
            borderRadius: '8px', 
            display: 'flex', 
            alignItems: 'center',
            fontSize: '16px',
            fontWeight: 'bold',
            opacity: isLoading ? 0.8 : 1,
            transition: 'all 0.2s ease',
          }}
        >
          {isLoading ? <Loader2 size={20} className="spin-icon" style={{ marginRight: 8 }} /> : <Save size={20} style={{ marginRight: 8 }} />}
          {isLoading ? 'Salvando...' : 'SALVAR ORDEM DE SERVIÇO'}
        </button>
      </div>
    </div>
  );
};

export default OSForm;
