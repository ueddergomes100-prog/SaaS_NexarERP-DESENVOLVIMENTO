import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, User, Car, FileText, Loader2, Plus, Trash2, Activity, Package, Gauge, Fuel, CalendarDays, ClipboardList, X } from 'lucide-react';
import { collection, addDoc, doc, getDoc, getDocs, getCountFromServer, serverTimestamp, query, where, orderBy, limit, runTransaction } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { NexusSwal, showSuccess, showError, showWarning } from '../../utils/alerts';
import { getServiceHours, getServiceTotal } from '../../utils/osServicePricing';
import { applyStockAdjustments, applyStockFieldDeltas, describeTransactionError, formatSequenceValue, getCurrentMaxSequence, getNextTenantSequenceValue, writeTenantSequenceValue } from '../../utils/firestoreAtomic';
import {
  computeReservationCommit,
  computeReservationDelta,
  computeReservationRelease,
  computeReservationReturn,
  DEFAULT_MOMENTO_BAIXA_ESTOQUE,
  type MomentoBaixaEstoque,
} from '../../utils/estoqueReservaDomain';
import { isPlatformAdminRole, isTenantManagerRole } from '../../utils/roles';
import { isRegistroDeVendedor } from '../../utils/vendedorCadastroDomain';
import {
  calcularDescontoCents,
  checarLimiteTotal,
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
import {
  CAMPO_CREDITO_VERSAO,
  creditoFoiAlteradoDurante,
  excedeLimiteCredito,
  MENSAGEM_CREDITO_CONCORRENTE,
  parseCreditoVersao,
  parseTrabalhaComLimiteCredito,
} from '../../utils/creditoDomain';
import { calcularSaldoEmAbertoClienteCents } from '../../utils/contasReceberQuery';
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
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { useEscapeLayer, useKeyboardShortcuts } from '../../hooks/useKeyboardFlow';
import { useTenantCollection } from '../../hooks/useTenantCollection';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import PaymentsEditor, { type PaymentFinanceConfig } from '../../components/finance/PaymentsEditor';
import {
  buildCardFeeSchedulesByBrand,
  buildServiceOrderCommissionSnapshot,
  cancelCommissionSnapshot,
  computeBankCreditsMap,
  createEmptyPaymentDraft,
  explodeInstallmentPaymentRecords,
  fromCents,
  normalizeCreditCardFeeSchedule,
  normalizePayments,
  parseCreditTerms,
  parsePagamentoCartaoSimplificadoAtivo,
  resolveBancoPadraoSimplificado,
  resolveComissaoPercentual,
  summarizePayments,
  toCents,
  transactionMovesPhysicalCash,
  type PaymentDraft,
  type PaymentMethod,
  type PaymentRecord,
} from '../../utils/financeDomain';
import { DICA_BUSCA_MULTIPLA } from '../../utils/textSearch';
import './OS.css';

interface ClienteBasico { id: string; nome: string; telefone: string; codigo?: string; limiteDeCredito?: number | null; }
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
  nome: string;
  precoVenda: number;
  quantidade?: number;
  codigo?: string;
  codigoBarras?: string;
  unidadeMedidaSigla?: string;
  unidadeMedidaFracionado?: boolean;
  unidadeMedidaCasasDecimais?: number;
  /** Comissao propria da peca -- vence o percentual do mecanico/sistema
   * quando configurada. Ver resolveComissaoPercentual em financeDomain.ts. */
  comissaoPercentual?: number;
}
interface PecaSelecionada {
  id: string;
  nome: string;
  preco: number;
  quantidade: number;
  unidadeMedidaSigla?: string;
  unidadeMedidaFracionado?: boolean;
  unidadeMedidaCasasDecimais?: number;
}

const renderPecaRow = (p: PecaData) => (
  <>
    <span>{p.nome}</span>
    <span>R$ {p.precoVenda.toFixed(2)}</span>
  </>
);
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
}

const getLocalDateInputValue = (date = new Date()) => {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
};

const OSForm: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams(); // Para modo Edição
  const isEditing = !!id;
  
  const [formData, setFormData] = useState({
    clienteNome: '', clienteTelefone: '',
    placa: '', modelo: '', marca: '', ano: '', cor: '',
    renavam: '', quilometragem: '', combustivel: '',
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
  const [pecaNomeInput, setPecaNomeInput] = useState('');
  const [pecaPrecoInput, setPecaPrecoInput] = useState('');
  const [isPecaSearchModalOpen, setIsPecaSearchModalOpen] = useState(false);
  const [pecasSelecionadas, setPecasSelecionadas] = useState<PecaSelecionada[]>([]);
  const [permitirVendaSemEstoque, setPermitirVendaSemEstoque] = useState(false);
  const [pecaSearchMode, setPecaSearchMode] = useState<ProductSearchMode>(DEFAULT_PRODUCT_SEARCH_MODE);
  const [momentoBaixaEstoque, setMomentoBaixaEstoque] = useState<MomentoBaixaEstoque>(DEFAULT_MOMENTO_BAIXA_ESTOQUE);
  const [descontoInput, setDescontoInput] = useState<DescontoInputValue>({ tipo: 'valor', valor: '' });
  const [limiteDescontoOS, setLimiteDescontoOS] = useState<LimiteDescontoConfig | null>(null);
  const [modoLimiteDesconto, setModoLimiteDesconto] = useState<ModoLimiteDesconto>('avisar');
  const [modoValidacaoCliente, setModoValidacaoCliente] = useState<ModoValidacaoCliente>(DEFAULT_MODO_VALIDACAO_CLIENTE);
  const [trabalhaComLimiteCredito, setTrabalhaComLimiteCredito] = useState(false);
  const [cadastroRapidoAberto, setCadastroRapidoAberto] = useState(false);
  const [showAprovacaoDesconto, setShowAprovacaoDesconto] = useState(false);
  const [aprovacaoDesconto, setAprovacaoDesconto] = useState<AprovacaoDesconto | null>(null);

  const { currentUser, tenantId, userRole } = useAuth();
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
      snapE.forEach((doc) => dataE.push({
        id: doc.id,
        nome: doc.data().nome,
        precoVenda: doc.data().precoVenda,
        quantidade: doc.data().quantidade || 0,
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
      }));
      setPecasEstoque(dataE);

      // Fetch Configurações
      try {
        const configRef = doc(db, 'configuracoes', tenantId);
        const configSnap = await getDoc(configRef);
        if (configSnap.exists()) {
          const config = configSnap.data();
          setPermitirVendaSemEstoque(config.venderSemEstoque === true);
          setPagamentoCartaoSimplificadoAtivo(parsePagamentoCartaoSimplificadoAtivo(config.pagamentoCartaoSimplificadoAtivo));
          setPecaSearchMode(config.buscaProdutoModo === 'exata' ? 'exata' : DEFAULT_PRODUCT_SEARCH_MODE);
          setMomentoBaixaEstoque((config.momentoBaixaEstoque ?? DEFAULT_MOMENTO_BAIXA_ESTOQUE) as MomentoBaixaEstoque);
          setLimiteDescontoOS(parseLimiteDescontoConfig(config.limiteDescontoOS));
          setModoLimiteDesconto(parseModoLimiteDesconto(config.modoLimiteDesconto));
          setModoValidacaoCliente(parseModoValidacaoCliente(config.modoValidacaoCliente));
          setTrabalhaComLimiteCredito(parseTrabalhaComLimiteCredito(config.trabalhaComLimiteCredito));
          setComissaoPadraoPecas(typeof config.comissaoPadraoPecas === 'number' ? config.comissaoPadraoPecas : undefined);
          setComissaoPadraoServicos(typeof config.comissaoPadraoServicos === 'number' ? config.comissaoPadraoServicos : undefined);
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
            // OS antiga pode ter peca gravada sem unidade (documento salvo
            // antes da feature existir): completa com 'UN' na carga, pra
            // ficar consistente com o que o catalogo devolve hoje.
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
            if (Array.isArray(os.pagamentos) && os.pagamentos.length > 0) {
              setPaymentDrafts(os.pagamentos.map((payment: PaymentRecord, index: number) => ({
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
              paymentDraftCounter.current = os.pagamentos.length;
            } else {
              setPaymentDrafts([{
                ...createEmptyPaymentDraft('pagamento-1', toCents(os.valorTotal || 0)),
                forma: (os.formaPagamento || 'Outros') as PaymentMethod,
              }]);
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
    const { name, value } = e.target;
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

  const handleAddPeca = async () => {
    if (!pecaNomeInput || !pecaPrecoInput) return;
    const precoNum = parseFloat(pecaPrecoInput.replace(',', '.'));
    
    let peca = pecasEstoque.find(p => p.nome.toLowerCase() === pecaNomeInput.toLowerCase());
    
    if (!peca && currentUser) {
      setIsLoading(true);
      try {
        const q = query(collection(db, 'estoque'), where('tenantId', '==', tenantId));
        const snap = await getCountFromServer(q);
        const nextId = snap.data().count + 1;
        
        const newRef = await addDoc(collection(db, 'estoque'), {
          codigo: String(nextId),
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
      if (!permitirVendaSemEstoque && (peca.quantidade || 0) < 1) {
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
      setPecasSelecionadas([...pecasSelecionadas, {
        id: peca.id,
        nome: peca.nome,
        preco: precoNum,
        quantidade: 1,
        ...resolveUnidadeMedidaProduto(peca),
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

    if (!permitirVendaSemEstoque) {
      const pecaEstoque = pecasEstoque.find(p => p.id === peca.id);
      if (pecaEstoque && qtd > (pecaEstoque.quantidade || 0)) {
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
  const checagemLimiteDesconto = checarLimiteTotal(limiteDescontoOS, subtotalOSCentavos, descontoCents);
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
      ),
    ]);
  };

  const removePaymentDraft = (paymentId: string) => {
    setPaymentDrafts((current) => current.length > 1
      ? current.filter((payment) => payment.id !== paymentId)
      : current);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Finalizada': return '#10b981'; // Verde
      case 'Orçamento Pendente': return '#3b82f6'; // Azul
      case 'Aguardando Peça': return '#f59e0b'; // Amarelo
      case 'Em Manutenção': return '#8b5cf6'; // Roxo
      case 'Cancelada': return '#ef4444'; // Vermelho
      default: return '#6b7280'; // Cinza
    }
  };

  /** Devolve true/false (sucesso) -- usado tanto pelo clique do botao
   * quanto pelo useUnsavedChangesGuard (fechar aba -> "Salvar e fechar"). */
  const saveOS = async (): Promise<boolean> => {
    if (submitLockRef.current) return false;
    if (!currentUser || !tenantId) return false;
    if (!formData.clienteNome || !formData.placa) {
      showError('Campos incompletos', 'Por favor, preencha o Nome do Cliente e a Placa.');
      return false;
    }

    // Nivel 2 (sistema): so faz sentido checar o desconto no momento em que
    // a OS vira receita de verdade -- mesmo gate que ja existe pra validar
    // pagamento logo abaixo.
    if (formData.status === 'Finalizada' && checagemLimiteDesconto.excedeu) {
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
    if (formData.status === 'Finalizada') {
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

    const nomeClienteFormatado = formData.clienteNome.toUpperCase().trim();
    const clienteEncontrado = clientesDisponiveis.find(c => c.nome.toUpperCase() === nomeClienteFormatado);

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

    submitLockRef.current = true;
    setIsLoading(true);

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
      // furarem o limite juntas. Ver creditoDomain.ts.
      const osEhAprazo = formData.status === 'Finalizada'
        && trabalhaComLimiteCredito
        && paymentSummary?.paymentCondition === 'aprazo';
      let creditoVersaoNaChecagem = 0;

      if (osEhAprazo) {
        const limiteDeCreditoCents = clienteEncontrado?.limiteDeCredito != null
          ? Math.round(clienteEncontrado.limiteDeCredito * 100)
          : null;
        const saldoEmAbertoCents = clienteIdParaSalvar
          ? await calcularSaldoEmAbertoClienteCents(tenantId, clienteIdParaSalvar)
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

      let estoqueFoiBaixado = formData.estoqueBaixado || false;
      let deveRetornarEstoque = false;
      let novoEstoqueReservado = false;

      if (formData.status === 'Cancelada' && estoqueFoiBaixado) {
        const confirmRetorno = await NexusSwal.fire({
          title: 'Retornar Estoque?',
          text: 'Esta OS foi cancelada. Deseja retornar as peças utilizadas para o estoque?',
          icon: 'question',
          showCancelButton: true,
          confirmButtonText: 'Sim, retornar peças',
          cancelButtonText: 'Não, manter fora do estoque'
        });

        if (confirmRetorno.isConfirmed) {
          deveRetornarEstoque = true;
          estoqueFoiBaixado = false;
        }
      }

      let finalNumeroOS = formData.numeroOS;
      const currentMaxOs = !isEditing
        ? await getCurrentMaxSequence(db, 'ordens_de_servico', tenantId, 'numeroOS').catch(() => 0)
        : 0;
      let didCancelJustNow = false;

      await runTransaction(db, async (transaction) => {
        let nextOs: number | null = null;
        if (!isEditing) {
          nextOs = await getNextTenantSequenceValue(transaction, db, tenantId, 'ordens_de_servico', currentMaxOs);
          finalNumeroOS = formatSequenceValue(nextOs, 2);
        }

        const osRef = isEditing && id ? doc(db, 'ordens_de_servico', id) : doc(collection(db, 'ordens_de_servico'));
        const existingOsSnap = isEditing ? await transaction.get(osRef) : null;
        const existingOsData = existingOsSnap?.exists() ? existingOsSnap.data() : null;
        const mechanicSnap = formData.mecanicoId
          ? await transaction.get(doc(db, 'usuarios', formData.mecanicoId))
          : null;

        // Guarda do limite de credito: outra venda/OS a prazo do mesmo
        // cliente entrou depois que o saldo foi lido la fora? Entao o saldo
        // em maos esta velho e esta gravacao para. Leitura antes de
        // qualquer escrita, como o Firestore exige.
        const clienteCreditoRef = osEhAprazo && clienteIdParaSalvar
          ? doc(db, 'clientes', clienteIdParaSalvar)
          : null;
        let creditoVersaoAtual = 0;
        if (clienteCreditoRef) {
          const clienteSnapTx = await transaction.get(clienteCreditoRef);
          creditoVersaoAtual = parseCreditoVersao(clienteSnapTx.data()?.[CAMPO_CREDITO_VERSAO]);
          if (creditoFoiAlteradoDurante(creditoVersaoNaChecagem, creditoVersaoAtual)) {
            throw new Error(MENSAGEM_CREDITO_CONCORRENTE);
          }
        }
        const persistedPayments = paymentRecords.map((payment, index) => ({
          ...payment,
          transactionId: index === 0 ? osRef.id : `${osRef.id}_pag_${index + 1}`,
        }));
        const existingPaymentIds = Array.isArray(existingOsData?.pagamentos) && existingOsData.pagamentos.length > 0
          ? existingOsData.pagamentos.map((payment: PaymentRecord, index: number) => (
              payment.transactionId || (index === 0 ? osRef.id : `${osRef.id}_pag_${index + 1}`)
            ))
          : [osRef.id];
        const currentPaymentIds = persistedPayments.map((payment) => payment.transactionId);
        const paymentTransactionIds = isEditing
          ? Array.from(new Set([...existingPaymentIds, ...currentPaymentIds]))
          : [];
        const paymentTransactionSnapshots = await Promise.all(
          paymentTransactionIds.map((transactionId) => transaction.get(doc(db, 'transacoes', transactionId))),
        );
        const paymentTransactionById = new Map(
          paymentTransactionSnapshots.map((snapshot) => [snapshot.id, snapshot]),
        );

        const wasAlreadyFinalized = existingOsData?.status === 'Finalizada';
        const bankCreditsByBanco = formData.status === 'Finalizada' && !wasAlreadyFinalized
          ? computeBankCreditsMap(persistedPayments)
          : new Map<string, number>();
        // Reverte o credito bancario aplicado na finalizacao sempre que a OS
        // deixa de estar Finalizada -- cobre tanto cancelamento quanto
        // "reabertura" (troca de status pra qualquer outro), que antes
        // deixavam o saldo do banco inflado pra sempre. Le do
        // existingOsData.pagamentos (o que foi creditado de fato), nao do
        // formData atual (que pode ter mudado forma de pagamento na mesma
        // edicao). Naturalmente idempotente: so roda quando o status
        // PERSISTIDO ainda era Finalizada, entao nao reverte duas vezes.
        const bankDebitsByBanco = wasAlreadyFinalized && formData.status !== 'Finalizada'
          ? computeBankCreditsMap(existingOsData?.pagamentos || [])
          : new Map<string, number>();
        const bankBalancesById = new Map<string, number>();
        for (const bancoId of new Set([...bankCreditsByBanco.keys(), ...bankDebitsByBanco.keys()])) {
          const bancoSnap = await transaction.get(doc(db, 'bancos', bancoId));
          if (!bancoSnap.exists()) {
            if (bankCreditsByBanco.has(bancoId)) throw new Error('O banco de destino selecionado não foi encontrado.');
            continue; // banco do credito original nao existe mais -- reversao segue sem quebrar o fluxo
          }
          bankBalancesById.set(bancoId, Number(bancoSnap.data().saldoCentavos || 0));
        }

        // Reserva de estoque (Modulo 13, Fatia 1) -- so tem efeito real quando
        // momentoBaixaEstoque === 'pedido'. Para todo tenant no default
        // ('imediato'), hasOrphanReservation e' sempre false (nunca houve
        // reserva pra essa OS) e o fluxo cai exatamente nos mesmos dois
        // applyStockAdjustments de sempre, inalterados.
        const wasReserved = existingOsData?.estoqueReservado === true;
        const previousReserved = wasReserved ? (existingOsData.pecas || []) : [];
        const wasAlreadyBaixado = existingOsData?.estoqueBaixado === true;
        const hasOrphanReservation = wasReserved && previousReserved.length > 0;
        const pecasItems = pecasSelecionadas.map(peca => ({ id: peca.id, nome: peca.nome, quantidade: peca.quantidade }));

        if (formData.status === 'Finalizada' && !formData.estoqueBaixado) {
          if (hasOrphanReservation || momentoBaixaEstoque === 'pedido') {
            const deltas = computeReservationCommit(previousReserved, pecasItems);
            if (deltas.length) await applyStockFieldDeltas(transaction, db, deltas, permitirVendaSemEstoque);
          } else {
            await applyStockAdjustments(transaction, db, pecasItems, 'decrement', permitirVendaSemEstoque);
          }
          estoqueFoiBaixado = true;
        } else if (deveRetornarEstoque) {
          if (hasOrphanReservation) {
            const deltas = computeReservationReturn(previousReserved, pecasItems);
            await applyStockFieldDeltas(transaction, db, deltas, true);
          } else {
            await applyStockAdjustments(transaction, db, pecasItems, 'increment', true);
          }
        } else if (formData.status === 'Cancelada' && hasOrphanReservation) {
          const deltas = computeReservationRelease(previousReserved);
          if (deltas.length) await applyStockFieldDeltas(transaction, db, deltas, true);
        } else if (momentoBaixaEstoque === 'pedido' && !wasAlreadyBaixado && formData.status !== 'Cancelada') {
          const deltas = computeReservationDelta(previousReserved, pecasItems);
          if (deltas.length) await applyStockFieldDeltas(transaction, db, deltas, permitirVendaSemEstoque);
          novoEstoqueReservado = pecasItems.length > 0;
        } else if (hasOrphanReservation) {
          const deltas = computeReservationRelease(previousReserved);
          if (deltas.length) await applyStockFieldDeltas(transaction, db, deltas, true);
        }

        if (nextOs !== null) {
          writeTenantSequenceValue(transaction, db, tenantId, 'ordens_de_servico', nextOs);
        }

        const existingCommission = existingOsData?.comissao || null;
        let commission = existingCommission;
        const wasAlreadyCancelled = existingOsData?.status === 'Cancelada';
        if (formData.status === 'Finalizada' && !existingCommission && !wasAlreadyFinalized) {
          const mechanicProfile = mechanicSnap?.exists() ? mechanicSnap.data() : {};
          // Hierarquia da comissao, por item: servico/peca (comissao propria,
          // se configurada) > mecanico (cadastro, se "recebe comissao" =
          // sim) > padrao do sistema. Ver resolveComissaoPercentual em
          // financeDomain.ts.
          commission = buildServiceOrderCommissionSnapshot({
            sellerId: formData.mecanicoId,
            sellerName: formData.mecanicoNome || mechanicProfile.nome || 'Não identificado',
            itensServicos: servicosSelecionados.map((servico) => ({
              id: servico.id,
              nome: servico.nome,
              baseCents: toCents(getServiceTotal(servico)),
              percentual: resolveComissaoPercentual({
                itemPercentual: servicosCatalogo.find((s) => s.id === servico.id)?.comissaoPercentual,
                recebeComissao: mechanicProfile.recebeComissaoServicos,
                percentualVendedor: mechanicProfile.comissaoPercentualServicos,
                percentualPadraoSistema: comissaoPadraoServicos,
              }),
            })),
            itensPecas: pecasSelecionadas.map((peca) => ({
              id: peca.id,
              nome: peca.nome,
              baseCents: toCents(peca.preco * peca.quantidade),
              percentual: resolveComissaoPercentual({
                itemPercentual: pecasEstoque.find((p) => p.id === peca.id)?.comissaoPercentual,
                recebeComissao: mechanicProfile.recebeComissaoPecas,
                percentualVendedor: mechanicProfile.comissaoPercentualPecas,
                percentualPadraoSistema: comissaoPadraoPecas,
              }),
            })),
          });
        } else if (formData.status === 'Cancelada' && existingCommission?.regraVersion) {
          commission = cancelCommissionSnapshot(existingCommission);
        }

        const finalizedPaymentStatus = paymentSummary
          ? (
              paymentSummary.pendingCents === 0
                ? 'Paga'
                : paymentSummary.receivedCents > 0
                  ? 'Parcial'
                  : 'Pendente'
            )
          : formData.statusPagamento;
        const osData = {
          ...formData,
          numeroOS: finalNumeroOS,
          clienteId: clienteIdParaSalvar,
          clienteNome: formData.clienteNome.toUpperCase().trim(),
          servicos: servicosSelecionados,
          pecas: pecasSelecionadas,
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
          statusColor: getStatusColor(formData.status),
          estoqueBaixado: estoqueFoiBaixado,
          estoqueReservado: novoEstoqueReservado,
          formaPagamento: paymentSummary?.paymentMethodLabel || formData.formaPagamento,
          statusPagamento: formData.status === 'Cancelada'
            ? 'Cancelada'
            : formData.status === 'Finalizada'
              ? finalizedPaymentStatus
              : formData.statusPagamento,
          ...(formData.status === 'Finalizada' && paymentSummary ? {
            dataSaida: paymentDate,
            dataPagamento: paymentDate,
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
          } : {}),
          ...(commission ? { comissao: commission } : {})
        };

        if (isEditing && id) {
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

        // Fecha a guarda: a proxima venda/OS a prazo deste cliente que tiver
        // lido o saldo antes desta aqui vai ver a versao diferente e parar.
        if (clienteCreditoRef) {
          transaction.update(clienteCreditoRef, {
            [CAMPO_CREDITO_VERSAO]: creditoVersaoAtual + 1,
            updatedAt: serverTimestamp(),
          });
        }

        bankCreditsByBanco.forEach((deltaCents, bancoId) => {
          transaction.update(doc(db, 'bancos', bancoId), {
            saldoCentavos: (bankBalancesById.get(bancoId) || 0) + deltaCents,
            updatedAt: serverTimestamp(),
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), `Crédito da OS #${finalNumeroOS}`),
          });
        });
        bankDebitsByBanco.forEach((deltaCents, bancoId) => {
          const currentBalance = bankBalancesById.get(bancoId);
          if (currentBalance === undefined) return;
          transaction.update(doc(db, 'bancos', bancoId), {
            saldoCentavos: currentBalance - deltaCents,
            updatedAt: serverTimestamp(),
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), `Estorno do crédito da OS #${finalNumeroOS}`),
          });
        });

        if (formData.status === 'Finalizada') {
          persistedPayments.forEach((payment) => {
            const paymentRef = doc(db, 'transacoes', payment.transactionId);
            const existingPaymentSnapshot = paymentTransactionById.get(payment.transactionId);
            const parcelaLabel = payment.cartao?.numero
              ? ` (Parcela ${payment.cartao.numero}/${payment.cartao.totalParcelas})`
              : '';
            transaction.set(paymentRef, {
              descricao: `Recebimento OS #${finalNumeroOS || osRef.id.substring(0,6).toUpperCase()} - ${payment.formaPagamento}${parcelaLabel}`,
              categoria: 'Serviços',
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
              data: payment.dataVencimento || paymentDate,
              dataVencimento: payment.dataVencimento || null,
              dataPrevistaRecebimento: payment.dataPrevistaRecebimento || null,
              cartao: payment.cartao || null,
              osId: osRef.id,
              sourceType: 'ordem_servico',
              sourceId: osRef.id,
              paymentIndex: payment.indice,
              idempotencyKey: `os:${osRef.id}:pagamento:${payment.indice}`,
              clienteId: clienteIdParaSalvar,
              clienteNome: formData.clienteNome.toUpperCase().trim(),
              usuarioResponsavelId: currentUser.uid,
              mecanicoId: formData.mecanicoId,
              tenantId,
              ...(existingPaymentSnapshot?.exists()
                ? { updatedAt: serverTimestamp(), ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp()) }
                : { createdAt: serverTimestamp(), ...buildDocumentMetadata(currentUser.uid, serverTimestamp()) }),
            }, { merge: true });
          });

          paymentTransactionSnapshots.forEach((paymentSnapshot) => {
            if (!paymentSnapshot.exists() || currentPaymentIds.includes(paymentSnapshot.id)) return;
            transaction.update(paymentSnapshot.ref, {
              status: 'Cancelada',
              movimentaCaixaFisico: false,
              substituidaEm: serverTimestamp(),
              updatedAt: serverTimestamp(),
              ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Substituída por novo pagamento'),
            });
          });
        } else if (isEditing) {
          if (formData.status === 'Cancelada' && !wasAlreadyCancelled) {
            didCancelJustNow = true;
            paymentTransactionSnapshots.forEach((paymentSnapshot) => {
              if (!paymentSnapshot.exists()) return;
              const existingTransaction = paymentSnapshot.data();

              if (existingTransaction.status === 'Paga' && existingTransaction.estornada !== true) {
                const movesPhysicalCash = transactionMovesPhysicalCash(existingTransaction);
                transaction.update(paymentSnapshot.ref, {
                  estornada: true,
                  statusOperacional: 'Cancelada',
                  estornadaEm: serverTimestamp(),
                  updatedAt: serverTimestamp(),
                  ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Estornada pelo cancelamento da OS'),
                });
                transaction.set(doc(db, 'transacoes', `estorno_cancelamento_${paymentSnapshot.id}`), {
                  descricao: `Estorno do cancelamento da OS #${finalNumeroOS}`,
                  categoria: 'Cancelamento de OS',
                  valor: Number(existingTransaction.valor || 0),
                  valorCentavos: Number(existingTransaction.valorCentavos ?? toCents(existingTransaction.valor)),
                  valorBruto: Number(existingTransaction.valorBruto ?? existingTransaction.valor ?? 0),
                  valorBrutoCentavos: Number(existingTransaction.valorBrutoCentavos ?? existingTransaction.valorCentavos ?? toCents(existingTransaction.valor)),
                  valorTaxa: Number(existingTransaction.valorTaxa ?? existingTransaction.cartao?.valorTaxa ?? 0),
                  valorTaxaCentavos: Number(existingTransaction.valorTaxaCentavos ?? existingTransaction.cartao?.valorTaxaCentavos ?? 0),
                  valorLiquido: Number(existingTransaction.valorLiquido ?? existingTransaction.cartao?.valorLiquido ?? existingTransaction.valor ?? 0),
                  valorLiquidoCentavos: Number(existingTransaction.valorLiquidoCentavos ?? existingTransaction.cartao?.valorLiquidoCentavos ?? existingTransaction.valorCentavos ?? toCents(existingTransaction.valor)),
                  cartao: existingTransaction.cartao || null,
                  tipo: 'saida',
                  formaPagamento: existingTransaction.formaPagamento || 'Outros',
                  naturezaFinanceira: movesPhysicalCash
                    ? 'caixa_fisico'
                    : (existingTransaction.naturezaFinanceira || 'bancario_digital'),
                  movimentaCaixaFisico: movesPhysicalCash,
                  status: 'Paga',
                  data: getDateInputInTimeZone(),
                  osId: osRef.id,
                  sourceType: 'cancelamento_ordem_servico',
                  sourceId: osRef.id,
                  sourcePaymentTransactionId: paymentSnapshot.id,
                  idempotencyKey: `cancelamento:${osRef.id}:transacao:${paymentSnapshot.id}`,
                  clienteNome: formData.clienteNome.toUpperCase().trim(),
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
                  ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Cancelada junto com a OS'),
                });
              }
            });
          } else if (formData.status !== 'Cancelada') {
            paymentTransactionSnapshots.forEach((paymentSnapshot) => {
              if (!paymentSnapshot.exists()) return;
              transaction.update(paymentSnapshot.ref, {
                status: 'Pendente',
                movimentaCaixaFisico: false,
                updatedAt: serverTimestamp(),
                ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Reaberta (OS deixou de estar Finalizada)'),
              });
            });
          }
        }

        if (formData.orcamentoId) {
          const novoStatusOrcamento = formData.status === 'Cancelada' ? 'Pendente' : 'Finalizado';
          transaction.update(doc(db, 'orcamentos', formData.orcamentoId), {
            status: novoStatusOrcamento,
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), `OS #${finalNumeroOS} atualizou o status`),
          });
        }
      });

      if (didCancelJustNow) {
        try {
          const { createAuditLog } = await import('../../services/logService');
          createAuditLog({
            tenantId: tenantId || '',
            usuarioId: currentUser.uid,
            usuarioEmail: currentUser.email || currentUser.uid,
            modulo: 'mecanica',
            acao: 'cancelamento',
            descricao: `OS #${finalNumeroOS} cancelada.`,
            registroRelacionadoId: id || finalNumeroOS,
            status: 'sucesso',
            critical: true,
          });
        } catch (logError) {
          console.error('Erro ao registrar log de cancelamento da OS:', logError);
        }
      }

      setFormData(prev => ({
        ...prev,
        numeroOS: finalNumeroOS,
        estoqueBaixado: estoqueFoiBaixado,
        estoqueReservado: novoEstoqueReservado,
        ...(formData.status === 'Finalizada' && paymentSummary ? {
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
      initialSnapshotRef.current = buildDirtySnapshot();
      setIsDirty(false);
      navigate('/os');
      return true;
    } catch (error) {
      console.error('Erro ao salvar OS:', error);
      // Erro de infraestrutura primeiro (disputa entre operadores, queda de
      // rede, permissao recusada): sem isto o texto cru do Firestore chegava
      // na tela -- foi assim que "Missing or insufficient permissions."
      // apareceu pro cliente. As mensagens de negocio lancadas aqui dentro
      // ("Estoque insuficiente para X") continuam vindo pelo fallback, que
      // sao sempre mais especificas do que qualquer texto generico.
      showError(
        'Erro ao salvar',
        describeTransactionError(error)
          || (error instanceof Error && error.message ? error.message : 'Verifique a conexão e tente novamente.'),
      );
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
        <button className="btn-primary" onClick={handleSave} disabled={isLoading} style={{ opacity: isLoading ? 0.7 : 1, display: 'flex', alignItems: 'center' }}>
          {isLoading ? <Loader2 size={18} className="spin-icon" style={{ marginRight: 8 }} /> : <Save size={18} style={{ marginRight: 8 }} />}
          {isLoading ? 'Salvando...' : 'Salvar OS'}
        </button>
      </div>

      <div className="form-grid">
        <div className="form-column">
          
          {/* Controle de Status */}
          <div className="card form-section os-status-card" style={{ borderColor: `${getStatusColor(formData.status)}50` }}>
             <div className="section-header">
              <Activity size={20} className="section-icon" style={{ color: getStatusColor(formData.status) }} />
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
                renderItem={(c) => (
                  <>
                    <span>{c.codigo ? `#${c.codigo} — ${c.nome}` : c.nome}</span>
                    <span>{c.telefone}</span>
                  </>
                )}
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
              <input type="text" name="clienteTelefone" placeholder="(00) 00000-0000" value={formData.clienteTelefone} onChange={handleChange} />
            </div>
          </div>

          <div className="card form-section">
            <div className="section-header">
              <Car size={20} className="section-icon" />
              <h3>Dados do Veículo</h3>
            </div>
            
            {isVeiculoDropdownOpen && veiculosDoCliente.length > 1 && (
              <div style={{ padding: '16px', backgroundColor: 'rgba(59, 130, 246, 0.1)', border: '1px dashed #3b82f6', borderRadius: '8px', marginBottom: '16px' }}>
                <p style={{ color: '#3b82f6', marginBottom: '12px', fontWeight: 'bold' }}>Este cliente possui múltiplos veículos. Selecione qual será atendido:</p>
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
                        }));
                        setIsVeiculoDropdownOpen(false);
                      }}
                      style={{ padding: '8px 16px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}
                    >
                      {v.placa} - {v.modelo}
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
              <div className="input-group"><label>Placa *</label><input type="text" name="placa" placeholder="ABC-1234" style={{ textTransform: 'uppercase' }} value={formData.placa} onChange={handleChange} /></div>
              <div className="input-group"><label>Modelo</label><input type="text" name="modelo" placeholder="Ex: Honda Civic" value={formData.modelo} onChange={handleChange} /></div>
              <div className="input-group"><label>Marca</label><input type="text" name="marca" placeholder="Ex: Honda" value={formData.marca} onChange={handleChange} /></div>
              <div className="input-group"><label>Ano</label><input type="text" name="ano" placeholder="Ex: 2018" value={formData.ano} onChange={handleChange} /></div>
              <div className="input-group"><label>Cor</label><input type="text" name="cor" placeholder="Ex: Prata" value={formData.cor} onChange={handleChange} /></div>
              <div className="input-group"><label>RENAVAM</label><input type="text" name="renavam" placeholder="Ex: 00123456789" value={formData.renavam} onChange={handleChange} /></div>
              <div className="input-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Gauge size={14} /> Quilometragem</label>
                <input type="number" name="quilometragem" placeholder="Ex: 41600" value={formData.quilometragem} onChange={handleChange} min="0" />
              </div>
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

          <div className="card form-section">
            <div className="section-header">
              <FileText size={20} className="section-icon" />
              <h3>Inclusão de Serviços e Mão de Obra</h3>
            </div>
            
            <div className="input-group" style={{ marginBottom: '20px', paddingBottom: '20px', borderBottom: '1px dashed var(--border-color)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                Funcionário Responsável
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
                    setServicoNomeInput(e.target.value);
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
                placeholder="R$ por hora"
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
                            placeholder="Detalhamento do serviço executado"
                            style={{ width: '100%', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '7px 9px', borderRadius: '4px', fontSize: '12px' }}
                          />
                          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginTop: '7px' }}>
                            <label style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Tempo (h)</label>
                            <input
                              type="number"
                              value={getServiceHours(s)}
                              onChange={e => updateTempoServico(index, Number(e.target.value))}
                              placeholder="1,00"
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
                    if (exists) setPecaPrecoInput(String(exists.precoVenda));
                  }}
                  onSelect={(p) => {
                    setPecaNomeInput(p.nome);
                    setPecaPrecoInput(String(p.precoVenda));
                  }}
                  mode={pecaSearchMode}
                  placeholder={`Busque ou digite nova peça — ${DICA_BUSCA_MULTIPLA}`}
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
                    setPecaPrecoInput(String(p.precoVenda));
                  }}
                  mode={pecaSearchMode}
                  renderItem={renderPecaRow}
                  initialQuery={pecaNomeInput}
                  title="Buscar peça"
                />
              </div>

              <input
                type="number"
                placeholder="R$ Valor"
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
                            min="0.001"
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
          onClose={() => setShowAprovacaoDesconto(false)}
          onAprovado={(aprovacao) => setAprovacaoDesconto(aprovacao)}
        />

        <CadastroRapidoClienteModal
          open={cadastroRapidoAberto}
          nomeInicial={formData.clienteNome}
          onClose={() => setCadastroRapidoAberto(false)}
          onCriado={(cliente: ClienteCadastradoRapido) => setFormData({ ...formData, clienteNome: cliente.nome, clienteTelefone: cliente.telefone || formData.clienteTelefone })}
        />

        <div className="form-column">
          <div className="card form-section fill-height">
            <div className="section-header">
              <FileText size={20} className="section-icon" />
              <h3>Relatório Técnico (Impressão)</h3>
            </div>
            <div className="input-group">
              <label>Defeito Relatado (Cliente)</label>
              <textarea name="defeitoRelatado" placeholder="Descreva o problema reclamado pelo cliente..." rows={3} value={formData.defeitoRelatado} onChange={handleChange}></textarea>
            </div>
            <div className="input-group" style={{ flex: 1 }}>
              <label>Relatório do Técnico (O que foi feito)</label>
              <textarea name="relatorioTecnico" placeholder="Descreva tecnicamente o que foi encontrado e reparado no veículo..." rows={10} value={formData.relatorioTecnico} onChange={handleChange}></textarea>
            </div>
            <div className="input-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Package size={14} /> Materiais fornecidos pelo cliente</label>
              <textarea name="materiaisCliente" placeholder="Ex: óleo do motor, filtro de óleo e filtro de ar..." rows={3} value={formData.materiaisCliente} onChange={handleChange}></textarea>
            </div>
            <div className="input-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><ClipboardList size={14} /> Condições de pagamento</label>
              <textarea name="condicoesPagamento" placeholder="Ex: pagamento referente à mão de obra, via Pix na entrega..." rows={3} value={formData.condicoesPagamento} onChange={handleChange}></textarea>
            </div>
            <div className="input-group">
              <label>Observações do recibo</label>
              <textarea name="observacoes" placeholder="Orientações, garantias específicas ou recomendações ao cliente..." rows={4} value={formData.observacoes} onChange={handleChange}></textarea>
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
