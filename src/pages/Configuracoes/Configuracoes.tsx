import React, { useState, useEffect } from 'react';
import { Save, Store, FileText, Loader2, Edit2, CheckCircle, Bell, ChevronDown, ChevronUp, Shield, ListTree, Plus, X, Sliders, LayoutTemplate, Camera, MessageCircle, CreditCard, CalendarClock, Eye, EyeOff, Copy } from 'lucide-react';
import { addDoc, doc, getDoc, setDoc, serverTimestamp, collection, query, where, getDocs, updateDoc, deleteField } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError, showWarning, NexusSwal } from '../../utils/alerts';
import { DEFAULT_OS_PRINT_MODEL, OS_PRINT_MODELS } from '../../utils/osPrintModels';
import { DEFAULT_PEDIDO_PRINT_MODEL, PEDIDO_PRINT_MODELS } from '../../utils/pedidoPrintModels';
import { formatCompanyAddress } from '../../utils/companyAddress';
import { MODULE_GROUPS } from '../../utils/moduleCatalog';
import { PERMISSION_CATALOG } from '../../utils/permissionCatalog';
import { isPlatformAdminRole } from '../../utils/roles';
import {
  DEFAULT_PAGAMENTO_CARTAO_SIMPLIFICADO_ATIVO,
  normalizeCreditCardFeeSchedule,
  parseCreditTerms,
  parseComissaoPercentualInput,
  parsePagamentoCartaoSimplificadoAtivo,
  SIMPLIFIED_CARD_BANK_NAME,
} from '../../utils/financeDomain';
import { DEFAULT_PRODUCT_SEARCH_MODE, type ProductSearchMode } from '../../utils/productSearch';
import { DEFAULT_MOSTRAR_VALOR_LISTA_OS, parseMostrarValorListaOS } from '../../utils/osListaValorDomain';
import { DEFAULT_MOSTRAR_RESUMO_ESTOQUE, parseMostrarResumoEstoque } from '../../utils/estoqueResumoDomain';
import { DEFAULT_CONTROLA_FISCAL, parseControlaFiscal } from '../../utils/fiscalDomain';
import { DEFAULT_EXIGIR_ESCOLHA_FORMA_PAGAMENTO, parseExigirEscolhaFormaPagamento } from '../../utils/financeDomain';
import {
  DEFAULT_PERMITIR_DESCONTO_POR_ITEM,
  DEFAULT_TIPO_DESCONTO_PADRAO,
  parsePermitirDescontoPorItem,
  parseTipoDescontoPadrao,
} from '../../utils/descontoDomain';
import { DEFAULT_REGIME_TRIBUTARIO, REGIME_TRIBUTARIO_OPTIONS, type RegimeTributario } from '../../utils/fiscalDomain';
import { spedyService, type SpedyCity } from '../../services/spedyService';
import { DEFAULT_MOMENTO_BAIXA_ESTOQUE, MOMENTO_BAIXA_ESTOQUE_OPTIONS, type MomentoBaixaEstoque } from '../../utils/estoqueReservaDomain';
import {
  DEFAULT_AGENTE_DIGITAL_ATIVO,
  DEFAULT_ALTERAR_PAGAMENTO_VENDA_FINALIZADA,
  DEFAULT_TRABALHA_COM_PRE_VENDA,
  parseAgenteDigitalAtivo,
  parseAlterarPagamentoVendaFinalizada,
  parseTrabalhaComPreVenda,
} from '../../utils/preVendaDomain';
import {
  DEFAULT_EXIGIR_IDENTIFICACAO_VENDEDOR,
  parseExigirIdentificacaoVendedor,
} from '../../utils/vendedorPinDomain';
import { DEFAULT_VENDER_POR_EMBALAGEM } from '../../utils/embalagemDomain';
import {
  DEFAULT_MODO_LIMITE_DESCONTO,
  parseLimiteDescontoConfig,
  parseModoLimiteDesconto,
  type DescontoTipo,
} from '../../utils/descontoDomain';
import {
  DEFAULT_MODO_VALIDACAO_CLIENTE,
  parseModoValidacaoCliente,
} from '../../utils/clienteValidacaoDomain';
import { parseTrabalhaComLimiteCredito } from '../../utils/creditoDomain';
import { parseMetaFaturamentoMensal } from '../../utils/metaFaturamentoDomain';
import {
  DEFAULT_BLOQUEAR_EXCEDENTE,
  DEFAULT_CONFERENCIA_MERCADORIA,
  DEFAULT_EXIGIR_BIPAGEM,
  DEFAULT_IMPRIMIR_MINUTA_APOS_VENDA,
  DEFAULT_ORDENAR_MINUTA_POR_LOCAL,
} from '../../utils/conferenciaDomain';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { isRegistroDeVendedor } from '../../utils/vendedorCadastroDomain';
import {
  DEFAULT_NIVEL_ACESSO,
  DEFAULT_RESTRINGIR_VENDAS_POR_USUARIO,
  NIVEIS_ACESSO,
  NIVEL_ACESSO_LABELS,
  parseNivelAcesso,
  parseRestringirVendasPorUsuario,
  type NivelAcesso,
} from '../../utils/visibilidadeVendasDomain';
import { aplicarCaixaAltaCadastro } from '../../utils/textoCadastroDomain';

const toStringArray = (value: unknown): string[] => {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
};

const toConfigurationNumber = (value: unknown) => {
  const parsed = Number(String(value ?? '').trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

/** Le um limite de desconto salvo pro formato do formulario (valor como
 * string, vazio quando nao configurado -- mesmo padrao das taxas de cartao
 * neste arquivo). */
const toLimiteDescontoFormValue = (raw: unknown) => {
  const parsed = parseLimiteDescontoConfig(raw);
  return { tipo: parsed.tipo, valor: parsed.valor > 0 ? String(parsed.valor) : '' };
};

const toCreditCardRateInputs = (value: unknown, fallbackFeePercent = 0) => (
  Object.fromEntries(
    Object.entries(normalizeCreditCardFeeSchedule(value, fallbackFeePercent))
      .map(([installments, fee]) => [installments, String(fee)]),
  )
);

const Configuracoes: React.FC = () => {
  const { currentUser, tenantId, userRole } = useAuth();
  const isPlatformAdmin = isPlatformAdminRole(userRole);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const [isEditingMode, setIsEditingMode] = useState(true);
  const [showSuccessAnim, setShowSuccessAnim] = useState(false);
  const [showModulosSistema, setShowModulosSistema] = useState(true);
  const [showDadosOficina, setShowDadosOficina] = useState(false);
  const [showTextosPadroes, setShowTextosPadroes] = useState(true);
  const [showNotificacoesCrm, setShowNotificacoesCrm] = useState(true);
  const [showPermissoes, setShowPermissoes] = useState(false);
  const [showPlanoContas, setShowPlanoContas] = useState(false);
  const [showConfigAvancadas, setShowConfigAvancadas] = useState(false);
  const [showSpedy, setShowSpedy] = useState(false);
  const [novaReceitaInput, setNovaReceitaInput] = useState('');
  const [novaDespesaInput, setNovaDespesaInput] = useState('');

  // Controle de permissões
  const [tenantUsers, setTenantUsers] = useState<any[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [selectedUserPermissions, setSelectedUserPermissions] = useState<string[]>([]);
  const [selectedUserNivelAcesso, setSelectedUserNivelAcesso] = useState<NivelAcesso>(DEFAULT_NIVEL_ACESSO);
  const [copiarPermissoesDeId, setCopiarPermissoesDeId] = useState('');
  const [recebeComissaoServicos, setRecebeComissaoServicos] = useState(false);
  // String, nao number: percentual em branco != percentual zero -- em
  // branco cai pra comissao padrao do sistema (ver resolveComissaoPercentual
  // em financeDomain.ts). Um number sempre teria um valor (0 por padrao),
  // sem jeito de representar "nao preenchido".
  const [comissaoPercentualServicos, setComissaoPercentualServicos] = useState('');
  const [recebeComissaoPecas, setRecebeComissaoPecas] = useState(false);
  const [comissaoPercentualPecas, setComissaoPercentualPecas] = useState('');
  const [isSavingPermissions, setIsSavingPermissions] = useState(false);
  const [moduleBlockedDraft, setModuleBlockedDraft] = useState<string[]>([]);
  const [isSavingTenantModules, setIsSavingTenantModules] = useState(false);

  const [formData, setFormData] = useState({
    logo: '',
    nomeOficina: '',
    nomeUsuario: '',
    cnpj: '',
    inscricaoEstadual: '',
    regimeTributario: DEFAULT_REGIME_TRIBUTARIO as RegimeTributario,
    controlaFiscal: DEFAULT_CONTROLA_FISCAL,
    telefone: '',
    whatsapp: '',
    instagram: '',
    rua: '',
    numero: '',
    bairro: '',
    cep: '',
    endereco: '',
    email: '',
    garantiaPadrao: '',
    diasNotificacaoLembrete: '15',
    venderSemEstoque: false,
    validarCadastroProduto: false,
    venderPorEmbalagem: DEFAULT_VENDER_POR_EMBALAGEM,
    modoLimiteDesconto: DEFAULT_MODO_LIMITE_DESCONTO,
    limiteDescontoOS: { tipo: 'percentual' as DescontoTipo, valor: '' },
    limiteDescontoPedido: { tipo: 'percentual' as DescontoTipo, valor: '' },
    limiteDescontoOrcamento: { tipo: 'percentual' as DescontoTipo, valor: '' },
    limiteDescontoPdv: { tipo: 'percentual' as DescontoTipo, valor: '' },
    permitirDescontoPorItem: DEFAULT_PERMITIR_DESCONTO_POR_ITEM,
    tipoDescontoPadrao: DEFAULT_TIPO_DESCONTO_PADRAO as DescontoTipo,
    modoValidacaoCliente: DEFAULT_MODO_VALIDACAO_CLIENTE,
    trabalhaComLimiteCredito: false,
    buscaProdutoModo: DEFAULT_PRODUCT_SEARCH_MODE as ProductSearchMode,
    momentoBaixaEstoque: DEFAULT_MOMENTO_BAIXA_ESTOQUE as MomentoBaixaEstoque,
    trabalhaComPreVenda: DEFAULT_TRABALHA_COM_PRE_VENDA,
    agenteDigitalAtivo: DEFAULT_AGENTE_DIGITAL_ATIVO,
    alterarPagamentoVendaFinalizada: DEFAULT_ALTERAR_PAGAMENTO_VENDA_FINALIZADA,
    exigirIdentificacaoVendedor: DEFAULT_EXIGIR_IDENTIFICACAO_VENDEDOR,
    devolucaoBotaoSeparado: false,
    // Usado so quando o vendedor/mecanico tem "Recebe comissao?" marcado
    // sim mas nao preencheu um percentual proprio -- ver
    // resolveComissaoPercentual em financeDomain.ts.
    comissaoPadraoPecas: '',
    comissaoPadraoServicos: '',
    /** Meta de faturamento do mes (R$). Vazio/0 = sem meta -- o Dashboard
     * mostra o indicador de pipeline no lugar do anel de meta. */
    metaFaturamentoMensal: '',
    restringirVendasPorUsuario: DEFAULT_RESTRINGIR_VENDAS_POR_USUARIO,
    conferenciaMercadoria: DEFAULT_CONFERENCIA_MERCADORIA,
    imprimirMinutaAposVenda: DEFAULT_IMPRIMIR_MINUTA_APOS_VENDA,
    exigirBipagem: DEFAULT_EXIGIR_BIPAGEM,
    bloquearExcedente: DEFAULT_BLOQUEAR_EXCEDENTE,
    ordenarMinutaPorLocal: DEFAULT_ORDENAR_MINUTA_POR_LOCAL,
    emiteNFe: false,
    emiteNFCe: false,
    emiteNFSe: false,
    diasCrediario: '30',
    maxParcelasCartao: '12',
    pagamentoCartaoSimplificadoAtivo: DEFAULT_PAGAMENTO_CARTAO_SIMPLIFICADO_ATIVO,
    exigirEscolhaFormaPagamento: DEFAULT_EXIGIR_ESCOLHA_FORMA_PAGAMENTO,
    taxasCartaoCreditoPorParcela: toCreditCardRateInputs(null),
    taxaCartaoDebitoPercentual: '0',
    prazoRecebimentoCartaoCreditoDias: '30',
    prazoRecebimentoCartaoDebitoDias: '1',
    planoContasReceitas: ['Serviços', 'Venda de Produtos', 'Outras Receitas'],
    planoContasDespesas: ['Aluguel', 'Água/Luz/Internet', 'Salários', 'Impostos', 'Fornecedores de Produtos', 'Marketing', 'Manutenção', 'Outros'],
    modeloImpressaoOS: DEFAULT_OS_PRINT_MODEL,
    mostrarValorListaOS: DEFAULT_MOSTRAR_VALOR_LISTA_OS,
    mostrarResumoEstoque: DEFAULT_MOSTRAR_RESUMO_ESTOQUE,
    modeloImpressaoPedidoVenda: DEFAULT_PEDIDO_PRINT_MODEL,
    observacoesPadraoPedido: '',
    spedyEnabled: false,
    spedyApiKey: '',
    spedyEnvironment: 'sandbox',
    nfseCidadeCodigo: '',
    nfseCidadeNome: '',
    nfseCidadeEstado: '',
    nfseInscricaoMunicipal: '',
    nfseCodigoServicoMunicipal: '',
    nfseCodigoServicoFederal: '',
    nfseAliquotaIssPadrao: '0'
  });

  const [cidadeSearchTerm, setCidadeSearchTerm] = useState('');
  const [cidadeSearchResults, setCidadeSearchResults] = useState<SpedyCity[]>([]);
  const [isCidadeSearching, setIsCidadeSearching] = useState(false);
  const [showCidadeDropdown, setShowCidadeDropdown] = useState(false);
  // true quando a leitura de configuracoes_privadas falhou (ex: erro de
  // permissao/rede) -- nesse caso o campo spedyApiKey no formData fica vazio
  // sem sabermos se e' porque o tenant realmente nao tem chave, ou porque so
  // nao conseguimos ler. Salvar as configuracoes nao pode apagar a chave
  // real so por causa disso (bug achado ao vivo: salvar com a leitura
  // falhando zerava a integracao Spedy do tenant).
  const [spedyPrivateConfigLoadFailed, setSpedyPrivateConfigLoadFailed] = useState(false);
  const [mostrarSpedyApiKey, setMostrarSpedyApiKey] = useState(false);

  useEffect(() => {
    const fetchConfig = async () => {
      if (!currentUser || !tenantId) return;
      try {
        // Busca Configurações
        const docRef = doc(db, 'configuracoes', tenantId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          let privateSpedyApiKey = data.spedyApiKey ?? '';
          try {
            const privateSnap = await getDoc(doc(db, 'configuracoes_privadas', tenantId));
            if (privateSnap.exists()) {
              privateSpedyApiKey = privateSnap.data().spedyApiKey ?? privateSpedyApiKey;
            }
            setSpedyPrivateConfigLoadFailed(false);
          } catch (privateError) {
            console.warn('Nao foi possivel carregar configuracoes privadas:', privateError);
            setSpedyPrivateConfigLoadFailed(true);
            showError('Aviso', 'Não foi possível carregar a chave da integração fiscal (Spedy) já configurada. Salvar aqui não vai apagá-la, mas o campo abaixo pode aparecer vazio mesmo com uma chave já cadastrada.');
          }
          let receitas = data.planoContasReceitas || [];
          if (typeof receitas === 'string') receitas = receitas.split('\n').filter((c: string) => c.trim() !== '');
          let despesas = data.planoContasDespesas || [];
          if (typeof despesas === 'string') despesas = despesas.split('\n').filter((c: string) => c.trim() !== '');

          setFormData({
            ...data,
            venderSemEstoque: data.venderSemEstoque ?? false,
            validarCadastroProduto: data.validarCadastroProduto ?? false,
            venderPorEmbalagem: data.venderPorEmbalagem ?? DEFAULT_VENDER_POR_EMBALAGEM,
            modoLimiteDesconto: parseModoLimiteDesconto(data.modoLimiteDesconto),
            limiteDescontoOS: toLimiteDescontoFormValue(data.limiteDescontoOS),
            limiteDescontoPedido: toLimiteDescontoFormValue(data.limiteDescontoPedido),
            limiteDescontoOrcamento: toLimiteDescontoFormValue(data.limiteDescontoOrcamento),
            limiteDescontoPdv: toLimiteDescontoFormValue(data.limiteDescontoPdv),
            permitirDescontoPorItem: parsePermitirDescontoPorItem(data.permitirDescontoPorItem),
            tipoDescontoPadrao: parseTipoDescontoPadrao(data.tipoDescontoPadrao),
            modoValidacaoCliente: parseModoValidacaoCliente(data.modoValidacaoCliente),
            trabalhaComLimiteCredito: parseTrabalhaComLimiteCredito(data.trabalhaComLimiteCredito),
            buscaProdutoModo: data.buscaProdutoModo === 'exata' ? 'exata' : DEFAULT_PRODUCT_SEARCH_MODE,
            momentoBaixaEstoque: (data.momentoBaixaEstoque ?? DEFAULT_MOMENTO_BAIXA_ESTOQUE) as MomentoBaixaEstoque,
            trabalhaComPreVenda: parseTrabalhaComPreVenda(data.trabalhaComPreVenda),
            agenteDigitalAtivo: parseAgenteDigitalAtivo(data.agenteDigitalAtivo),
            alterarPagamentoVendaFinalizada: parseAlterarPagamentoVendaFinalizada(data.alterarPagamentoVendaFinalizada),
            exigirIdentificacaoVendedor: parseExigirIdentificacaoVendedor(data.exigirIdentificacaoVendedor),
            devolucaoBotaoSeparado: data.devolucaoBotaoSeparado === true,
            comissaoPadraoPecas: data.comissaoPadraoPecas != null ? String(data.comissaoPadraoPecas) : '',
            comissaoPadraoServicos: data.comissaoPadraoServicos != null ? String(data.comissaoPadraoServicos) : '',
            // 0 (sem meta) volta como campo vazio, nao como "0" -- o campo
            // em branco e' o que comunica "nao trabalho com meta".
            metaFaturamentoMensal: parseMetaFaturamentoMensal(data.metaFaturamentoMensal) > 0
              ? String(parseMetaFaturamentoMensal(data.metaFaturamentoMensal))
              : '',
            restringirVendasPorUsuario: parseRestringirVendasPorUsuario(data.restringirVendasPorUsuario),
            conferenciaMercadoria: data.conferenciaMercadoria ?? DEFAULT_CONFERENCIA_MERCADORIA,
            imprimirMinutaAposVenda: data.imprimirMinutaAposVenda ?? DEFAULT_IMPRIMIR_MINUTA_APOS_VENDA,
            exigirBipagem: data.exigirBipagem ?? DEFAULT_EXIGIR_BIPAGEM,
            bloquearExcedente: data.bloquearExcedente ?? DEFAULT_BLOQUEAR_EXCEDENTE,
            ordenarMinutaPorLocal: data.ordenarMinutaPorLocal ?? DEFAULT_ORDENAR_MINUTA_POR_LOCAL,
            emiteNFe: data.emiteNFe ?? false,
            emiteNFCe: data.emiteNFCe ?? false,
            emiteNFSe: data.emiteNFSe ?? false,
            regimeTributario: (data.regimeTributario ?? DEFAULT_REGIME_TRIBUTARIO) as RegimeTributario,
            controlaFiscal: parseControlaFiscal(data.controlaFiscal),
            whatsapp: data.whatsapp ?? '',
            instagram: data.instagram ?? '',
            inscricaoEstadual: data.inscricaoEstadual ?? '',
            rua: data.rua ?? data.endereco ?? '',
            numero: data.numero ?? '',
            bairro: data.bairro ?? '',
            cep: data.cep ?? '',
            diasCrediario: data.diasCrediario ?? '30',
            maxParcelasCartao: String(Math.min(12, Math.max(1, Number(data.maxParcelasCartao ?? 12) || 12))),
            pagamentoCartaoSimplificadoAtivo: parsePagamentoCartaoSimplificadoAtivo(data.pagamentoCartaoSimplificadoAtivo),
            exigirEscolhaFormaPagamento: parseExigirEscolhaFormaPagamento(data.exigirEscolhaFormaPagamento),
            taxasCartaoCreditoPorParcela: toCreditCardRateInputs(
              data.taxasCartaoCreditoPorParcela,
              data.taxaCartaoCreditoPercentual ?? 0,
            ),
            taxaCartaoDebitoPercentual: String(data.taxaCartaoDebitoPercentual ?? 0),
            prazoRecebimentoCartaoCreditoDias: String(data.prazoRecebimentoCartaoCreditoDias ?? 30),
            prazoRecebimentoCartaoDebitoDias: String(data.prazoRecebimentoCartaoDebitoDias ?? 1),
            planoContasReceitas: receitas,
            planoContasDespesas: despesas,
            modeloImpressaoOS: data.modeloImpressaoOS || DEFAULT_OS_PRINT_MODEL,
            mostrarValorListaOS: parseMostrarValorListaOS(data.mostrarValorListaOS),
            mostrarResumoEstoque: parseMostrarResumoEstoque(data.mostrarResumoEstoque),
            modeloImpressaoPedidoVenda: data.modeloImpressaoPedidoVenda || DEFAULT_PEDIDO_PRINT_MODEL,
            observacoesPadraoPedido: data.observacoesPadraoPedido || '',
            spedyEnabled: data.spedyEnabled ?? false,
            spedyApiKey: privateSpedyApiKey,
            spedyEnvironment: data.spedyEnvironment ?? 'sandbox',
            nfseCidadeCodigo: data.nfseCidadeCodigo ?? '',
            nfseCidadeNome: data.nfseCidadeNome ?? '',
            nfseCidadeEstado: data.nfseCidadeEstado ?? '',
            nfseInscricaoMunicipal: data.nfseInscricaoMunicipal ?? '',
            nfseCodigoServicoMunicipal: data.nfseCodigoServicoMunicipal ?? '',
            nfseCodigoServicoFederal: data.nfseCodigoServicoFederal ?? '',
            nfseAliquotaIssPadrao: String(data.nfseAliquotaIssPadrao ?? 0)
          } as any);
          setIsEditingMode(false);
        } else {
          const userProfileSnap = await getDoc(doc(db, 'usuarios', currentUser.uid));
          if (userProfileSnap.exists()) {
            const profileData = userProfileSnap.data();
            setFormData(prev => ({
              ...prev,
              nomeOficina: profileData.nomeOficina || '',
              nomeUsuario: profileData.nomeResponsavel || '',
              email: profileData.email || currentUser.email || ''
            }));
          } else {
            setFormData(prev => ({
              ...prev,
              email: currentUser.email || ''
            }));
          }
          setIsEditingMode(true);
        }

        // Busca usuários da empresa para o controle de permissões
        const qUsers = query(collection(db, 'usuarios'), where('tenantId', '==', tenantId));
        const qSnap = await getDocs(qUsers);
        const usersList: any[] = [];
        qSnap.forEach(u => {
          const uData = u.data();
          // Vendedor de balcao nao entra no sistema: nao ha modulo pra
          // liberar nem tela pra bloquear. As regras de comissao dele ficam
          // no proprio cadastro, em Cadastros Auxiliares > Vendedores.
          if (isRegistroDeVendedor(uData)) return;
          // Allow listing Admin to satisfy user request
          usersList.push({ id: u.id, ...uData });
        });
        setTenantUsers(usersList);

        if (isPlatformAdmin && tenantId) {
          const ownerSnap = await getDoc(doc(db, 'usuarios', tenantId));
          const ownerBlockedModules = ownerSnap.exists() ? toStringArray(ownerSnap.data().modulosBloqueados) : [];
          const configBlockedModules = docSnap.exists() ? toStringArray(docSnap.data().modulosBloqueados) : [];
          setModuleBlockedDraft(ownerBlockedModules.length > 0 ? ownerBlockedModules : configBlockedModules);
        } else {
          setModuleBlockedDraft([]);
        }

      } catch (error) {
        console.error("Erro ao buscar configurações:", error);
      } finally {
        setIsFetching(false);
      }
    };
    fetchConfig();
  }, [currentUser, tenantId, isPlatformAdmin]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: aplicarCaixaAltaCadastro(e.target, e.target.value) });
  };

  // Busca ao vivo de cidades integradas a Spedy pra NFS-e -- exige a
  // chave da Spedy ja salva no banco (o backend le de la, nao do
  // formData em memoria), entao so funciona depois que a config da
  // Spedy acima foi salva pelo menos uma vez.
  useEffect(() => {
    if (cidadeSearchTerm.trim().length < 3) {
      setCidadeSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setIsCidadeSearching(true);
      try {
        const result = await spedyService.searchServiceInvoiceCities('', 'sandbox', cidadeSearchTerm.trim());
        setCidadeSearchResults(result.items || []);
      } catch (error) {
        console.error('Erro ao buscar cidades da Spedy:', error);
        setCidadeSearchResults([]);
      } finally {
        setIsCidadeSearching(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [cidadeSearchTerm]);

  const handleSelectCidade = (cidade: SpedyCity) => {
    setFormData(prev => ({
      ...prev,
      nfseCidadeCodigo: cidade.code || '',
      nfseCidadeNome: cidade.name || '',
      nfseCidadeEstado: cidade.state || ''
    }));
    setCidadeSearchTerm('');
    setCidadeSearchResults([]);
    setShowCidadeDropdown(false);
  };

  const handleAddReceita = () => {
    if (!novaReceitaInput.trim()) return;
    setFormData(prev => ({ ...prev, planoContasReceitas: [...prev.planoContasReceitas, novaReceitaInput.trim()] }));
    setNovaReceitaInput('');
  };

  const handleRemoveReceita = (index: number) => {
    setFormData(prev => ({ ...prev, planoContasReceitas: prev.planoContasReceitas.filter((_, i) => i !== index) }));
  };

  const handleAddDespesa = () => {
    if (!novaDespesaInput.trim()) return;
    setFormData(prev => ({ ...prev, planoContasDespesas: [...prev.planoContasDespesas, novaDespesaInput.trim()] }));
    setNovaDespesaInput('');
  };

  const handleRemoveDespesa = (index: number) => {
    setFormData(prev => ({ ...prev, planoContasDespesas: prev.planoContasDespesas.filter((_, i) => i !== index) }));
  };

  /**
   * Primeiro precedente no sistema de "confirmar ANTES de marcar um
   * checkbox de configuracao" -- este toggle muda o comportamento de
   * DUAS telas de uma vez (exige PIN na venda + esconde a lista geral de
   * Pedidos de Venda do funcionario comum), entao o usuario precisa saber
   * disso antes de ligar, nao descobrir depois. Desligar nao precisa de
   * aviso: nao ha risco de travar nada.
   *
   * Usa o updater funcional do setFormData -- o NexusSwal.fire fica
   * aberto esperando o clique, e o formData pode ter mudado nesse meio
   * tempo (usuario mexeu em outro campo antes de decidir).
   */
  const handleToggleExigirIdentificacaoVendedor = (ligar: boolean) => {
    if (!ligar) {
      setFormData((atual) => ({ ...atual, exigirIdentificacaoVendedor: false }));
      return;
    }

    NexusSwal.fire({
      icon: 'warning',
      title: 'Ativar identificação do vendedor a cada venda?',
      html: `
        <div style="text-align:left; font-size:14px; line-height:1.6;">
          <p style="margin:0 0 10px;">A partir de agora:</p>
          <ul style="margin:0 0 12px; padding-left:20px;">
            <li>Toda <strong>venda finalizada</strong> ou <strong>pré-venda</strong> gravada vai pedir o <strong>código (2 dígitos)</strong> e a <strong>senha (de 2 a 10 dígitos)</strong> do vendedor antes de concluir.</li>
            <li>A lista geral de <strong>Pedidos de Venda</strong> deixa de aparecer para quem não é dono, Master ou Admin da empresa. Esses usuários passam a usar a nova tela <strong>Minhas Vendas</strong>, que mostra só as vendas do próprio vendedor.</li>
          </ul>
          <p style="margin:0;"><strong>Antes de confirmar:</strong> cadastre código e senha de pelo menos um vendedor em Usuários. Sem isso, ninguém consegue finalizar uma venda.</p>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Sim, ativar',
      cancelButtonText: 'Cancelar',
      reverseButtons: true,
    }).then((result) => {
      if (result.isConfirmed) {
        setFormData((atual) => ({ ...atual, exigirIdentificacaoVendedor: true }));
      }
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !tenantId) return;

    if (formData.cnpj) {
      const cnpjLimpo = formData.cnpj.replace(/\D/g, '');
      if (cnpjLimpo.length !== 14) {
        showError('Atenção', 'O CNPJ deve conter 14 dígitos válidos.');
        return;
      }
    }

    const creditTerms = parseCreditTerms(formData.diasCrediario);
    if (creditTerms.length === 0) {
      showError('Configuração financeira inválida', 'Informe pelo menos um prazo de crediário maior que zero.');
      return;
    }

    const maxCardInstallments = toConfigurationNumber(formData.maxParcelasCartao);
    const debitCardFee = toConfigurationNumber(formData.taxaCartaoDebitoPercentual);
    const creditCardSettlementDays = toConfigurationNumber(formData.prazoRecebimentoCartaoCreditoDias);
    const debitCardSettlementDays = toConfigurationNumber(formData.prazoRecebimentoCartaoDebitoDias);
    const comissaoPadraoPecasValor = toConfigurationNumber(formData.comissaoPadraoPecas);
    const comissaoPadraoServicosValor = toConfigurationNumber(formData.comissaoPadraoServicos);
    const creditCardFees = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => {
        const installments = String(index + 1);
        return [installments, toConfigurationNumber(formData.taxasCartaoCreditoPorParcela[installments])];
      }),
    );

    if (!Number.isInteger(maxCardInstallments) || maxCardInstallments < 1 || maxCardInstallments > 12) {
      showError('Configuração financeira inválida', 'O máximo de parcelas deve ser um número inteiro entre 1 e 12.');
      return;
    }
    if (
      !Number.isFinite(debitCardFee) ||
      debitCardFee < 0 ||
      debitCardFee > 100 ||
      Object.values(creditCardFees).some((fee) => !Number.isFinite(fee) || fee < 0 || fee > 100)
    ) {
      showError('Configuração financeira inválida', 'Todas as taxas dos cartões devem estar entre 0% e 100%.');
      return;
    }
    if (
      !Number.isInteger(creditCardSettlementDays) ||
      !Number.isInteger(debitCardSettlementDays) ||
      creditCardSettlementDays < 0 ||
      creditCardSettlementDays > 365 ||
      debitCardSettlementDays < 0 ||
      debitCardSettlementDays > 365
    ) {
      showError('Configuração financeira inválida', 'Os prazos de recebimento devem ser números inteiros entre 0 e 365 dias.');
      return;
    }

    const nfseAliquotaIssPadrao = toConfigurationNumber(formData.nfseAliquotaIssPadrao);
    if (!Number.isFinite(nfseAliquotaIssPadrao) || nfseAliquotaIssPadrao < 0 || nfseAliquotaIssPadrao > 100) {
      showError('Configuração de NFS-e inválida', 'A alíquota de ISS padrão deve estar entre 0% e 100%.');
      return;
    }
    if (
      !Number.isFinite(comissaoPadraoPecasValor) || comissaoPadraoPecasValor < 0 || comissaoPadraoPecasValor > 100 ||
      !Number.isFinite(comissaoPadraoServicosValor) || comissaoPadraoServicosValor < 0 || comissaoPadraoServicosValor > 100
    ) {
      showError('Configuração de comissão inválida', 'A comissão padrão do sistema deve estar entre 0% e 100%.');
      return;
    }

    // Meta de faturamento: campo vazio = sem meta (0), valido. Numero
    // negativo ou texto e' erro de digitacao -- avisa em vez de gravar 0
    // calado, que pareceria "salvou" e sumiria com a meta.
    const metaFaturamentoInformada = formData.metaFaturamentoMensal.trim();
    const metaFaturamentoValor = metaFaturamentoInformada === ''
      ? 0
      : toConfigurationNumber(formData.metaFaturamentoMensal);
    if (metaFaturamentoInformada !== '' && (!Number.isFinite(metaFaturamentoValor) || metaFaturamentoValor <= 0)) {
      showError('Meta de faturamento inválida', 'Informe um valor maior que zero, ou deixe o campo em branco para não trabalhar com meta.');
      return;
    }

    // Limite de desconto: campo vazio = sem limite (0), valido em qualquer
    // tela. Percentual tem teto de 100; valor (R$) so nao pode ser negativo.
    const buildLimiteDesconto = (raw: { tipo: DescontoTipo; valor: string }) => {
      const valor = raw.valor.trim() === '' ? 0 : toConfigurationNumber(raw.valor);
      return { tipo: raw.tipo, valor: Number.isFinite(valor) ? Math.max(0, valor) : NaN };
    };
    const limitesDesconto = {
      limiteDescontoOS: buildLimiteDesconto(formData.limiteDescontoOS),
      limiteDescontoPedido: buildLimiteDesconto(formData.limiteDescontoPedido),
      limiteDescontoOrcamento: buildLimiteDesconto(formData.limiteDescontoOrcamento),
      limiteDescontoPdv: buildLimiteDesconto(formData.limiteDescontoPdv),
    };
    const limiteInvalido = Object.values(limitesDesconto).some(({ tipo, valor }) => (
      !Number.isFinite(valor) || (tipo === 'percentual' && valor > 100)
    ));
    if (limiteInvalido) {
      showError('Limite de desconto inválido', 'O limite percentual deve estar entre 0% e 100%. Deixe em branco para não limitar.');
      return;
    }

    setIsLoading(true);
    try {
      const docRef = doc(db, 'configuracoes', tenantId);
      const privateDocRef = doc(db, 'configuracoes_privadas', tenantId);
      const enderecoCompleto = formatCompanyAddress(formData);
      const { spedyApiKey, ...publicFormData } = formData;
      const trimmedSpedyApiKey = spedyApiKey.trim();
      // Se a leitura da chave privada falhou no carregamento, o campo pode
      // estar vazio sem isso significar "remover a chave" -- so mexe na
      // integracao Spedy aqui se a leitura funcionou, ou se o usuario
      // digitou uma chave nova (nesse caso a intencao e' explicita).
      const podeAtualizarSpedyApiKey = !spedyPrivateConfigLoadFailed || trimmedSpedyApiKey !== '';

      if (podeAtualizarSpedyApiKey) {
        await setDoc(privateDocRef, {
          tenantId,
          spedyApiKey: trimmedSpedyApiKey,
          updatedAt: serverTimestamp(),
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp()),
        }, { merge: true });
      }

      await setDoc(docRef, {
        ...publicFormData,
        diasCrediario: creditTerms.join(', '),
        maxParcelasCartao: maxCardInstallments,
        taxasCartaoCreditoPorParcela: creditCardFees,
        taxaCartaoCreditoPercentual: creditCardFees['1'],
        taxaCartaoDebitoPercentual: debitCardFee,
        prazoRecebimentoCartaoCreditoDias: creditCardSettlementDays,
        prazoRecebimentoCartaoDebitoDias: debitCardSettlementDays,
        comissaoPadraoPecas: comissaoPadraoPecasValor,
        comissaoPadraoServicos: comissaoPadraoServicosValor,
        metaFaturamentoMensal: metaFaturamentoValor,
        endereco: enderecoCompleto,
        nfseAliquotaIssPadrao,
        ...limitesDesconto,
        modoLimiteDesconto: formData.modoLimiteDesconto,
        spedyApiKey: deleteField(),
        ...(podeAtualizarSpedyApiKey ? { spedyApiKeyConfigured: Boolean(trimmedSpedyApiKey) } : {}),
        tenantId,
        updatedAt: serverTimestamp(),
        ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp()),
      }, { merge: true });

      // Pagamento de cartão simplificado precisa de um banco de destino fixo
      // pra nao pedir escolha na venda -- garante que "BANCO" existe assim
      // que a opcao e' ligada, em vez de deixar a venda descobrir isso na
      // hora de finalizar. Nao mexe se ja existir (mesmo inativo -- respeita
      // uma desativacao deliberada em vez de recriar por baixo).
      if (formData.pagamentoCartaoSimplificadoAtivo) {
        const bancosSnap = await getDocs(query(collection(db, 'bancos'), where('tenantId', '==', tenantId)));
        const bancoPadraoJaExiste = bancosSnap.docs.some((bancoDoc) => (
          String(bancoDoc.data().nome || '').trim().toLowerCase() === SIMPLIFIED_CARD_BANK_NAME.toLowerCase()
        ));
        if (!bancoPadraoJaExiste) {
          const maiorOrdem = bancosSnap.docs.reduce(
            (max, bancoDoc) => Math.max(max, Number(bancoDoc.data().ordem) || 0),
            -1,
          );
          await addDoc(collection(db, 'bancos'), {
            nome: SIMPLIFIED_CARD_BANK_NAME,
            banco: '',
            agencia: '',
            conta: '',
            tipoConta: 'corrente',
            ativo: true,
            ordem: maiorOrdem + 1,
            saldoInicialCentavos: 0,
            saldoCentavos: 0,
            tenantId,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
          });
        }
      }

      setFormData((current) => ({
        ...current,
        diasCrediario: creditTerms.join(', '),
        maxParcelasCartao: String(maxCardInstallments),
        taxasCartaoCreditoPorParcela: Object.fromEntries(
          Object.entries(creditCardFees).map(([installments, fee]) => [installments, String(fee)]),
        ),
        taxaCartaoDebitoPercentual: String(debitCardFee),
        prazoRecebimentoCartaoCreditoDias: String(creditCardSettlementDays),
        prazoRecebimentoCartaoDebitoDias: String(debitCardSettlementDays),
        comissaoPadraoPecas: String(comissaoPadraoPecasValor),
        comissaoPadraoServicos: String(comissaoPadraoServicosValor),
        metaFaturamentoMensal: metaFaturamentoValor > 0 ? String(metaFaturamentoValor) : '',
        nfseAliquotaIssPadrao: String(nfseAliquotaIssPadrao),
        limiteDescontoOS: { tipo: limitesDesconto.limiteDescontoOS.tipo, valor: limitesDesconto.limiteDescontoOS.valor > 0 ? String(limitesDesconto.limiteDescontoOS.valor) : '' },
        limiteDescontoPedido: { tipo: limitesDesconto.limiteDescontoPedido.tipo, valor: limitesDesconto.limiteDescontoPedido.valor > 0 ? String(limitesDesconto.limiteDescontoPedido.valor) : '' },
        limiteDescontoOrcamento: { tipo: limitesDesconto.limiteDescontoOrcamento.tipo, valor: limitesDesconto.limiteDescontoOrcamento.valor > 0 ? String(limitesDesconto.limiteDescontoOrcamento.valor) : '' },
        limiteDescontoPdv: { tipo: limitesDesconto.limiteDescontoPdv.tipo, valor: limitesDesconto.limiteDescontoPdv.valor > 0 ? String(limitesDesconto.limiteDescontoPdv.valor) : '' },
      }));
      setIsEditingMode(false);
      setShowSuccessAnim(true);
      setTimeout(() => setShowSuccessAnim(false), 2000);

    } catch (error) {
      console.error("Erro ao salvar:", error);
      showError('Erro ao salvar', 'Não foi possível salvar as configurações.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleUserSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const uId = e.target.value;
    setSelectedUserId(uId);
    setCopiarPermissoesDeId('');
    if (uId) {
      const user = tenantUsers.find(u => u.id === uId);
      setSelectedUserPermissions(user?.permissoes || []);
      setSelectedUserNivelAcesso(parseNivelAcesso(user?.nivelAcesso));
      setRecebeComissaoServicos(user?.recebeComissaoServicos || false);
      setComissaoPercentualServicos(user?.comissaoPercentualServicos != null ? String(user.comissaoPercentualServicos) : '');
      setRecebeComissaoPecas(user?.recebeComissaoPecas || false);
      setComissaoPercentualPecas(user?.comissaoPercentualPecas != null ? String(user.comissaoPercentualPecas) : '');
    } else {
      setSelectedUserPermissions([]);
      setSelectedUserNivelAcesso(DEFAULT_NIVEL_ACESSO);
      setRecebeComissaoServicos(false);
      setComissaoPercentualServicos('');
      setRecebeComissaoPecas(false);
      setComissaoPercentualPecas('');
    }
  };

  /** So copia permissoes + nivel de acesso -- comissao e' remuneracao
   * pessoal, nao "acesso", entao fica de fora (pedido do usuario,
   * 2026-08-27). Nao salva sozinho: so preenche a tela, o admin ainda
   * revisa e clica em "Salvar Acessos" pra confirmar. */
  const handleCopiarPermissoes = () => {
    if (!copiarPermissoesDeId) return;
    const origem = tenantUsers.find(u => u.id === copiarPermissoesDeId);
    if (!origem) return;
    setSelectedUserPermissions([...(origem.permissoes || [])]);
    setSelectedUserNivelAcesso(parseNivelAcesso(origem.nivelAcesso));
    showWarning('Permissões copiadas', `Permissões e nível de acesso de ${origem.nome} copiados para a tela. Revise e clique em "Salvar Acessos" para confirmar.`);
  };

  const togglePermission = (perm: string) => {
    setSelectedUserPermissions(prev =>
      prev.includes(perm) ? prev.filter(p => p !== perm) : [...prev, perm]
    );
  };

  const handleSavePermissions = async () => {
    if (!selectedUserId || !currentUser) return;
    setIsSavingPermissions(true);
    try {
      // Percentual em branco (undefined) cai pra comissao padrao do sistema
      // na hora da venda -- por isso a chave e' OMITIDA, nunca gravada como
      // 0 (regra do CLAUDE.md: nunca undefined tambem, entao e' de fato
      // "sem a chave", nao "chave com undefined").
      const percentualServicosValor = parseComissaoPercentualInput(comissaoPercentualServicos);
      const percentualPecasValor = parseComissaoPercentualInput(comissaoPercentualPecas);
      const updatePayload: Record<string, unknown> = {
        permissoes: selectedUserPermissions,
        nivelAcesso: selectedUserNivelAcesso,
        recebeComissaoServicos: recebeComissaoServicos,
        comissaoPercentualServicos: percentualServicosValor,
        recebeComissaoPecas: recebeComissaoPecas,
        comissaoPercentualPecas: percentualPecasValor,
        ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Permissões/regras de comissão atualizadas'),
      };
      // updateDoc so mescla campos presentes no payload -- so OMITIR a
      // chave deixaria uma comissao antiga gravada intacta se o usuario
      // limpou o campo pra voltar ao fallback do sistema. deleteField()
      // remove de verdade (updateDoc sempre edita cadastro existente aqui).
      if (percentualServicosValor === undefined) updatePayload.comissaoPercentualServicos = deleteField();
      if (percentualPecasValor === undefined) updatePayload.comissaoPercentualPecas = deleteField();
      await updateDoc(doc(db, 'usuarios', selectedUserId), updatePayload);
      // Atualiza o estado local para não perder
      setTenantUsers(prev => prev.map(u => u.id === selectedUserId ? {
        ...u,
        permissoes: selectedUserPermissions,
        nivelAcesso: selectedUserNivelAcesso,
        recebeComissaoServicos: recebeComissaoServicos,
        comissaoPercentualServicos: percentualServicosValor,
        recebeComissaoPecas: recebeComissaoPecas,
        comissaoPercentualPecas: percentualPecasValor
      } : u));

      setShowSuccessAnim(true);
      showSuccess('Permissões e regras salvas com sucesso!');
      setTimeout(() => setShowSuccessAnim(false), 2000);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      console.error(err);
      showError('Erro', 'Não foi possível salvar as permissões.');
    } finally {
      setIsSavingPermissions(false);
    }
  };

  const toggleTenantModule = (moduleId: string) => {
    setModuleBlockedDraft(prev =>
      prev.includes(moduleId)
        ? prev.filter(id => id !== moduleId)
        : [...prev, moduleId]
    );
  };

  const handleSaveTenantModules = async () => {
    if (!tenantId) {
      showError('Atenção', 'Selecione uma empresa ativa para configurar os módulos.');
      return;
    }
    if (!currentUser) return;

    setIsSavingTenantModules(true);
    try {
      await updateDoc(doc(db, 'usuarios', tenantId), {
        modulosBloqueados: moduleBlockedDraft,
        updatedAt: serverTimestamp(),
        ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Módulos bloqueados atualizados'),
      });

      try {
        await updateDoc(doc(db, 'configuracoes', tenantId), {
          modulosBloqueados: moduleBlockedDraft,
          updatedAt: serverTimestamp(),
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Módulos bloqueados atualizados'),
        });
      } catch {
        await setDoc(doc(db, 'configuracoes', tenantId), {
          tenantId,
          modulosBloqueados: moduleBlockedDraft,
          updatedAt: serverTimestamp(),
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Módulos bloqueados atualizados'),
        }, { merge: true });
      }

      showSuccess('Módulos e telas atualizados com sucesso!');
    } catch (error) {
      console.error('Erro ao salvar módulos da empresa:', error);
      showError('Erro', 'Não foi possível atualizar os módulos desta empresa.');
    } finally {
      setIsSavingTenantModules(false);
    }
  };

  if (isFetching) {
    return <div style={{ padding: '40px', color: 'var(--text-primary)', textAlign: 'center' }}>Carregando configurações...</div>;
  }

  const totalModuleCount = MODULE_GROUPS.reduce((acc, group) => acc + group.items.length, 0);
  const activeModuleCount = totalModuleCount - moduleBlockedDraft.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0' }}>Configurações</h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)', margin: 0 }}>Dados da empresa e preferências do sistema</p>
        </div>
        {isEditingMode ? (
          <button
            className="btn-primary"
            onClick={handleSave}
            disabled={isLoading}
            style={{ opacity: isLoading ? 0.7 : 1, display: 'flex', alignItems: 'center' }}
          >
            {isLoading ? <Loader2 size={18} className="spin-icon" style={{ marginRight: 8 }} /> : <Save size={18} style={{ marginRight: 8 }} />}
            {isLoading ? 'Salvando...' : 'Salvar Alterações'}
          </button>
        ) : (
          <button
            className="btn-secondary"
            onClick={() => setIsEditingMode(true)}
            style={{ display: 'flex', alignItems: 'center', borderColor: 'var(--accent-purple)', color: 'var(--accent-purple)' }}
          >
            <Edit2 size={18} style={{ marginRight: 8 }} />
            Editar Dados
          </button>
        )}
      </div>

      {showSuccessAnim && (
        <div style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          backgroundColor: 'rgba(16, 185, 129, 0.9)', color: 'var(--text-primary)', padding: '24px 48px',
          borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', alignItems: 'center',
          gap: '12px', zIndex: 1000, boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
          animation: 'fadeInUpLogout 0.3s ease-out forwards'
        }}>
          <CheckCircle size={48} />
          <h2 style={{ margin: 0, fontSize: '20px' }}>Configurações Salvas!</h2>
        </div>
      )}

      {isPlatformAdmin && (
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1100px' }}>
          <div
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: showModulosSistema ? '1px solid var(--border-color)' : 'none', cursor: 'pointer' }}
            onClick={() => setShowModulosSistema(!showModulosSistema)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Sliders size={20} style={{ color: 'var(--accent-purple)' }} />
              <div>
                <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Configurar Módulos & Telas</h3>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '4px 0 0' }}>Área restrita para liberar ou bloquear recursos da empresa ativa.</p>
              </div>
            </div>
            <button type="button" style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              {showModulosSistema ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>
          </div>

          {showModulosSistema && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) 160px 160px', gap: '16px', alignItems: 'stretch' }}>
                <div style={{ padding: '12px 14px', borderRadius: '8px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}>
                  <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Empresa ativa</span>
                  <strong style={{ display: 'block', fontSize: '16px', color: 'var(--text-primary)', marginTop: '6px' }}>{formData.nomeOficina || 'Empresa selecionada'}</strong>
                  <span style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginTop: '3px' }}>{formData.email || tenantId}</span>
                </div>

                <div style={{ padding: '12px 14px', borderRadius: '8px', backgroundColor: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                  <span style={{ display: 'block', fontSize: '11px', color: '#10b981', fontWeight: 700, textTransform: 'uppercase' }}>Ativos</span>
                  <strong style={{ display: 'block', fontSize: '22px', color: 'var(--text-primary)', marginTop: '4px' }}>{activeModuleCount}</strong>
                </div>

                <div style={{ padding: '12px 14px', borderRadius: '8px', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                  <span style={{ display: 'block', fontSize: '11px', color: '#ef4444', fontWeight: 700, textTransform: 'uppercase' }}>Bloqueados</span>
                  <strong style={{ display: 'block', fontSize: '22px', color: 'var(--text-primary)', marginTop: '4px' }}>{moduleBlockedDraft.length}</strong>
                </div>
              </div>

              {tenantId ? (
                <>
                  <div style={{ padding: '12px 14px', borderRadius: '8px', backgroundColor: 'rgba(139, 92, 246, 0.08)', border: '1px solid rgba(139, 92, 246, 0.18)', color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.5 }}>
                    Marcado significa módulo ativo para <strong style={{ color: 'var(--text-primary)' }}>{formData.nomeOficina || 'a empresa ativa'}</strong>. Desmarcado bloqueia a tela para dono e funcionários da empresa.
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
                    {MODULE_GROUPS.map(group => (
                      <div key={group.group} style={{ padding: '16px', borderRadius: '8px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <h4 style={{ margin: '0 0 4px', fontSize: '12px', color: 'var(--accent-purple)', textTransform: 'uppercase', fontWeight: 700 }}>{group.group}</h4>
                        {group.items.map(moduleItem => {
                          const isActive = !moduleBlockedDraft.includes(moduleItem.id);
                          return (
                            <label
                              key={moduleItem.id}
                              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '10px 0', cursor: isSavingTenantModules ? 'not-allowed' : 'pointer', borderTop: '1px solid rgba(255,255,255,0.04)' }}
                            >
                              <span style={{ fontSize: '13px', color: isActive ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: isActive ? 600 : 400 }}>{moduleItem.label}</span>
                              <span style={{ position: 'relative', width: '40px', height: '22px', borderRadius: '999px', backgroundColor: isActive ? 'var(--accent-purple)' : 'var(--bg-primary)', border: `1px solid ${isActive ? 'var(--accent-purple)' : 'var(--border-color)'}`, flexShrink: 0 }}>
                                <span style={{ position: 'absolute', top: '2px', left: isActive ? '20px' : '2px', width: '16px', height: '16px', borderRadius: '50%', backgroundColor: isActive ? '#fff' : 'var(--text-muted)', transition: 'left 0.2s ease' }} />
                              </span>
                              <input
                                type="checkbox"
                                checked={isActive}
                                disabled={isSavingTenantModules}
                                onChange={() => toggleTenantModule(moduleItem.id)}
                                style={{ display: 'none' }}
                              />
                            </label>
                          );
                        })}
                      </div>
                    ))}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={handleSaveTenantModules}
                      disabled={isSavingTenantModules}
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: isSavingTenantModules ? 0.7 : 1 }}
                    >
                      {isSavingTenantModules ? <Loader2 size={16} className="spin-icon" /> : <Save size={16} />}
                      {isSavingTenantModules ? 'Salvando...' : 'Salvar Módulos da Empresa'}
                    </button>
                  </div>
                </>
              ) : (
                <div style={{ padding: '20px', borderRadius: '8px', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)', textAlign: 'center' }}>
                  Nenhuma empresa encontrada para configurar.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '24px', maxWidth: '800px', opacity: isEditingMode ? 1 : 0.4, filter: isEditingMode ? 'none' : 'grayscale(60%) blur(1px)', transition: 'all 0.4s ease', pointerEvents: isEditingMode ? 'auto' : 'none' }}>
        {/* Dados da Empresa */}
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: showDadosOficina ? '1px solid var(--border-color)' : 'none', cursor: 'pointer' }}
            onClick={() => setShowDadosOficina(!showDadosOficina)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Store size={20} style={{ color: 'var(--accent-purple)' }} />
              <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Dados da Empresa (Cabeçalhos e Impressões)</h3>
            </div>
            <button type="button" style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              {showDadosOficina ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>
          </div>

          {showDadosOficina && (
            <>
              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Logotipo da Empresa (Aparecerá nas Impressões)</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  {formData.logo ? (
                    <div style={{ position: 'relative', width: '100px', height: '100px', borderRadius: '8px', border: '1px solid var(--border-color)', overflow: 'hidden', backgroundColor: 'white' }}>
                      <img src={formData.logo} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                      {isEditingMode && (
                        <button type="button" onClick={() => setFormData({...formData, logo: ''})} style={{ position: 'absolute', top: '4px', right: '4px', background: 'rgba(239, 68, 68, 0.9)', color: 'var(--text-primary)', border: 'none', borderRadius: '50%', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  ) : (
                    <div style={{ width: '100px', height: '100px', borderRadius: '8px', border: '1px dashed var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                      <Store size={32} />
                    </div>
                  )}
                  {isEditingMode && (
                    <div>
                      <label htmlFor="logo-upload" className="btn-secondary" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '8px 16px', borderRadius: '8px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}>
                        <Plus size={16} /> Carregar Logo
                      </label>
                      <input
                        id="logo-upload"
                        type="file"
                        accept="image/png, image/jpeg, image/jpg"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            if (file.size > 1024 * 1024 * 2) {
                              showError('Erro', 'A imagem deve ter no máximo 2MB.');
                              return;
                            }
                            const reader = new FileReader();
                            reader.onloadend = () => {
                              setFormData({...formData, logo: reader.result as string});
                            };
                            reader.readAsDataURL(file);
                          }
                        }}
                      />
                      <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px' }}>Formatos: PNG, JPG (Máx 2MB)</p>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Nome Fantasia da Empresa</label>
              <input
                type="text"
                name="nomeOficina"
                placeholder="Ex: Mercado Central Hennder"
                value={formData.nomeOficina}
                onChange={handleChange}
                disabled={!isEditingMode}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
              />
            </div>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Nome de Usuário (Aparecerá no Topo)</label>
              <input
                type="text"
                name="nomeUsuario"
                placeholder="Ex: Carlos (Admin)"
                value={formData.nomeUsuario}
                onChange={handleChange}
                disabled={!isEditingMode}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>CNPJ da Empresa</label>
              <input
                type="text"
                name="cnpj"
                placeholder="00.000.000/0000-00"
                value={formData.cnpj}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '');
                  let formatted = val;
                  if (val.length <= 14) {
                    formatted = val.replace(/^(\d{2})(\d)/, '$1.$2')
                                   .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
                                   .replace(/\.(\d{3})(\d)/, '.$1/$2')
                                   .replace(/(\d{4})(\d)/, '$1-$2');
                  }
                  setFormData({ ...formData, cnpj: formatted });
                }}
                maxLength={18}
                disabled={!isEditingMode}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
              />
            </div>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Regime Tributário</label>
              <select
                name="regimeTributario"
                value={formData.regimeTributario}
                onChange={(e) => setFormData({ ...formData, regimeTributario: e.target.value as RegimeTributario })}
                disabled={!isEditingMode}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
              >
                {REGIME_TRIBUTARIO_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '13px', color: 'var(--text-primary)', marginTop: '4px', cursor: isEditingMode ? 'pointer' : 'default' }}>
                <input
                  type="checkbox"
                  checked={formData.controlaFiscal === false}
                  onChange={(e) => setFormData({ ...formData, controlaFiscal: !e.target.checked })}
                  disabled={!isEditingMode}
                  style={{ accentColor: 'var(--accent-purple)', width: '16px', height: '16px', marginTop: '2px' }}
                />
                <span>
                  <strong>Esta empresa não controla fiscal</strong>
                  <span style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', lineHeight: 1.45 }}>
                    Marque quando a empresa vende no balcão com recibo e resolve a parte fiscal fora do sistema. Some da tela o
                    menu <strong>Fiscal</strong> inteiro, o botão de <strong>emitir cupom (NFC-e)</strong> ao finalizar a venda e o de
                    imprimir cupom na lista de pedidos. O resto do sistema não muda.
                    <br />
                    O regime tributário acima continua valendo: ele é um fato contábil da empresa e é o que define CSOSN/CST no
                    cadastro de produto, mesmo que nenhuma nota saia por aqui.
                  </span>
                </span>
              </label>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Inscrição Estadual</label>
              <input
                type="text"
                name="inscricaoEstadual"
                placeholder="Isento, se aplicável"
                value={formData.inscricaoEstadual}
                onChange={handleChange}
                disabled={!isEditingMode}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
              />
            </div>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>CEP</label>
              <input
                type="text"
                name="cep"
                placeholder="00000-000"
                value={formData.cep}
                onChange={handleChange}
                disabled={!isEditingMode}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Telefone / WhatsApp</label>
              <input
                type="text"
                name="telefone"
                placeholder="(00) 00000-0000"
                value={formData.telefone}
                onChange={handleChange}
                disabled={!isEditingMode}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
              />
            </div>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>E-mail</label>
              <input
                type="email"
                name="email"
                placeholder="contato@empresa.com"
                value={formData.email}
                onChange={handleChange}
                disabled={!isEditingMode}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <MessageCircle size={14} /> WhatsApp para impressões
              </label>
              <input
                type="text"
                name="whatsapp"
                placeholder="(00) 00000-0000"
                value={formData.whatsapp}
                onChange={handleChange}
                disabled={!isEditingMode}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
              />
            </div>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Camera size={14} /> Instagram para impressões
              </label>
              <input
                type="text"
                name="instagram"
                placeholder="@suaempresa"
                value={formData.instagram}
                onChange={handleChange}
                disabled={!isEditingMode}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 0.8fr 1.2fr', gap: '20px' }}>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Rua</label>
              <input
                type="text"
                name="rua"
                placeholder="Rua Joaquim Santana"
                value={formData.rua}
                onChange={handleChange}
                disabled={!isEditingMode}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
              />
            </div>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Número</label>
              <input
                type="text"
                name="numero"
                placeholder="111"
                value={formData.numero}
                onChange={handleChange}
                disabled={!isEditingMode}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
              />
            </div>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Bairro</label>
              <input
                type="text"
                name="bairro"
                placeholder="Sagrada Família"
                value={formData.bairro}
                onChange={handleChange}
                disabled={!isEditingMode}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
              />
            </div>
          </div>

          <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px', position: 'relative' }}>
            <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Cidade da Empresa</label>
            {formData.nfseCidadeNome && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-primary)' }}>
                <CheckCircle size={16} style={{ color: '#10b981' }} />
                {formData.nfseCidadeNome} / {formData.nfseCidadeEstado} (IBGE {formData.nfseCidadeCodigo})
              </div>
            )}
            <input
              type="text"
              placeholder="Digite o nome da cidade pra buscar (ex: Manhuaçu)"
              value={cidadeSearchTerm}
              onChange={(e) => { setCidadeSearchTerm(e.target.value); setShowCidadeDropdown(true); }}
              onFocus={() => setShowCidadeDropdown(true)}
              onBlur={() => setTimeout(() => setShowCidadeDropdown(false), 150)}
              disabled={!isEditingMode}
              style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
            />
            {isCidadeSearching && <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>Buscando...</p>}
            {showCidadeDropdown && cidadeSearchResults.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', maxHeight: '220px', overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.25)' }}>
                {cidadeSearchResults.map((cidade, index) => (
                  <button
                    key={`${cidade.code}-${index}`}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); handleSelectCidade(cidade); }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 16px', background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '13px' }}
                  >
                    {cidade.name} / {cidade.state}
                  </button>
                ))}
              </div>
            )}
            {showCidadeDropdown && !isCidadeSearching && cidadeSearchTerm.trim().length >= 3 && cidadeSearchResults.length === 0 && (
              <p style={{ fontSize: '12px', color: '#ef4444', margin: 0 }}>Nenhuma cidade integrada encontrada com esse nome — a busca depende da chave da Spedy estar salva (mais abaixo), mesmo que essa empresa só use SINTEGRA/SPED e não emita NFS-e.</p>
            )}
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>Usada na emissão de NFS-e e nos utilitários fiscais (SINTEGRA, SPED).</p>
          </div>
            </>
          )}
        </div>

        {/* Preferências do Sistema */}
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: showTextosPadroes ? '1px solid var(--border-color)' : 'none', cursor: 'pointer' }}
            onClick={() => setShowTextosPadroes(!showTextosPadroes)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <FileText size={20} style={{ color: 'var(--accent-purple)' }} />
              <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Textos Padrões (OS)</h3>
            </div>
            <button type="button" style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              {showTextosPadroes ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>
          </div>

          {showTextosPadroes && (
            <>
              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Termo de Garantia Padrão (Aparecerá na impressão da OS)</label>
                <textarea
                  name="garantiaPadrao"
                  rows={4}
                  placeholder="Ex: Garantia de 90 dias sobre a mão de obra. As peças possuem garantia do fabricante..."
                  value={formData.garantiaPadrao}
                  onChange={handleChange}
                  disabled={!isEditingMode}
                  style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)', resize: 'vertical' }}
                />
              </div>

              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                  <LayoutTemplate size={18} style={{ color: 'var(--accent-purple)' }} />
                  <div>
                    <h4 style={{ margin: 0, fontSize: '14px', color: 'var(--text-primary)' }}>Modelo de impressão da Ordem de Serviço</h4>
                    <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>O modelo selecionado será usado automaticamente ao imprimir qualquer OS.</p>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '12px' }}>
                  {OS_PRINT_MODELS.map(modelo => {
                    const selected = formData.modeloImpressaoOS === modelo.id;
                    return (
                      <label
                        key={modelo.id}
                        style={{
                          display: 'flex',
                          gap: '12px',
                          alignItems: 'flex-start',
                          padding: '14px',
                          borderRadius: '8px',
                          border: `1px solid ${selected ? 'var(--accent-purple)' : 'var(--border-color)'}`,
                          backgroundColor: selected ? 'rgba(139, 92, 246, 0.1)' : 'var(--bg-tertiary)',
                          cursor: isEditingMode ? 'pointer' : 'default',
                        }}
                      >
                        <input
                          type="radio"
                          name="modeloImpressaoOS"
                          value={modelo.id}
                          checked={selected}
                          onChange={handleChange}
                          disabled={!isEditingMode}
                          style={{ marginTop: '3px', accentColor: 'var(--accent-purple)' }}
                        />
                        <span>
                          <strong style={{ display: 'block', fontSize: '13px', color: 'var(--text-primary)', marginBottom: '4px' }}>{modelo.name}</strong>
                          <span style={{ display: 'block', fontSize: '12px', lineHeight: 1.45, color: 'var(--text-muted)' }}>{modelo.description}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: 'var(--text-primary)', cursor: isEditingMode ? 'pointer' : 'default' }}>
                  <input
                    type="checkbox"
                    checked={formData.mostrarValorListaOS === true}
                    onChange={(e) => setFormData({ ...formData, mostrarValorListaOS: e.target.checked })}
                    disabled={!isEditingMode}
                    style={{ accentColor: 'var(--accent-purple)', width: '16px', height: '16px' }}
                  />
                  Mostrar o valor de cada OS na lista
                </label>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '8px 0 0' }}>
                  Acrescenta uma coluna <strong>Valor</strong> no fim de cada linha da lista de Ordens de Serviço, com o total já
                  com desconto. Sem ela, descobrir quanto vale cada OS exige abrir uma por uma. Desligue se o computador fica
                  à vista do cliente e você prefere o valor fora da tela — quem abrir a OS continua vendo o total normalmente.
                </p>
              </div>

              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: 'var(--text-primary)', cursor: isEditingMode ? 'pointer' : 'default' }}>
                  <input
                    type="checkbox"
                    checked={formData.mostrarResumoEstoque === true}
                    onChange={(e) => setFormData({ ...formData, mostrarResumoEstoque: e.target.checked })}
                    disabled={!isEditingMode}
                    style={{ accentColor: 'var(--accent-purple)', width: '16px', height: '16px' }}
                  />
                  Mostrar os cartões de resumo na tela de Estoque
                </label>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '8px 0 0' }}>
                  São os três do topo: <strong>Itens Cadastrados</strong>, <strong>Estoque Baixo</strong> e <strong>Itens Esgotados</strong>.
                  Eles ocupam a primeira dobra inteira da tela — quem usa o Estoque para consultar produto ganha a busca e a
                  lista mais acima ao desligar. Nenhum número deixa de ser calculado, apenas não aparece.
                </p>
              </div>

              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                  <LayoutTemplate size={18} style={{ color: 'var(--accent-purple)' }} />
                  <div>
                    <h4 style={{ margin: 0, fontSize: '14px', color: 'var(--text-primary)' }}>Modelo de impressão do Pedido de Venda</h4>
                    <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>O modelo selecionado será usado automaticamente ao imprimir qualquer Pedido de Venda.</p>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '12px' }}>
                  {PEDIDO_PRINT_MODELS.map(modelo => {
                    const selected = formData.modeloImpressaoPedidoVenda === modelo.id;
                    return (
                      <label
                        key={modelo.id}
                        style={{
                          display: 'flex',
                          gap: '12px',
                          alignItems: 'flex-start',
                          padding: '14px',
                          borderRadius: '8px',
                          border: `1px solid ${selected ? 'var(--accent-purple)' : 'var(--border-color)'}`,
                          backgroundColor: selected ? 'rgba(139, 92, 246, 0.1)' : 'var(--bg-tertiary)',
                          cursor: isEditingMode ? 'pointer' : 'default',
                        }}
                      >
                        <input
                          type="radio"
                          name="modeloImpressaoPedidoVenda"
                          value={modelo.id}
                          checked={selected}
                          onChange={handleChange}
                          disabled={!isEditingMode}
                          style={{ marginTop: '3px', accentColor: 'var(--accent-purple)' }}
                        />
                        <span>
                          <strong style={{ display: 'block', fontSize: '13px', color: 'var(--text-primary)', marginBottom: '4px' }}>{modelo.name}</strong>
                          <span style={{ display: 'block', fontSize: '12px', lineHeight: 1.45, color: 'var(--text-muted)' }}>{modelo.description}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>

                <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '16px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Observações Padrão (Aparecerá na impressão do Pedido de Venda em meia folha)</label>
                  <textarea
                    name="observacoesPadraoPedido"
                    rows={2}
                    placeholder="Ex: Devoluções e troca em até 15 dias somente com a apresentação da nota."
                    value={formData.observacoesPadraoPedido}
                    onChange={handleChange}
                    disabled={!isEditingMode}
                    style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)', resize: 'vertical' }}
                  />
                </div>
              </div>
            </>
          )}
        </div>

        {/* Notificações do Sistema */}
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: showNotificacoesCrm ? '1px solid var(--border-color)' : 'none', cursor: 'pointer' }}
            onClick={() => setShowNotificacoesCrm(!showNotificacoesCrm)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Bell size={20} style={{ color: 'var(--accent-purple)' }} />
              <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Notificações CRM</h3>
            </div>
            <button type="button" style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              {showNotificacoesCrm ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>
          </div>

          {showNotificacoesCrm && (
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Avisar Lembretes Preventivos com antecedência de:</label>
              <select
                name="diasNotificacaoLembrete"
                value={formData.diasNotificacaoLembrete}
                onChange={handleChange}
                disabled={!isEditingMode}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)', maxWidth: '300px' }}
              >
                <option value="15">15 Dias antes</option>
                <option value="30">30 Dias antes</option>
                <option value="45">45 Dias antes</option>
              </select>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Isso define quando o sininho vermelho de notificações no topo da tela será acionado.</p>
            </div>
          )}
        </div>

        {/* Plano de Contas */}
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: showPlanoContas ? '1px solid var(--border-color)' : 'none', cursor: 'pointer' }}
            onClick={() => setShowPlanoContas(!showPlanoContas)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <ListTree size={20} style={{ color: 'var(--accent-purple)' }} />
              <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Plano de Contas (Categorias Financeiras)</h3>
            </div>
            <button type="button" style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              {showPlanoContas ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>
          </div>

          {showPlanoContas && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>

              {/* Receitas */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <h4 style={{ fontSize: '14px', fontWeight: 600, color: '#10b981', margin: 0, paddingBottom: '8px', borderBottom: '1px solid rgba(16, 185, 129, 0.2)' }}>Categorias de Receita</h4>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    placeholder="Nova categoria de receita..."
                    value={novaReceitaInput}
                    onChange={(e) => setNovaReceitaInput(e.target.value)}
                    disabled={!isEditingMode}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddReceita())}
                    style={{ flex: 1, backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--text-primary)', fontSize: '13px' }}
                  />
                  <button type="button" onClick={handleAddReceita} disabled={!isEditingMode || !novaReceitaInput.trim()} style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: 'var(--radius-md)', padding: '0 12px', cursor: (!isEditingMode || !novaReceitaInput.trim()) ? 'not-allowed' : 'pointer', opacity: (!isEditingMode || !novaReceitaInput.trim()) ? 0.5 : 1 }}>
                    <Plus size={18} />
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '250px', overflowY: 'auto', paddingRight: '4px' }}>
                  {formData.planoContasReceitas.map((cat, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-tertiary)', padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                      <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{cat}</span>
                      <button type="button" onClick={() => handleRemoveReceita(idx)} disabled={!isEditingMode} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: isEditingMode ? 'pointer' : 'not-allowed', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <X size={14} style={{ opacity: isEditingMode ? 1 : 0.5 }} />
                      </button>
                    </div>
                  ))}
                  {formData.planoContasReceitas.length === 0 && (
                    <p style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>Nenhuma categoria de receita cadastrada.</p>
                  )}
                </div>
              </div>

              {/* Despesas */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <h4 style={{ fontSize: '14px', fontWeight: 600, color: '#ef4444', margin: 0, paddingBottom: '8px', borderBottom: '1px solid rgba(239, 68, 68, 0.2)' }}>Categorias de Despesa</h4>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    placeholder="Nova categoria de despesa..."
                    value={novaDespesaInput}
                    onChange={(e) => setNovaDespesaInput(e.target.value)}
                    disabled={!isEditingMode}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddDespesa())}
                    style={{ flex: 1, backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--text-primary)', fontSize: '13px' }}
                  />
                  <button type="button" onClick={handleAddDespesa} disabled={!isEditingMode || !novaDespesaInput.trim()} style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 'var(--radius-md)', padding: '0 12px', cursor: (!isEditingMode || !novaDespesaInput.trim()) ? 'not-allowed' : 'pointer', opacity: (!isEditingMode || !novaDespesaInput.trim()) ? 0.5 : 1 }}>
                    <Plus size={18} />
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '250px', overflowY: 'auto', paddingRight: '4px' }}>
                  {formData.planoContasDespesas.map((cat, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-tertiary)', padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                      <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{cat}</span>
                      <button type="button" onClick={() => handleRemoveDespesa(idx)} disabled={!isEditingMode} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: isEditingMode ? 'pointer' : 'not-allowed', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <X size={14} style={{ opacity: isEditingMode ? 1 : 0.5 }} />
                      </button>
                    </div>
                  ))}
                  {formData.planoContasDespesas.length === 0 && (
                    <p style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>Nenhuma categoria de despesa cadastrada.</p>
                  )}
                </div>
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>Estas categorias aparecerão automaticamente na hora de lançar uma nova Receita ou Despesa no Fluxo de Caixa.</p>
              </div>
            </div>
          )}
        </div>

        {/* Configurações Avançadas */}
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: showConfigAvancadas ? '1px solid var(--border-color)' : 'none', cursor: 'pointer' }}
            onClick={() => setShowConfigAvancadas(!showConfigAvancadas)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Sliders size={20} style={{ color: 'var(--accent-purple)' }} />
              <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Configurações Avançadas</h3>
            </div>
            <button type="button" style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              {showConfigAvancadas ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>
          </div>

          {showConfigAvancadas && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>Permitir Venda Sem Estoque</label>
                <div style={{ display: 'flex', gap: '16px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '14px' }}>
                    <input
                      type="radio"
                      name="venderSemEstoque"
                      checked={formData.venderSemEstoque === true}
                      onChange={() => setFormData({ ...formData, venderSemEstoque: true })}
                      disabled={!isEditingMode}
                      style={{ accentColor: 'var(--accent-purple)', width: '16px', height: '16px' }}
                    />
                    Sim
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '14px' }}>
                    <input
                      type="radio"
                      name="venderSemEstoque"
                      checked={formData.venderSemEstoque === false}
                      onChange={() => setFormData({ ...formData, venderSemEstoque: false })}
                      disabled={!isEditingMode}
                      style={{ accentColor: 'var(--accent-purple)', width: '16px', height: '16px' }}
                    />
                    Não
                  </label>
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>Se "Sim", o sistema permitirá adicionar itens na OS e Vendas mesmo que o estoque seja insuficiente.</p>
              </div>

              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>Validar Cadastro de Produto</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '14px' }}>
                  <input
                    type="checkbox"
                    name="validarCadastroProduto"
                    checked={formData.validarCadastroProduto === true}
                    onChange={(e) => setFormData({ ...formData, validarCadastroProduto: e.target.checked })}
                    disabled={!isEditingMode}
                    style={{ accentColor: 'var(--accent-purple)', width: '16px', height: '16px' }}
                  />
                  Permitir cadastrar produto apenas com nome, preço e quantidade
                </label>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>Quando marcado, o cadastro de produtos exige apenas nome, preço de venda e quantidade inicial de estoque.</p>
              </div>

              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>Vender por Embalagem</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '14px' }}>
                  <input
                    type="checkbox"
                    name="venderPorEmbalagem"
                    checked={formData.venderPorEmbalagem === true}
                    onChange={(e) => setFormData({ ...formData, venderPorEmbalagem: e.target.checked })}
                    disabled={!isEditingMode}
                    style={{ accentColor: 'var(--accent-purple)', width: '16px', height: '16px' }}
                  />
                  Permitir vender o mesmo produto em mais de uma unidade
                </label>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                  Libera a aba "Embalagens" no cadastro do produto e o seletor de unidade na venda — por exemplo,
                  vender a mesma ração por quilo ou por saco de 20kg, com preços diferentes. O estoque continua sendo
                  controlado na unidade base. Desmarcar não apaga nenhuma embalagem cadastrada.
                </p>
              </div>

              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>Modo de Busca de Produto</label>
                <div style={{ display: 'flex', gap: '16px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '14px' }}>
                    <input
                      type="radio"
                      name="buscaProdutoModo"
                      checked={formData.buscaProdutoModo === 'completa'}
                      onChange={() => setFormData({ ...formData, buscaProdutoModo: 'completa' })}
                      disabled={!isEditingMode}
                      style={{ accentColor: 'var(--accent-purple)', width: '16px', height: '16px' }}
                    />
                    Completa (padrão)
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '14px' }}>
                    <input
                      type="radio"
                      name="buscaProdutoModo"
                      checked={formData.buscaProdutoModo === 'exata'}
                      onChange={() => setFormData({ ...formData, buscaProdutoModo: 'exata' })}
                      disabled={!isEditingMode}
                      style={{ accentColor: 'var(--accent-purple)', width: '16px', height: '16px' }}
                    />
                    Exata
                  </label>
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>Afeta a busca por nome no PDV, Pedido de Venda e OS. "Completa" encontra o termo em qualquer posição do nome; "Exata" só encontra nomes que começam com o termo digitado. Código, código de barras e referência sempre buscam por prefixo, nos dois modos.</p>
              </div>

              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>Momento da Baixa de Estoque</label>
                <select
                  name="momentoBaixaEstoque"
                  value={formData.momentoBaixaEstoque}
                  onChange={(e) => setFormData({ ...formData, momentoBaixaEstoque: e.target.value as MomentoBaixaEstoque })}
                  disabled={!isEditingMode}
                  style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
                >
                  {MOMENTO_BAIXA_ESTOQUE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>Define quando o estoque será debitado. Por enquanto é só um registro informativo — nenhum fluxo de venda, PDV ou OS lê essa configuração ainda; a baixa continua acontecendo imediatamente no fechamento, como hoje.</p>
              </div>

              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '12px', gridColumn: '1 / -1' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>Pré-venda</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '14px' }}>
                  <input
                    type="checkbox"
                    checked={formData.trabalhaComPreVenda === true}
                    onChange={(e) => setFormData({ ...formData, trabalhaComPreVenda: e.target.checked })}
                    disabled={!isEditingMode}
                    style={{ accentColor: 'var(--accent-purple)', width: '16px', height: '16px' }}
                  />
                  Trabalha com pré-venda
                </label>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                  Quando marcado, a tela de Pedido de Venda ganha o botão <strong>Gravar Pré-venda</strong> ao lado de Finalizar Venda. A pré-venda fica em aberto, <strong>reserva o estoque sem dar baixa</strong> e não gera nenhum lançamento financeiro — a baixa e o financeiro só acontecem quando alguém finaliza. Pré-venda em aberto não entra em faturamento nem em caixa; ela tem relatório próprio em Vendas → Pré-vendas em Aberto. Desligado (padrão), a tela funciona exatamente como antes.
                </p>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                  Ligar aqui libera o recurso para a empresa. <strong>Quem pode gravar, editar, finalizar ou cancelar pré-venda é definido usuário a usuário</strong>, nas permissões de cada funcionário.
                </p>
              </div>

              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '12px', gridColumn: '1 / -1' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>Agente Digital</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '14px' }}>
                  <input
                    type="checkbox"
                    checked={formData.agenteDigitalAtivo === true}
                    onChange={(e) => setFormData({ ...formData, agenteDigitalAtivo: e.target.checked })}
                    disabled={!isEditingMode}
                    style={{ accentColor: 'var(--accent-purple)', width: '16px', height: '16px' }}
                  />
                  Faz vendas com agente digital (WhatsApp)
                </label>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                  Desligado (padrão): a aba <strong>Pendentes</strong> some da listagem de Pedidos de Venda, já que não existe pedido chegando pelo agente. Ligue aqui se a empresa recebe pedido em análise vindo do agente de WhatsApp.
                </p>
              </div>

              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '12px', gridColumn: '1 / -1' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>Devolução de Venda</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '14px' }}>
                  <input
                    type="checkbox"
                    checked={formData.devolucaoBotaoSeparado === true}
                    onChange={(e) => setFormData({ ...formData, devolucaoBotaoSeparado: e.target.checked })}
                    disabled={!isEditingMode}
                    style={{ accentColor: 'var(--accent-purple)', width: '16px', height: '16px' }}
                  />
                  Trabalhar com botão de devolução separado (menu próprio)
                </label>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                  Desligado (padrão): a devolução é feita pelo botão <strong>Devolução</strong> dentro da própria tela do pedido finalizado.
                  Ligado: o botão some do pedido e aparece um item de menu <strong>Devolução de Venda</strong> em Comercial, com uma tela própria para buscar o pedido e devolver.
                </p>
              </div>

              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '12px', gridColumn: '1 / -1' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>Identificação do Vendedor</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '14px' }}>
                  <input
                    type="checkbox"
                    checked={formData.exigirIdentificacaoVendedor === true}
                    onChange={(e) => handleToggleExigirIdentificacaoVendedor(e.target.checked)}
                    disabled={!isEditingMode}
                    style={{ accentColor: 'var(--accent-purple)', width: '16px', height: '16px' }}
                  />
                  Exigir identificação do vendedor a cada venda
                </label>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                  Para lojas onde vários vendedores usam o mesmo computador. Ao finalizar cada venda, aparece um popup pedindo o
                  <strong> código (2 dígitos)</strong> e a <strong>senha (de 2 a 10 dígitos)</strong> do vendedor — a venda e a comissão ficam no nome dele.
                  Terminada a venda, o sistema esquece: a próxima pede de novo. Com esta opção ligada, o campo "Vendedor" da tela deixa de ser editável à mão.
                </p>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                  Ligar esta opção libera o menu <strong>Cadastros Auxiliares → Vendedores</strong>. É lá que entram as pessoas que vendem
                  no balcão — <strong>sem login, sem senha de acesso e sem ocupar vaga do seu plano</strong>. Os computadores ficam
                  logados o dia inteiro em contas de estação (balcão 01, balcão 02...), criadas em Equipe &amp; Acessos como sempre.
                </p>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                  Quem <strong>também precisa entrar no sistema</strong> (um gerente que vende, por exemplo) continua em Equipe &amp; Acessos,
                  com o código do vendedor cadastrado na ficha dele. Se alguém esquecer a senha, o administrador cadastra
                  outra na hora e isso já destrava quem estiver bloqueado por tentativas.
                </p>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                  Com esta opção ligada, a lista geral de <strong>Pedidos de Venda</strong> fica visível só para dono, Master ou Admin — o funcionário comum passa a usar a tela <strong>Minhas Vendas</strong>, que mostra e reimprime só as vendas dele.
                </p>
              </div>

              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '12px', gridColumn: '1 / -1' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>Comissão padrão do sistema</label>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                  Ordem de prioridade da comissão de uma venda: <strong>1)</strong> comissão própria do produto/serviço (cadastro em Estoque/Serviços), <strong>2)</strong> comissão do vendedor/mecânico (cadastro em Usuários), <strong>3)</strong> este percentual padrão — usado só quando o vendedor tem "Recebe comissão?" marcado como sim mas não preencheu um percentual próprio.
                </p>
                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Produtos (%):</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={formData.comissaoPadraoPecas}
                      onChange={(e) => setFormData({ ...formData, comissaoPadraoPecas: e.target.value })}
                      disabled={!isEditingMode}
                      style={{ width: '100px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'var(--text-primary)', fontSize: '14px' }}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Serviços (%):</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={formData.comissaoPadraoServicos}
                      onChange={(e) => setFormData({ ...formData, comissaoPadraoServicos: e.target.value })}
                      disabled={!isEditingMode}
                      style={{ width: '100px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'var(--text-primary)', fontSize: '14px' }}
                    />
                  </div>
                </div>
              </div>

              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '12px', gridColumn: '1 / -1' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>Meta de faturamento mensal</label>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                  Quanto a empresa quer faturar por mês. O Dashboard mostra o quanto já foi atingido e o quanto falta,
                  comparando com a <strong>receita paga do mês corrente</strong> (não do período selecionado nos filtros).
                  Deixe <strong>em branco</strong> se você não trabalha com meta — nesse caso o Dashboard mostra, no lugar do
                  anel de meta, quanto da oportunidade do período já virou dinheiro.
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Meta (R$):</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Sem meta"
                    value={formData.metaFaturamentoMensal}
                    onChange={(e) => setFormData({ ...formData, metaFaturamentoMensal: e.target.value })}
                    disabled={!isEditingMode}
                    style={{ width: '160px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'var(--text-primary)', fontSize: '14px' }}
                  />
                </div>
              </div>

              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '12px', gridColumn: '1 / -1' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>Venda Finalizada</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '14px' }}>
                  <input
                    type="checkbox"
                    checked={formData.alterarPagamentoVendaFinalizada === true}
                    onChange={(e) => setFormData({ ...formData, alterarPagamentoVendaFinalizada: e.target.checked })}
                    disabled={!isEditingMode}
                    style={{ accentColor: 'var(--accent-purple)', width: '16px', height: '16px' }}
                  />
                  Permitir alterar a forma de pagamento de venda já finalizada
                </label>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                  Para corrigir recebimento lançado errado (registrou dinheiro, era cartão). <strong>O valor total da venda não muda</strong> — só a composição do recebimento, e os lançamentos financeiros são refeitos junto. <strong>Venda com cupom fiscal (NFC-e) autorizado nunca pode ser alterada</strong>, mesmo com esta opção ligada: nota transmitida à SEFAZ é imutável.
                </p>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                  Ligar aqui libera o recurso para a empresa. <strong>Quem pode alterar é definido usuário a usuário</strong>, nas permissões de cada funcionário.
                </p>
              </div>

              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '12px', gridColumn: '1 / -1' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>Visibilidade de Vendas</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '14px' }}>
                  <input
                    type="checkbox"
                    checked={formData.restringirVendasPorUsuario === true}
                    onChange={(e) => setFormData({ ...formData, restringirVendasPorUsuario: e.target.checked })}
                    disabled={!isEditingMode}
                    style={{ accentColor: 'var(--accent-purple)', width: '16px', height: '16px' }}
                  />
                  Não visualizar vendas de outro usuário
                </label>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                  Quando marcado, quem tem nível <strong>Funcionário</strong> passa a enxergar apenas as vendas em que ele é o vendedor: lista de Pedidos de Venda, Relatório de Vendas, Pré-vendas em Aberto, Descontos Concedidos, Comissões, Contas a Receber, Dashboard, painel fiscal, fila de expedição e impressões. Ele também não consegue abrir nem imprimir a venda de outro pelo link direto. Quem tem nível <strong>Administração</strong> (e o dono da empresa) continua vendo tudo.
                </p>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                  <strong>Caixa, Banco e Faturamento (DRE) não são filtrados</strong>, de propósito: são o saldo e o resultado da empresa inteira, e mostrar um valor parcial ali seria mostrar um número errado. Para manter o funcionário fora desses números, não libere esses módulos nas permissões dele.
                </p>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                  O nível de cada pessoa é definido logo abaixo, em <strong>Permissão de Usuários</strong>. Desligado (padrão), todo mundo vê todas as vendas, como sempre foi.
                </p>
              </div>

              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '12px', gridColumn: '1 / -1' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>Conferência de Mercadoria (Expedição)</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '14px' }}>
                  <input
                    type="checkbox"
                    checked={formData.conferenciaMercadoria === true}
                    onChange={(e) => setFormData({ ...formData, conferenciaMercadoria: e.target.checked })}
                    disabled={!isEditingMode}
                    style={{ accentColor: 'var(--accent-purple)', width: '16px', height: '16px' }}
                  />
                  Trabalha com conferência de mercadoria antes da expedição
                </label>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>Quando marcado, toda venda finalizada nasce com um status de conferência e passa a ser exigida a separação/bipagem antes de considerar o pedido pronto. Desligado (padrão), nenhuma venda ganha esse status e nada muda no fluxo atual.</p>
              </div>

              {formData.conferenciaMercadoria && (
                <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: '16px', backgroundColor: 'var(--bg-tertiary)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                  <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>Opções da Conferência</h4>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '14px' }}>
                    <input
                      type="checkbox"
                      checked={formData.imprimirMinutaAposVenda === true}
                      onChange={(e) => setFormData({ ...formData, imprimirMinutaAposVenda: e.target.checked })}
                      disabled={!isEditingMode}
                      style={{ accentColor: 'var(--accent-purple)', width: '16px', height: '16px' }}
                    />
                    Perguntar se imprime a minuta de entrega ao finalizar a venda
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '14px' }}>
                    <input
                      type="checkbox"
                      checked={formData.exigirBipagem === true}
                      onChange={(e) => setFormData({ ...formData, exigirBipagem: e.target.checked })}
                      disabled={!isEditingMode}
                      style={{ accentColor: 'var(--accent-purple)', width: '16px', height: '16px' }}
                    />
                    Exigir bipagem do código de barras (produto sem EAN cadastrado sempre aceita lançamento manual)
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '14px' }}>
                    <input
                      type="checkbox"
                      checked={formData.bloquearExcedente === true}
                      onChange={(e) => setFormData({ ...formData, bloquearExcedente: e.target.checked })}
                      disabled={!isEditingMode}
                      style={{ accentColor: 'var(--accent-purple)', width: '16px', height: '16px' }}
                    />
                    Bloquear conferência acima da quantidade pedida ou de item fora do pedido
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '14px' }}>
                    <input
                      type="checkbox"
                      checked={formData.ordenarMinutaPorLocal === true}
                      onChange={(e) => setFormData({ ...formData, ordenarMinutaPorLocal: e.target.checked })}
                      disabled={!isEditingMode}
                      style={{ accentColor: 'var(--accent-purple)', width: '16px', height: '16px' }}
                    />
                    Ordenar a minuta por localização do produto no estoque
                  </label>

                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>Fundação do módulo (Fatia 0/4) — estas opções ainda não são lidas por nenhuma tela de venda, minuta ou conferência; entram em uso nas fatias seguintes.</p>
                </div>
              )}

              <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: '16px', backgroundColor: 'var(--bg-tertiary)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                <div>
                  <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>Limites de Desconto</h4>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '4px 0 0' }}>
                    Deixe o campo em branco para não limitar aquela tela. Um produto com "Desconto máximo" preenchido no
                    próprio cadastro sempre prevalece sobre o limite daqui, item a item.
                  </p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
                  {([
                    { key: 'limiteDescontoOS' as const, label: 'Ordem de Serviço' },
                    { key: 'limiteDescontoPedido' as const, label: 'Pedido de Venda' },
                    { key: 'limiteDescontoOrcamento' as const, label: 'Orçamento' },
                    { key: 'limiteDescontoPdv' as const, label: 'Frente de Caixa (PDV)' },
                  ]).map(({ key, label }) => (
                    <div key={key} className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <label style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>{label}</label>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <select
                          value={formData[key].tipo}
                          onChange={(e) => setFormData({ ...formData, [key]: { ...formData[key], tipo: e.target.value as DescontoTipo } })}
                          disabled={!isEditingMode}
                          style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 8px', color: 'var(--text-primary)', width: '92px' }}
                        >
                          <option value="percentual">%</option>
                          <option value="valor">R$</option>
                        </select>
                        <input
                          type="number"
                          min="0"
                          max={formData[key].tipo === 'percentual' ? 100 : undefined}
                          step="0.01"
                          placeholder="Sem limite"
                          value={formData[key].valor}
                          onChange={(e) => setFormData({ ...formData, [key]: { ...formData[key], valor: e.target.value } })}
                          disabled={!isEditingMode}
                          style={{ flex: 1, backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--text-primary)' }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>Ao exceder o limite configurado</label>
                  <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                    {([
                      { value: 'bloquear' as const, label: 'Bloquear' },
                      { value: 'avisar' as const, label: 'Avisar mas não bloquear' },
                      { value: 'senha' as const, label: 'Solicitar senha de aprovador' },
                    ]).map((opcao) => (
                      <label key={opcao.value} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '14px' }}>
                        <input
                          type="radio"
                          name="modoLimiteDesconto"
                          checked={formData.modoLimiteDesconto === opcao.value}
                          onChange={() => setFormData({ ...formData, modoLimiteDesconto: opcao.value })}
                          disabled={!isEditingMode}
                          style={{ accentColor: 'var(--accent-purple)', width: '16px', height: '16px' }}
                        />
                        {opcao.label}
                      </label>
                    ))}
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                    Vale para as 4 telas acima. "Solicitar senha" exige a permissão "Vendas: Aprovar Desconto Acima do
                    Limite" (ou ser Admin/Master) de quem for digitar a senha.
                  </p>
                </div>

                <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>Desconto abre em</label>
                  <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                    {([
                      { value: 'valor' as DescontoTipo, label: 'R$ (valor)' },
                      { value: 'percentual' as DescontoTipo, label: '% (percentual)' },
                    ]).map((opcao) => (
                      <label key={opcao.value} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: isEditingMode ? 'pointer' : 'default', color: 'var(--text-primary)', fontSize: '14px' }}>
                        <input
                          type="radio"
                          name="tipoDescontoPadrao"
                          checked={formData.tipoDescontoPadrao === opcao.value}
                          onChange={() => setFormData({ ...formData, tipoDescontoPadrao: opcao.value })}
                          disabled={!isEditingMode}
                          style={{ accentColor: 'var(--accent-purple)', width: '16px', height: '16px' }}
                        />
                        {opcao.label}
                      </label>
                    ))}
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                    Decide qual dos dois já vem escolhido quando o campo de desconto abre vazio — no item e na venda inteira, e
                    também na OS e no Orçamento. Loja que negocia sempre em percentual deixa de trocar o seletor em
                    toda venda. Trocar na hora continua sendo um clique, e desconto já lançado não muda.
                  </p>
                </div>

                <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '14px', color: 'var(--text-primary)', cursor: isEditingMode ? 'pointer' : 'default' }}>
                    <input
                      type="checkbox"
                      checked={formData.permitirDescontoPorItem === true}
                      onChange={(e) => setFormData({ ...formData, permitirDescontoPorItem: e.target.checked })}
                      disabled={!isEditingMode}
                      style={{ accentColor: 'var(--accent-purple)', width: '16px', height: '16px', marginTop: '2px' }}
                    />
                    <span>
                      Permitir desconto por item no Pedido de Venda
                      <span style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', lineHeight: 1.45 }}>
                        Desmarque para tirar o campo <strong>Desconto</strong> da linha de lançamento do produto. Em loja que
                        negocia um desconto só, no fim da venda, o campo por item é porta aberta para erro — desconto lançado
                        no produto errado, ou dado duas vezes (no item e no total). O <strong>desconto geral da venda</strong> continua
                        funcionando normalmente. Venda já gravada não muda: item que tem desconto continua com ele.
                      </span>
                    </span>
                  </label>
                </div>
              </div>

              <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: '16px', backgroundColor: 'var(--bg-tertiary)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                <div>
                  <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>Validação de Cliente Cadastrado</h4>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '4px 0 0' }}>
                    Controla o que acontece em Pedido de Venda, OS e Orçamento quando o nome digitado não bate com
                    nenhum cliente já cadastrado. No PDV a seleção já é sempre restrita a clientes cadastrados.
                  </p>
                </div>
                <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                    {([
                      { value: 'permitir' as const, label: 'Permitir (cadastra automaticamente)' },
                      { value: 'bloquear' as const, label: 'Bloquear' },
                      { value: 'perguntar' as const, label: 'Perguntar se quer cadastrar' },
                    ]).map((opcao) => (
                      <label key={opcao.value} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '14px' }}>
                        <input
                          type="radio"
                          name="modoValidacaoCliente"
                          checked={formData.modoValidacaoCliente === opcao.value}
                          onChange={() => setFormData({ ...formData, modoValidacaoCliente: opcao.value })}
                          disabled={!isEditingMode}
                          style={{ accentColor: 'var(--accent-purple)', width: '16px', height: '16px' }}
                        />
                        {opcao.label}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: '16px', backgroundColor: 'var(--bg-tertiary)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                <div>
                  <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>Limite de Crédito</h4>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '4px 0 0' }}>
                    Quando ligado, uma venda a prazo só pode ser finalizada se o cliente tiver "Limite de Crédito"
                    preenchido no cadastro e se o saldo em aberto dele + o valor desta venda não ultrapassar esse limite.
                  </p>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '14px' }}>
                  <input
                    type="checkbox"
                    checked={formData.trabalhaComLimiteCredito === true}
                    onChange={(e) => setFormData({ ...formData, trabalhaComLimiteCredito: e.target.checked })}
                    disabled={!isEditingMode}
                    style={{ accentColor: 'var(--accent-purple)', width: '16px', height: '16px' }}
                  />
                  Trabalha com limite de crédito
                </label>
              </div>

              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '10px', gridColumn: '1 / -1' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>Emissão Fiscal Habilitada</label>
                <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '14px' }}>
                    <input
                      type="checkbox"
                      checked={formData.emiteNFe === true}
                      onChange={(e) => setFormData({ ...formData, emiteNFe: e.target.checked })}
                      disabled={!isEditingMode}
                      style={{ accentColor: 'var(--accent-purple)', width: '16px', height: '16px' }}
                    />
                    Emite NF-e
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '14px' }}>
                    <input
                      type="checkbox"
                      checked={formData.emiteNFCe === true}
                      onChange={(e) => setFormData({ ...formData, emiteNFCe: e.target.checked })}
                      disabled={!isEditingMode}
                      style={{ accentColor: 'var(--accent-purple)', width: '16px', height: '16px' }}
                    />
                    Emite NFC-e
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '14px' }}>
                    <input
                      type="checkbox"
                      checked={formData.emiteNFSe === true}
                      onChange={(e) => setFormData({ ...formData, emiteNFSe: e.target.checked })}
                      disabled={!isEditingMode}
                      style={{ accentColor: 'var(--accent-purple)', width: '16px', height: '16px' }}
                    />
                    Emite NFS-e
                  </label>
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>Identifica quais documentos fiscais esta empresa emite. "Emite NF-e"/"Emite NFC-e" continuam só informativos; "Emite NFS-e" já libera a configuração abaixo, usada de verdade na emissão.</p>
              </div>

              {formData.emiteNFSe && (
                <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: '16px', backgroundColor: 'var(--bg-tertiary)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                  <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>Configuração de NFS-e (Nota de Serviço)</h4>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>Esses dados variam por cidade e por empresa — cada cliente do Hennder configura o próprio código de serviço e alíquota aqui. A cidade da empresa (acima, em Dados da Empresa) é usada aqui também.</p>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Inscrição Municipal</label>
                      <input
                        type="text"
                        name="nfseInscricaoMunicipal"
                        value={formData.nfseInscricaoMunicipal}
                        onChange={handleChange}
                        disabled={!isEditingMode}
                        style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
                      />
                    </div>
                    <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Alíquota de ISS Padrão (%)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        name="nfseAliquotaIssPadrao"
                        value={formData.nfseAliquotaIssPadrao}
                        onChange={handleChange}
                        disabled={!isEditingMode}
                        style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
                      />
                    </div>
                    <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Código de Serviço Municipal</label>
                      <input
                        type="text"
                        name="nfseCodigoServicoMunicipal"
                        value={formData.nfseCodigoServicoMunicipal}
                        onChange={handleChange}
                        disabled={!isEditingMode}
                        style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
                      />
                    </div>
                    <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Código de Serviço Federal (LC 116/03)</label>
                      <input
                        type="text"
                        name="nfseCodigoServicoFederal"
                        placeholder="Ex: 14.01"
                        value={formData.nfseCodigoServicoFederal}
                        onChange={handleChange}
                        disabled={!isEditingMode}
                        style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
                      />
                    </div>
                  </div>
                </div>
              )}

              <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px', paddingTop: '20px', borderTop: '1px solid var(--border-color)' }}>
                <CalendarClock size={19} style={{ color: '#f59e0b' }} />
                <div>
                  <h4 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '14px' }}>Pagamento a Prazo</h4>
                  <p style={{ margin: '3px 0 0', color: 'var(--text-muted)', fontSize: '12px' }}>Padrões usados em Vendas e Ordens de Serviço.</p>
                </div>
              </div>

              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px', gridColumn: '1 / -1' }}>
                <label htmlFor="diasCrediario" style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>Prazos padrão do crediário (dias)</label>
                <input
                  id="diasCrediario"
                  type="text"
                  name="diasCrediario"
                  inputMode="numeric"
                  placeholder="Ex.: 15, 30, 45"
                  value={formData.diasCrediario}
                  onChange={handleChange}
                  disabled={!isEditingMode}
                  style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
                />
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>Separe as opções por vírgula. O primeiro prazo será preenchido inicialmente; a data ainda poderá ser alterada na operação.</p>
              </div>

              <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px', paddingTop: '20px', borderTop: '1px solid var(--border-color)' }}>
                <CreditCard size={19} style={{ color: '#8b5cf6' }} />
                <div>
                  <h4 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '14px' }}>Cartões e Recebimento</h4>
                  <p style={{ margin: '3px 0 0', color: 'var(--text-muted)', fontSize: '12px' }}>
                    Taxas e prazos de recebimento agora são configurados por bandeira em Cadastros → Bandeiras de Cartão.
                  </p>
                </div>
              </div>

              <div className="input-group">
                <label htmlFor="maxParcelasCartao">Máximo de parcelas no crédito</label>
                <input
                  id="maxParcelasCartao"
                  type="number"
                  name="maxParcelasCartao"
                  min="1"
                  max="12"
                  step="1"
                  value={formData.maxParcelasCartao}
                  onChange={handleChange}
                  disabled={!isEditingMode}
                />
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>Define até qual opção, entre 1x e 12x, poderá ser usada na operação.</p>
              </div>

              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '12px', gridColumn: '1 / -1' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>Pagamento de Cartão Simplificado</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '14px' }}>
                  <input
                    type="checkbox"
                    checked={formData.pagamentoCartaoSimplificadoAtivo === true}
                    onChange={(e) => setFormData({ ...formData, pagamentoCartaoSimplificadoAtivo: e.target.checked })}
                    disabled={!isEditingMode}
                    style={{ accentColor: 'var(--accent-purple)', width: '16px', height: '16px' }}
                  />
                  Finalizar cartão de crédito/débito sem bandeira, autorização, parcelas ou banco
                </label>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                  Com esta opção ligada, ao escolher Cartão de Crédito ou Débito na venda/OS/PDV o operador só informa o
                  valor — o pagamento confirma na hora e é lançado automaticamente no banco padrão{' '}
                  <strong>&quot;{SIMPLIFIED_CARD_BANK_NAME}&quot;</strong> (criado automaticamente ao salvar). Dinheiro,
                  Pix, Transferência e Pagamento a Prazo não mudam. Desligada (padrão), o cartão continua pedindo
                  bandeira, NSU/autorização, parcelas e banco de destino, como hoje.
                </p>
              </div>

              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '12px', gridColumn: '1 / -1' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>Escolha da Forma de Pagamento</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '14px' }}>
                  <input
                    type="checkbox"
                    checked={formData.exigirEscolhaFormaPagamento === true}
                    onChange={(e) => setFormData({ ...formData, exigirEscolhaFormaPagamento: e.target.checked })}
                    disabled={!isEditingMode}
                    style={{ accentColor: 'var(--accent-purple)', width: '16px', height: '16px' }}
                  />
                  Obrigar o operador a escolher a forma de pagamento
                </label>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                  O campo passa a abrir em <strong>&quot;Selecione...&quot;</strong> em vez de Dinheiro, e finalizar sem escolher
                  mostra um aviso. Sem isso, quem vende no cartão ou no Pix também não mexe no campo — clica em finalizar e a
                  venda sai como Dinheiro, sujando o caixa e o relatório sem ninguém perceber. Custa um clique a mais por
                  venda; evita descobrir o erro no fechamento do caixa. Desligada (padrão), continua abrindo em Dinheiro.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Configuração de Nota Fiscal (Spedy) */}
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: showSpedy ? '1px solid var(--border-color)' : 'none', cursor: 'pointer' }}
            onClick={() => setShowSpedy(!showSpedy)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <FileText size={20} style={{ color: 'var(--accent-purple)' }} />
              <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Configuração de Nota Fiscal (Spedy)</h3>
            </div>
            <button type="button" style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              {showSpedy ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>
          </div>

          {showSpedy && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '24px' }}>
              <div className="input-group" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <input
                  type="checkbox"
                  name="spedyEnabled"
                  id="spedyEnabled"
                  checked={formData.spedyEnabled || false}
                  onChange={(e) => setFormData({ ...formData, spedyEnabled: e.target.checked })}
                  disabled={!isEditingMode}
                  style={{ width: '18px', height: '18px', accentColor: 'var(--accent-purple)', cursor: 'pointer' }}
                />
                <label htmlFor="spedyEnabled" style={{ fontSize: '14px', color: 'var(--text-primary)', cursor: 'pointer', fontWeight: 600 }}>Habilitar Emissão de Notas Fiscais (Spedy)</label>
              </div>

              {formData.spedyEnabled && (
                <>
                  <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Ambiente</label>
                    <select
                      name="spedyEnvironment"
                      value={formData.spedyEnvironment || 'sandbox'}
                      onChange={handleChange}
                      disabled={!isEditingMode}
                      style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)', maxWidth: '300px' }}
                    >
                      <option value="sandbox">Sandbox (Homologação / Testes)</option>
                      <option value="production">Produção (Valor Fiscal Real)</option>
                    </select>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>O ambiente de Sandbox permite simular emissões sem valor fiscal real.</p>
                  </div>

                  <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Spedy API Key (Chave da Empresa)</label>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                      <input
                        type={mostrarSpedyApiKey ? 'text' : 'password'}
                        name="spedyApiKey"
                        placeholder="Insira a chave obtida no painel Spedy"
                        value={formData.spedyApiKey || ''}
                        onChange={handleChange}
                        disabled={!isEditingMode}
                        style={{ flex: 1, backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 44px 12px 16px', color: 'var(--text-primary)' }}
                      />
                      <button
                        type="button"
                        onClick={() => setMostrarSpedyApiKey((atual) => !atual)}
                        title={mostrarSpedyApiKey ? 'Ocultar chave' : 'Mostrar chave'}
                        aria-label={mostrarSpedyApiKey ? 'Ocultar chave' : 'Mostrar chave'}
                        style={{ position: 'absolute', right: '12px', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0 }}
                      >
                        {mostrarSpedyApiKey ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Esta chave é única por empresa (CNPJ) e pode ser encontrada no painel da Spedy.</p>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Permissão de Usuários */}
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: showPermissoes ? '1px solid var(--border-color)' : 'none', cursor: 'pointer' }}
            onClick={() => setShowPermissoes(!showPermissoes)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Shield size={20} style={{ color: 'var(--accent-purple)' }} />
              <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Permissão de Usuários</h3>
            </div>
            <button type="button" style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              {showPermissoes ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>
          </div>

          {showPermissoes && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: 0 }}>
                Selecione um usuário da sua empresa para liberar ou bloquear o acesso aos módulos do sistema.
              </p>

              <div className="input-group">
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Selecionar Usuário</label>
                <select
                  value={selectedUserId}
                  onChange={handleUserSelect}
                  style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
                >
                  <option value="">-- Escolha um usuário --</option>
                  {tenantUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.nome} ({u.username})</option>
                  ))}
                </select>
              </div>

              {selectedUserId && selectedUserId !== tenantId && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', backgroundColor: 'var(--bg-secondary)', padding: '16px 20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>Copiar permissões de outro usuário</label>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <select
                      value={copiarPermissoesDeId}
                      onChange={(e) => setCopiarPermissoesDeId(e.target.value)}
                      style={{ flex: '1 1 220px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 14px', color: 'var(--text-primary)' }}
                    >
                      <option value="">-- Escolha o usuário de origem --</option>
                      {tenantUsers.filter(u => u.id !== selectedUserId).map(u => (
                        <option key={u.id} value={u.id}>{u.nome} ({u.username})</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={handleCopiarPermissoes}
                      disabled={!copiarPermissoesDeId}
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: copiarPermissoesDeId ? 1 : 0.5 }}
                    >
                      <Copy size={16} /> Copiar
                    </button>
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                    Copia as permissões (Módulos Permitidos) e o Nível de Acesso do usuário escolhido pra este. Não mexe nas regras de comissão. Só preenche a tela — clique em "Salvar Acessos" pra confirmar.
                  </p>
                </div>
              )}

              {selectedUserId && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', backgroundColor: 'var(--bg-tertiary)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>

                  {/* Bloco de Nivel de Acesso */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', borderBottom: '1px solid var(--border-color)', paddingBottom: '20px' }}>
                    <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10b981' }}></span>
                      Nível de Acesso
                    </h4>

                    {selectedUserId === tenantId ? (
                      <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
                        Este é o <strong>dono da empresa</strong>. Ele é sempre Administração e enxerga todas as vendas — o nível não pode ser alterado.
                      </p>
                    ) : (
                      <>
                        <select
                          value={selectedUserNivelAcesso}
                          onChange={(e) => setSelectedUserNivelAcesso(parseNivelAcesso(e.target.value))}
                          style={{ width: '100%', maxWidth: '320px', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 14px', color: 'var(--text-primary)', fontSize: '14px' }}
                        >
                          {NIVEIS_ACESSO.map((nivel) => (
                            <option key={nivel} value={nivel}>{NIVEL_ACESSO_LABELS[nivel]}</option>
                          ))}
                        </select>
                        <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                          O nível decide <strong>apenas</strong> quais vendas a pessoa enxerga. Os módulos que ela pode abrir continuam sendo os marcados aqui embaixo, em Módulos Permitidos — mudar o nível não libera módulo nenhum.
                        </p>
                        {formData.restringirVendasPorUsuario === true ? (
                          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                            {selectedUserNivelAcesso === 'funcionario'
                              ? 'Como a empresa está com "Não visualizar vendas de outro usuário" ligado, este usuário verá somente as vendas em que ele é o vendedor.'
                              : 'Este usuário verá as vendas de todos os vendedores, mesmo com a restrição ligada.'}
                          </p>
                        ) : (
                          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                            A restrição de visibilidade está <strong>desligada</strong> nas Configurações Avançadas desta empresa, então hoje todo mundo vê todas as vendas independente do nível. Este campo passa a valer quando você marcar "Não visualizar vendas de outro usuário".
                          </p>
                        )}
                      </>
                    )}
                  </div>

                  {/* Bloco de Comissões */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', borderBottom: '1px solid var(--border-color)', paddingBottom: '20px' }}>
                    <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#f59e0b' }}></span>
                      Regras de Comissão
                    </h4>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13px', color: 'var(--text-primary)' }}>
                          <input
                            type="checkbox"
                            checked={recebeComissaoServicos}
                            onChange={(e) => setRecebeComissaoServicos(e.target.checked)}
                            style={{ width: '18px', height: '18px', accentColor: '#f59e0b', cursor: 'pointer' }}
                          />
                          Comissão em Serviços?
                        </label>

                        {recebeComissaoServicos && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Porcentagem (%):</label>
                            <input
                              type="number"
                              min="0"
                              max="100"
                              placeholder="Usa o padrão do sistema"
                              value={comissaoPercentualServicos}
                              onChange={(e) => setComissaoPercentualServicos(e.target.value)}
                              style={{ width: '160px', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'var(--text-primary)', fontSize: '14px', outline: 'none' }}
                            />
                          </div>
                        )}
                        {recebeComissaoServicos && (
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Em branco, usa a comissão padrão do sistema (abaixo).</span>
                        )}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13px', color: 'var(--text-primary)' }}>
                          <input
                            type="checkbox"
                            checked={recebeComissaoPecas}
                            onChange={(e) => setRecebeComissaoPecas(e.target.checked)}
                            style={{ width: '18px', height: '18px', accentColor: '#f59e0b', cursor: 'pointer' }}
                          />
                          Comissão em Produtos?
                        </label>

                        {recebeComissaoPecas && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Porcentagem (%):</label>
                            <input
                              type="number"
                              min="0"
                              max="100"
                              placeholder="Usa o padrão do sistema"
                              value={comissaoPercentualPecas}
                              onChange={(e) => setComissaoPercentualPecas(e.target.value)}
                              style={{ width: '160px', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'var(--text-primary)', fontSize: '14px', outline: 'none' }}
                            />
                          </div>
                        )}
                        {recebeComissaoPecas && (
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Em branco, usa a comissão padrão do sistema (abaixo).</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Bloco de Permissões */}
                  <div>
                    <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--accent-purple)' }}></span>
                      Módulos Permitidos
                    </h4>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px', marginTop: '16px' }}>
                    {/* O catalogo saiu daqui em 2026-08-18 e virou
                        src/utils/permissionCatalog.ts, compartilhado com o popup de
                        permissoes da tela de Usuarios -- a lista duplicada em dois
                        componentes era garantia de divergencia. Para adicionar uma
                        permissao nova, edite AQUELE arquivo (as regras de sempre
                        continuam la: entrar tambem em MODULE_GROUPS e ter branch em
                        routeAccess.ts). */}
                    {PERMISSION_CATALOG.map(mod => {
                      const isChecked = selectedUserPermissions.includes(mod.id);
                      return (
                        <label key={mod.id} style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer',
                          fontSize: '13px', color: isChecked ? 'white' : 'var(--text-secondary)',
                          backgroundColor: isChecked ? 'rgba(255,255,255,0.03)' : 'var(--bg-primary)',
                          padding: '14px 16px', borderRadius: 'var(--radius-md)',
                          border: `1px solid ${isChecked ? mod.color : 'var(--border-color)'}`,
                          borderLeft: `4px solid ${isChecked ? mod.color : 'transparent'}`,
                          transition: 'all 0.2s', boxShadow: isChecked ? `0 0 10px ${mod.color}20` : 'none'
                        }}>
                          <span style={{ fontWeight: isChecked ? 600 : 400 }}>{mod.label}</span>
                          <div style={{ position: 'relative', width: '40px', height: '22px', backgroundColor: isChecked ? mod.color : 'var(--bg-tertiary)', borderRadius: '20px', transition: 'all 0.3s', border: `1px solid ${isChecked ? mod.color : 'var(--border-color)'}` }}>
                            <div style={{ position: 'absolute', top: '2px', left: isChecked ? '20px' : '2px', width: '16px', height: '16px', backgroundColor: isChecked ? '#fff' : 'var(--text-muted)', borderRadius: '50%', transition: 'all 0.3s', boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }} />
                          </div>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => togglePermission(mod.id)}
                            style={{ display: 'none' }}
                          />
                        </label>
                      );
                    })}
                  </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
                    <button
                      onClick={handleSavePermissions}
                      disabled={isSavingPermissions}
                      style={{
                        backgroundColor: 'var(--accent-purple)', color: 'var(--text-primary)', border: 'none',
                        padding: '10px 20px', borderRadius: 'var(--radius-md)', fontWeight: 600,
                        cursor: isSavingPermissions ? 'not-allowed' : 'pointer', opacity: isSavingPermissions ? 0.7 : 1,
                        display: 'flex', alignItems: 'center', gap: '8px', transition: 'all 0.2s'
                      }}
                    >
                      {isSavingPermissions ? <Loader2 size={16} className="spin-icon" /> : <Save size={16} />}
                      {isSavingPermissions ? 'Salvando...' : 'Salvar Acessos'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

export default Configuracoes;
