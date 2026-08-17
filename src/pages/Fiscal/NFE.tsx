import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Receipt, Plus, Search, CheckCircle,
  XCircle, AlertCircle, Eye, Download, RefreshCw, X, Ban, Settings, Trash2,
  ChevronLeft, ChevronRight, MessageCircle
} from 'lucide-react';
import { collection, query, where, getDocs, onSnapshot, addDoc, updateDoc, deleteDoc, doc, getDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { spedyService } from '../../services/spedyService';
import type { SpedyInvoice } from '../../services/spedyService';
import { showSuccess, showError, NexusSwal } from '../../utils/alerts';
import { isPlatformAdminRole } from '../../utils/roles';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import {
  DEFAULT_REGIME_TRIBUTARIO, buildTaxesPayload, buildServiceInvoicePayload,
  buildServiceInvoiceDescription, sumServiceInvoiceAmount,
  type RegimeTributario, type NfseConfig, type OsServicoParaFatura, type ClienteParaFatura,
} from '../../utils/fiscalDomain';
import Swal from 'sweetalert2';

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
}

interface ClienteOption {
  id: string;
  nome: string;
  documento: string;
  email: string;
  endereco?: string;
  numero?: string;
  bairro?: string;
  cep?: string;
  cidade?: string;
  estado?: string;
  codigoIbge?: string;
  telefone?: string;
}

interface PedidoVendaItem {
  id: string;
  nome: string;
  quantidade: number;
  precoUnitario: number;
  desconto: number;
  valorTotal: number;
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
}

interface PedidoVenda {
  id: string;
  numeroPedido: string;
  clienteNome: string;
  valorTotal: number;
  itens: PedidoVendaItem[];
  formaPagamento: string;
  createdAt?: unknown;
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
  const { currentUser, tenantId, userRole, userPermissions, isOwner } = useAuth();

  const canDeleteInvoice = isOwner || isPlatformAdminRole(userRole) || (userPermissions && userPermissions.includes('fiscal.excluir'));
  const canEmitirNota = isOwner || isPlatformAdminRole(userRole) || (userPermissions && userPermissions.includes('fiscal.emitir'));
  const canCancelarNota = isOwner || isPlatformAdminRole(userRole) || (userPermissions && userPermissions.includes('fiscal.excluir'));

  // Configurações
  const [config, setConfig] = useState<FiscalConfig | null>(null);
  const [isConfigLoading, setIsConfigLoading] = useState(true);
  const [regimeTributario, setRegimeTributario] = useState<RegimeTributario>(DEFAULT_REGIME_TRIBUTARIO);
  const [nfseConfig, setNfseConfig] = useState<NfseConfig>({ habilitada: false });

  // Estado de dados
  const [invoices, setInvoices] = useState<LocalInvoice[]>([]);
  const [clients, setClients] = useState<ClienteOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTab, setSelectedTab] = useState<'Todas' | 'NFC-e' | 'NF-e' | 'NFS-e'>('Todas');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // Modal de Emissão
  const [isModalOpen, setIsModalOpen] = useState(false);
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
  const [importedPedidoItens, setImportedPedidoItens] = useState<PedidoVendaItem[]>([]);
  const [importedPedidoId, setImportedPedidoId] = useState<string>('');

  // Importação de Ordens de Serviço (NFS-e) -- so servicos, nunca pecas
  const [ordensServico, setOrdensServico] = useState<OrdemServicoParaImportar[]>([]);
  const [importedOsServicos, setImportedOsServicos] = useState<OsServicoParaFatura[]>([]);
  const [importedOsId, setImportedOsId] = useState<string>('');

  // Estados adicionados para a aba de produtos e Nota Cuponada
  const [activeModalTab, setActiveModalTab] = useState<'cliente' | 'produtos'>('cliente');
  const [referencedAccessKey, setReferencedAccessKey] = useState<string>('');
  const [retransmittingInvoiceId, setRetransmittingInvoiceId] = useState<string | null>(null);

  // Volta pra primeira página sempre que o filtro/busca/aba mudar
  useEffect(() => { setPage(1); }, [searchTerm, selectedTab]);

  // Limpa estados temporários ao fechar o modal
  const handleCloseModal = () => {
    setIsModalOpen(false);
    setRetransmittingInvoiceId(null);
    pendingIntegrationIdRef.current = null;
  };

  const [formData, setFormData] = useState({
    tipo: 'NF-e',
    clienteId: '',
    clienteNome: '',
    documento: '',
    email: '',
    valor: '',
    descricao: '',
    // Endereço
    cep: '01001-000',
    rua: 'Rua Principal',
    numero: '123',
    bairro: 'Centro',
    cidade: 'São Paulo',
    estado: 'SP',
    codigoIbge: '3550308',
    // Específico NFS-e
    federalServiceCode: '',
    cityServiceCode: '',
    issRate: '0',
    // Específico NF-e
    ncm: '87082999', // Peças de veículos
    cfop: '5102', // Venda
    csosn: '400' // Simples Nacional Isento
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

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
            email: dData.email || '',
            endereco: dData.endereco || '',
            numero: dData.numero || '',
            bairro: dData.bairro || '',
            cep: dData.cep || '',
            cidade: dData.cidade || '',
            estado: dData.estado || '',
            codigoIbge: dData.codigoIbge || '',
            telefone: dData.telefone || ''
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
          pedidosList.push({
            id: d.id,
            numeroPedido: dData.numeroPedido || '',
            clienteNome: dData.clienteNome || '',
            valorTotal: dData.valorTotal || 0,
            itens: dData.itens || [],
            formaPagamento: dData.formaPagamento || '',
            createdAt: dData.createdAt
          });
        });
        pedidosList.sort((a, b) => {
          const numA = Number(a.numeroPedido) || 0;
          const numB = Number(b.numeroPedido) || 0;
          return numB - numA;
        });
        setPedidosVenda(pedidosList);

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
  }, [tenantId]);

  // Sincroniza campos avulsos/manuais com importedPedidoItens quando não há pedido nem OS selecionado
  useEffect(() => {
    if (!importedPedidoId && !importedOsId && isModalOpen) {
      const timer = setTimeout(() => {
        setImportedPedidoItens(prev => {
          const currentAvulso = prev[0];
          const newNome = formData.descricao || 'Manual NF-e Item';
          const newPreco = Number(formData.valor) || 0;
          const newNcm = formData.ncm || '87082999';
          const newCfop = formData.cfop || '5102';
          const newCsosn = formData.csosn || '400';

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
            const pData = docSnap.data();
            mapped.push({
              ...item,
              ncm: pData.ncm || '87082999',
              cfop: pData.cfop || '5102',
              csosn: pData.csosn || '400',
              origem: pData.origem || '0',
              aliquotaIcms: Number(pData.aliquotaIcms || 0),
              reducaoBaseIcms: Number(pData.reducaoBaseIcms || 0),
              cstPis: pData.cstPis || '',
              aliquotaPis: Number(pData.aliquotaPis || 0),
              cstCofins: pData.cstCofins || '',
              aliquotaCofins: Number(pData.aliquotaCofins || 0),
              cstIpi: pData.cstIpi || '',
              aliquotaIpi: Number(pData.aliquotaIpi || 0),
              cstIbs: pData.cstIbs || '',
              aliquotaIbs: Number(pData.aliquotaIbs || 0),
              cstCbs: pData.cstCbs || '',
              aliquotaCbs: Number(pData.aliquotaCbs || 0)
            });
            continue;
          }
        } catch (err) {
          console.error(`Erro ao carregar dados fiscais do produto ${item.id}`, err);
        }
      }
      mapped.push({
        ...item,
        ncm: '87082999',
        cfop: '5102',
        csosn: '400',
        origem: '0'
      });
    }
    return mapped;
  };

  // Ação ao selecionar pedido para importação
  const handleSelectPedido = async (pedidoId: string) => {
    setImportedPedidoId(pedidoId);
    // Mutuamente exclusivo com a importação de OS -- importar um pedido
    // sempre desfaz uma OS importada antes.
    setImportedOsId('');
    setImportedOsServicos([]);
    if (!pedidoId) {
      setImportedPedidoItens([]);
      setReferencedAccessKey('');
      setFormData(prev => ({
        ...prev,
        tipo: 'NF-e',
        clienteId: '',
        clienteNome: '',
        documento: '',
        email: '',
        valor: '',
        descricao: '',
        cep: '01001-000',
        rua: 'Rua Principal',
        numero: '123',
        bairro: 'Centro',
        cidade: 'São Paulo',
        estado: 'SP',
        codigoIbge: '3550308',
      }));
      return;
    }

    const pedido = pedidosVenda.find(p => p.id === pedidoId);
    if (!pedido) return;

    NexusSwal.fire({
      title: 'Importando Pedido...',
      text: 'Buscando informações fiscais dos produtos...',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    try {
      let itemsWithTaxes = await fetchPedidoItensTaxes(pedido.itens);

      const foundClient = clients.find(c => c.nome.toUpperCase() === pedido.clienteNome.toUpperCase());
      const descItens = pedido.itens.map((it: PedidoVendaItem) => `${it.quantidade}x ${it.nome}`).join(', ');

      // Procura cupom fiscal (NFC-e) associado a este pedido que esteja autorizado
      const cupom = invoices.find(inv => inv.pedidoId === pedidoId && inv.tipo === 'NFC-e' && inv.status === 'authorized');

      let companyState = 'SP';
      try {
        const confRef = doc(db, 'configuracoes', tenantId || '');
        const confSnap = await getDoc(confRef);
        if (confSnap.exists()) {
          const addr = confSnap.data().endereco || '';
          const match = addr.match(/(?:^|\s|-|\/)([A-Z]{2})(?:\s|$)/i);
          if (match) companyState = match[1].toUpperCase();
        }
      } catch (err) {
        console.warn("Erro ao buscar estado da oficina:", err);
      }

      const clientState = foundClient?.estado || 'SP';
      const cfopForced = clientState.toUpperCase() === companyState.toUpperCase() ? '5929' : '6929';

      if (cupom) {
        setReferencedAccessKey(cupom.accessKey || '');
        itemsWithTaxes = itemsWithTaxes.map(item => ({
          ...item,
          cfop: cfopForced
        }));
      } else {
        setReferencedAccessKey('');
      }

      setImportedPedidoItens(itemsWithTaxes);

      setFormData(prev => ({
        ...prev,
        tipo: 'NF-e',
        clienteId: foundClient?.id || '',
        clienteNome: pedido.clienteNome,
        documento: foundClient?.documento || '',
        email: foundClient?.email || '',
        valor: String(pedido.valorTotal),
        descricao: cupom
          ? `Lançamento de NF-e decorrente do Cupom Fiscal ref. Pedido #${pedido.numeroPedido}`
          : `Venda Ref. Pedido #${pedido.numeroPedido} - Itens: ${descItens}`,
        cep: foundClient?.cep || prev.cep,
        rua: foundClient?.endereco || prev.rua,
        numero: foundClient?.numero || prev.numero,
        bairro: foundClient?.bairro || prev.bairro,
        cidade: foundClient?.cidade || prev.cidade,
        estado: foundClient?.estado || prev.estado,
        codigoIbge: foundClient?.codigoIbge || prev.codigoIbge,
      }));

      Swal.close();
    } catch (err) {
      console.error("Erro ao carregar dados do pedido:", err);
      Swal.close();
      showError('Erro ao importar', 'Não foi possível carregar os dados fiscais dos produtos.');
    }
  };

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
        email: '',
        valor: '',
        descricao: '',
        cep: '01001-000',
        rua: 'Rua Principal',
        numero: '123',
        bairro: 'Centro',
        cidade: 'São Paulo',
        estado: 'SP',
        codigoIbge: '3550308',
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
      email: foundClient?.email || '',
      valor: String(sumServiceInvoiceAmount(os.servicos)),
      descricao: buildServiceInvoiceDescription(os.servicos) || `Serviços Ref. OS #${os.numeroOS}`,
      federalServiceCode: nfseConfig.codigoServicoFederal || prev.federalServiceCode,
      cityServiceCode: nfseConfig.codigoServicoMunicipal || prev.cityServiceCode,
      issRate: nfseConfig.aliquotaIssPadrao !== undefined ? String(nfseConfig.aliquotaIssPadrao) : prev.issRate,
      cep: foundClient?.cep || prev.cep,
      rua: foundClient?.endereco || prev.rua,
      numero: foundClient?.numero || prev.numero,
      bairro: foundClient?.bairro || prev.bairro,
      cidade: foundClient?.cidade || prev.cidade,
      estado: foundClient?.estado || prev.estado,
      codigoIbge: foundClient?.codigoIbge || prev.codigoIbge,
    }));
  };

  // Sincroniza notas pendentes com a Spedy
  const syncPendingInvoices = useCallback(async (pendingNotes: LocalInvoice[]) => {
    if (!config?.spedyApiKey) return;
    setSyncing(true);

    for (const note of pendingNotes) {
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
          clienteId: data.clienteId || null
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
          clienteId: data.clienteId || null
        });
      });
      list.sort((a, b) => b.id.localeCompare(a.id));
      setInvoices(list);
    }, (err) => {
      console.error('Erro ao observar notas fiscais em tempo real:', err);
    });
    return () => unsubscribe();
  }, [tenantId]);

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
  const handleCancel = async (note: LocalInvoice) => {
    if (!currentUser) return;
    const { value: justification } = await NexusSwal.fire({
      title: 'Cancelar Nota Fiscal',
      input: 'textarea',
      inputLabel: 'Justificativa de Cancelamento (Mínimo de 15 caracteres)',
      inputPlaceholder: 'Escreva o motivo real do cancelamento...',
      showCancelButton: true,
      confirmButtonText: 'Confirmar Cancelamento',
      cancelButtonText: 'Voltar',
      confirmButtonColor: '#ef4444',
      inputValidator: (value) => {
        if (!value || value.trim().length < 15) {
          return 'A justificativa deve conter no mínimo 15 caracteres!';
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
        showSuccess('Cancelamento solicitado com sucesso!');
        loadLocalInvoices(false);
      } catch (err) {
        Swal.close();
        showError('Erro ao cancelar', (err as Error).message || 'Erro ao cancelar a nota.');
      }
    }
  };

  const handleDeleteInvoice = async (note: LocalInvoice) => {
    const confirm = await NexusSwal.fire({
      title: 'Excluir Nota do Sistema?',
      text: 'Isso removerá o registro local da nota fiscal do banco de dados do ERP. Essa ação NÃO cancela a nota na SEFAZ. Tem certeza?',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sim, excluir',
      cancelButtonText: 'Cancelar'
    });

    if (confirm.isConfirmed) {
      try {
        await deleteDoc(doc(db, 'notas_fiscais', note.id));
        showSuccess('Nota excluída do sistema!');
        try {
          const { createAuditLog } = await import('../../services/logService');
          createAuditLog({
            tenantId: tenantId || '',
            usuarioId: currentUser?.uid || '',
            usuarioEmail: currentUser?.email || '',
            modulo: 'fiscal',
            acao: 'exclusao',
            descricao: `Nota Fiscal #${note.number || note.spedyId.substring(0, 6)} (${note.tipo}) excluída do registro local. Valor: R$ ${note.valor.toFixed(2)}.`,
            registroRelacionadoId: note.id,
            status: 'sucesso',
            critical: true
          });
        } catch {
          // ignore audit log error
        }
        loadLocalInvoices(false);
      } catch {
        showError('Erro', 'Não foi possível excluir o registro da nota.');
      }
    }
  };

  // Emissão de nova nota
  const handleEmitir = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config?.spedyApiKey || !tenantId || !currentUser) return;

    if (!formData.clienteNome || !formData.documento || !formData.valor || !formData.descricao) {
      showError('Campos Incompletos', 'Preencha Nome do Cliente, Documento, Descrição e Valor.');
      return;
    }

    setIsSubmitting(true);

    try {
      // Procura se já existe uma nota rejeitada para este pedido e tipo --
      // reenvio manual (retransmissão) ou reenvio automático de uma nota
      // já rejeitada reaproveitam o id dela como integrationId da Spedy
      // (mesma operação lógica, garante idempotência). Sem nenhum dos
      // dois, cai no id gerado uma vez por sessão do modal (ver
      // pendingIntegrationIdRef acima).
      const existingRejectedNote = importedPedidoId
        ? invoices.find(inv => inv.pedidoId === importedPedidoId && inv.tipo === formData.tipo && (inv.status === 'rejected' || inv.status === 'denied'))
        : null;
      const targetInvoiceId = retransmittingInvoiceId || existingRejectedNote?.id || null;
      if (!targetInvoiceId && !pendingIntegrationIdRef.current) {
        pendingIntegrationIdRef.current = crypto.randomUUID();
      }
      const integrationId = targetInvoiceId || pendingIntegrationIdRef.current!;

      const cleanDoc = formData.documento.replace(/\D/g, '');
      const cleanCep = formData.cep.replace(/\D/g, '');
      const valorNumerico = Number(formData.valor);

      let spedyNote: SpedyInvoice;

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

        spedyNote = await spedyService.emitServiceInvoice(config.spedyApiKey, config.spedyEnvironment, payload as unknown as Record<string, unknown>);

      } else {
        const itemsPayload = importedPedidoId && importedPedidoItens.length > 0
          ? importedPedidoItens.map((item, index) => {
              const itemTotal = Number(item.valorTotal || (item.quantidade * item.precoUnitario) || 0);
              const unitAmount = Number(item.precoUnitario || 0);
              return {
                code: item.id || `PROD-${index}`,
                description: item.nome,
                ncm: item.ncm || '87082999',
                cfop: Number(item.cfop || '5102'),
                unit: 'UN',
                quantity: Number(item.quantidade || 1),
                unitAmount: unitAmount,
                totalAmount: itemTotal,
                unitTax: 'UN',
                quantityTax: Number(item.quantidade || 1),
                unitTaxAmount: unitAmount,
                makeupTotal: true,
                // Regime Simples Nacional mantem o payload minimo (so
                // csosn/origem, sem base/aliquota -- ja funcionava assim);
                // Presumido/Real usam CST real com base/aliquota efetivas
                // do produto (ver fiscalDomain.ts, formato confirmado na
                // documentacao da Spedy).
                taxes: buildTaxesPayload(item, regimeTributario, itemTotal)
              };
            })
          : [
              {
                code: 'PROD-FISCAL',
                description: formData.descricao,
                ncm: formData.ncm,
                cfop: Number(formData.cfop),
                unit: 'UN',
                quantity: 1,
                unitAmount: valorNumerico,
                totalAmount: valorNumerico,
                unitTax: 'UN',
                quantityTax: 1,
                unitTaxAmount: valorNumerico,
                makeupTotal: true,
                // Lançamento avulso (sem pedido importado) -- o modal so
                // coleta NCM/CFOP/CSOSN manualmente, sem CST/aliquota real
                // de ICMS/PIS/COFINS por item. Mantido no formato minimo
                // de Simples Nacional mesmo pra tenants Presumido/Real;
                // pra emissao fiel ao regime, importar de um Pedido de
                // Venda (produto ja traz os dados reais, ver acima).
                taxes: {
                  icms: {
                    origin: 0,
                    csosn: Number(formData.csosn)
                  },
                  pis: { cst: 7 },
                  cofins: { cst: 7 }
                }
              }
            ];

        let companyState = 'SP';
        try {
          const confRef = doc(db, 'configuracoes', tenantId || '');
          const confSnap = await getDoc(confRef);
          if (confSnap.exists()) {
            const addr = confSnap.data().endereco || '';
            const match = addr.match(/(?:^|\s|-|\/)([A-Z]{2})(?:\s|$)/i);
            if (match) companyState = match[1].toUpperCase();
          }
        } catch (err) {
          console.warn("Erro ao buscar estado da oficina:", err);
        }

        const clientState = formData.estado || 'SP';
        const destination = clientState.toUpperCase() === companyState.toUpperCase() ? 'internal' : 'interstate';

        const payload = {
          integrationId,
          isFinalCustomer: true,
          operationType: 'outgoing',
          destination: destination,
          presenceType: 'presence',
          operationNature: referencedAccessKey ? 'Lançamento decorrente de Cupom Fiscal' : 'Venda de Mercadoria',
          sendEmailToCustomer: !!formData.email,
          receiver: {
            name: formData.clienteNome,
            federalTaxNumber: cleanDoc,
            email: formData.email || undefined,
            address: {
              street: formData.rua,
              number: formData.numero,
              district: formData.bairro,
              postalCode: cleanCep,
              city: {
                code: formData.codigoIbge,
                name: formData.cidade,
                state: formData.estado
              }
            }
          },
          items: itemsPayload,
          payments: [
            {
              method: 'other',
              amount: valorNumerico
            }
          ],
          total: {
            invoiceAmount: valorNumerico,
            productAmount: valorNumerico
          },
          ...(referencedAccessKey ? {
            refNFe: referencedAccessKey,
            referencedAccessKey: referencedAccessKey,
            referencedInvoices: [{ accessKey: referencedAccessKey }]
          } : {})
        };

        spedyNote = await spedyService.emitProductInvoice(config.spedyApiKey, config.spedyEnvironment, payload);
      }

      if (targetInvoiceId) {
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
          status: spedyNote.status,
          processingMessage: spedyNote.processingDetail?.message || null,
          processingCode: spedyNote.processingDetail?.code || null,
          updatedAt: serverTimestamp(),
          data: new Date().toISOString(),
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Retransmitida na Spedy'),
        });
      } else {
        // Salva nova referência local no Firestore
        await addDoc(collection(db, 'notas_fiscais'), {
          spedyId: spedyNote.id,
          number: spedyNote.number,
          accessKey: spedyNote.accessKey || null,
          pedidoId: importedPedidoId || null,
          osId: importedOsId || null,
          tipo: formData.tipo,
          clienteNome: formData.clienteNome,
          clienteId: formData.clienteId || null,
          valor: valorNumerico,
          status: spedyNote.status,
          processingMessage: spedyNote.processingDetail?.message || null,
          processingCode: spedyNote.processingDetail?.code || null,
          tenantId,
          ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
          createdAt: serverTimestamp(),
          data: new Date().toISOString()
        });
      }

      handleCloseModal();
      showSuccess('Nota enviada para processamento com sucesso!');

      // Reseta form basico
      setFormData(prev => ({
        ...prev,
        clienteId: '',
        clienteNome: '',
        documento: '',
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
      showError('Erro ao emitir', (err as Error).message || 'Houve um problema ao enviar a nota.');
    } finally {
      setIsSubmitting(false);
    }
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
    setRetransmittingInvoiceId(note.id);
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
            onClick={() => NexusSwal.fire('Detalhes da Rejeição', `Código: ${note.processingCode || 'N/A'}\n\nMensagem: ${note.processingMessage || 'Motivo desconhecido.'}`, 'error')}
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
    const matchesSearch =
      note.clienteNome.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (note.number ? String(note.number).includes(searchTerm) : false) ||
      note.status.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesTab = selectedTab === 'Todas' || note.tipo === selectedTab;

    return matchesSearch && matchesTab;
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
          <button
            className="btn-secondary"
            onClick={handleManualSyncAll}
            disabled={syncing}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: syncing ? 0.7 : 1 }}
          >
            <RefreshCw size={18} className={syncing ? 'spin-icon' : ''} />
            {syncing ? 'Sincronizando...' : 'Sincronizar Notas'}
          </button>
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

          {/* Busca */}
          <div className="search-box" style={{ position: 'relative', width: '300px' }}>
            <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Buscar por cliente ou número..."
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
                <th style={{ padding: '16px' }}>Nº Nota</th>
                <th style={{ padding: '16px' }}>Tipo</th>
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
                  <td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    Carregando notas fiscais...
                  </td>
                </tr>
              ) : filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
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
                    </td>
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

                        {/* Retransmitir / Corrigir Nota Rejeitada */}
                        {canEmitirNota && (note.status === 'rejected' || note.status === 'denied') && (
                          <button
                            className="icon-btn"
                            title="Corrigir e Transmitir Novamente"
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
                            onClick={() => spedyService.openFiscalFile(
                              note.spedyId,
                              note.tipo === 'NFS-e' ? 'service' : note.tipo === 'NFC-e' ? 'consumer' : 'product',
                              'pdf'
                            ).catch(err => showError('Erro ao abrir PDF', (err as Error).message))}
                            className="icon-btn"
                            title="Visualizar PDF (DANFE)"
                            style={{ padding: '6px', borderRadius: '4px', backgroundColor: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'inline-flex' }}
                          >
                            <Eye size={18} />
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
                              'xml'
                            ).catch(err => showError('Erro ao baixar XML', (err as Error).message))}
                            className="icon-btn"
                            title="Baixar XML"
                            style={{ padding: '6px', borderRadius: '4px', backgroundColor: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'inline-flex' }}
                          >
                            <Download size={18} />
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

                        {/* Excluir Registro da Nota */}
                        {canDeleteInvoice && (
                          <button
                            className="icon-btn"
                            title="Excluir Nota Fiscal"
                            onClick={() => handleDeleteInvoice(note)}
                            style={{ padding: '6px', borderRadius: '4px', backgroundColor: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer' }}
                          >
                            <Trash2 size={16} />
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

      {/* Modal de Emissão Real de Nota */}
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
                      placeholder="0,00"
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
                        setFormData({...formData, clienteNome: e.target.value, clienteId: ''});
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
                                  email: c.email,
                                  rua: c.endereco || formData.rua,
                                  numero: c.numero || formData.numero,
                                  bairro: c.bairro || formData.bairro,
                                  cep: c.cep || formData.cep,
                                  cidade: c.cidade || formData.cidade,
                                  estado: c.estado || formData.estado,
                                  codigoIbge: c.codigoIbge || formData.codigoIbge
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
                      placeholder="Ex: 12345678909"
                      value={formData.documento}
                      onChange={(e) => setFormData({...formData, documento: e.target.value.replace(/\D/g, '')})}
                      required
                      style={{ padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>E-mail do Cliente (Envio Automático)</label>
                    <input
                      type="email"
                      placeholder="cliente@email.com"
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
                  {referencedAccessKey && (
                    <div style={{ padding: '12px', backgroundColor: 'rgba(139, 92, 246, 0.1)', color: '#a78bfa', borderRadius: 'var(--radius-md)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid rgba(139, 92, 246, 0.2)' }}>
                      <Receipt size={16} />
                      <span><strong>Nota Cuponada ativa:</strong> Referenciando chave do cupom <code>{referencedAccessKey}</code>. Os CFOPs das linhas foram forçados para devolução/cuponada.</span>
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
                          <th style={{ padding: '10px 8px', width: '80px' }}>CFOP</th>
                          <th style={{ padding: '10px 8px', width: '80px' }}>CSOSN</th>
                          <th style={{ padding: '10px 8px', width: '140px' }}>Origem</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importedPedidoItens.length === 0 ? (
                          <tr>
                            <td colSpan={8} style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                              Nenhum produto cadastrado nesta nota.
                            </td>
                          </tr>
                        ) : (
                          importedPedidoItens.map((item, idx) => (
                            <tr key={idx} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                              <td style={{ padding: '8px' }}>
                                <input
                                  type="text"
                                  value={item.nome}
                                  onChange={(e) => handleItemTaxChange(idx, 'nome', e.target.value)}
                                  disabled={!!importedPedidoId}
                                  style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '12px', opacity: importedPedidoId ? 0.7 : 1 }}
                                />
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
                                  placeholder="87082999"
                                  style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '12px' }}
                                />
                              </td>
                              <td style={{ padding: '8px' }}>
                                <input
                                  type="text"
                                  value={item.cfop || ''}
                                  onChange={(e) => handleItemTaxChange(idx, 'cfop', e.target.value)}
                                  maxLength={4}
                                  placeholder="5102"
                                  style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '12px' }}
                                />
                              </td>
                              <td style={{ padding: '8px' }}>
                                <input
                                  type="text"
                                  value={item.csosn || ''}
                                  onChange={(e) => handleItemTaxChange(idx, 'csosn', e.target.value)}
                                  maxLength={3}
                                  placeholder="400"
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
