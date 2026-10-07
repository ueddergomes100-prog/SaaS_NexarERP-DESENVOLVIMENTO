import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Receipt, Plus, Search, CheckCircle,
  XCircle, AlertCircle, Eye, Download, RefreshCw, X, Ban, Settings,
  ChevronLeft, ChevronRight, MessageCircle, Loader2, FilePenLine, RotateCcw, Mail
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import MenuMaisOpcoes from '../../components/common/MenuMaisOpcoes';
import { collection, query, where, getDocs, onSnapshot, addDoc, updateDoc, doc, getDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { spedyService } from '../../services/spedyService';
import type { SpedyInvoice } from '../../services/spedyService';
import { showSuccess, showError, showWarning, NexusSwal, escaparHtml } from '../../utils/alerts';
import { notaEmailService } from '../../services/notaEmailService';
import { isPlatformAdminRole } from '../../utils/roles';
import { isVendaDoUsuario } from '../../utils/visibilidadeVendasDomain';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { aplicarCaixaAltaCadastro } from '../../utils/textoCadastroDomain';
import {
  DEFAULT_REGIME_TRIBUTARIO, REGIME_TRIBUTARIO_OPTIONS, buildServiceInvoicePayload,
  buildServiceInvoiceDescription, sumServiceInvoiceAmount, usesCsosn,
  isExportCfop, resolveInvoiceDestination, resolveInvoiceUnitFields,
  type RegimeTributario, type NfseConfig, type OsServicoParaFatura, type ClienteParaFatura,
} from '../../utils/fiscalDomain';
import {
  TEXTO_OPTANTE_SIMPLES_NACIONAL, destinatarioEConsumidorFinal, montarItemNotaFiscal, montarPagamentosNota,
  percentuaisTributos, produtoFiscalDoCadastro, resolverGtin, somarTributos, textoTributosAproximados, totaisImpostosDosItens, type ValoresTributosItem,
} from '../../utils/notaFiscalItemDomain';
import Swal from 'sweetalert2';
import { motivoPedidoNaoEmiteNota, notaDeveAparecer } from '../../utils/notaFiscalVisibilidadeDomain';
import { escolherIntegrationIdDoReenvio, rejeicaoPrendeConfiguracaoNaNota } from '../../utils/reenvioNotaDomain';
import { resolverInscricaoEstadualDestinatario } from '../../utils/destinatarioFiscalDomain';
import EmissaoProgressoModal from '../../components/common/EmissaoProgressoModal';
import PdfVisualizador from '../../components/common/PdfVisualizador';
import { nomeArquivoDocumento } from '../../utils/nomeArquivoDomain';
import CartaCorrecaoModal from '../../components/common/CartaCorrecaoModal';
import DevolucaoNfeModal from '../../components/common/DevolucaoNfeModal';
import { motivoQueImpedeCartaNaTela, notaAceitaCartaCorrecao, type CartaEnviada } from '../../utils/cartaCorrecaoDomain';
import { desfechoDoStatus, type EtapaEmissao } from '../../utils/emissaoProgressoDomain';
import { useEmissaoAcompanhamento, type ProgressoEmissao } from '../../hooks/useEmissaoAcompanhamento';
import type { PaymentRecord } from '../../utils/financeDomain';
import { ratearValorPorPesos } from '../../utils/notaAvulsaDomain';
import EmissaoLoteModal, { type PedidoParaLote, type ResultadoItemLote } from './EmissaoLoteModal';

interface FiscalConfig {
  spedyEnabled: boolean;
  spedyApiKey: string;
  spedyEnvironment: 'sandbox' | 'production';
}

interface LocalInvoice {
  id: string; // Firebase doc ID
  spedyId: string; // Spedy UUID
  number: number | null;
  tipo: 'NFS-e' | 'NF-e' | 'NFC-e';
  clienteNome: string;
  valor: number;
  data: string;
  status: string;
  processingMessage?: string | null;
  processingCode?: string | null;
  accessKey?: string | null;
  pedidoId?: string | null;
  osId?: string | null;
  clienteId?: string | null;
  /** Resultado do ultimo e-mail ao cliente (gravado pelo servidor). */
  emailEnvio?: { status?: 'enviado' | 'erro'; para?: string; erro?: string } | null;
  /** Tentativa de emissao em uso na Spedy (1 = original). Ver reenvioNotaDomain.ts. */
  tentativaEmissao?: number | null;
  /** Id com que a nota foi criada na Spedy -- o reenvio usa o MESMO pra manter o numero. */
  integrationId?: string | null;
  /** Cartas de correcao (CC-e) ja enviadas -- gravadas pelo servidor. */
  cartasCorrecao?: CartaEnviada[];
  /** 'devolucao' = NF-e de devolucao de venda (entrada), emitida pelo servidor. */
  finalidade?: string | null;
  /** Devolucao (devolucoes_venda) que esta nota documenta. */
  devolucaoId?: string | null;
  /** Pedido da venda devolvida (nas notas de devolucao; `pedidoId` fica vazio de proposito). */
  pedidoOrigemId?: string | null;
  /** 'transferencia' (Filiais F4): transferencia entre filiais que esta nota documenta. */
  transferenciaId?: string | null;
  numeroTransferencia?: string | null;
}

interface ClienteOption {
  id: string;
  nome: string;
  documento: string;
  /** Campo "Inscricao Estadual / RG" do cadastro do cliente. */
  identidade?: string;
  email: string;
  endereco?: string;
  numero?: string;
  bairro?: string;
  cep?: string;
  cidade?: string;
  estado?: string;
  codigoIbge?: string;
  telefone?: string;
  /** Codigo do cliente (o numero que a empresa usa pra achar o cliente). */
  codigo?: string;
}

interface PedidoVendaItem {
  id: string;
  nome: string;
  quantidade: number;
  precoUnitario: number;
  desconto: number;
  valorTotal: number;
  /** Codigo interno do produto (Estoque -> Codigo interno, ex: "1") --
   * distinto de `id` (o id do documento no Firestore). A NF-e manda isso
   * como "codigo do produto" na DANFE; usar o id do documento ali confunde
   * o cliente, que nunca viu esse id em lugar nenhum do sistema. */
  codigoProduto?: string;
  ncm?: string;
  cfop?: string;
  csosn?: string;
  origem?: string;
  aliquotaIcms?: number;
  reducaoBaseIcms?: number;
  cstPis?: string;
  aliquotaPis?: number;
  cstCofins?: string;
  aliquotaCofins?: number;
  cstIpi?: string;
  aliquotaIpi?: number;
  cstIbs?: string;
  aliquotaIbs?: number;
  cstCbs?: string;
  aliquotaCbs?: number;
  /** Peso liquido POR UNIDADE (kg) do produto -- so usado quando o CFOP
   * do item e de exportacao (7101/7102), pra converter a quantidade
   * comercial pra quilo antes de emitir (ver fiscalDomain.ts). */
  pesoLiquidoUnitarioKg?: number;
  // Demais dados fiscais do cadastro (2026-09-30, ver notaFiscalItemDomain.ts).
  cfopInterestadual?: string;
  csosnInterestadual?: string;
  cest?: string;
  codigoBarras?: string;
  beneficioFiscal?: string;
  enquadramentoIpi?: string;
  percentualTributosFederal?: number;
  percentualTributosEstadual?: number;
  percentualTributosMunicipal?: number;
  percentualTributos?: number;
  /** Unidade em que o item foi vendido (vem do pedido). */
  unidadeMedidaSigla?: string;
  embalagemId?: string;
  /** Dados fiscais lidos do cadastro do produto (e nao item avulso/produto apagado). */
  doCadastro?: boolean;
}

/** Campos fiscais do item que a pessoa pode corrigir na propria nota (aba Produtos). */
type CampoFiscalEditavel = 'ncm' | 'cest' | 'cfop' | 'csosn' | 'origem';
const CAMPOS_FISCAIS_EDITAVEIS: CampoFiscalEditavel[] = ['ncm', 'cest', 'cfop', 'csosn', 'origem'];
const ROTULO_CAMPO_FISCAL: Record<CampoFiscalEditavel, string> = { ncm: 'NCM', cest: 'CEST', cfop: 'CFOP', csosn: 'CSOSN/CST', origem: 'Origem' };
const normalizarCampoFiscal = (campo: CampoFiscalEditavel, valor: unknown) => {
  const texto = String(valor ?? '').trim();
  return campo === 'ncm' || campo === 'cest' || campo === 'cfop' ? texto.replace(/\D/g, '') : texto;
};

/** "NFE", "NFCE", "NFSE" -- comeco do nome do arquivo baixado. */
const siglaArquivoNota = (tipo: string) => (tipo === 'NFC-e' ? 'NFCE' : tipo === 'NFS-e' ? 'NFSE' : 'NFE');

/** "[nItem: 1]" da mensagem da SEFAZ -> indice 0 da tabela. */
const itemDaMensagemSefaz = (mensagem: unknown): number | null => {
  const achado = String(mensagem ?? '').match(/nItem\s*:?\s*(\d+)/i);
  return achado ? Number(achado[1]) - 1 : null;
};

/** Erro de montagem de UM item da nota -- a tela destaca a linha na aba Produtos. */
class ErroItemNota extends Error {
  indice: number;
  constructor(mensagem: string, indice: number) {
    super(mensagem);
    this.indice = indice;
  }
}

interface PedidoVenda {
  id: string;
  numeroPedido: string;
  clienteId: string;
  clienteNome: string;
  valorTotal: number;
  itens: PedidoVendaItem[];
  formaPagamento: string;
  createdAt?: unknown;
  /** Desconto GERAL do pedido (nao o desconto por item, que ja vem em cada item.desconto) --
   *  em centavos, exatamente o que foi aplicado na venda. Usado pra ratear entre os itens na
   *  hora de montar a nota (ver handleSelectPedido): sem isso a nota saia sempre no preco
   *  cheio, porque so' o desconto por item chegava na Spedy. */
  descontoGeralCentavos?: number;
  /** Pagamentos da venda (mesmo formato salvo pelo Pedido) -- usado pra montar as duplicatas
   *  (parcelas) da nota quando a forma e' Boleto/a prazo. */
  pagamentos?: PaymentRecord[];
}

/** Ordem de Servico finalizada, so os campos usados pra importar como
 * NFS-e -- nunca le `pecas`, so `servicos` (exclusao estrutural, peca de
 * OS nao tem caminho de nota fiscal nesta entrega). */
interface OrdemServicoParaImportar {
  id: string;
  numeroOS: string;
  clienteId: string;
  clienteNome: string;
  servicos: OsServicoParaFatura[];
}

const NFE: React.FC = () => {
  const { currentUser, tenantId, userRole, userPermissions, isOwner, vendasVisiveisDeUsuarioId } = useAuth();

  const canEmitirNota = isOwner || isPlatformAdminRole(userRole) || (userPermissions && userPermissions.includes('fiscal.emitir'));
  const canCancelarNota = isOwner || isPlatformAdminRole(userRole) || (userPermissions && userPermissions.includes('fiscal.excluir'));

  // Configurações
  const [config, setConfig] = useState<FiscalConfig | null>(null);
  // A empresa configurou o SMTP em Configuracoes: o e-mail da NF-e sai pelo sistema. Sem isso, segue o envio da Spedy como sempre foi.
  const [emailPeloSistema, setEmailPeloSistema] = useState(false);
  const [isConfigLoading, setIsConfigLoading] = useState(true);
  const [regimeTributario, setRegimeTributario] = useState<RegimeTributario>(DEFAULT_REGIME_TRIBUTARIO);
  const [nfseConfig, setNfseConfig] = useState<NfseConfig>({ habilitada: false });

  // Estado de dados
  const [allInvoices, setInvoices] = useState<LocalInvoice[]>([]);
  const [clients, setClients] = useState<ClienteOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  // Id da nota com o PDF (DANFE) sendo buscado agora -- so pra trocar o
  // iconezinho de olho por um spinner enquanto o fetch do PDF roda, que
  // sem isso parecia o sistema ter travado (nenhum feedback ate a aba
  // nova abrir).
  const [carregandoPdfId, setCarregandoPdfId] = useState<string | null>(null);
  /** PDF (DANFE) aberto dentro do sistema, ja' com o nome de arquivo "NFE 000040 - CLIENTE.pdf". */
  const [pdfAberto, setPdfAberto] = useState<{ titulo: string; nome: string; blob: Blob } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTab, setSelectedTab] = useState<'Todas' | 'NFC-e' | 'NF-e' | 'NFS-e'>('Todas');
  const [page, setPage] = useState(1);
  /** Ordem da lista pelo numero da nota (pedido do dono, 2026-09-30: crescente). Clique no titulo inverte. */
  const [ordemNumero, setOrdemNumero] = useState<'asc' | 'desc'>(() => {
    try { return localStorage.getItem('nfe.ordemNumero') === 'desc' ? 'desc' : 'asc'; } catch { return 'asc'; }
  });
  const inverterOrdemNumero = () => {
    const nova = ordemNumero === 'asc' ? 'desc' : 'asc';
    setOrdemNumero(nova);
    try { localStorage.setItem('nfe.ordemNumero', nova); } catch { /* so' preferencia da tela */ }
  };
  const [pageSize, setPageSize] = useState(20);

  // Modal de Emissão
  const [isModalOpen, setIsModalOpen] = useState(false);
  // `?pedido=<id>`: o fim da venda manda pra ca' quando a empresa emite
  // NF-e em vez de cupom (ver documentoFiscalVendaDomain.ts).
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const pedidoImportadoPelaUrlRef = useRef('');
  const [isClientDropdownOpen, setIsClientDropdownOpen] = useState(false);
  const clientDropdownRef = useRef<HTMLDivElement>(null);
  // Idempotencia da Spedy: `integrationId` estavel por tentativa de
  // emissao, gerado uma vez por abertura do modal e reaproveitado se o
  // usuario clicar "Emitir" de novo apos um erro/timeout, sem fechar o
  // modal -- evita nota fiscal duplicada num reenvio manual. Zerado em
  // handleCloseModal (nota nova = id novo).
  const pendingIntegrationIdRef = useRef<string | null>(null);

  // Importação de Pedidos
  const [pedidosVenda, setPedidosVenda] = useState<PedidoVenda[]>([]);
  // Visibilidade de vendas: a nota nao guarda vendedor, so pedidoId. Quem
  // esta restrito ja recebe pedidosVenda filtrado, entao a nota amarrada a
  // um pedido que sumiu da lista tambem some daqui. Nota sem pedidoId
  // (NFS-e de OS ou avulsa) nao e' venda de vendedor nenhum e continua
  // visivel. Ver src/utils/visibilidadeVendasDomain.ts.
  // Pedidos cancelados: as notas que nao chegaram a valer, ligadas a eles,
  // saem da lista. Ver src/utils/notaFiscalVisibilidadeDomain.ts.
  const [pedidosCanceladosIds, setPedidosCanceladosIds] = useState<Set<string>>(new Set());
  const [mostrarCanceladas, setMostrarCanceladas] = useState(false);
  const invoices = useMemo(() => {
    const pedidosVisiveis = new Set(pedidosVenda.map((pedido) => pedido.id));
    return allInvoices
      .filter((note) => {
        const pedidoDaNota = note.pedidoId || note.pedidoOrigemId; // devolucao aponta pro pedido da venda original
        return !vendasVisiveisDeUsuarioId || !pedidoDaNota || pedidosVisiveis.has(pedidoDaNota);
      })
      .filter((note) => notaDeveAparecer(note, pedidosCanceladosIds, mostrarCanceladas));
  }, [allInvoices, pedidosVenda, vendasVisiveisDeUsuarioId, pedidosCanceladosIds, mostrarCanceladas]);
  const [importedPedidoItens, setImportedPedidoItens] = useState<PedidoVendaItem[]>([]);
  const [importedPedidoId, setImportedPedidoId] = useState<string>('');
  /** Pagamentos do pedido importado -- usado so' pra montar as duplicatas (parcelas) da nota
   *  quando a forma e' Boleto/a prazo. Ver handleSelectPedido e o payload de emissao. */
  const [importedPedidoPagamentos, setImportedPedidoPagamentos] = useState<PaymentRecord[]>([]);
  /** Tela "Emitir NF-e em lote" aberta (ver EmissaoLoteModal). */
  const [loteAberto, setLoteAberto] = useState(false);
  const [atualizandoCadastro, setAtualizandoCadastro] = useState(false);

  // Importação de Ordens de Serviço (NFS-e) -- so servicos, nunca pecas
  const [ordensServico, setOrdensServico] = useState<OrdemServicoParaImportar[]>([]);
  const [importedOsServicos, setImportedOsServicos] = useState<OsServicoParaFatura[]>([]);
  const [importedOsId, setImportedOsId] = useState<string>('');

  // Estados adicionados para a aba de produtos e Nota Cuponada
  const [activeModalTab, setActiveModalTab] = useState<'cliente' | 'produtos'>('cliente');
  const [referencedAccessKey, setReferencedAccessKey] = useState<string>('');
  const [retransmittingInvoiceId, setRetransmittingInvoiceId] = useState<string | null>(null);
  /**
   * Correcao de nota rejeitada (2026-09-30, pedido do dono): a rejeicao aparece no
   * topo da aba Produtos, o item apontado pela SEFAZ fica em destaque e da' pra
   * corrigir ali mesmo (NCM, CEST, CFOP, CSOSN) e transmitir -- sem sair pro
   * cadastro do produto. Na transmissao, o sistema oferece levar a correcao pro cadastro.
   */
  const [correcaoRejeicao, setCorrecaoRejeicao] = useState<{ mensagem: string; itemIndice: number | null } | null>(null);
  const [itemComProblema, setItemComProblema] = useState<number | null>(null);
  /** Dados fiscais de cada item como vieram do cadastro -- base pra saber o que foi corrigido na nota. */
  const [fiscalDoCadastro, setFiscalDoCadastro] = useState<Array<Record<CampoFiscalEditavel, string> | null>>([]);

  // Volta pra primeira página sempre que o filtro/busca/aba mudar
  useEffect(() => { setPage(1); }, [searchTerm, selectedTab]);

  // Limpa estados temporários ao fechar o modal
  const handleCloseModal = () => {
    setIsModalOpen(false);
    setRetransmittingInvoiceId(null);
    setCorrecaoRejeicao(null);
    setItemComProblema(null);
    pendingIntegrationIdRef.current = null;
  };

  const fotografiaFiscal = (itens: PedidoVendaItem[]) => itens.map((it) => (it.doCadastro
    ? Object.fromEntries(CAMPOS_FISCAIS_EDITAVEIS.map((c) => [c, normalizarCampoFiscal(c, it[c])])) as Record<CampoFiscalEditavel, string>
    : null));

  const [formData, setFormData] = useState({
    tipo: 'NF-e',
    clienteId: '',
    clienteNome: '',
    documento: '',
    /** IE do destinatario (so' vale pra CNPJ) -- vem do cadastro do cliente. */
    inscricaoEstadual: '',
    email: '',
    valor: '',
    descricao: '',
    // Endereço: vazio de proposito -- vem SEMPRE do cadastro do cliente.
    // Ate 2026-09-30 nascia com um endereco de exemplo (Rua Principal, Sao
    // Paulo/SP, IBGE 3550308) que vazava pra nota de verdade quando o cliente
    // nao tinha o dado: cliente migrado sem codigo IBGE saia com o municipio de
    // SAO PAULO e a SEFAZ validava a IE de MG como se fosse de SP (Rejeicao 210
    // "IE do destinatario invalida", NF-e 000036 da Sol Life). Vazio, a trava de
    // endereco incompleto (handleEmitir) pega e diz o que corrigir.
    cep: '',
    rua: '',
    numero: '',
    bairro: '',
    cidade: '',
    estado: '',
    codigoIbge: '',
    // Específico NFS-e
    federalServiceCode: '',
    cityServiceCode: '',
    issRate: '0',
    // Específico NF-e
    // Lancamento avulso: NCM e CSOSN digitados pela pessoa. Nasciam com
    // 87082999 (peca de veiculo) e 400 (nao tributada) e iam assim pra nota.
    ncm: '',
    cfop: '5102', // Venda
    csosn: ''
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  /** Devolucao (id) cuja NF-e de devolucao esta aberta no pop-up. null = fechado. */
  const [devolucaoNfeId, setDevolucaoNfeId] = useState<string | null>(null);
  /** Nota (id do documento) cuja carta de correcao esta aberta. null = fechado. */
  const [notaDaCartaId, setNotaDaCartaId] = useState<string | null>(null);
  /** Pop-up de acompanhamento da emissao (estado, consulta e DANFE): ver useEmissaoAcompanhamento.ts. */
  const {
    progresso, setProgresso, segundosEsperando, abrindoDanfe: abrindoDanfeProgresso,
    notaEmAcompanhamentoRef, fechar: fecharProgresso, abrirDanfe: abrirDanfeDoProgresso, acompanhar: acompanharNota,
    emailNota, reenviarEmail,
  } = useEmissaoAcompanhamento();

  // Fecha dropdown do cliente ao clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (clientDropdownRef.current && !clientDropdownRef.current.contains(event.target as Node)) {
        setIsClientDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Busca configurações fiscais, clientes e pedidos
  useEffect(() => {
    const loadConfigAndClients = async () => {
      if (!tenantId) return;
      try {
        // 1. Busca configs fiscais pelo backend para nao expor a chave Spedy no navegador.
        const runtimeConfig = await spedyService.getRuntimeConfig();
        setConfig({
          spedyEnabled: runtimeConfig.spedyEnabled,
          spedyApiKey: runtimeConfig.spedyApiKeyConfigured ? '__backend_proxy__' : '',
          spedyEnvironment: runtimeConfig.spedyEnvironment
        });

        // 1b. Regime tributário do tenant -- decide se o bloco de impostos
        // enviado a Spedy usa CSOSN (Simples Nacional) ou CST real com
        // base/alíquota (Presumido/Real).
        const configSnap = await getDoc(doc(db, 'configuracoes', tenantId));
        const configData = configSnap.data();
        setEmailPeloSistema(configData?.emailNotasConfigurado === true);
        setRegimeTributario((configData?.regimeTributario ?? DEFAULT_REGIME_TRIBUTARIO) as RegimeTributario);

        // 1c. Config de NFS-e do tenant (Configuracoes > Emissao Fiscal
        // Habilitada > Emite NFS-e) -- so preenche os defaults do modal
        // quando uma OS e importada, continua editavel antes de emitir.
        setNfseConfig({
          habilitada: configData?.emiteNFSe === true,
          cidadeCodigo: configData?.nfseCidadeCodigo || '',
          cidadeNome: configData?.nfseCidadeNome || '',
          cidadeEstado: configData?.nfseCidadeEstado || '',
          inscricaoMunicipal: configData?.nfseInscricaoMunicipal || '',
          codigoServicoMunicipal: configData?.nfseCodigoServicoMunicipal || '',
          codigoServicoFederal: configData?.nfseCodigoServicoFederal || '',
          aliquotaIssPadrao: Number(configData?.nfseAliquotaIssPadrao || 0),
        });

        // 2. Busca lista de clientes locais
        const clientsRef = collection(db, 'clientes');
        const q = query(clientsRef, where('tenantId', '==', tenantId));
        const qSnap = await getDocs(q);
        const clientList: ClienteOption[] = [];
        qSnap.forEach(d => {
          const dData = d.data();
          clientList.push({
            id: d.id,
            nome: dData.nome || '',
            documento: dData.documento || '',
            identidade: dData.identidade || '',
            email: dData.email || '',
            endereco: dData.endereco || '',
            numero: dData.numero || '',
            bairro: dData.bairro || '',
            cep: dData.cep || '',
            cidade: dData.cidade || '',
            estado: dData.estado || '',
            codigoIbge: dData.codigoIbge || '',
            telefone: dData.telefone || '',
            codigo: dData.codigo != null ? String(dData.codigo) : ''
          });
        });
        setClients(clientList);

        // 3. Busca lista de pedidos de venda finalizados
        const pedidosRef = collection(db, 'pedidos_venda');
        const qPed = query(
          pedidosRef,
          where('tenantId', '==', tenantId),
          where('status', '==', 'Finalizada')
        );
        const qPedSnap = await getDocs(qPed);
        const pedidosList: PedidoVenda[] = [];
        qPedSnap.forEach(d => {
          const dData = d.data();
          // Visibilidade de vendas: quem so ve as proprias vendas tambem so
          // pode importar as proprias pra nota -- a lista de pedidos aqui
          // mostra cliente e valor de cada venda.
          if (vendasVisiveisDeUsuarioId && !isVendaDoUsuario(dData, vendasVisiveisDeUsuarioId)) return;
          pedidosList.push({
            id: d.id,
            numeroPedido: dData.numeroPedido || '',
            clienteId: dData.clienteId || '',
            clienteNome: dData.clienteNome || '',
            valorTotal: dData.valorTotal || 0,
            itens: dData.itens || [],
            formaPagamento: dData.formaPagamento || '',
            createdAt: dData.createdAt,
            descontoGeralCentavos: Number(dData.descontoGeral?.valorAplicadoCentavos || 0),
            pagamentos: Array.isArray(dData.pagamentos) ? dData.pagamentos : [],
          });
        });
        pedidosList.sort((a, b) => {
          const numA = Number(a.numeroPedido) || 0;
          const numB = Number(b.numeroPedido) || 0;
          return numB - numA;
        });
        setPedidosVenda(pedidosList);

        // Pedidos/pre-vendas cancelados: so' os ids, pra esconder as notas
        // que ficaram penduradas neles. Falha aqui nao derruba a tela -- as
        // notas apenas continuam aparecendo.
        try {
          const cancelados = await getDocs(query(
            pedidosRef,
            where('tenantId', '==', tenantId),
            where('status', '==', 'Cancelada'),
          ));
          setPedidosCanceladosIds(new Set(cancelados.docs.map((d) => d.id)));
        } catch (erroCancelados) {
          console.error('Erro ao buscar pedidos cancelados (notas ligadas a eles continuam visiveis):', erroCancelados);
        }

        // 4. Busca lista de Ordens de Servico finalizadas, pra importar
        // como NFS-e -- so os campos usados, nunca `pecas`.
        const osRef = collection(db, 'ordens_de_servico');
        const qOs = query(
          osRef,
          where('tenantId', '==', tenantId),
          where('status', '==', 'Finalizada')
        );
        const qOsSnap = await getDocs(qOs);
        const osList: OrdemServicoParaImportar[] = [];
        qOsSnap.forEach(d => {
          const dData = d.data();
          osList.push({
            id: d.id,
            numeroOS: dData.numeroOS || '',
            clienteId: dData.clienteId || '',
            clienteNome: dData.clienteNome || '',
            servicos: dData.servicos || []
          });
        });
        osList.sort((a, b) => (Number(b.numeroOS) || 0) - (Number(a.numeroOS) || 0));
        setOrdensServico(osList);

      } catch (err) {
        console.error("Erro ao carregar dados iniciais do módulo fiscal", err);
      } finally {
        setIsConfigLoading(false);
      }
    };
    loadConfigAndClients();
  }, [tenantId, vendasVisiveisDeUsuarioId]);

  // Sincroniza campos avulsos/manuais com importedPedidoItens quando não há pedido nem OS selecionado
  useEffect(() => {
    if (!importedPedidoId && !importedOsId && isModalOpen) {
      const timer = setTimeout(() => {
        setImportedPedidoItens(prev => {
          const currentAvulso = prev[0];
          const newNome = formData.descricao || 'Manual NF-e Item';
          const newPreco = Number(formData.valor) || 0;
          const newNcm = formData.ncm || '';
          const newCfop = formData.cfop || '5102';
          const newCsosn = formData.csosn || '';

          if (currentAvulso &&
              currentAvulso.id === 'avulso' &&
              currentAvulso.nome === newNome &&
              currentAvulso.precoUnitario === newPreco &&
              currentAvulso.ncm === newNcm &&
              currentAvulso.cfop === newCfop &&
              currentAvulso.csosn === newCsosn) {
            return prev;
          }

          return [
            {
              id: 'avulso',
              nome: newNome,
              quantidade: 1,
              precoUnitario: newPreco,
              valorTotal: newPreco,
              desconto: 0,
              ncm: newNcm,
              cfop: newCfop,
              csosn: newCsosn,
              origem: '0'
            }
          ];
        });
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [formData.descricao, formData.valor, formData.ncm, formData.cfop, formData.csosn, importedPedidoId, importedOsId, isModalOpen]);

  const handleItemTaxChange = (index: number, field: string, value: string) => {
    const updated = [...importedPedidoItens];
    updated[index] = {
      ...updated[index],
      [field]: value
    };
    setImportedPedidoItens(updated);

    // Se for item manual/avulso e for a única linha, sincroniza de volta ao formData
    if (!importedPedidoId && index === 0) {
      if (field === 'nome') {
        setFormData(prev => ({ ...prev, descricao: value }));
      } else if (field === 'precoUnitario') {
        setFormData(prev => ({ ...prev, valor: value }));
      } else {
        setFormData(prev => ({ ...prev, [field]: value }));
      }
    }
  };

  // Auxiliar para buscar tributação real dos produtos no Firestore
  const fetchPedidoItensTaxes = async (items: PedidoVendaItem[]) => {
    const mapped: PedidoVendaItem[] = [];
    for (const item of items) {
      if (item.id && item.id !== 'avulso') {
        try {
          const docRef = doc(db, 'estoque', item.id);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            // Tudo do cadastro, sem inventar: o que faltar (NCM, CSOSN, CFOP) a
            // montagem do item barra com o nome do produto (notaFiscalItemDomain).
            // Antes caia em NCM 87082999 (autopeca) e CSOSN 400 sem avisar.
            const f = produtoFiscalDoCadastro(docSnap.data(), { embalagemId: item.embalagemId });
            mapped.push({
              ...item,
              codigoProduto: f.codigo || item.id,
              ncm: f.ncm,
              cfop: f.cfop,
              csosn: f.csosn,
              cfopInterestadual: f.cfopInterestadual,
              csosnInterestadual: f.csosnInterestadual,
              origem: f.origem,
              aliquotaIcms: f.aliquotaIcms,
              reducaoBaseIcms: f.reducaoBaseIcms,
              cstPis: f.cstPis,
              aliquotaPis: f.aliquotaPis,
              cstCofins: f.cstCofins,
              aliquotaCofins: f.aliquotaCofins,
              cstIpi: f.cstIpi,
              aliquotaIpi: f.aliquotaIpi,
              enquadramentoIpi: f.enquadramentoIpi,
              cstIbs: f.cstIbs,
              aliquotaIbs: f.aliquotaIbs,
              cstCbs: f.cstCbs,
              aliquotaCbs: f.aliquotaCbs,
              cest: f.cest,
              codigoBarras: f.codigoBarras,
              beneficioFiscal: f.beneficioFiscal,
              percentualTributosFederal: f.percentualTributosFederal,
              percentualTributosEstadual: f.percentualTributosEstadual,
              percentualTributosMunicipal: f.percentualTributosMunicipal,
              percentualTributos: f.percentualTributos,
              pesoLiquidoUnitarioKg: f.pesoLiquidoUnitarioKg,
              unidadeMedidaSigla: item.unidadeMedidaSigla || String(docSnap.data().unidadeMedidaSigla || ''),
              doCadastro: true,
            });
            continue;
          }
        } catch (err) {
          console.error(`Erro ao carregar dados fiscais do produto ${item.id}`, err);
        }
      }
      // Item avulso ou produto apagado: vai so' com o que a venda tem. NCM/CFOP/
      // CSOSN sao digitados na aba Produtos da nota (a montagem barra se faltar).
      mapped.push({ ...item, origem: item.origem || '0' });
    }
    return mapped;
  };

  // Ação ao selecionar pedido para importação
  /**
   * Relê do CADASTRO o que a nota usa: NCM/CFOP/CST/aliquotas de cada produto
   * e IE/documento/e-mail do cliente. Serve pra quando o cadastro foi corrigido
   * DEPOIS de a nota ser aberta -- a tela guarda uma copia dos dados. Descarta o
   * que foi digitado na mao aqui na nota (por isso o botao diz o que faz).
   */
  const atualizarDoCadastro = async () => {
    setAtualizandoCadastro(true);
    try {
      if (importedPedidoItens.length > 0) {
        const relidos = await fetchPedidoItensTaxes(importedPedidoItens);
        setImportedPedidoItens(relidos);
        setFiscalDoCadastro(fotografiaFiscal(relidos));
      }
      if (formData.clienteId) {
        const clienteSnap = await getDoc(doc(db, 'clientes', formData.clienteId));
        if (clienteSnap.exists() && clienteSnap.data().tenantId === tenantId) {
          const c = clienteSnap.data();
          setFormData((prev) => ({
            ...prev,
            inscricaoEstadual: c.identidade || '',
            documento: c.documento || prev.documento,
            email: c.email || prev.email,
            // Endereco tambem: e' o caso tipico de "corrigi o cadastro" (ex.:
            // cliente migrado sem codigo IBGE da cidade).
            cep: c.cep || '',
            rua: c.endereco || '',
            numero: c.numero || '',
            bairro: c.bairro || '',
            cidade: c.cidade || '',
            estado: c.estado || '',
            codigoIbge: c.codigoIbge || '',
          }));
        }
      }
      showSuccess('Dados atualizados do cadastro!');
    } catch (erro) {
      console.error('Erro ao atualizar os dados da nota a partir do cadastro:', erro);
      showError('Não foi possível atualizar', 'Não consegui ler o cadastro agora. Tente de novo em instantes.');
    } finally {
      setAtualizandoCadastro(false);
    }
  };

  /**
   * NF-e que JA EXISTE pra este pedido -- autorizada ou ainda em transmissao
   * (2026-09-30, pedido do dono: "se clicar pra transmitir uma venda que ja
   * foi emitida, o sistema deve barrar"). Conferido no BANCO, nao na lista da
   * tela: outra aba ou outro computador pode ter emitido agora ha pouco. Nota
   * rejeitada ou cancelada nao conta (dai' pode emitir de novo), nem a propria
   * nota que esta sendo retransmitida.
   */
  const notaNfeJaEmitidaDoPedido = async (pedidoId: string, ignorarNotaId?: string | null): Promise<LocalInvoice | null> => {
    if (!tenantId || !pedidoId) return null;
    const snap = await getDocs(query(
      collection(db, 'notas_fiscais'),
      where('tenantId', '==', tenantId),
      where('pedidoId', '==', pedidoId),
    ));
    const achada = snap.docs.find((d) => {
      const n = d.data();
      return d.id !== ignorarNotaId
        && n.tipo === 'NF-e'
        && ['authorized', 'enqueued', 'processing', 'created'].includes(String(n.status));
    });
    if (!achada) return null;
    const n = achada.data();
    return {
      id: achada.id,
      spedyId: n.spedyId || '',
      number: n.number || null,
      tipo: 'NF-e',
      clienteNome: n.clienteNome || '',
      valor: n.valor || 0,
      data: '',
      status: n.status,
      pedidoId,
    };
  };

  /** Barra a nota duplicada: diz qual nota ja existe e, se autorizada, oferece abrir o PDF. */
  const avisarNotaJaEmitida = async (nota: LocalInvoice, numeroPedido?: string) => {
    const doPedido = numeroPedido ? ` do pedido #${numeroPedido}` : ' deste pedido';
    if (nota.status !== 'authorized') {
      await NexusSwal.fire({
        icon: 'info',
        title: 'Nota fiscal já enviada',
        text: `A NF-e${doPedido} já foi transmitida e está aguardando a resposta da SEFAZ. Não emita outra: aguarde alguns instantes e clique em "Sincronizar Notas" para ver o resultado.`,
        confirmButtonText: 'Entendi',
      });
      return;
    }
    const escolha = await NexusSwal.fire({
      icon: 'warning',
      title: 'Este pedido já tem nota fiscal',
      text: `A NF-e${nota.number ? ` nº ${nota.number}` : ''}${doPedido} já foi emitida e autorizada. Não é possível emitir outra nota para a mesma venda. Quer abrir o PDF da nota?`,
      showCancelButton: true,
      confirmButtonText: 'Abrir PDF',
      cancelButtonText: 'Fechar',
    });
    if (escolha.isConfirmed) await abrirDanfe(nota);
  };

  /**
   * Monta tudo que a NF-e de um pedido precisa (itens com impostos, pagamentos,
   * destinatario, cupom referenciado) SEM mexer no formulario da tela. Usada
   * pela importacao do pedido (handleSelectPedido) e pela emissao em lote --
   * as duas passam pelas mesmas regras (desconto rateado, cadastro relido,
   * endereco so' do cliente).
   */
  const montarNotaDoPedido = async (pedido: PedidoVenda) => {
    let itemsWithTaxes = await fetchPedidoItensTaxes(pedido.itens);

    // Desconto GERAL do pedido (2026-09-29, bugfix): o pedido tem dois tipos de desconto --
    // por item (ja' vem em cada item.desconto, sempre chegou certo na nota) e geral (aplicado
    // uma vez sobre a venda toda, nunca tocava os itens). Sem ratear o geral entre os itens
    // aqui, a nota saia sempre no preco cheio -- o desconto do pedido simplesmente sumia.
    // `valorTotal` tambem passa a ser gravado explicito (bruto, quantidade x preco unitario):
    // o campo nunca existia nos itens salvos pelo Pedido de Venda (que usa `subtotal`), entao
    // o calculo do valor do item na nota sempre caia no fallback bruto sem desconto nenhum.
    const descontoGeralReais = (pedido.descontoGeralCentavos || 0) / 100;
    const pesosItens = itemsWithTaxes.map((it) => Number(it.quantidade || 0) * Number(it.precoUnitario || 0));
    const descontoGeralRateado = descontoGeralReais > 0 ? ratearValorPorPesos(descontoGeralReais, pesosItens) : itemsWithTaxes.map(() => 0);
    itemsWithTaxes = itemsWithTaxes.map((it, i) => ({
      ...it,
      valorTotal: pesosItens[i],
      desconto: Number(it.desconto || 0) + descontoGeralRateado[i],
    }));

    // Casa pelo clienteId primeiro (mesmo padrao ja usado em
    // handleSelectOS abaixo) -- so pelo nome e fragil: cliente renomeado
    // depois do pedido, acento/espaco diferente, ou dois clientes com
    // nome parecido, e o pedido silenciosamente pega o endereco errado
    // (ou o endereco de exemplo deixado no formulario) na nota fiscal.
    const clienteEmCache = clients.find(c => c.id === pedido.clienteId)
      || clients.find(c => c.nome.toUpperCase() === pedido.clienteNome.toUpperCase());
    // A lista de clientes foi lida quando a tela abriu; se o cadastro foi
    // corrigido depois (IE, endereco...), a nota tem que sair com o dado de
    // AGORA. Falha ao reler cai na copia da lista.
    let foundClient = clienteEmCache;
    if (clienteEmCache?.id) {
      try {
        const clienteSnap = await getDoc(doc(db, 'clientes', clienteEmCache.id));
        if (clienteSnap.exists() && clienteSnap.data().tenantId === tenantId) {
          const d = clienteSnap.data();
          foundClient = {
            ...clienteEmCache,
            nome: d.nome || clienteEmCache.nome,
            documento: d.documento || '',
            identidade: d.identidade || '',
            email: d.email || '',
            endereco: d.endereco || '',
            numero: d.numero || '',
            bairro: d.bairro || '',
            cep: d.cep || '',
            cidade: d.cidade || '',
            estado: d.estado || '',
            codigoIbge: d.codigoIbge || '',
            telefone: d.telefone || '',
          };
        }
      } catch (erroCliente) {
        console.error('Erro ao reler o cliente do cadastro (usa a copia da lista):', erroCliente);
      }
    }
    const descItens = pedido.itens.map((it: PedidoVendaItem) => `${it.quantidade}x ${it.nome}`).join(', ');

    // Procura cupom fiscal (NFC-e) associado a este pedido que esteja autorizado
    const cupom = invoices.find(inv => inv.pedidoId === pedido.id && inv.tipo === 'NFC-e' && inv.status === 'authorized');

    // UF da empresa vem da cidade resolvida em Configuracoes ->
    // Nota Fiscal (Spedy) (nfseCidadeEstado, mesmo campo usado pra
    // cadastrar a empresa na Spedy) -- ja tentamos "adivinhar" isso
    // com regex em cima do campo Rua (texto livre), que quase nunca
    // acha um estado de verdade e sempre caia no default 'SP', fazendo
    // uma venda dentro do mesmo estado ser marcada como interestadual
    // por engano (rejeicao 772 da Sefaz).
    let companyState = 'SP';
    try {
      const confRef = doc(db, 'configuracoes', tenantId || '');
      const confSnap = await getDoc(confRef);
      if (confSnap.exists()) {
        const estadoConfig = String(confSnap.data().nfseCidadeEstado || '').trim();
        if (estadoConfig) companyState = estadoConfig.toUpperCase();
      }
    } catch (err) {
      console.warn("Erro ao buscar estado da oficina:", err);
    }

    const clientState = foundClient?.estado || 'SP';
    const cfopForced = clientState.toUpperCase() === companyState.toUpperCase() ? '5929' : '6929';

    if (cupom) {
      itemsWithTaxes = itemsWithTaxes.map(item => ({
        ...item,
        cfop: cfopForced
      }));
    }

    return {
      itens: itemsWithTaxes,
      pagamentos: pedido.pagamentos || [],
      referencedAccessKey: cupom ? (cupom.accessKey || '') : '',
      form: {
        tipo: 'NF-e' as const,
        clienteId: foundClient?.id || '',
        clienteNome: pedido.clienteNome,
        documento: foundClient?.documento || '',
        inscricaoEstadual: foundClient?.identidade || '',
        email: foundClient?.email || '',
        valor: String(pedido.valorTotal),
        descricao: cupom
          ? `Lançamento de NF-e decorrente do Cupom Fiscal ref. Pedido #${pedido.numeroPedido}`
          : `Venda Ref. Pedido #${pedido.numeroPedido} - Itens: ${descItens}`,
        // So' o endereco DESTE cliente -- sem cair no que o formulario ja tinha
        // (exemplo ou o cliente do pedido anterior). Faltou dado? A trava de
        // endereco incompleto avisa na hora de transmitir.
        cep: foundClient?.cep || '',
        rua: foundClient?.endereco || '',
        numero: foundClient?.numero || '',
        bairro: foundClient?.bairro || '',
        cidade: foundClient?.cidade || '',
        estado: foundClient?.estado || '',
        codigoIbge: foundClient?.codigoIbge || '',
      },
    };
  };

  const handleSelectPedido = async (pedidoId: string) => {
    setImportedPedidoId(pedidoId);
    // Mutuamente exclusivo com a importação de OS -- importar um pedido
    // sempre desfaz uma OS importada antes.
    setImportedOsId('');
    setImportedOsServicos([]);
    if (!pedidoId) {
      setImportedPedidoItens([]);
      setImportedPedidoPagamentos([]);
      setReferencedAccessKey('');
      setFormData(prev => ({
        ...prev,
        tipo: 'NF-e',
        clienteId: '',
        clienteNome: '',
        documento: '',
        inscricaoEstadual: '',
        email: '',
        valor: '',
        descricao: '',
        cep: '',
        rua: '',
        numero: '',
        bairro: '',
        cidade: '',
        estado: '',
        codigoIbge: '',
      }));
      return;
    }

    const pedido = pedidosVenda.find(p => p.id === pedidoId);
    if (!pedido) return;

    try {
      const jaEmitida = await notaNfeJaEmitidaDoPedido(pedidoId);
      if (jaEmitida) {
        setImportedPedidoId('');
        setIsModalOpen(false);
        await avisarNotaJaEmitida(jaEmitida, pedido.numeroPedido);
        return;
      }
    } catch (erroConsulta) {
      // Nao conseguiu conferir: segue -- a mesma conferencia roda de novo
      // antes de transmitir, e ali trava.
      console.error('Erro ao conferir se o pedido ja tem nota fiscal:', erroConsulta);
    }

    NexusSwal.fire({
      title: 'Importando Pedido...',
      text: 'Buscando informações fiscais dos produtos...',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    try {
      const montada = await montarNotaDoPedido(pedido);
      setReferencedAccessKey(montada.referencedAccessKey);
      setImportedPedidoItens(montada.itens);
      setFiscalDoCadastro(fotografiaFiscal(montada.itens));
      setImportedPedidoPagamentos(montada.pagamentos);
      setFormData(prev => ({ ...prev, ...montada.form }));

      Swal.close();
    } catch (err) {
      console.error("Erro ao carregar dados do pedido:", err);
      Swal.close();
      showError('Erro ao importar', 'Não foi possível carregar os dados fiscais dos produtos.');
    }
  };

  /**
   * CHEGOU AQUI VINDO DO FIM DE UMA VENDA (`/fiscal/nfe?pedido=<id>`).
   *
   * Empresa que emite NF-e e nao emite cupom termina a venda e cai nesta
   * tela em vez de transmitir no balcao. Abrir a tela vazia obrigaria a
   * pessoa a procurar o proprio pedido que ela acabou de fechar numa lista
   * de todos os pedidos finalizados -- entao ja abrimos o formulario com
   * ele importado.
   *
   * Espera `pedidosVenda` carregar: handleSelectPedido procura o pedido
   * nessa lista, e rodar antes dela chegar nao acharia nada. O ref garante
   * uma importacao so' -- sem ele, cada re-render com o parametro ainda na
   * URL reimportaria por cima do que a pessoa ja' estivesse editando.
   */
  useEffect(() => {
    const pedidoDaUrl = searchParams.get('pedido');
    if (!pedidoDaUrl) return;
    if (pedidoImportadoPelaUrlRef.current === pedidoDaUrl) return;
    if (pedidosVenda.length === 0) return;

    pedidoImportadoPelaUrlRef.current = pedidoDaUrl;
    // Limpa o parametro: recarregar a pagina depois nao pode reimportar o
    // pedido por cima de uma nota que ja' esta sendo preenchida.
    setSearchParams({}, { replace: true });

    if (!pedidosVenda.some((pedido) => pedido.id === pedidoDaUrl)) {
      // Diz POR QUE nao entra: pre-venda ainda nao e' pedido, e o aviso
      // generico mandava a pessoa procurar na lista um pedido que nunca
      // estaria la.
      void (async () => {
        let mensagem = 'Este pedido não está disponível para importar nesta tela. Ele precisa estar finalizado — e, se sua empresa limita cada vendedor às próprias vendas, precisa ser um pedido seu. Escolha o pedido na lista "Importar do Pedido de Venda".';
        try {
          const pedidoSnap = await getDoc(doc(db, 'pedidos_venda', pedidoDaUrl));
          if (pedidoSnap.exists() && pedidoSnap.data().tenantId === tenantId) {
            const motivo = motivoPedidoNaoEmiteNota(pedidoSnap.data().status);
            if (motivo) mensagem = motivo;
          }
        } catch (erroPedido) {
          console.error('Erro ao conferir o status do pedido para emitir nota:', erroPedido);
        }
        showError('Nota fiscal não pode ser emitida', mensagem);
        setIsModalOpen(true);
        setActiveModalTab('cliente');
      })();
      return;
    }

    setFormData((prev) => ({ ...prev, tipo: 'NF-e' }));
    setIsModalOpen(true);
    setActiveModalTab('cliente');
    void handleSelectPedido(pedidoDaUrl);
    // handleSelectPedido e' recriado a cada render; incluir na lista faria
    // o efeito rodar de novo a toa (o ref ja' protege, mas a intencao aqui
    // e' reagir a URL + lista de pedidos, nada mais).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, pedidosVenda]);

  // Importa uma Ordem de Servico finalizada como NFS-e -- so os
  // `servicos[]` da OS entram na nota, `pecas[]` nunca e lido aqui (se a
  // OS tiver peca, ela fica de fora desta nota; nao ha fluxo de nota
  // pra peca de OS ainda). Mutuamente exclusivo com importar um Pedido.
  const handleSelectOS = (osId: string) => {
    setImportedOsId(osId);
    setImportedPedidoId('');
    setImportedPedidoItens([]);
    setReferencedAccessKey('');

    if (!osId) {
      setImportedOsServicos([]);
      setFormData(prev => ({
        ...prev,
        tipo: 'NF-e',
        clienteId: '',
        clienteNome: '',
        documento: '',
        inscricaoEstadual: '',
        email: '',
        valor: '',
        descricao: '',
        cep: '',
        rua: '',
        numero: '',
        bairro: '',
        cidade: '',
        estado: '',
        codigoIbge: '',
      }));
      return;
    }

    const os = ordensServico.find(o => o.id === osId);
    if (!os) return;

    const foundClient = clients.find(c => c.id === os.clienteId)
      || clients.find(c => c.nome.toUpperCase() === os.clienteNome.toUpperCase());

    setImportedOsServicos(os.servicos);

    setFormData(prev => ({
      ...prev,
      tipo: 'NFS-e',
      clienteId: foundClient?.id || '',
      clienteNome: os.clienteNome,
      documento: foundClient?.documento || '',
      inscricaoEstadual: foundClient?.identidade || '',
      email: foundClient?.email || '',
      valor: String(sumServiceInvoiceAmount(os.servicos)),
      descricao: buildServiceInvoiceDescription(os.servicos) || `Serviços Ref. OS #${os.numeroOS}`,
      federalServiceCode: nfseConfig.codigoServicoFederal || prev.federalServiceCode,
      cityServiceCode: nfseConfig.codigoServicoMunicipal || prev.cityServiceCode,
      issRate: nfseConfig.aliquotaIssPadrao !== undefined ? String(nfseConfig.aliquotaIssPadrao) : prev.issRate,
      // So' o endereco DESTE cliente -- sem cair no que o formulario ja tinha
      // (exemplo ou o cliente do pedido anterior). Faltou dado? A trava de
      // endereco incompleto avisa na hora de transmitir.
      cep: foundClient?.cep || '',
      rua: foundClient?.endereco || '',
      numero: foundClient?.numero || '',
      bairro: foundClient?.bairro || '',
      cidade: foundClient?.cidade || '',
      estado: foundClient?.estado || '',
      codigoIbge: foundClient?.codigoIbge || '',
    }));
  };

  // Sincroniza notas pendentes com a Spedy
  const syncPendingInvoices = useCallback(async (pendingNotes: LocalInvoice[]) => {
    if (!config?.spedyApiKey) return;
    setSyncing(true);

    for (const note of pendingNotes) {
      // O pop-up de emissao ja' esta acompanhando esta nota (e mostra o resultado).
      if (note.id === notaEmAcompanhamentoRef.current) continue;
      try {
        let spedyNote: SpedyInvoice;
        if (note.tipo === 'NFS-e') {
          spedyNote = await spedyService.getServiceInvoice(config.spedyApiKey, config.spedyEnvironment, note.spedyId);
        } else if (note.tipo === 'NFC-e') {
          spedyNote = await spedyService.getConsumerInvoice(config.spedyApiKey, config.spedyEnvironment, note.spedyId);
        } else {
          spedyNote = await spedyService.getProductInvoice(config.spedyApiKey, config.spedyEnvironment, note.spedyId);
        }

        if (spedyNote && spedyNote.status !== note.status) {
          await updateDoc(doc(db, 'notas_fiscais', note.id), {
            status: spedyNote.status,
            number: spedyNote.number,
            accessKey: spedyNote.accessKey || null,
            processingMessage: spedyNote.processingDetail?.message || null,
            processingCode: spedyNote.processingDetail?.code || null
          });

          setInvoices(prev => prev.map(item => item.id === note.id ? {
            ...item,
            status: spedyNote.status,
            number: spedyNote.number,
            accessKey: spedyNote.accessKey || null,
            processingMessage: spedyNote.processingDetail?.message || null,
            processingCode: spedyNote.processingDetail?.code || null
          } : item));

          // Nota acabou de sair de processamento e foi autorizada agora --
          // oferece a DANFE na hora, em vez do usuario ter que ir procurar
          // o icone dela na lista depois. So dispara pra transicao REAL
          // (nao repete se a nota ja estava autorizada antes deste sync).
          if (spedyNote.status === 'authorized' && note.status !== 'authorized') {
            const tipoArquivo = note.tipo === 'NFS-e' ? 'service' : note.tipo === 'NFC-e' ? 'consumer' : 'product';
            NexusSwal.fire({
              icon: 'success',
              title: 'Nota autorizada!',
              text: `${note.tipo} Nº ${spedyNote.number ?? ''} de ${note.clienteNome} foi autorizada pela Sefaz.`,
              confirmButtonText: 'Ver / Imprimir DANFE',
              showCancelButton: true,
              cancelButtonText: 'Fechar',
              // Spinner no proprio botao enquanto o PDF carrega -- sem
              // isso o alerta so fechava e nada parecia acontecer ate a
              // aba nova abrir, dava impressao de sistema travado.
              showLoaderOnConfirm: true,
              preConfirm: () => spedyService.baixarArquivoFiscal(note.spedyId, tipoArquivo, 'pdf')
                .then((blob) => setPdfAberto({
                  titulo: `${note.tipo} nº ${spedyNote.number ?? ''} — ${note.clienteNome}`,
                  nome: nomeArquivoDocumento({ tipo: siglaArquivoNota(note.tipo), numero: spedyNote.number, destinatario: note.clienteNome }),
                  blob,
                }))
                .catch(err => {
                  showError('Erro ao abrir PDF', (err as Error).message);
                }),
            });
          }
        }
      } catch (err) {
        console.warn(`Falha ao sincronizar nota ${note.spedyId}:`, err);
      }
    }
    setSyncing(false);
  }, [config]);

  // Carrega e sincroniza notas locais
  const loadLocalInvoices = useCallback(async (autoSync = true) => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const q = query(collection(db, 'notas_fiscais'), where('tenantId', '==', tenantId));
      const qSnap = await getDocs(q);
      const list: LocalInvoice[] = [];
      qSnap.forEach(d => {
        const data = d.data();
        let dateStr = '';
        if (data.data) {
          const dt = data.data.toDate ? data.data.toDate() : new Date(data.data);
          dateStr = dt.toLocaleDateString('pt-BR');
        }
        list.push({
          id: d.id,
          spedyId: data.spedyId || '',
          number: data.number || null,
          tipo: data.tipo || 'NFS-e',
          clienteNome: data.clienteNome || '',
          valor: data.valor || 0,
          data: dateStr,
          status: data.status || 'enqueued',
          processingMessage: data.processingMessage || null,
          processingCode: data.processingCode || null,
          accessKey: data.accessKey || null,
          pedidoId: data.pedidoId || null,
          clienteId: data.clienteId || null,
          emailEnvio: data.emailEnvio || null,
          tentativaEmissao: data.tentativaEmissao || null,
          integrationId: data.integrationId || null,
          cartasCorrecao: Array.isArray(data.cartasCorrecao) ? data.cartasCorrecao as CartaEnviada[] : [],
          finalidade: data.finalidade || null,
          devolucaoId: data.devolucaoId || null,
          pedidoOrigemId: data.pedidoOrigemId || null,
          transferenciaId: data.transferenciaId || null,
          numeroTransferencia: data.numeroTransferencia || null
        });
      });

      // Ordenar localmente por data de criacao decrescente
      list.sort((a, b) => b.id.localeCompare(a.id));
      setInvoices(list);

      // Sincronizar automaticamente notas pendentes
      if (autoSync && config?.spedyEnabled && config?.spedyApiKey) {
        const pending = list.filter(n => ['enqueued', 'processing', 'created'].includes(n.status));
        if (pending.length > 0) {
          syncPendingInvoices(pending);
        }
      }
    } catch (err) {
      console.error("Erro ao buscar notas no Firestore:", err);
    } finally {
      setLoading(false);
    }
  }, [tenantId, config, syncPendingInvoices]);

  useEffect(() => {
    if (config?.spedyEnabled && config?.spedyApiKey) {
      const timer = setTimeout(() => {
        loadLocalInvoices();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [config, loadLocalInvoices]);

  // Mantem a lista sincronizada ao vivo -- sem isso, uma nota criada em
  // outra aba (ex: venda com emissao automatica de NFC-e) so aparecia
  // aqui depois de fechar e reabrir esta aba. So atualiza a lista, nao
  // dispara sincronizacao com a Spedy (isso continua so no mount/acoes,
  // via loadLocalInvoices, pra nao bater na API a cada mudanca alheia).
  useEffect(() => {
    if (!tenantId) return;
    const q = query(collection(db, 'notas_fiscais'), where('tenantId', '==', tenantId));
    const unsubscribe = onSnapshot(q, (qSnap) => {
      const list: LocalInvoice[] = [];
      qSnap.forEach(d => {
        const data = d.data();
        let dateStr = '';
        if (data.data) {
          const dt = data.data.toDate ? data.data.toDate() : new Date(data.data);
          dateStr = dt.toLocaleDateString('pt-BR');
        }
        list.push({
          id: d.id,
          spedyId: data.spedyId || '',
          number: data.number || null,
          tipo: data.tipo || 'NFS-e',
          clienteNome: data.clienteNome || '',
          valor: data.valor || 0,
          data: dateStr,
          status: data.status || 'enqueued',
          processingMessage: data.processingMessage || null,
          processingCode: data.processingCode || null,
          accessKey: data.accessKey || null,
          pedidoId: data.pedidoId || null,
          clienteId: data.clienteId || null,
          emailEnvio: data.emailEnvio || null,
          tentativaEmissao: data.tentativaEmissao || null,
          integrationId: data.integrationId || null,
          cartasCorrecao: Array.isArray(data.cartasCorrecao) ? data.cartasCorrecao as CartaEnviada[] : [],
          finalidade: data.finalidade || null,
          devolucaoId: data.devolucaoId || null,
          pedidoOrigemId: data.pedidoOrigemId || null,
          transferenciaId: data.transferenciaId || null,
          numeroTransferencia: data.numeroTransferencia || null
        });
      });
      list.sort((a, b) => b.id.localeCompare(a.id));
      setInvoices(list);
    }, (err) => {
      console.error('Erro ao observar notas fiscais em tempo real:', err);
    });
    return () => unsubscribe();
  }, [tenantId]);

  // Consulta a Spedy sozinho enquanto existir nota "processando" -- antes
  // disso, o unico jeito de saber que uma nota saiu de processamento pra
  // autorizada/rejeitada era clicar em "Sincronizar Notas" na mao ou
  // recarregar a pagina (o onSnapshot acima so pega mudanca que ja
  // aconteceu no Firestore, nao consulta a Spedy sozinho). So fica ativo
  // com nota pendente na tela -- sem nenhuma, nao bate na API a toa.
  useEffect(() => {
    if (!config?.spedyEnabled || !config?.spedyApiKey) return;
    const pending = invoices.filter(n => ['enqueued', 'processing', 'created'].includes(n.status));
    if (pending.length === 0) return;
    const interval = setInterval(() => {
      syncPendingInvoices(pending);
    }, 15000);
    return () => clearInterval(interval);
  }, [invoices, config, syncPendingInvoices]);

  const handleManualSyncAll = async () => {
    if (!config?.spedyApiKey) return;
    setSyncing(true);
    try {
      const pending = invoices.filter(n => ['enqueued', 'processing', 'created'].includes(n.status));
      if (pending.length === 0) {
        showSuccess('Todas as notas já estão atualizadas!');
        setSyncing(false);
        return;
      }
      await syncPendingInvoices(pending);
      showSuccess('Sincronização concluída com sucesso!');
    } catch {
      showError('Erro ao sincronizar', 'Não foi possível atualizar o status das notas.');
    } finally {
      setSyncing(false);
    }
  };

  const handleManualSyncSingle = async (note: LocalInvoice) => {
    if (!config?.spedyApiKey) return;
    NexusSwal.fire({
      title: 'Consultando Spedy...',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    try {
      let spedyNote: SpedyInvoice;
      if (note.tipo === 'NFS-e') {
        spedyNote = await spedyService.getServiceInvoice(config.spedyApiKey, config.spedyEnvironment, note.spedyId);
      } else if (note.tipo === 'NFC-e') {
        spedyNote = await spedyService.getConsumerInvoice(config.spedyApiKey, config.spedyEnvironment, note.spedyId);
      } else {
        spedyNote = await spedyService.getProductInvoice(config.spedyApiKey, config.spedyEnvironment, note.spedyId);
      }

      await updateDoc(doc(db, 'notas_fiscais', note.id), {
        status: spedyNote.status,
        number: spedyNote.number,
        accessKey: spedyNote.accessKey || null,
        processingMessage: spedyNote.processingDetail?.message || null,
        processingCode: spedyNote.processingDetail?.code || null
      });

      Swal.close();
      showSuccess('Nota sincronizada com sucesso!');
      loadLocalInvoices(false);
    } catch (err) {
      Swal.close();
      showError('Erro na sincronização', (err as Error).message || 'Erro ao consultar nota.');
    }
  };

  /**
   * Consulta a nota NA SPEDY e mostra o que ela tem de verdade: ambiente,
   * serie, numero, status e o motivo -- pra separar "rejeicao nova" de
   * "nota antiga da Spedy que continua igual". Nasceu do caso em que a nota
   * foi reenviada depois de corrigir a configuracao e voltou com o mesmo
   * erro. Atualiza o status local com o que a Spedy devolveu.
   */
  const handleConsultarNaSpedy = async (note: LocalInvoice) => {
    if (!config?.spedyApiKey) return;
    NexusSwal.fire({ title: 'Consultando a Spedy...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
      const spedyNote: SpedyInvoice = note.tipo === 'NFS-e'
        ? await spedyService.getServiceInvoice(config.spedyApiKey, config.spedyEnvironment, note.spedyId)
        : note.tipo === 'NFC-e'
          ? await spedyService.getConsumerInvoice(config.spedyApiKey, config.spedyEnvironment, note.spedyId)
          : await spedyService.getProductInvoice(config.spedyApiKey, config.spedyEnvironment, note.spedyId);

      await updateDoc(doc(db, 'notas_fiscais', note.id), {
        status: spedyNote.status,
        number: spedyNote.number,
        accessKey: spedyNote.accessKey || null,
        processingMessage: spedyNote.processingDetail?.message || null,
        processingCode: spedyNote.processingDetail?.code || null,
      });

      const ambiente = spedyNote.environmentType === 'production'
        ? 'Produção'
        : spedyNote.environmentType === 'development' ? 'Homologação' : String(spedyNote.environmentType ?? 'não definido');
      const situacao: Record<string, string> = {
        authorized: 'Autorizada',
        canceled: 'CANCELADA — cancelamento registrado na SEFAZ',
        rejected: 'Rejeitada',
        denied: 'Denegada',
        enqueued: 'Na fila, aguardando a SEFAZ',
        processing: 'Em processamento na SEFAZ',
        created: 'Criada, ainda não transmitida',
      };
      const linhas = [
        `Situação: ${situacao[spedyNote.status] || spedyNote.status}`,
        `Ambiente da nota: ${ambiente}`,
        `Série: ${spedyNote.series ?? '—'} · Número: ${spedyNote.number ?? '—'}`,
        `Emitida em: ${spedyNote.issuedOn || '—'}`,
        ...(spedyNote.accessKey ? [`Chave de acesso: ${spedyNote.accessKey}`] : []),
        `Retorno da SEFAZ: ${spedyNote.processingDetail?.code || '—'} ${spedyNote.processingDetail?.message || ''}`.trim(),
      ];
      await NexusSwal.fire({
        title: `Nota ${note.tipo} na Spedy`,
        html: `<div style="text-align:left;font-size:14px">${linhas.map((l) => l.replace(/[<>&]/g, '')).join('<br/>')}</div>`,
        icon: spedyNote.status === 'authorized' || spedyNote.status === 'canceled' ? 'success' : 'info',
      });
      loadLocalInvoices(false);
    } catch (err) {
      Swal.close();
      showError('Não foi possível consultar a Spedy', (err as Error).message || 'Tente novamente em instantes.');
    }
  };

  const abrirDanfe = async (note: LocalInvoice) => {
    setCarregandoPdfId(note.id);
    try {
      const tipoArquivo = note.tipo === 'NFS-e' ? 'service' : note.tipo === 'NFC-e' ? 'consumer' : 'product';
      const blob = await spedyService.baixarArquivoFiscal(note.spedyId, tipoArquivo, 'pdf');
      setPdfAberto({
        titulo: `${note.tipo} nº ${note.number ?? ''} — ${note.clienteNome}`,
        nome: nomeArquivoDocumento({ tipo: siglaArquivoNota(note.tipo), numero: note.number, destinatario: note.clienteNome }),
        blob,
      });
    } catch (err) {
      showError('Erro ao abrir PDF', (err as Error).message);
    } finally {
      setCarregandoPdfId(null);
    }
  };

  /**
   * "Enviar por e-mail" na lista: PDF + XML para o e-mail do CADASTRO do cliente, do e-mail da empresa.
   * Mostra "Enviando...", depois "enviado com sucesso" ou o erro em portugues. Nota ja enviada pergunta antes.
   */
  const handleEnviarEmail = async (note: LocalInvoice) => {
    const anterior = note.emailEnvio;
    let forcar = false;
    if (anterior?.status === 'enviado') {
      const confirmar = await NexusSwal.fire({
        title: 'Enviar o e-mail de novo?',
        text: `Esta nota já foi enviada${anterior.para ? ` para ${anterior.para}` : ''}. Deseja enviar outra vez?`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Sim, enviar de novo',
        cancelButtonText: 'Cancelar',
      });
      if (!confirmar.isConfirmed) return;
      forcar = true;
    }
    void NexusSwal.fire({
      title: 'Enviando e-mail ao cliente...',
      text: 'Estamos enviando o PDF (DANFE) e o XML da nota.',
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => NexusSwal.showLoading(),
    });
    try {
      const resultado = await notaEmailService.enviar(note.id, forcar);
      await NexusSwal.fire({
        icon: 'success',
        title: 'E-mail enviado com sucesso',
        text: `PDF (DANFE) e XML enviados para ${resultado.para}.`,
        confirmButtonText: 'OK',
      });
      void loadLocalInvoices(false);
    } catch (erro) {
      await showError('Não foi possível enviar o e-mail', (erro as Error).message);
    }
  };

  const handleOpenWhatsApp = (note: LocalInvoice) => {
    const telefone = clients.find(c => c.id === note.clienteId)?.telefone;
    if (!telefone) {
      showError('Telefone indisponível', 'Este cliente não tem telefone cadastrado, ou a nota foi emitida antes desta função existir.');
      return;
    }
    const telLimpado = telefone.replace(/\D/g, '');
    if (telLimpado.length < 10) {
      showError('Telefone inválido', 'Número de telefone do cliente é inválido.');
      return;
    }
    const numeroFinal = telLimpado.length <= 11 ? `55${telLimpado}` : telLimpado;
    const valorFormatado = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(note.valor);
    const mensagem = encodeURIComponent(`Olá, ${note.clienteNome}! Sua nota fiscal ${note.tipo} nº ${note.number ? String(note.number).padStart(6, '0') : ''}, no valor de ${valorFormatado}, foi emitida com sucesso.`);
    window.open(`https://wa.me/${numeroFinal}?text=${mensagem}`, '_blank');
  };

  // Solicita cancelamento
  const enviarCartaCorrecao = async (nota: LocalInvoice, texto: string) => {
    const confirmacao = await NexusSwal.fire({
      icon: 'warning',
      title: 'Enviar a carta de correção?',
      text: 'Depois de enviada à SEFAZ, a carta não pode ser apagada nem editada. Confira o texto antes de confirmar.',
      showCancelButton: true,
      confirmButtonText: 'Sim, enviar',
      cancelButtonText: 'Voltar e revisar',
    });
    if (!confirmacao.isConfirmed) return;
    await spedyService.sendCorrectionLetter(nota.spedyId, texto);
    showSuccess('Carta de correção enviada! Ela aparece no histórico; o PDF fica disponível assim que a SEFAZ registrar.');
  };

  /** Da nota autorizada ao pop-up da NF-e de devolucao: acha as devolucoes do pedido que ainda nao tem nota. */
  const abrirDevolucaoFiscal = async (note: LocalInvoice) => {
    if (!note.pedidoId || !tenantId) return;
    try {
      const snap = await getDocs(query(collection(db, 'devolucoes_venda'), where('tenantId', '==', tenantId), where('pedidoVendaId', '==', note.pedidoId)));
      const comNotaValendo = new Set(
        allInvoices
          .filter((n) => n.finalidade === 'devolucao' && !['rejected', 'denied', 'canceled'].includes(n.status))
          .map((n) => n.devolucaoId),
      );
      const pendentes = snap.docs.filter((d) => !comNotaValendo.has(d.id));

      if (pendentes.length === 0) {
        await NexusSwal.fire({
          icon: 'info',
          title: 'Nenhuma devolução esperando nota',
          text: snap.empty
            ? 'Este pedido não tem devolução registrada. Registre a devolução dos itens (Vendas → Devolução de Venda, ou dentro do pedido) e depois emita a nota de devolução.'
            : 'Todas as devoluções deste pedido já têm NF-e de devolução em andamento ou autorizada.',
        });
        return;
      }
      if (pendentes.length === 1) {
        setDevolucaoNfeId(pendentes[0].id);
        return;
      }

      const opcoes: Record<string, string> = {};
      pendentes.forEach((d) => {
        const dados = d.data();
        const quando = dados.createdAt?.seconds ? new Date(dados.createdAt.seconds * 1000).toLocaleDateString('pt-BR') : 'sem data';
        opcoes[d.id] = `${quando} — ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(dados.valorTotalDevolvido || 0))}`;
      });
      const { value } = await NexusSwal.fire({
        title: 'Qual devolução?',
        text: 'Este pedido tem mais de uma devolução sem nota fiscal.',
        input: 'select',
        inputOptions: opcoes,
        inputPlaceholder: 'Selecione a devolução',
        showCancelButton: true,
        confirmButtonText: 'Continuar',
        cancelButtonText: 'Voltar',
      });
      if (value) setDevolucaoNfeId(String(value));
    } catch (err) {
      console.error('Erro ao buscar as devolucoes do pedido:', err);
      showError('Não foi possível buscar as devoluções', 'Tente novamente em instantes. Se continuar, avise o suporte.');
    }
  };

  const handleCancel = async (note: LocalInvoice) => {
    if (!currentUser) return;
    const { value: justification } = await NexusSwal.fire({
      title: 'Cancelar Nota Fiscal',
      input: 'textarea',
      inputLabel: 'Justificativa de Cancelamento (de 15 a 255 caracteres)',
      inputAttributes: { maxlength: '255' },
      inputPlaceholder: 'Escreva o motivo real do cancelamento...',
      showCancelButton: true,
      confirmButtonText: 'Confirmar Cancelamento',
      cancelButtonText: 'Voltar',
      confirmButtonColor: '#ef4444',
      inputValidator: (value) => {
        if (!value || value.trim().length < 15) {
          return 'A justificativa deve conter no mínimo 15 caracteres!';
        }
        if (value.trim().length > 255) {
          return 'A justificativa pode ter no máximo 255 caracteres (limite da SEFAZ).';
        }
      }
    });

    if (justification && config?.spedyApiKey) {
      NexusSwal.fire({
        title: 'Solicitando cancelamento na prefeitura/SEFAZ...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
      });

      try {
        await spedyService.cancelInvoice(
          config.spedyApiKey,
          config.spedyEnvironment,
          note.tipo === 'NFS-e' ? 'service' : note.tipo === 'NFC-e' ? 'consumer' : 'product',
          note.spedyId,
          justification
        );

        // Atualiza banco local
        await updateDoc(doc(db, 'notas_fiscais', note.id), {
          status: 'canceled',
          processingMessage: 'Solicitação de cancelamento enviada.',
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), `Cancelamento solicitado: ${justification}`),
        });

        try {
          const { createAuditLog } = await import('../../services/logService');
          createAuditLog({
            tenantId: tenantId || '',
            usuarioId: currentUser?.uid || '',
            usuarioEmail: currentUser?.email || '',
            modulo: 'fiscal',
            acao: 'cancelamento',
            descricao: `Nota Fiscal #${note.number || note.spedyId.substring(0, 6)} (${note.tipo}) cancelada. Motivo: ${justification}`,
            registroRelacionadoId: note.id,
            status: 'sucesso',
            critical: true
          });
        } catch {
          // ignore audit log error
        }

        Swal.close();
        loadLocalInvoices(false);
        // Nota de VENDA cancelada: a venda continua finalizada no sistema (estoque
        // baixado, financeiro lançado). Cancelar a nota nao desfaz a venda sozinho --
        // avisa e leva pra venda, onde "Estornar/Cancelar" devolve estoque e financeiro.
        if (note.pedidoId && note.finalidade !== 'devolucao' && (note.tipo === 'NF-e' || note.tipo === 'NFC-e')) {
          const numeroPedido = pedidosVenda.find((p) => p.id === note.pedidoId)?.numeroPedido;
          const escolha = await NexusSwal.fire({
            icon: 'success',
            title: 'Nota cancelada',
            text: `A venda${numeroPedido ? ` #${numeroPedido}` : ''} continua FINALIZADA no sistema: o estoque ainda está baixado e o financeiro lançado. Se a venda não aconteceu, cancele também a venda (Mais ações → Estornar/Cancelar) para o estoque voltar e o financeiro ser estornado.`,
            showCancelButton: true,
            confirmButtonText: 'Abrir a venda',
            cancelButtonText: 'Depois',
          });
          if (escolha.isConfirmed) navigate(`/pedidos-venda/visualizar/${note.pedidoId}`);
        } else {
          showSuccess('Cancelamento solicitado com sucesso!');
        }
      } catch (err) {
        Swal.close();
        const mensagemErro = (err as Error).message || 'Erro ao cancelar a nota.';
        // Fora do prazo normal (24h apos a autorizacao). CANCELAMENTO EXTEMPORANEO
        // (2026-09-30): em MG a SEFAZ aceita entre 24h e 168h, mas a empresa pede
        // antes no SIARE e SO' DEPOIS transmite o cancelamento pelo emissor --
        // ou seja, e' este mesmo botao, clicado de novo depois do protocolo.
        // Mercadoria que saiu e voltou continua sendo devolucao.
        const foraDoPrazo = /prazo|501/i.test(mensagemErro);
        showError(
          foraDoPrazo ? 'Passou do prazo normal de cancelamento (24 horas)' : 'Erro ao cancelar',
          foraDoPrazo && note.tipo !== 'NFS-e'
            ? `${mensagemErro}

• Venda que NÃO aconteceu, com a nota autorizada há até 168 horas (7 dias): peça o cancelamento extemporâneo no SIARE (site da SEFAZ-MG). Com o pedido registrado, volte aqui e clique em Cancelar de novo — o prazo é de 30 dias depois do protocolo. Em outros estados o caminho é parecido: confirme com o contador.
• Mercadoria que saiu e voltou: registre a devolução dos itens e emita a NF-e de devolução (botão de devolução, na linha da nota).
• Depois de 168 horas: fale com o contador (em MG, a SEFAZ cobra multa de 20% do valor da nota).`
            : mensagemErro,
        );
      }
    }
  };

  // Emissão de nova nota
  const consultarNotaNaSpedy = (tipo: LocalInvoice['tipo'], spedyId: string): Promise<SpedyInvoice> => {
    if (!config?.spedyApiKey) return Promise.reject(new Error('A integração fiscal não está configurada.'));
    if (tipo === 'NFS-e') return spedyService.getServiceInvoice(config.spedyApiKey, config.spedyEnvironment, spedyId);
    if (tipo === 'NFC-e') return spedyService.getConsumerInvoice(config.spedyApiKey, config.spedyEnvironment, spedyId);
    return spedyService.getProductInvoice(config.spedyApiKey, config.spedyEnvironment, spedyId);
  };

  /**
   * Id com que a nota rejeitada esta na Spedy: o gravado na nota ou, em nota
   * antiga (antes de 2026-09-30 nao se gravava), o que a propria Spedy informa.
   * null = nao deu pra saber -- quem chama NAO transmite (senao pula numero).
   */
  const integrationIdDaNota = async (nota: LocalInvoice | null | undefined): Promise<string | null> => {
    if (!nota) return null;
    if (nota.integrationId) return nota.integrationId;
    if (!nota.spedyId) return null;
    try {
      const naSpedy = await consultarNotaNaSpedy(nota.tipo, nota.spedyId);
      return naSpedy.integrationId || null;
    } catch (erroConsulta) {
      console.error('Nao foi possivel ler o id da nota na Spedy:', erroConsulta);
      return null;
    }
  };

  /**
   * Monta o corpo da NF-e (itens com impostos, destino, desconto, parcelas do boleto,
   * fatura, totais) no formato da Spedy. Uma so' funcao pra emissao normal e pra emissao
   * em lote -- as duas mandam exatamente o mesmo formato. `itens` vazio = lancamento avulso.
   */
  const montarPayloadNfe = async (a: {
    integrationId: string;
    form: typeof formData;
    itens: PedidoVendaItem[];
    pagamentos: PaymentRecord[];
    numeroPedido?: string;
    referencedAccessKey: string;
    stateTaxNumber?: string;
  }) => {
    const valorNumerico = Number(a.form.valor);

    // UF da empresa vem da cidade resolvida em Configuracoes -> Nota
    // Fiscal (Spedy) (nfseCidadeEstado) -- ver mesmo comentario em
    // handleSelectPedido acima. Regex em cima do campo Rua livre
    // (versao antiga) quase sempre caia no default 'SP' e marcava
    // venda dentro do mesmo estado como interestadual (rejeicao 772).
    let companyState = 'SP';
    try {
      const confRef = doc(db, 'configuracoes', tenantId || '');
      const confSnap = await getDoc(confRef);
      if (confSnap.exists()) {
        const estadoConfig = String(confSnap.data().nfseCidadeEstado || '').trim();
        if (estadoConfig) companyState = estadoConfig.toUpperCase();
      }
    } catch (err) {
      console.warn("Erro ao buscar estado da oficina:", err);
    }
    const clientState = a.form.estado || 'SP';
    const interestadual = clientState.toUpperCase() !== companyState.toUpperCase();

    // Itens: montagem UNICA (notaFiscalItemDomain) -- unidade vendida, GTIN,
    // CEST, cBenef, CFOP do destino (5xxx/6xxx), ICMS/PIS/COFINS/IPI pelo CST
    // do cadastro e valor aproximado dos tributos. Cadastro incompleto barra
    // aqui com o nome do produto (a nota nao sai com dado inventado).
    // Lancamento avulso (sem pedido) vira um item so', com o NCM/CFOP/CSOSN
    // digitados no formulario.
    const itensDaNota: PedidoVendaItem[] = a.itens.length > 0
      ? a.itens
      : [{
          id: 'avulso', nome: a.form.descricao, quantidade: 1, precoUnitario: valorNumerico, desconto: 0, valorTotal: valorNumerico,
          codigoProduto: 'AVULSO', ncm: a.form.ncm, cfop: a.form.cfop, csosn: a.form.csosn, origem: '0',
        }];
    const avisosItens: string[] = [];
    const tributosItens: ValoresTributosItem[] = [];
    const itemsPayload = itensDaNota.map((item, index) => {
      const montado = montarItemNotaFiscal({
        produto: { ...item, nome: item.nome },
        venda: {
          quantidade: Number(item.quantidade || 1),
          precoUnitario: Number(item.precoUnitario || 0),
          desconto: Number(item.desconto || 0),
          unidadeSigla: item.unidadeMedidaSigla,
        },
        contexto: { regime: regimeTributario, interestadual },
        codigoItem: item.codigoProduto || item.id || `PROD-${index}`,
      });
      if (!montado.ok) throw new ErroItemNota(montado.erro, index);
      avisosItens.push(...montado.avisos);
      tributosItens.push(montado.tributos);
      return montado.item;
    });
    const destination = resolveInvoiceDestination(
      (itemsPayload.find((pi) => isExportCfop(pi.cfop as number)) as { cfop?: number } | undefined)?.cfop,
      interestadual ? 'interstate' : 'internal',
    );

    // vProd (bruto) e vDesc somados dos itens -- productAmount tem que ser o BRUTO (soma dos
    // itens antes do desconto), nunca igual ao invoiceAmount, senao o desconto nao aparece na
    // nota nenhuma (era exatamente o bug: os dois saiam iguais a valorNumerico, que ja e' liquido).
    const productAmountBruto = itemsPayload.reduce((soma, it) => soma + Number(it.totalAmount || 0), 0);
    const discountAmountTotal = itemsPayload.reduce((soma, it) => soma + Number(it.discountAmount || 0), 0);
    const totaisImpostos = totaisImpostosDosItens(itemsPayload);
    const tributosNota = somarTributos(tributosItens);

    // Duplicatas (parcelas): so' quando a venda importada foi paga em Boleto -- o numero de
    // cada parcela e a data de vencimento vem dos pagamentos gravados no pedido. Sem isso a
    // nota saia sem nenhuma duplicata, mesmo quando o boleto tinha varias parcelas.
    const pagamentosBoleto = a.pagamentos.filter((p) => p.formaPagamento === 'Boleto' && p.dataVencimento);
    const duplicatesPayload = pagamentosBoleto.map((p) => ({
      number: String(p.numeroParcelaAPrazo || 1).padStart(3, '0'),
      dueDate: `${p.dataVencimento}T00:00:00`,
      amount: Number(p.valor ?? p.valorCentavos / 100),
    }));
    // Fatura [cobr/fat] junto das duplicatas (2026-09-30): a SEFAZ exige que a soma das
    // parcelas bata com o valor LIQUIDO da fatura. Mandando so' `duplicates`, a Spedy montava a
    // fatura sem esse valor e a nota voltava "Rejeicao 851: Soma do valor das parcelas difere
    // do Valor Liquido da Fatura" (NF-e 000034 da Sol Life). Campo `billing` confirmado no
    // swagger da Spedy (SefazInvoiceBillingDto: number/originalAmount/discountAmount/netAmount).
    const valorFaturaCentavos = duplicatesPayload.reduce((soma, d) => soma + Math.round(d.amount * 100), 0);
    const billingPayload = duplicatesPayload.length > 0
      ? {
        number: a.numeroPedido || '1',
        originalAmount: valorFaturaCentavos / 100,
        discountAmount: 0,
        netAmount: valorFaturaCentavos / 100,
      }
      : null;

    // Informacoes complementares [infCpl]: pedido, frase obrigatoria do Simples
    // Nacional e o valor aproximado dos tributos (Lei 12.741).
    const informacoesComplementares = [
      a.numeroPedido ? `Pedido de venda nº ${a.numeroPedido}.` : '',
      a.referencedAccessKey ? `Referente ao cupom fiscal chave ${a.referencedAccessKey}.` : '',
      usesCsosn(regimeTributario) ? TEXTO_OPTANTE_SIMPLES_NACIONAL : '',
      textoTributosAproximados(tributosNota, valorNumerico),
    ].filter(Boolean).join(' ');

    const payload = {
      integrationId: a.integrationId,
      // indFinal: contribuinte com IE comprando pra revender nao e' consumidor final.
      isFinalCustomer: destinatarioEConsumidorFinal({ documento: a.form.documento, inscricaoEstadual: a.stateTaxNumber }),
      operationType: 'outgoing',
      destination: destination,
      presenceType: 'presence',
      operationNature: a.referencedAccessKey ? 'Lançamento decorrente de Cupom Fiscal' : 'Venda de Mercadoria',
      ...(informacoesComplementares ? { additionalInformation: informacoesComplementares } : {}),
      // Com o SMTP da empresa configurado, o e-mail ao cliente (PDF + XML) sai pelo sistema, do e-mail da empresa,
      // com pop-up de resultado (notaEmailService); ligar o envio da Spedy tambem mandaria a nota duas vezes.
      sendEmailToCustomer: !!a.form.email && !emailPeloSistema,
      receiver: {
        name: a.form.clienteNome,
        federalTaxNumber: a.form.documento.replace(/\D/g, ''),
        ...(a.stateTaxNumber ? { stateTaxNumber: a.stateTaxNumber } : {}),
        email: a.form.email || undefined,
        address: {
          street: a.form.rua,
          number: a.form.numero,
          district: a.form.bairro,
          postalCode: a.form.cep.replace(/\D/g, ''),
          city: {
            code: a.form.codigoIbge,
            name: a.form.cidade,
            state: a.form.estado
          }
        }
      },
      items: itemsPayload,
      // Meio de pagamento de verdade (dinheiro, pix, boleto...), nao mais "outros" fixo.
      payments: montarPagamentosNota(a.pagamentos, valorNumerico),
      ...(duplicatesPayload.length > 0 ? { duplicates: duplicatesPayload } : {}),
      ...(billingPayload ? { billing: billingPayload } : {}),
      total: {
        invoiceAmount: valorNumerico,
        productAmount: productAmountBruto,
        ...(discountAmountTotal > 0 ? { discountAmount: discountAmountTotal } : {}),
        ...(totaisImpostos.icmsBaseTax > 0 ? { icmsBaseTax: totaisImpostos.icmsBaseTax, icmsAmount: totaisImpostos.icmsAmount } : {}),
        ...(totaisImpostos.pisAmount > 0 ? { pisAmount: totaisImpostos.pisAmount } : {}),
        ...(totaisImpostos.cofinsAmount > 0 ? { cofinsAmount: totaisImpostos.cofinsAmount } : {}),
        ...(tributosNota.total > 0 ? { totalTax: tributosNota.total } : {}),
      },
      ...(a.referencedAccessKey ? {
        refNFe: a.referencedAccessKey,
        referencedAccessKey: a.referencedAccessKey,
        referencedInvoices: [{ accessKey: a.referencedAccessKey }]
      } : {})
    };

    return { payload, itemsPayload, avisos: [...new Set(avisosItens)] };
  };

  const handleEmitir = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config?.spedyApiKey || !tenantId || !currentUser) return;

    if (!formData.clienteNome || !formData.documento || !formData.valor || !formData.descricao) {
      showError('Campos Incompletos', 'Preencha Nome do Cliente, Documento, Descrição e Valor.');
      return;
    }

    // NF-e de produto manda o endereco completo do destinatario na XML --
    // ao contrario da NFS-e (endereco da nota vem da config da propria
    // empresa), aqui nada disso era conferido antes de enviar pra Spedy.
    // Cliente sem CEP/numero/bairro/cidade/codigo IBGE saia silenciosamente
    // com o endereco de exemplo que fica no formulario (Rua Principal,
    // Sao Paulo...) ou com o endereco do ultimo cliente importado, e so
    // aparecia como erro generico da Spedy (SPD003) depois de enviado.
    if (formData.tipo !== 'NFS-e') {
      const camposEnderecoFaltando: string[] = [];
      if (!formData.rua) camposEnderecoFaltando.push('Endereço');
      if (!formData.numero) camposEnderecoFaltando.push('Número');
      if (!formData.bairro) camposEnderecoFaltando.push('Bairro');
      if (!formData.cep) camposEnderecoFaltando.push('CEP');
      if (!formData.cidade) camposEnderecoFaltando.push('Cidade');
      if (!formData.estado) camposEnderecoFaltando.push('Estado');
      if (!formData.codigoIbge) camposEnderecoFaltando.push('Código IBGE da cidade');
      if (camposEnderecoFaltando.length > 0) {
        showError(
          'Endereço do cliente incompleto',
          `Falta ${camposEnderecoFaltando.join(', ')} no endereço de "${formData.clienteNome}" para emitir a NF-e. `
            + 'Abra o cadastro deste cliente em Clientes, digite o CEP e saia do campo (rua, bairro, cidade, UF e o código IBGE são preenchidos sozinhos), complete o número e salve. '
            + (formData.clienteId ? 'Depois, aqui na nota, clique em "Atualizar dados do cadastro" (aba de produtos) e transmita de novo.' : 'Depois, escolha o cliente de novo aqui na nota.')
        );
        return;
      }

      // Lançamento avulso (sem Pedido de Venda importado) só monta o bloco
      // de impostos com NCM/CFOP/CSOSN digitados -- nao tem como informar CST
      // de PIS/COFINS nem aliquota de ICMS, que Lucro Presumido/Real exigem.
      // Importar de um Pedido de Venda usa o cadastro completo de cada
      // produto (notaFiscalItemDomain) -- e o unico caminho correto pra
      // esses regimes hoje.
      const semPedidoImportado = !(importedPedidoId && importedPedidoItens.length > 0);
      if (semPedidoImportado && !usesCsosn(regimeTributario)) {
        showError(
          'Lançamento avulso não suporta este regime tributário',
          `A empresa está no regime "${REGIME_TRIBUTARIO_OPTIONS.find(r => r.value === regimeTributario)?.label || regimeTributario}", que exige CST real de ICMS/PIS/COFINS por produto -- o lançamento avulso só monta o formato simplificado de Simples Nacional (CSOSN) e a Spedy vai rejeitar (SPD003). Importe um Pedido de Venda pronto em vez de lançar avulso: ele já usa os dados fiscais reais cadastrados em cada produto.`
        );
        return;
      }
    }

    // Correcao feita NA NOTA (NCM, CEST, CFOP, CSOSN, origem) diferente do cadastro:
    // pergunta se leva pro produto tambem -- senao a proxima nota erra igual.
    if (formData.tipo !== 'NFS-e' && importedPedidoId) {
      const mudancas = importedPedidoItens.flatMap((item, indice) => {
        const antes = fiscalDoCadastro[indice];
        if (!antes || !item.id || item.id === 'avulso') return [];
        return CAMPOS_FISCAIS_EDITAVEIS
          // Nota cuponada troca o CFOP pra 5929/6929 de proposito: nao e' correcao do produto.
          .filter((campo) => !(campo === 'cfop' && referencedAccessKey))
          .map((campo) => ({ produtoId: item.id, nome: item.nome, campo, antes: antes[campo], depois: normalizarCampoFiscal(campo, item[campo]) }))
          .filter((m) => m.depois && m.depois !== m.antes);
      });
      if (mudancas.length > 0) {
        const escolha = await NexusSwal.fire({
          title: 'Atualizar também o cadastro do produto?',
          html: `<p style="margin:0 0 8px">Nesta nota você corrigiu:</p><ul style="text-align:left;margin:0;padding-left:18px">${mudancas.map((m) => `<li><strong>${escaparHtml(m.nome)}</strong> — ${ROTULO_CAMPO_FISCAL[m.campo]}: ${escaparHtml(m.antes || 'vazio')} → <strong>${escaparHtml(m.depois)}</strong></li>`).join('')}</ul><p style="margin:10px 0 0">Atualizando o cadastro, as próximas notas já saem certas.</p>`,
          icon: 'question',
          showDenyButton: true,
          showCancelButton: true,
          confirmButtonText: 'Atualizar cadastro e transmitir',
          denyButtonText: 'Só nesta nota',
          cancelButtonText: 'Voltar',
        });
        if (escolha.isDismissed) return;
        if (escolha.isConfirmed && currentUser) {
          const porProduto = new Map<string, Record<string, string>>();
          mudancas.forEach((m) => porProduto.set(m.produtoId, { ...(porProduto.get(m.produtoId) || {}), [m.campo]: m.depois }));
          try {
            for (const [produtoId, campos] of porProduto) {
              await updateDoc(doc(db, 'estoque', produtoId), {
                ...campos,
                updatedAt: serverTimestamp(),
                ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Dados fiscais corrigidos na emissão da NF-e'),
              });
            }
            setFiscalDoCadastro(fotografiaFiscal(importedPedidoItens));
            showSuccess('Cadastro do produto atualizado.');
          } catch (erroCadastro) {
            console.error('Nao foi possivel atualizar o cadastro do produto:', erroCadastro);
            showWarning('Cadastro não atualizado', 'A nota segue com a correção, mas o cadastro do produto não foi alterado (produto inativo ou sem permissão "Alterar cadastro de produtos"). Corrija depois em Estoque.');
          }
        }
      }
    }

    // Ultima conferencia antes de transmitir (pega a outra aba/computador que
    // emitiu enquanto este formulario estava aberto). Sem conseguir conferir,
    // NAO transmite: nota fiscal em duplicidade nao tem volta simples.
    if (formData.tipo === 'NF-e' && importedPedidoId) {
      try {
        const jaEmitida = await notaNfeJaEmitidaDoPedido(importedPedidoId, retransmittingInvoiceId);
        if (jaEmitida) {
          setIsModalOpen(false);
          await avisarNotaJaEmitida(jaEmitida, pedidosVenda.find((p) => p.id === importedPedidoId)?.numeroPedido);
          return;
        }
      } catch (erroConsulta) {
        console.error('Erro ao conferir se o pedido ja tem nota fiscal:', erroConsulta);
        showError('Não foi possível conferir a nota do pedido', 'Não consegui verificar se esta venda já tem nota fiscal, então a nota não foi transmitida (para não sair em duplicidade). Confira sua conexão e tente de novo.');
        return;
      }
    }

    setIsSubmitting(true);
    let etapaAtual = 'validando' as EtapaEmissao; // mudada dentro de irParaEnvio (o TS nao acompanha isso)
    let enviouParaSpedy = false;
    const tipoNota = formData.tipo as LocalInvoice['tipo'];
    setProgresso({ tipo: tipoNota, clienteNome: formData.clienteNome, etapa: 'validando', desfecho: null });
    const irParaEnvio = () => {
      etapaAtual = 'enviando';
      setProgresso((atual) => (atual ? { ...atual, etapa: 'enviando' } : atual));
    };

    try {
      // Antes de qualquer coisa: a empresa tem o que precisa pra emitir?
      // (ambiente, serie, certificado...). Sem isso a Spedy devolvia
      // rejeicao crua tipo "Ambiente: 0". Falha ao CONFERIR nao trava a
      // emissao -- so' o que a conferencia diz que falta.
      if (formData.tipo === 'NF-e' || formData.tipo === 'NFC-e') {
        try {
          const requisitos = await spedyService.getRequisitos();
          const grupo = formData.tipo === 'NF-e' ? requisitos.nfe : requisitos.nfce;
          const bloqueios = grupo.checks.filter((c) => c.gravidade === 'bloqueio');
          if (bloqueios.length > 0) {
            setProgresso(null);
            showError(
              `Faltam itens para emitir a ${formData.tipo}`,
              bloqueios.map((c) => `• ${c.mensagem} ${c.comoResolver}`.trim()).join('\n'),
            );
            return;
          }
        } catch (erroRequisitos) {
          console.error('Nao foi possivel conferir os requisitos fiscais (a emissao segue):', erroRequisitos);
        }
      }

      // Procura se já existe uma nota rejeitada para este pedido e tipo --
      // reenvio manual (retransmissão) ou reenvio automático de uma nota
      // já rejeitada reaproveitam o id dela como integrationId da Spedy
      // (mesma operação lógica, garante idempotência). Sem nenhum dos
      // dois, cai no id gerado uma vez por sessão do modal (ver
      // pendingIntegrationIdRef acima).
      const existingRejectedNote = importedPedidoId
        ? invoices.find(inv => inv.pedidoId === importedPedidoId && inv.tipo === formData.tipo && inv.finalidade !== 'devolucao' && (inv.status === 'rejected' || inv.status === 'denied'))
        : null;
      const targetInvoiceId = retransmittingInvoiceId || existingRejectedNote?.id || null;
      if (!targetInvoiceId && !pendingIntegrationIdRef.current) {
        pendingIntegrationIdRef.current = crypto.randomUUID();
      }
      // Reenvio de nota rejeitada: mesmo id (a Spedy atualiza a nota e reaproveita
      // o numero) -- exceto quando a rejeicao veio da CONFIGURACAO presa na
      // nota ("Ambiente:0"): ai' vai uma nota nova. Ver reenvioNotaDomain.ts.
      const notaLocalAlvo = targetInvoiceId ? allInvoices.find((n) => n.id === targetInvoiceId) : null;
      // O MESMO id com que a nota esta na Spedy -- senao a Spedy cria outra nota e
      // pula o numero (a rejeitada fica como buraco na sequencia).
      const idNaSpedy = targetInvoiceId ? await integrationIdDaNota(notaLocalAlvo) : null;
      if (targetInvoiceId && notaLocalAlvo?.spedyId && !idNaSpedy && !rejeicaoPrendeConfiguracaoNaNota(notaLocalAlvo.processingMessage)) {
        setProgresso(null);
        showError(
          'Não foi possível retransmitir agora',
          'Não consegui confirmar com a Spedy qual é a nota original, e transmitir sem isso criaria uma nota nova, pulando a numeração. Confira sua conexão e tente de novo em instantes.',
        );
        return;
      }
      const escolhaReenvio = targetInvoiceId
        ? escolherIntegrationIdDoReenvio({
            docId: targetInvoiceId,
            tentativaAtual: notaLocalAlvo?.tentativaEmissao,
            mensagemRejeicao: notaLocalAlvo?.processingMessage,
            integrationIdAtual: idNaSpedy,
          })
        : null;
      const integrationId = escolhaReenvio ? escolhaReenvio.integrationId : pendingIntegrationIdRef.current!;

      const cleanDoc = formData.documento.replace(/\D/g, '');
      const cleanCep = formData.cep.replace(/\D/g, '');

      // IE do destinatario (pessoa juridica): vem do cadastro do cliente e vai em
      // receiver.stateTaxNumber. Sem ela a SEFAZ rejeita (232) -- entao nao se
      // adivinha nem se contorna: bloqueia dizendo onde cadastrar. Ver
      // destinatarioFiscalDomain.ts.
      let stateTaxNumberDestinatario: string | undefined;
      if (formData.tipo === 'NF-e') {
        const ie = resolverInscricaoEstadualDestinatario({
          documento: cleanDoc,
          identidade: formData.inscricaoEstadual,
          clienteNome: formData.clienteNome,
        });
        if (ie.erro) {
          setProgresso(null);
          showError('Inscrição Estadual do destinatário', ie.erro);
          return;
        }
        stateTaxNumberDestinatario = ie.valor;
      }
      const valorNumerico = Number(formData.valor);

      let spedyNote: SpedyInvoice;
      // Snapshot fiscal (Fatia 0 do plano de Utilitarios/SINTEGRA) --
      // guarda exatamente o que foi mandado pra Spedy (codigo, NCM, CFOP,
      // taxes com base/aliquota/valor), pra poder gerar o SINTEGRA depois
      // sem depender do dado ATUAL do produto (que pode ja ter mudado).
      // So faz sentido pra NF-e/NFC-e -- SINTEGRA e so mercadoria.
      let itensFiscaisParaSalvar: Record<string, unknown>[] | null = null;

      if (formData.tipo === 'NFS-e') {
        // Servicos importados da OS (nunca pecas) -- se for reemissao de
        // uma nota ja salva sem OS ainda em memoria (retransmissao),
        // cai num item avulso com a descricao/valor do formData.
        const servicosParaFatura: OsServicoParaFatura[] = importedOsServicos.length > 0
          ? importedOsServicos
          : [{ nome: formData.descricao, preco: valorNumerico, quantidade: 1 }];

        const clienteParaFatura: ClienteParaFatura = {
          nome: formData.clienteNome,
          documento: formData.documento,
          email: formData.email,
          endereco: formData.rua,
          numero: formData.numero,
          bairro: formData.bairro,
          cep: formData.cep,
          cidade: formData.cidade,
          estado: formData.estado,
          codigoIbge: formData.codigoIbge,
        };

        const effectiveNfseConfig: NfseConfig = {
          habilitada: true,
          cidadeCodigo: nfseConfig.cidadeCodigo,
          cidadeNome: nfseConfig.cidadeNome,
          cidadeEstado: nfseConfig.cidadeEstado,
          inscricaoMunicipal: nfseConfig.inscricaoMunicipal,
          codigoServicoMunicipal: formData.cityServiceCode,
          codigoServicoFederal: formData.federalServiceCode,
          aliquotaIssPadrao: Number(formData.issRate) || 0,
        };

        const payload = buildServiceInvoicePayload(servicosParaFatura, clienteParaFatura, effectiveNfseConfig, integrationId);

        irParaEnvio();
        spedyNote = await spedyService.emitServiceInvoice(config.spedyApiKey, config.spedyEnvironment, payload as unknown as Record<string, unknown>);

      } else {
        const { payload, itemsPayload, avisos: avisosNota } = await montarPayloadNfe({
          integrationId,
          form: formData,
          itens: importedPedidoId ? importedPedidoItens : [],
          pagamentos: importedPedidoId ? importedPedidoPagamentos : [],
          numeroPedido: pedidosVenda.find((p) => p.id === importedPedidoId)?.numeroPedido,
          referencedAccessKey,
          stateTaxNumber: stateTaxNumberDestinatario,
        });
        // Nao trava (a nota sai certa), mas o cadastro precisa de ajuste.
        if (avisosNota.length > 0) showWarning('Confira o cadastro destes produtos', avisosNota.join(' '));

        irParaEnvio();
        spedyNote = await spedyService.emitProductInvoice(config.spedyApiKey, config.spedyEnvironment, payload);
        itensFiscaisParaSalvar = itemsPayload;
      }
      enviouParaSpedy = true; // dai' pra frente a nota EXISTE na Spedy, mesmo que algo falhe aqui
      let notaDocId: string;

      if (targetInvoiceId) {
        notaDocId = targetInvoiceId;
        // Atualiza a nota fiscal existente em vez de criar uma nova
        await updateDoc(doc(db, 'notas_fiscais', targetInvoiceId), {
          spedyId: spedyNote.id,
          number: spedyNote.number,
          accessKey: spedyNote.accessKey || null,
          pedidoId: importedPedidoId || null,
          osId: importedOsId || null,
          tipo: formData.tipo,
          clienteNome: formData.clienteNome,
          clienteId: formData.clienteId || null,
          valor: valorNumerico,
          itensFiscais: itensFiscaisParaSalvar,
          status: spedyNote.status,
          processingMessage: spedyNote.processingDetail?.message || null,
          processingCode: spedyNote.processingDetail?.code || null,
          // So' grava a tentativa DEPOIS que a Spedy respondeu: se o envio cair
          // no meio, o proximo clique recalcula o mesmo id (sem nota duplicada).
          tentativaEmissao: escolhaReenvio ? escolhaReenvio.tentativa : 1,
          integrationId,
          emailDestinatario: formData.email.trim() || null,
          updatedAt: serverTimestamp(),
          data: new Date().toISOString(),
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Retransmitida na Spedy'),
        });
      } else {
        // Salva nova referência local no Firestore
        const novaNotaRef = await addDoc(collection(db, 'notas_fiscais'), {
          spedyId: spedyNote.id,
          number: spedyNote.number,
          accessKey: spedyNote.accessKey || null,
          pedidoId: importedPedidoId || null,
          osId: importedOsId || null,
          tipo: formData.tipo,
          clienteNome: formData.clienteNome,
          clienteId: formData.clienteId || null,
          valor: valorNumerico,
          itensFiscais: itensFiscaisParaSalvar,
          status: spedyNote.status,
          processingMessage: spedyNote.processingDetail?.message || null,
          processingCode: spedyNote.processingDetail?.code || null,
          emailDestinatario: formData.email.trim() || null,
          integrationId,
          tenantId,
          ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
          createdAt: serverTimestamp(),
          data: new Date().toISOString()
        });
        notaDocId = novaNotaRef.id;
      }

      handleCloseModal();

      // Pop-up: a nota ja' saiu -- agora mostra o resultado (se a Spedy ja' respondeu)
      // ou passa a esperar a SEFAZ, perguntando de tempos em tempos.
      const desfechoImediato = desfechoDoStatus(spedyNote.status);
      const baseProgresso: ProgressoEmissao = {
        tipo: tipoNota,
        clienteNome: formData.clienteNome,
        etapa: 'transmitindo',
        desfecho: desfechoImediato,
        numero: spedyNote.number,
        codigo: spedyNote.processingDetail?.code ?? null,
        mensagem: spedyNote.processingDetail?.message ?? null,
        spedyId: spedyNote.id,
        notaIdLocal: notaDocId,
        // Sem docId o pop-up nao dispara o e-mail (SMTP nao configurado: a Spedy e' quem envia).
        ...(emailPeloSistema && tipoNota === 'NF-e' ? { docId: notaDocId } : {}),
        transmitindoDesdeMs: Date.now(),
      };
      setProgresso(baseProgresso); // o contador de segundos reinicia sozinho no hook
      if (!desfechoImediato) {
        void acompanharNota({ docId: notaDocId, spedyId: spedyNote.id, tipo: tipoNota, statusInicial: spedyNote.status, consultar: consultarNotaNaSpedy });
      }

      // Reseta form basico
      setFormData(prev => ({
        ...prev,
        clienteId: '',
        clienteNome: '',
        documento: '',
        inscricaoEstadual: '',
        email: '',
        valor: '',
        descricao: ''
      }));
      setImportedPedidoId('');
      setImportedPedidoItens([]);
      setReferencedAccessKey('');
      setActiveModalTab('cliente');

      loadLocalInvoices(false);
    } catch (err) {
      console.error(err);
      if (enviouParaSpedy) {
        // A nota JA existe na Spedy; o que falhou foi guardar na lista. Nao pode
        // aparecer como "nota nao emitida" -- o usuario emitiria de novo e duplicaria.
        setProgresso(null);
        showError(
          'A nota foi enviada, mas não foi salva na lista',
          'A Spedy recebeu a nota, mas o sistema não conseguiu guardá-la na lista de notas. Não emita de novo: avise o suporte informando o cliente e o valor, para conferirmos a nota no painel da Spedy.',
        );
      } else if (etapaAtual === 'enviando') {
        setProgresso((atual) => (atual ? { ...atual, desfecho: 'falha_envio', erroEnvio: (err as Error).message } : atual));
      } else {
        setProgresso(null);
        if (err instanceof ErroItemNota) {
          // O formulario continua aberto: leva pra aba Produtos com a linha destacada.
          setItemComProblema(err.indice);
          setActiveModalTab('produtos');
        }
        showError('Erro ao emitir', (err as Error).message || 'Houve um problema ao enviar a nota.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  /** Codigo do cliente por id (cadastro lido quando a tela abriu). */
  const codigoClientePorId = useMemo(
    () => new Map(clients.map((c) => [c.id, c.codigo || ''])),
    [clients],
  );

  /** Pedidos finalizados que ainda nao tem nota (NF-e ou cupom) autorizada ou na fila. */
  const pedidosParaLote = useMemo<PedidoParaLote[]>(() => {
    const ativos = new Set(allInvoices
      .filter((n) => n.pedidoId && n.finalidade !== 'devolucao' && ['authorized', 'enqueued', 'processing', 'created'].includes(n.status))
      .map((n) => n.pedidoId as string));
    const rejeitadas = new Set(allInvoices
      .filter((n) => n.pedidoId && n.tipo === 'NF-e' && (n.status === 'rejected' || n.status === 'denied'))
      .map((n) => n.pedidoId as string));
    const dataDe = (v: unknown): string => {
      const t = v as { toDate?: () => Date; seconds?: number } | undefined;
      const d = t?.toDate ? t.toDate() : t?.seconds ? new Date(t.seconds * 1000) : null;
      return d ? d.toLocaleDateString('pt-BR') : '—';
    };
    return pedidosVenda
      .filter((p) => !ativos.has(p.id))
      .map((p) => ({
        id: p.id,
        numeroPedido: p.numeroPedido,
        clienteNome: p.clienteNome,
        clienteCodigo: codigoClientePorId.get(p.clienteId) || '',
        valorTotal: Number(p.valorTotal || 0),
        formaPagamento: p.formaPagamento,
        data: dataDe(p.createdAt),
        temRejeitada: rejeitadas.has(p.id),
      }));
  }, [allInvoices, pedidosVenda, codigoClientePorId]);

  /** Status da Spedy -> linha do lote; null = ainda sem resposta da SEFAZ. */
  const resultadoDoStatusLote = (nota: SpedyInvoice): ResultadoItemLote | null => {
    if (nota.status === 'authorized') return { estado: 'autorizada', numeroNota: nota.number, spedyId: nota.id };
    if (nota.status === 'rejected' || nota.status === 'denied') {
      return {
        estado: 'rejeitada',
        numeroNota: nota.number,
        mensagem: `${nota.processingDetail?.code || ''} ${nota.processingDetail?.message || 'Motivo não informado.'}`.trim()
          + ' Corrija e use "Corrigir e Transmitir Novamente" na lista.',
      };
    }
    return null;
  };

  /**
   * Transmite a NF-e de UM pedido do lote, com as mesmas travas da emissao
   * normal (handleEmitir): nota duplicada, CPF/CNPJ, endereco com codigo IBGE,
   * IE do destinatario. Nao abre pop-up: devolve o que aconteceu, em portugues,
   * pra aparecer na linha do pedido. `pendente` = a Spedy aceitou e a SEFAZ
   * ainda vai responder (ou ja' autorizou e falta o e-mail).
   */
  const emitirPedidoDoLote = async (pedido: PedidoVenda): Promise<{ resultado?: ResultadoItemLote; pendente?: { docId: string; spedyId: string } }> => {
    if (!config?.spedyApiKey || !tenantId || !currentUser) {
      return { resultado: { estado: 'erro', mensagem: 'A integração fiscal não está configurada.' } };
    }
    const jaEmitida = await notaNfeJaEmitidaDoPedido(pedido.id);
    if (jaEmitida) {
      return {
        resultado: {
          estado: 'pulada',
          mensagem: jaEmitida.status === 'authorized'
            ? `Este pedido já tem a NF-e nº ${jaEmitida.number ?? ''} autorizada.`
            : 'A NF-e deste pedido já está na fila da SEFAZ.',
        },
      };
    }

    const montada = await montarNotaDoPedido(pedido);
    const form = { ...formData, ...montada.form };
    if (montada.itens.length === 0) return { resultado: { estado: 'erro', mensagem: 'O pedido não tem itens.' } };
    if (!form.documento.replace(/\D/g, '')) {
      return { resultado: { estado: 'erro', mensagem: 'O cliente está sem CPF/CNPJ no cadastro. Corrija em Clientes.' } };
    }
    const faltando = [
      !form.rua && 'endereço', !form.numero && 'número', !form.bairro && 'bairro', !form.cep && 'CEP',
      !form.cidade && 'cidade', !form.estado && 'UF', !form.codigoIbge && 'código IBGE da cidade',
    ].filter(Boolean);
    if (faltando.length > 0) {
      return { resultado: { estado: 'erro', mensagem: `Endereço do cliente incompleto (falta ${faltando.join(', ')}). No cadastro, digite o CEP e saia do campo, confira e salve.` } };
    }
    const ie = resolverInscricaoEstadualDestinatario({ documento: form.documento, identidade: form.inscricaoEstadual, clienteNome: form.clienteNome });
    if (ie.erro) return { resultado: { estado: 'erro', mensagem: ie.erro } };

    // Nota rejeitada deste pedido: reenvia a MESMA (mesma regra do reenvio manual).
    const rejeitada = allInvoices.find((n) => n.pedidoId === pedido.id && n.tipo === 'NF-e' && n.finalidade !== 'devolucao' && (n.status === 'rejected' || n.status === 'denied'));
    const idNaSpedy = rejeitada ? await integrationIdDaNota(rejeitada) : null;
    if (rejeitada?.spedyId && !idNaSpedy && !rejeicaoPrendeConfiguracaoNaNota(rejeitada.processingMessage)) {
      return { resultado: { estado: 'erro', mensagem: 'Não consegui confirmar com a Spedy qual é a nota rejeitada deste pedido; transmitir agora pularia a numeração. Tente de novo em instantes.' } };
    }
    const escolha = rejeitada
      ? escolherIntegrationIdDoReenvio({ docId: rejeitada.id, tentativaAtual: rejeitada.tentativaEmissao, mensagemRejeicao: rejeitada.processingMessage, integrationIdAtual: idNaSpedy })
      : null;
    const integrationId = escolha ? escolha.integrationId : crypto.randomUUID();

    const { payload, itemsPayload } = await montarPayloadNfe({
      integrationId,
      form,
      itens: montada.itens,
      pagamentos: montada.pagamentos,
      numeroPedido: pedido.numeroPedido,
      referencedAccessKey: montada.referencedAccessKey,
      stateTaxNumber: ie.valor,
    });
    const nota = await spedyService.emitProductInvoice(config.spedyApiKey, config.spedyEnvironment, payload);

    // Dai' pra frente a nota EXISTE na Spedy: falha ao gravar nao pode virar "nao emitida".
    let docId: string;
    try {
      const comum = {
        spedyId: nota.id,
        number: nota.number,
        accessKey: nota.accessKey || null,
        pedidoId: pedido.id,
        osId: null,
        tipo: 'NF-e',
        clienteNome: form.clienteNome,
        clienteId: form.clienteId || null,
        valor: Number(form.valor),
        itensFiscais: itemsPayload,
        status: nota.status,
        processingMessage: nota.processingDetail?.message || null,
        processingCode: nota.processingDetail?.code || null,
        emailDestinatario: form.email.trim() || null,
        integrationId,
        data: new Date().toISOString(),
      };
      if (rejeitada) {
        docId = rejeitada.id;
        await updateDoc(doc(db, 'notas_fiscais', rejeitada.id), {
          ...comum,
          tentativaEmissao: escolha ? escolha.tentativa : 1,
          updatedAt: serverTimestamp(),
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Retransmitida na Spedy (lote)'),
        });
      } else {
        const nova = await addDoc(collection(db, 'notas_fiscais'), {
          ...comum,
          tenantId,
          ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
          createdAt: serverTimestamp(),
        });
        docId = nova.id;
      }
    } catch (erroGravacao) {
      console.error('Nota do lote enviada, mas nao gravada na lista:', erroGravacao);
      return { resultado: { estado: 'erro', mensagem: 'A Spedy recebeu a nota, mas o sistema não conseguiu guardá-la na lista. Não emita de novo: avise o suporte.' } };
    }

    const final = resultadoDoStatusLote(nota);
    if (final) return { resultado: final, pendente: final.estado === 'autorizada' ? { docId, spedyId: nota.id } : undefined };
    return { pendente: { docId, spedyId: nota.id } };
  };

  const executarLote = async (
    ids: string[],
    avisar: (id: string, resultado: ResultadoItemLote) => void,
    deveParar: () => boolean,
  ) => {
    // A empresa tem o que precisa pra emitir? Conferido UMA vez pro lote todo.
    try {
      const requisitos = await spedyService.getRequisitos();
      const bloqueios = requisitos.nfe.checks.filter((c) => c.gravidade === 'bloqueio');
      if (bloqueios.length > 0) {
        const motivo = bloqueios.map((c) => `${c.mensagem} ${c.comoResolver}`.trim()).join(' ');
        ids.forEach((id) => avisar(id, { estado: 'erro', mensagem: `A empresa ainda não pode emitir NF-e: ${motivo}` }));
        return;
      }
    } catch (erroRequisitos) {
      console.error('Nao foi possivel conferir os requisitos fiscais (o lote segue):', erroRequisitos);
    }

    const acompanhar: Array<{ pedidoId: string; docId: string; spedyId: string; autorizada: boolean }> = [];
    for (const id of ids) {
      if (deveParar()) {
        avisar(id, { estado: 'pulada', mensagem: 'Lote interrompido antes desta nota.' });
        continue;
      }
      const pedido = pedidosVenda.find((p) => p.id === id);
      if (!pedido) {
        avisar(id, { estado: 'erro', mensagem: 'Pedido não encontrado. Atualize a tela.' });
        continue;
      }
      avisar(id, { estado: 'emitindo' });
      try {
        const r = await emitirPedidoDoLote(pedido);
        avisar(id, r.resultado || { estado: 'processando' });
        if (r.pendente) acompanhar.push({ pedidoId: id, ...r.pendente, autorizada: r.resultado?.estado === 'autorizada' });
      } catch (erro) {
        avisar(id, { estado: 'erro', mensagem: (erro as Error).message || 'Não foi possível transmitir a nota.' });
      }
    }

    // Espera a SEFAZ responder as que ficaram na fila (ate ~2 min), atualizando a lista.
    const aguardando = acompanhar.filter((a) => !a.autorizada);
    for (let volta = 0; volta < 40 && aguardando.length > 0; volta += 1) {
      await new Promise((r) => setTimeout(r, 3000));
      for (const item of [...aguardando]) {
        try {
          const nota = await consultarNotaNaSpedy('NF-e', item.spedyId);
          const final = resultadoDoStatusLote(nota);
          if (!final) continue;
          await updateDoc(doc(db, 'notas_fiscais', item.docId), {
            status: nota.status,
            number: nota.number,
            accessKey: nota.accessKey || null,
            processingMessage: nota.processingDetail?.message || null,
            processingCode: nota.processingDetail?.code || null,
          }).catch((e) => console.error('Nao atualizou a nota do lote:', e));
          avisar(item.pedidoId, final);
          aguardando.splice(aguardando.indexOf(item), 1);
          item.autorizada = final.estado === 'autorizada';
        } catch (erroConsulta) {
          console.error('Erro ao consultar nota do lote:', erroConsulta);
        }
      }
    }
    aguardando.forEach((item) => avisar(item.pedidoId, { estado: 'processando', mensagem: 'A SEFAZ ainda não respondeu. Clique em "Sincronizar Notas" daqui a pouco.' }));

    // E-mail ao cliente pelo sistema (quando a empresa configurou o SMTP) -- como na emissao normal.
    if (emailPeloSistema) {
      for (const item of acompanhar.filter((a) => a.autorizada)) {
        await notaEmailService.enviar(item.docId).catch((e) => console.error('E-mail da nota do lote nao enviado:', e));
      }
    }
    loadLocalInvoices(false);
  };

  const handleTransformarCupomEmNfe = async (note: LocalInvoice) => {
    if (!note.pedidoId) {
      showError('Operação Inválida', 'Este cupom fiscal não possui um pedido de venda associado para recuperação dos produtos.');
      return;
    }

    // Configura o formulário
    setFormData(prev => ({
      ...prev,
      tipo: 'NF-e',
      descricao: `Nota Fiscal Cuponada ref. ao Cupom Fiscal nº ${note.number || note.spedyId.substring(0, 6)}`
    }));

    // Abre o modal
    setIsModalOpen(true);
    setActiveModalTab('produtos'); // Manda o usuário direto para a aba de produtos revisá-los

    await handleSelectPedido(note.pedidoId);
  };

  const handleRetransmitRejected = async (note: LocalInvoice) => {
    // Nota de TRANSFERENCIA entre filiais: e' emitida de novo pela propria transferencia
    // (o servidor remonta a nota a partir do cadastro -- services/notaTransferencia.js).
    if (note.finalidade === 'transferencia' && note.transferenciaId) {
      const escolha = await NexusSwal.fire({
        icon: 'info',
        title: `Nota da transferência nº ${note.numeroTransferencia || ''}`,
        html: 'Corrija o cadastro indicado na rejeição e emita a nota de novo pela transferência (Estoque → Transferências → "Emitir a nota de novo").',
        showCancelButton: true,
        confirmButtonText: 'Abrir a transferência',
        cancelButtonText: 'Fechar',
      });
      if (escolha.isConfirmed) navigate(`/estoque/transferencias/${note.transferenciaId}`);
      return;
    }
    // Nota de DEVOLUCAO rejeitada volta pelo pop-up da devolucao: o fluxo abaixo remontaria
    // o pedido como uma venda normal.
    if (note.finalidade === 'devolucao' && note.devolucaoId) {
      setDevolucaoNfeId(note.devolucaoId);
      return;
    }
    setRetransmittingInvoiceId(note.id);
    const itemRejeitado = itemDaMensagemSefaz(note.processingMessage);
    setCorrecaoRejeicao(note.status === 'rejected' || note.status === 'denied'
      ? { mensagem: `${note.processingCode ? `Rejeição ${note.processingCode}: ` : ''}${note.processingMessage || 'Motivo não informado.'}`, itemIndice: itemRejeitado }
      : null);
    setItemComProblema(itemRejeitado);
    // Configura o formulário
    setFormData(prev => ({
      ...prev,
      tipo: note.tipo,
      clienteNome: note.clienteNome,
      valor: String(note.valor),
      descricao: note.tipo === 'NF-e' ? `NF-e Re-emitida` : note.tipo === 'NFC-e' ? `NFC-e Re-emitida` : `NFS-e Re-emitida`
    }));

    // Se tiver pedidoId vinculado, reimporta o pedido e suas taxas
    if (note.pedidoId) {
      setImportedPedidoId(note.pedidoId);
      setIsModalOpen(true);
      setActiveModalTab('produtos');
      await handleSelectPedido(note.pedidoId);
    } else {
      setImportedPedidoId('');
      setReferencedAccessKey('');
      setIsModalOpen(true);
      setActiveModalTab('cliente');
    }
  };

  /** "Corrigir na nota" do pop-up de rejeicao: reabre a nota com o item apontado pela SEFAZ. */
  const corrigirNotaDoProgresso = () => {
    const id = progresso?.notaIdLocal;
    const nota = id ? invoices.find((n) => n.id === id) : undefined;
    fecharProgresso();
    if (!nota) {
      showError('Nota não encontrada na lista', 'Atualize a lista de notas e use "Corrigir e Transmitir Novamente" na linha da nota.');
      return;
    }
    void handleRetransmitRejected({
      ...nota,
      status: nota.status === 'rejected' || nota.status === 'denied' ? nota.status : 'rejected',
      processingCode: nota.processingCode || progresso?.codigo || null,
      processingMessage: nota.processingMessage || progresso?.mensagem || null,
    });
  };

  const getStatusBadge = (note: LocalInvoice) => {
    switch (note.status) {
      case 'authorized':
        return (
          <span style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600, backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#10b981', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <CheckCircle size={14}/> Autorizada
          </span>
        );
      case 'rejected':
      case 'denied':
        return (
          <span
            onClick={() => NexusSwal.fire({
              title: 'Detalhes da Rejeição',
              // text (e nao o 2o argumento posicional, que e' HTML): a mensagem
              // vem da SEFAZ/Spedy e pode repetir dado digitado na nota.
              text: `Código: ${note.processingCode || 'N/A'} · Mensagem: ${note.processingMessage || 'Motivo desconhecido.'}`,
              icon: 'error',
            })}
            style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600, backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}
            title="Clique para ver o motivo da rejeição"
          >
            <XCircle size={14}/> Rejeitada
          </span>
        );
      case 'canceled':
        return (
          <span style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600, backgroundColor: 'rgba(63, 63, 70, 0.2)', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <Ban size={14}/> Cancelada
          </span>
        );
      case 'enqueued':
      case 'processing':
      case 'created':
        return (
          <span style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600, backgroundColor: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <AlertCircle size={14} className="spin-icon"/> Processando
          </span>
        );
      default:
        return <span style={{ color: 'var(--text-secondary)' }}>{note.status}</span>;
    }
  };

  // Filtragem local das notas
  const filteredInvoices = invoices.filter(note => {
    // Codigo do cliente (2026-09-30): "7", "07" e "0007" acham o mesmo cliente.
    const codigoBuscado = searchTerm.replace(/\D/g, '').replace(/^0+/, '');
    const codigoDaNota = String(codigoClientePorId.get(note.clienteId || '') || '').replace(/^0+/, '');
    const matchesSearch =
      (codigoBuscado !== '' && codigoDaNota === codigoBuscado) ||
      note.clienteNome.toLowerCase().includes(searchTerm.toLowerCase()) ||
      // Numero da nota como aparece na tela ("000040") ou sem zeros ("40").
      (note.number && codigoBuscado !== '' && /^[\d\s.-]+$/.test(searchTerm.trim())
        ? String(Number(note.number)).includes(codigoBuscado)
        : false) ||
      note.status.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesTab = selectedTab === 'Todas' || note.tipo === selectedTab;

    return matchesSearch && matchesTab;
  }).sort((a, b) => {
    // Pelo numero da nota; nota ainda sem numero (na fila) fica no fim. Mesmo numero
    // (NF-e e NFC-e tem series proprias): NF-e primeiro.
    const na = Number(a.number) || 0;
    const nb = Number(b.number) || 0;
    if (!na || !nb) return (na ? 0 : 1) - (nb ? 0 : 1);
    if (na !== nb) return ordemNumero === 'asc' ? na - nb : nb - na;
    return String(a.tipo).localeCompare(String(b.tipo));
  });

  const totalPages = Math.max(1, Math.ceil(filteredInvoices.length / pageSize));
  const pagedInvoices = filteredInvoices.slice((page - 1) * pageSize, page * pageSize);

  if (isConfigLoading) {
    return <div style={{ padding: '40px', color: 'var(--text-primary)', textAlign: 'center' }}>Carregando dados do módulo fiscal...</div>;
  }

  // Tela de Bloqueio se a integração Spedy não estiver ativa
  if (!config || !config.spedyEnabled || !config.spedyApiKey) {
    return (
      <div className="page-container" style={{ display: 'flex', flexDirection: 'column', gap: '24px', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', maxWidth: '600px', margin: '0 auto', textAlign: 'center' }}>
        <Receipt size={64} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
        <h1 style={{ fontSize: '28px', fontWeight: 700, margin: '16px 0 8px 0', color: 'var(--text-primary)' }}>Módulo Fiscal Desativado</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '16px', lineHeight: '1.6', marginBottom: '24px' }}>
          Para emitir notas fiscais eletrônicas de produto (NF-e) ou de serviço (NFS-e) diretamente pelo sistema, você precisa ativar a integração com a <strong>Spedy API</strong>.
        </p>
        <div style={{ padding: '20px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', width: '100%', display: 'flex', flexDirection: 'column', gap: '12px', textAlign: 'left', marginBottom: '32px' }}>
          <h4 style={{ margin: 0, color: 'var(--text-primary)', fontWeight: 600 }}>O que você precisa:</h4>
          <ol style={{ margin: 0, paddingLeft: '20px', color: 'var(--text-muted)', fontSize: '14px', lineHeight: '1.8' }}>
            <li>Criar uma conta no painel da <strong>Spedy</strong> (Produção ou Sandbox).</li>
            <li>Obter sua <strong>Chave de API (X-Api-Key)</strong> no backoffice.</li>
            <li>Inserir a chave nas configurações do seu Sistema Nexus.</li>
          </ol>
        </div>
        <a href="/configuracoes" className="btn-primary" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Settings size={18} /> Ir para Configurações
        </a>
      </div>
    );
  }

  // Métricas
  const mAtivas = invoices.filter(i => i.status === 'authorized');
  const totalEmitido = mAtivas.reduce((acc, curr) => acc + curr.valor, 0);
  const emFilaCount = invoices.filter(i => ['enqueued', 'processing', 'created'].includes(i.status)).length;
  const rejeitadasCount = invoices.filter(i => i.status === 'rejected' || i.status === 'denied').length;

  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '20px' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Receipt size={28} color="var(--accent-purple)" />
            Notas Fiscais
          </h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)' }}>
            Gerenciamento de emissão fiscal ativa em modo: <strong style={{ color: config.spedyEnvironment === 'sandbox' ? '#f59e0b' : '#10b981' }}>{config.spedyEnvironment === 'sandbox' ? 'Homologação' : 'Produção'}</strong>
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <MenuMaisOpcoes
            rotulo={syncing ? 'Sincronizando...' : 'Mais opções'}
            itens={[
              {
                texto: 'Emitir em lote', Icone: Receipt, oculto: !canEmitirNota,
                titulo: 'Marcar vários pedidos finalizados e emitir as NF-e de uma vez',
                onClick: () => setLoteAberto(true),
              },
              {
                texto: 'Sincronizar notas', Icone: RefreshCw, desabilitado: syncing,
                titulo: 'Busca na Spedy a situação atual das notas em processamento',
                onClick: () => { void handleManualSyncAll(); },
                separadorAntes: canEmitirNota,
              },
            ]}
          />
          {canEmitirNota && (
            <button
              className="btn-primary"
              onClick={() => {
                setReferencedAccessKey('');
                setImportedPedidoId('');
                setImportedPedidoItens([]);
                setActiveModalTab('cliente');
                setIsModalOpen(true);
              }}
              style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
            >
              <Plus size={18} /> Emitir Nota Fiscal
            </button>
          )}
        </div>
      </div>

      {/* Cards de Métricas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
        <div className="card" style={{ padding: '20px', backgroundColor: 'var(--bg-secondary)', borderLeft: '4px solid #10b981' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: '0 0 6px 0' }}>Total Emitido</p>
          <h3 style={{ margin: 0, fontSize: '24px', fontWeight: 700 }}>
            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalEmitido)}
          </h3>
          <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>{mAtivas.length} Notas Autorizadas</p>
        </div>
        <div className="card" style={{ padding: '20px', backgroundColor: 'var(--bg-secondary)', borderLeft: '4px solid #f59e0b' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: '0 0 6px 0' }}>Em Fila de Transmissão</p>
          <h3 style={{ margin: 0, fontSize: '24px', fontWeight: 700 }}>{emFilaCount}</h3>
          <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>Aguardando resposta da SEFAZ</p>
        </div>
        <div className="card" style={{ padding: '20px', backgroundColor: 'var(--bg-secondary)', borderLeft: '4px solid #ef4444' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: '0 0 6px 0' }}>Notas Rejeitadas</p>
          <h3 style={{ margin: 0, fontSize: '24px', fontWeight: 700 }}>{rejeitadasCount}</h3>
          <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>Exige correção cadastral</p>
        </div>
      </div>

      {/* Tabela de Notas */}
      <div className="card list-container" style={{ backgroundColor: 'var(--bg-secondary)', padding: '0', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        <div className="list-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', borderBottom: '1px solid var(--border-color)', flexWrap: 'wrap', gap: '16px' }}>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: '12px', borderBottom: '1px solid transparent' }}>
            {[
              { id: 'Todas', label: 'Todas as Notas' },
              { id: 'NF-e', label: 'NF-e (Produtos)' },
              { id: 'NFC-e', label: 'NFC-e (Cupons)' },
              { id: 'NFS-e', label: 'NFS-e (Serviços)' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setSelectedTab(tab.id as 'Todas' | 'NFC-e' | 'NF-e' | 'NFS-e')}
                style={{
                  background: 'none', border: 'none',
                  padding: '8px 16px', cursor: 'pointer',
                  color: selectedTab === tab.id ? 'var(--text-primary)' : 'var(--text-muted)',
                  fontWeight: selectedTab === tab.id ? 600 : 500,
                  borderBottom: selectedTab === tab.id ? '2px solid var(--accent-purple)' : '2px solid transparent',
                  transition: 'all 0.2s'
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={mostrarCanceladas}
              onChange={(e) => setMostrarCanceladas(e.target.checked)}
              style={{ accentColor: 'var(--accent-purple)' }}
            />
            Mostrar canceladas
          </label>

          {/* Busca */}
          <div className="search-box" style={{ position: 'relative', width: '300px' }}>
            <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Buscar por cliente, código do cliente ou número da nota..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: '100%', padding: '10px 10px 10px 40px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
            />
          </div>
        </div>

        <div className="table-wrapper" style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '13px' }}>
                <th style={{ padding: '16px' }}>
                  <button type="button" onClick={inverterOrdemNumero} title="Inverter a ordem pelo número da nota"
                    style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', font: 'inherit', textTransform: 'inherit', letterSpacing: 'inherit', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    Nº Nota {ordemNumero === 'asc' ? '▲' : '▼'}
                  </button>
                </th>
                <th style={{ padding: '16px' }}>Tipo</th>
                <th style={{ padding: '16px' }}>Cód.</th>
                <th style={{ padding: '16px' }}>Cliente</th>
                <th style={{ padding: '16px' }}>Data</th>
                <th style={{ padding: '16px' }}>Valor</th>
                <th style={{ padding: '16px' }}>Status</th>
                <th style={{ padding: '16px', textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    Carregando notas fiscais...
                  </td>
                </tr>
              ) : filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    <Receipt size={40} style={{ opacity: 0.2, margin: '0 auto 12px' }} />
                    <p>Nenhuma nota fiscal encontrada.</p>
                  </td>
                </tr>
              ) : (
                pagedInvoices.map((note) => (
                  <tr key={note.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '14px' }}>
                    <td style={{ padding: '16px', fontWeight: 600 }}>
                      {note.number ? String(note.number).padStart(6, '0') : (
                        <span style={{ fontStyle: 'italic', opacity: 0.6, fontSize: '12px' }}>Aguardando...</span>
                      )}
                    </td>
                    <td style={{ padding: '16px' }}>
                      <span style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '12px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', fontWeight: 500 }}>
                        {note.tipo}
                      </span>
                      {note.finalidade === 'devolucao' && (
                        <span title="NF-e de devolução de venda (nota de entrada)" style={{ marginLeft: '6px', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', backgroundColor: 'rgba(139,92,246,0.15)', color: '#a78bfa', fontWeight: 600 }}>
                          Devolução
                        </span>
                      )}
                      {note.finalidade === 'transferencia' && (
                        <span title={`NF-e de transferência entre filiais${note.numeroTransferencia ? ` (transferência nº ${note.numeroTransferencia})` : ''}`} style={{ marginLeft: '6px', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', backgroundColor: 'rgba(14,165,233,0.15)', color: '#38bdf8', fontWeight: 600 }}>
                          Transferência
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '16px', color: 'var(--text-secondary)' }}>{codigoClientePorId.get(note.clienteId || '') || '—'}</td>
                    <td style={{ padding: '16px', fontWeight: 500 }}>{note.clienteNome}</td>
                    <td style={{ padding: '16px', color: 'var(--text-secondary)' }}>{note.data}</td>
                    <td style={{ padding: '16px', fontWeight: 600 }}>
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(note.valor)}
                    </td>
                    <td style={{ padding: '16px' }}>{getStatusBadge(note)}</td>
                    <td style={{ padding: '16px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                        {/* Sincronizar Nota Individual se estiver pendente */}
                        {['enqueued', 'processing', 'created'].includes(note.status) && (
                          <button
                            className="icon-btn"
                            title="Atualizar Status"
                            onClick={() => handleManualSyncSingle(note)}
                            style={{ padding: '6px', borderRadius: '4px', backgroundColor: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                          >
                            <RefreshCw size={16} />
                          </button>
                        )}

                        {/* Transformar em NF-e (Nota Cuponada) */}
                        {canEmitirNota && note.tipo === 'NFC-e' && note.status === 'authorized' && note.pedidoId && !invoices.some(inv => inv.pedidoId === note.pedidoId && inv.tipo === 'NF-e' && inv.status === 'authorized') && (
                          <button
                            className="icon-btn"
                            title="Transformar em NF-e (Nota Cuponada)"
                            onClick={() => handleTransformarCupomEmNfe(note)}
                            style={{ padding: '6px', borderRadius: '4px', backgroundColor: 'transparent', border: 'none', color: '#8b5cf6', cursor: 'pointer' }}
                          >
                            <RefreshCw size={16} style={{ transform: 'rotate(90deg)' }} />
                          </button>
                        )}

                        {/* Ver a nota como a Spedy/SEFAZ a enxerga (ambiente, serie, motivo). Nas CANCELADAS
                            tambem (2026-09-30): confirma que o cancelamento foi homologado na SEFAZ. */}
                        {(note.status === 'rejected' || note.status === 'denied' || note.status === 'canceled') && (
                          <button
                            className="icon-btn"
                            title={note.status === 'canceled' ? 'Consultar o cancelamento na SEFAZ' : 'Consultar na Spedy (ambiente, série e motivo)'}
                            onClick={() => handleConsultarNaSpedy(note)}
                            style={{ padding: '6px', borderRadius: '4px', backgroundColor: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                          >
                            <Search size={16} />
                          </button>
                        )}

                        {/* Retransmitir / Corrigir Nota Rejeitada */}
                        {canEmitirNota && (note.status === 'rejected' || note.status === 'denied') && (
                          <button
                            className="icon-btn"
                            title={note.finalidade === 'devolucao' ? 'Corrigir e reemitir a devolução' : 'Corrigir e Transmitir Novamente'}
                            onClick={() => handleRetransmitRejected(note)}
                            style={{ padding: '6px', borderRadius: '4px', backgroundColor: 'transparent', border: 'none', color: '#f59e0b', cursor: 'pointer' }}
                          >
                            <RefreshCw size={16} />
                          </button>
                        )}

                        {/* Visualizar DANFE (PDF) */}
                        {note.status === 'authorized' && (
                          <button
                            type="button"
                            onClick={() => abrirDanfe(note)}
                            disabled={carregandoPdfId === note.id}
                            className="icon-btn"
                            title="Visualizar PDF (DANFE)"
                            style={{ padding: '6px', borderRadius: '4px', backgroundColor: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: carregandoPdfId === note.id ? 'default' : 'pointer', display: 'inline-flex' }}
                          >
                            {carregandoPdfId === note.id ? <Loader2 size={18} className="spin-animation" /> : <Eye size={18} />}
                          </button>
                        )}

                        {/* Enviar por e-mail (PDF + XML) */}
                        {note.status === 'authorized' && note.tipo === 'NF-e' && (
                          <button
                            type="button"
                            onClick={() => void handleEnviarEmail(note)}
                            className="icon-btn"
                            title={note.emailEnvio?.status === 'enviado' ? 'E-mail já enviado — clique para reenviar' : 'Enviar por e-mail (PDF + XML)'}
                            style={{ padding: '6px', borderRadius: '4px', backgroundColor: 'transparent', border: 'none', color: note.emailEnvio?.status === 'enviado' ? '#10b981' : 'var(--text-muted)', cursor: 'pointer', display: 'inline-flex' }}
                          >
                            <Mail size={18} />
                          </button>
                        )}

                        {/* Enviar por WhatsApp */}
                        {note.status === 'authorized' && (
                          <button
                            type="button"
                            onClick={() => handleOpenWhatsApp(note)}
                            className="icon-btn"
                            title="Enviar por WhatsApp"
                            style={{ padding: '6px', borderRadius: '4px', backgroundColor: 'transparent', border: 'none', color: '#25d366', cursor: 'pointer', display: 'inline-flex' }}
                          >
                            <MessageCircle size={18} />
                          </button>
                        )}

                        {/* Baixar XML */}
                        {note.status === 'authorized' && (
                          <button
                            type="button"
                            onClick={() => spedyService.openFiscalFile(
                              note.spedyId,
                              note.tipo === 'NFS-e' ? 'service' : note.tipo === 'NFC-e' ? 'consumer' : 'product',
                              'xml',
                              nomeArquivoDocumento({ tipo: siglaArquivoNota(note.tipo), numero: note.number, destinatario: note.clienteNome, extensao: 'xml' }),
                            ).catch(err => showError('Erro ao baixar XML', (err as Error).message))}
                            className="icon-btn"
                            title="Baixar XML"
                            style={{ padding: '6px', borderRadius: '4px', backgroundColor: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'inline-flex' }}
                          >
                            <Download size={18} />
                          </button>
                        )}

                        {/* Devolucao fiscal da venda (NF-e/NFC-e autorizada ligada a um pedido) */}
                        {canEmitirNota && note.status === 'authorized' && note.pedidoId && note.finalidade !== 'devolucao' && (note.tipo === 'NF-e' || note.tipo === 'NFC-e') && (
                          <button
                            type="button"
                            onClick={() => abrirDevolucaoFiscal(note)}
                            className="icon-btn"
                            title="Emitir NF-e de devolução desta venda"
                            style={{ padding: '6px', borderRadius: '4px', backgroundColor: 'transparent', border: 'none', color: '#3b82f6', cursor: 'pointer', display: 'inline-flex' }}
                          >
                            <RotateCcw size={18} />
                          </button>
                        )}

                        {/* Carta de correcao (so NF-e autorizada) */}
                        {canEmitirNota && notaAceitaCartaCorrecao(note) && (
                          <button
                            type="button"
                            onClick={() => setNotaDaCartaId(note.id)}
                            className="icon-btn"
                            title={note.cartasCorrecao?.length ? `Carta de correção (${note.cartasCorrecao.length} enviada${note.cartasCorrecao.length > 1 ? 's' : ''})` : 'Carta de correção'}
                            style={{ padding: '6px', borderRadius: '4px', backgroundColor: 'transparent', border: 'none', color: '#8b5cf6', cursor: 'pointer', display: 'inline-flex' }}
                          >
                            <FilePenLine size={18} />
                          </button>
                        )}

                        {/* Cancelar Nota */}
                        {canCancelarNota && note.status === 'authorized' && (
                          <button
                            className="icon-btn"
                            title="Cancelar Nota Fiscal"
                            onClick={() => handleCancel(note)}
                            style={{ padding: '6px', borderRadius: '4px', backgroundColor: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer' }}
                          >
                            <Ban size={16} />
                          </button>
                        )}

                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {filteredInvoices.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', borderTop: '1px solid var(--border-color)', flexWrap: 'wrap', gap: '12px' }}>
            <label style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
              Linhas por página
              <select
                value={pageSize}
                onChange={(event) => setPageSize(Number(event.target.value))}
                style={{ marginLeft: '8px', padding: '6px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button className="icon-btn" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                <ChevronLeft size={18} />
              </button>
              <span style={{ fontSize: '13px' }}>Página {Math.min(page, totalPages)} de {totalPages}</span>
              <button className="icon-btn" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        )}
      </div>

      {devolucaoNfeId && (
        <DevolucaoNfeModal devolucaoId={devolucaoNfeId} onClose={() => setDevolucaoNfeId(null)} />
      )}

      {(() => {
        const notaDaCarta = notaDaCartaId ? invoices.find((n) => n.id === notaDaCartaId) : null;
        return (
          <CartaCorrecaoModal
            aberto={notaDaCarta !== null && notaDaCarta !== undefined}
            notaNumero={notaDaCarta?.number ?? null}
            clienteNome={notaDaCarta?.clienteNome ?? ''}
            cartas={notaDaCarta?.cartasCorrecao ?? []}
            impedimento={notaDaCarta ? motivoQueImpedeCartaNaTela({ tipo: notaDaCarta.tipo, status: notaDaCarta.status, cartasCorrecao: notaDaCarta.cartasCorrecao }) : null}
            onEnviar={(texto) => (notaDaCarta ? enviarCartaCorrecao(notaDaCarta, texto) : Promise.resolve())}
            onBaixar={(eventId, tipo) => (notaDaCarta ? spedyService.openCorrectionFile(notaDaCarta.spedyId, eventId, tipo) : Promise.resolve())}
            onFechar={() => setNotaDaCartaId(null)}
          />
        );
      })()}

      {pdfAberto && (
        <PdfVisualizador titulo={pdfAberto.titulo} nomeArquivo={pdfAberto.nome} pdf={pdfAberto.blob} onFechar={() => setPdfAberto(null)} />
      )}

      <EmissaoProgressoModal
        aberto={progresso !== null}
        tipo={progresso?.tipo ?? 'NF-e'}
        clienteNome={progresso?.clienteNome ?? ''}
        etapa={progresso?.etapa ?? 'validando'}
        desfecho={progresso?.desfecho ?? null}
        numero={progresso?.numero}
        codigo={progresso?.codigo}
        mensagem={progresso?.mensagem}
        erroEnvio={progresso?.erroEnvio}
        segundosEsperando={segundosEsperando}
        abrindoDanfe={abrindoDanfeProgresso}
        onAbrirDanfe={abrirDanfeDoProgresso}
        email={emailNota}
        onReenviarEmail={reenviarEmail}
        onCorrigir={progresso?.notaIdLocal && progresso.tipo !== 'NFS-e' ? corrigirNotaDoProgresso : undefined}
        onFechar={fecharProgresso}
      />

      {/* Modal de Emissão Real de Nota */}
      {loteAberto && (
        <EmissaoLoteModal
          pedidos={pedidosParaLote}
          onFechar={() => { setLoteAberto(false); loadLocalInvoices(false); }}
          executar={executarLote}
          baixarPdf={(spedyId) => spedyService.baixarArquivoFiscal(spedyId, 'product', 'pdf')}
        />
      )}

      {isModalOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
            width: '100%', maxWidth: '850px', maxHeight: '90vh', overflowY: 'auto', padding: '32px',
            border: '1px solid var(--border-color)', boxShadow: '0 20px 40px rgba(0,0,0,0.5)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '20px', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Receipt size={24} color="var(--accent-purple)" />
                Emitir Nota Fiscal (Spedy)
              </h2>
              <button
                type="button"
                onClick={handleCloseModal}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <X size={24} />
              </button>
            </div>

            {/* Modal Tabs Header */}
            <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-color)', marginBottom: '24px' }}>
              <button
                type="button"
                onClick={() => setActiveModalTab('cliente')}
                style={{
                  background: 'none', border: 'none', padding: '8px 16px', cursor: 'pointer',
                  color: activeModalTab === 'cliente' ? 'var(--text-primary)' : 'var(--text-muted)',
                  fontWeight: activeModalTab === 'cliente' ? 600 : 500,
                  borderBottom: activeModalTab === 'cliente' ? '2px solid var(--accent-purple)' : '2px solid transparent',
                  transition: 'all 0.2s'
                }}
              >
                1. Destinatário e Endereço
              </button>
              <button
                type="button"
                onClick={() => setActiveModalTab('produtos')}
                style={{
                  background: 'none', border: 'none', padding: '8px 16px', cursor: 'pointer',
                  color: activeModalTab === 'produtos' ? 'var(--text-primary)' : 'var(--text-muted)',
                  fontWeight: activeModalTab === 'produtos' ? 600 : 500,
                  borderBottom: activeModalTab === 'produtos' ? '2px solid var(--accent-purple)' : '2px solid transparent',
                  transition: 'all 0.2s'
                }}
              >
                2. Detalhamento dos Produtos ({importedPedidoItens.length})
              </button>
            </div>

            <form onSubmit={handleEmitir}>
              {activeModalTab === 'cliente' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px' }}>

                  {/* Importar Pedido de Venda */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', gridColumn: '1 / -1', borderBottom: '1px solid var(--border-color)', paddingBottom: '16px', marginBottom: '8px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--accent-purple)' }}>Importar do Pedido de Venda</label>
                    <select
                      value={importedPedidoId}
                      onChange={(e) => handleSelectPedido(e.target.value)}
                      disabled={!!importedOsId}
                      style={{ padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
                    >
                      <option value="">-- Selecione um pedido finalizado para importar (opcional) --</option>
                      {pedidosVenda.map(p => (
                        <option key={p.id} value={p.id}>
                          Pedido #{p.numeroPedido} - {p.clienteNome} ({new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.valorTotal)})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Importar Ordem de Servico (NFS-e) -- so os servicos, peca fica de fora */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', gridColumn: '1 / -1', borderBottom: '1px solid var(--border-color)', paddingBottom: '16px', marginBottom: '8px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--accent-purple)' }}>Importar da Ordem de Serviço (NFS-e)</label>
                    <select
                      value={importedOsId}
                      onChange={(e) => handleSelectOS(e.target.value)}
                      disabled={!!importedPedidoId || !nfseConfig.habilitada}
                      style={{ padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
                    >
                      <option value="">-- Selecione uma OS finalizada para importar (opcional) --</option>
                      {ordensServico.map(o => (
                        <option key={o.id} value={o.id}>
                          OS #{o.numeroOS} - {o.clienteNome} ({new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(sumServiceInvoiceAmount(o.servicos))})
                        </option>
                      ))}
                    </select>
                    {!nfseConfig.habilitada && (
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>Habilite "Emite NFS-e" em Configurações para liberar esta importação.</p>
                    )}
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>Só os serviços da OS entram nesta nota — peças ficam de fora (precisam de um lançamento à parte).</p>
                  </div>

                  {/* Tipo de Nota */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Tipo de Nota</label>
                    <select
                      value={formData.tipo}
                      disabled
                      style={{ padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', opacity: 0.8 }}
                    >
                      <option value="NF-e">NF-e (Produtos / Peças)</option>
                      <option value="NFS-e">NFS-e (Serviço)</option>
                    </select>
                  </div>

                  {/* Valor Total */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Valor Total (R$) *</label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.valor}
                      onChange={(e) => setFormData({...formData, valor: e.target.value})}
                      required
                      disabled={!!importedPedidoId || !!importedOsId}
                      style={{ padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontWeight: 'bold', opacity: (importedPedidoId || importedOsId) ? 0.7 : 1 }}
                    />
                  </div>

                  {formData.tipo === 'NFS-e' && (
                    <>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Código de Serviço Municipal</label>
                        <input
                          type="text"
                          value={formData.cityServiceCode}
                          onChange={(e) => setFormData({ ...formData, cityServiceCode: e.target.value })}
                          style={{ padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Código de Serviço Federal (LC 116/03)</label>
                        <input
                          type="text"
                          value={formData.federalServiceCode}
                          onChange={(e) => setFormData({ ...formData, federalServiceCode: e.target.value })}
                          style={{ padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Alíquota de ISS (%)</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          value={formData.issRate}
                          onChange={(e) => setFormData({ ...formData, issRate: e.target.value })}
                          style={{ padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
                        />
                      </div>
                    </>
                  )}

                  {/* Cliente Selector (Dropdown Autocomplete) */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', gridColumn: '1 / -1', position: 'relative' }} ref={clientDropdownRef}>
                    <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Destinatário / Cliente *</label>
                    <input
                      type="text"
                      placeholder="Pesquise o cliente cadastrado ou digite..."
                      value={formData.clienteNome}
                      onChange={(e) => {
                        setFormData({...formData, clienteNome: aplicarCaixaAltaCadastro(e.target, e.target.value), clienteId: ''});
                        setIsClientDropdownOpen(true);
                      }}
                      onFocus={() => setIsClientDropdownOpen(true)}
                      required
                      style={{ padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
                    />
                    {isClientDropdownOpen && (
                      <div style={{
                        position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '4px',
                        backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                        borderRadius: 'var(--radius-md)', maxHeight: '180px', overflowY: 'auto',
                        boxShadow: '0 10px 25px rgba(0,0,0,0.5)', zIndex: 1100
                      }}>
                        {clients
                          .filter(c => c.nome.toLowerCase().includes(formData.clienteNome.toLowerCase()))
                          .map(c => (
                            <div
                              key={c.id}
                              onClick={() => {
                                setFormData({
                                  ...formData,
                                  clienteId: c.id,
                                  clienteNome: c.nome,
                                  documento: c.documento,
                                  inscricaoEstadual: c.identidade || '',
                                  email: c.email,
                                  rua: c.endereco || '',
                                  numero: c.numero || '',
                                  bairro: c.bairro || '',
                                  cep: c.cep || '',
                                  cidade: c.cidade || '',
                                  estado: c.estado || '',
                                  codigoIbge: c.codigoIbge || ''
                                });
                                setIsClientDropdownOpen(false);
                              }}
                              style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between' }}
                              onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'}
                              onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              <span style={{ fontWeight: 500, fontSize: '13px' }}>{c.nome}</span>
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{c.documento}</span>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>

                  {/* CPF/CNPJ e Email */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>CPF / CNPJ (Apenas números) *</label>
                    <input
                      type="text"
                      value={formData.documento}
                      onChange={(e) => setFormData({...formData, documento: e.target.value.replace(/\D/g, '')})}
                      required
                      style={{ padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
                    />
                  </div>
                  {formData.tipo === 'NF-e' && formData.documento.replace(/\D/g, '').length === 14 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Inscrição Estadual do destinatário *</label>
                      <input
                        type="text"
                        placeholder='Número da IE, ou "ISENTO"'
                        value={formData.inscricaoEstadual}
                        onChange={(e) => setFormData({ ...formData, inscricaoEstadual: e.target.value })}
                        style={{ padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
                      />
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        Vem do cadastro do cliente (Inscrição Estadual / RG). Para não precisar digitar de novo, corrija lá
                        {formData.clienteId ? (
                          <> e clique em <button type="button" onClick={atualizarDoCadastro} disabled={atualizandoCadastro} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent-primary, #3b82f6)', textDecoration: 'underline', font: 'inherit' }}>atualizar do cadastro</button>.</>
                        ) : '.'}
                      </span>
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>E-mail do Cliente (Envio Automático)</label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({...formData, email: e.target.value})}
                      style={{ padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
                    />
                  </div>

                  {/* Descrição */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', gridColumn: '1 / -1' }}>
                    <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Descrição do Serviço / Produtos *</label>
                    <textarea
                      placeholder="Descrição detalhada para a nota fiscal..."
                      rows={2}
                      value={formData.descricao}
                      onChange={(e) => setFormData({...formData, descricao: e.target.value})}
                      required
                      disabled={!!importedPedidoId}
                      style={{ padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', resize: 'vertical', opacity: importedPedidoId ? 0.7 : 1 }}
                    />
                  </div>

                  {/* Dados de Endereço do Receptor */}
                  <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--border-color)', paddingTop: '16px', marginTop: '8px' }}>
                    <h4 style={{ margin: '0 0 16px 0', fontSize: '14px', color: 'var(--accent-purple)' }}>Endereço do Destinatário</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: '16px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>CEP</label>
                        <input type="text" value={formData.cep} onChange={(e) => setFormData({...formData, cep: e.target.value})} style={{ padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '13px' }} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Logradouro (Rua)</label>
                        <input type="text" value={formData.rua} onChange={(e) => setFormData({...formData, rua: e.target.value})} style={{ padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '13px' }} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Número</label>
                        <input type="text" value={formData.numero} onChange={(e) => setFormData({...formData, numero: e.target.value})} style={{ padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '13px' }} />
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginTop: '12px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Bairro</label>
                        <input type="text" value={formData.bairro} onChange={(e) => setFormData({...formData, bairro: e.target.value})} style={{ padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '13px' }} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Cidade</label>
                        <input type="text" value={formData.cidade} onChange={(e) => setFormData({...formData, cidade: e.target.value})} style={{ padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '13px' }} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>UF / Estado</label>
                        <input type="text" maxLength={2} value={formData.estado} onChange={(e) => setFormData({...formData, estado: e.target.value.toUpperCase()})} style={{ padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '13px' }} />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeModalTab === 'produtos' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
                  {correcaoRejeicao && (
                    <div role="alert" style={{ padding: '12px 14px', borderRadius: 'var(--radius-md)', border: '1px solid rgba(239,68,68,0.5)', backgroundColor: 'rgba(239,68,68,0.08)', fontSize: '13px', color: 'var(--text-primary)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <strong style={{ color: '#ef4444' }}>Nota rejeitada pela SEFAZ</strong>
                      <span>{correcaoRejeicao.mensagem}</span>
                      <span style={{ color: 'var(--text-muted)' }}>
                        {correcaoRejeicao.itemIndice !== null && importedPedidoItens[correcaoRejeicao.itemIndice]
                          ? `O problema está no item ${correcaoRejeicao.itemIndice + 1} (${importedPedidoItens[correcaoRejeicao.itemIndice].nome}), destacado abaixo. `
                          : ''}
                        Corrija aqui na nota (NCM, CEST, CFOP, CSOSN) e transmita. Na transmissão o sistema pergunta se atualiza também o cadastro do produto.
                      </span>
                    </div>
                  )}
                  {referencedAccessKey && (
                    <div style={{ padding: '12px', backgroundColor: 'rgba(139, 92, 246, 0.1)', color: '#a78bfa', borderRadius: 'var(--radius-md)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid rgba(139, 92, 246, 0.2)' }}>
                      <Receipt size={16} />
                      <span><strong>Nota Cuponada ativa:</strong> Referenciando chave do cupom <code>{referencedAccessKey}</code>. Os CFOPs das linhas foram forçados para devolução/cuponada.</span>
                    </div>
                  )}

                  {(importedPedidoItens.length > 0 || formData.clienteId) && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                      <button type="button" className="btn-secondary" onClick={atualizarDoCadastro} disabled={atualizandoCadastro} style={{ padding: '6px 12px', fontSize: '13px' }}>
                        {atualizandoCadastro ? 'Atualizando...' : 'Atualizar dados do cadastro'}
                      </button>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        Corrigiu o NCM, a IE ou o endereço no cadastro? Isto puxa de novo (e apaga o que foi digitado à mão aqui).
                      </span>
                    </div>
                  )}

                  <div style={{ overflowX: 'auto', maxHeight: '400px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontWeight: 600 }}>
                          <th style={{ padding: '10px 8px' }}>Descrição</th>
                          <th style={{ padding: '10px 8px', width: '60px', textAlign: 'center' }}>Qtd</th>
                          <th style={{ padding: '10px 8px', width: '90px', textAlign: 'right' }}>V. Unit</th>
                          <th style={{ padding: '10px 8px', width: '90px', textAlign: 'right' }}>Total</th>
                          <th style={{ padding: '10px 8px', width: '110px' }}>NCM</th>
                          <th style={{ padding: '10px 8px', width: '95px' }}>CEST</th>
                          <th style={{ padding: '10px 8px', width: '80px' }}>CFOP</th>
                          <th style={{ padding: '10px 8px', width: '80px' }}>{usesCsosn(regimeTributario) ? 'CSOSN' : 'CST ICMS'}</th>
                          <th style={{ padding: '10px 8px', width: '140px' }}>Origem</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importedPedidoItens.length === 0 ? (
                          <tr>
                            <td colSpan={9} style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                              Nenhum produto cadastrado nesta nota.
                            </td>
                          </tr>
                        ) : (
                          importedPedidoItens.map((item, idx) => (
                            <tr key={idx} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)', ...(idx === itemComProblema ? { outline: '2px solid #ef4444', outlineOffset: '-2px', backgroundColor: 'rgba(239,68,68,0.08)' } : {}) }}>
                              <td style={{ padding: '8px' }}>
                                <input
                                  type="text"
                                  value={item.nome}
                                  onChange={(e) => handleItemTaxChange(idx, 'nome', e.target.value)}
                                  disabled={!!importedPedidoId}
                                  style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '12px', opacity: importedPedidoId ? 0.7 : 1 }}
                                />
                                {/* O que mais vai na nota, do cadastro do produto (conferencia rapida). */}
                                {importedPedidoId && (
                                  <span style={{ display: 'block', marginTop: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>
                                    {[
                                      item.unidadeMedidaSigla || 'UN (sem unidade no cadastro)',
                                      resolverGtin(item.codigoBarras) === 'SEM GTIN' ? 'SEM GTIN' : `GTIN ${resolverGtin(item.codigoBarras)}`,
                                      percentuaisTributos({ ...item, nome: item.nome }).total > 0
                                        ? `Trib. aprox. ${percentuaisTributos({ ...item, nome: item.nome }).total.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
                                        : 'sem % de tributos (IBPT)',
                                    ].filter(Boolean).join(' · ')}
                                  </span>
                                )}
                              </td>
                              <td style={{ padding: '8px', textAlign: 'center' }}>{item.quantidade}</td>
                              <td style={{ padding: '8px', textAlign: 'right', color: 'var(--text-secondary)' }}>R$ {item.precoUnitario.toFixed(2)}</td>
                              <td style={{ padding: '8px', textAlign: 'right', fontWeight: 600 }}>R$ {(item.valorTotal || (item.quantidade * item.precoUnitario)).toFixed(2)}</td>
                              <td style={{ padding: '8px' }}>
                                <input
                                  type="text"
                                  value={item.ncm || ''}
                                  onChange={(e) => handleItemTaxChange(idx, 'ncm', e.target.value)}
                                  maxLength={8}
                                  placeholder="8 dígitos"
                                  style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '12px' }}
                                />
                              </td>
                              <td style={{ padding: '8px' }}>
                                <input
                                  type="text"
                                  value={item.cest || ''}
                                  onChange={(e) => handleItemTaxChange(idx, 'cest', e.target.value)}
                                  maxLength={7}
                                  placeholder="7 dígitos"
                                  aria-label={`CEST do item ${idx + 1}`}
                                  style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '12px' }}
                                />
                              </td>
                              <td style={{ padding: '8px' }}>
                                <input
                                  type="text"
                                  value={item.cfop || ''}
                                  onChange={(e) => handleItemTaxChange(idx, 'cfop', e.target.value)}
                                  maxLength={4}
                                  style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '12px' }}
                                />
                                {isExportCfop(item.cfop) && (
                                  (() => {
                                    const preview = resolveInvoiceUnitFields({
                                      cfop: item.cfop,
                                      unidadeComercial: item.unidadeMedidaSigla || 'UN',
                                      quantidadeComercial: Number(item.quantidade || 1),
                                      valorUnitarioComercial: Number(item.precoUnitario || 0),
                                      pesoLiquidoUnitarioKg: item.pesoLiquidoUnitarioKg,
                                    });
                                    return (
                                      <span style={{ display: 'block', marginTop: '4px', fontSize: '11px', color: preview.ok ? '#10b981' : '#ef4444' }}>
                                        {preview.ok
                                          ? `Exportação: ${preview.fields!.quantityTax.toFixed(3)} kg`
                                          : 'Peso do produto não configurado'}
                                      </span>
                                    );
                                  })()
                                )}
                              </td>
                              <td style={{ padding: '8px' }}>
                                <input
                                  type="text"
                                  value={item.csosn || ''}
                                  onChange={(e) => handleItemTaxChange(idx, 'csosn', e.target.value)}
                                  maxLength={3}
                                 
                                  style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '12px' }}
                                />
                              </td>
                              <td style={{ padding: '8px' }}>
                                <select
                                  value={item.origem || '0'}
                                  onChange={(e) => handleItemTaxChange(idx, 'origem', e.target.value)}
                                  style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '12px' }}
                                >
                                  <option value="0">0 - Nacional</option>
                                  <option value="1">1 - Estrangeira Importada</option>
                                  <option value="2">2 - Estrangeira Adq. Interno</option>
                                  <option value="3">3 - Nac. Conteúdo Importado</option>
                                  <option value="4">4 - Nac. Processo Básico</option>
                                  <option value="5">5 - Nac. Conteúdo &lt; 40%</option>
                                  <option value="6">6 - Estrangeira Dir. Importada</option>
                                  <option value="7">7 - Estrangeira Mercado Interno</option>
                                  <option value="8">8 - Nac. Conteúdo Importado Est.</option>
                                </select>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '32px' }}>
                <button type="button" className="btn-secondary" onClick={handleCloseModal}>Cancelar</button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={isSubmitting}
                  style={{ backgroundColor: '#10b981', color: 'white', opacity: isSubmitting ? 0.7 : 1 }}
                >
                  {isSubmitting ? 'Transmitindo...' : 'Transmitir Nota'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default NFE;
