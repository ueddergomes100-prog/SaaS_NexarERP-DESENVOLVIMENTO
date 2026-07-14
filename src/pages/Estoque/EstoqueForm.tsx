import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, Package, DollarSign, Loader2 } from 'lucide-react';
import { collection, addDoc, updateDoc, doc, getDoc, getDocs, getCountFromServer, serverTimestamp, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError } from '../../utils/alerts';
import { isPlatformAdminRole } from '../../utils/roles';
import './Estoque.css';

interface UnidadeMedida {
  id: string;
  sigla: string;
  nome: string;
  casasDecimais: number;
  permiteFracionado: boolean;
}

type TabId = 'geral' | 'precos' | 'estoque' | 'fiscal' | 'compras' | 'atacado' | 'ecommerce' | 'avancado';

interface AtacadoFaixa {
  id: string;
  quantidadeInicial: string;
  quantidadeFinal: string;
  preco: string;
  ilimitado: boolean;
}

interface HistoricoPreco {
  precoAnterior: number;
  precoNovo: number;
  custoAnterior: number;
  custoNovo: number;
  alteradoEm: string;
  usuarioId?: string;
}

interface ProdutoOriginalData {
  precoVenda?: number;
  precoCusto?: number;
  ultimaAlteracaoPreco?: string | null;
}

interface ProdutoFormData {
  codigo: string;
  codigoAutomatico: boolean;
  nome: string;
  categoria: string;
  statusAtivo: boolean;
  quantidade: string;
  estoqueMinimo: string;
  estoqueMaximo: string;
  precoCusto: string;
  precoVenda: string;
  precoPromocional: string;
  comissaoPercentual: string;
  descontoMaximoPercentual: string;
  fornecedor: string;
  unidadeMedidaId: string;
  codigoBarras: string;
  marca: string;
  referencia: string;
  descricaoCurta: string;
  descricaoCompleta: string;
  observacoesInternas: string;
  imagemProduto: string;
  tags: string;
  controlarEstoque: boolean;
  localizacaoEstoque: string;
  permitirEstoqueNegativo: boolean;
  reservarEstoqueOrcamento: boolean;
  produtoFracionado: boolean;
  peso: string;
  altura: string;
  largura: string;
  comprimento: string;
  ncm: string;
  cfop: string;
  csosn: string;
  origem: string;
  perfilFiscal: string;
  cest: string;
  cstPis: string;
  cstCofins: string;
  aliquotaIcms: string;
  aliquotaPis: string;
  aliquotaCofins: string;
  reducaoBaseIcms: string;
  icmsSt: boolean;
  codigoAnp: string;
  beneficioFiscal: string;
  codigoProdutoFornecedor: string;
  ultimoCusto: string;
  dataUltimaCompra: string;
  leadTime: string;
  quantidadeMinimaCompra: string;
  ativarAtacado: boolean;
  quantidadeMinimaAtacado: string;
  skuSistema: string;
  slugUrl: string;
  pesoEnvio: string;
  seoTitulo: string;
  seoDescricao: string;
  descricaoMarketplace: string;
  imagensMarketplace: string;
  produzidoInternamente: boolean;
  produtoServico: boolean;
  produtoRevenda: boolean;
  bloquearVendaSemEstoque: boolean;
  exigirSerialLote: boolean;
  validade: string;
  controlarLote: boolean;
  permitirCashback: boolean;
  produtoDestaque: boolean;
  impedirVendaAbaixoCusto: boolean;
  autosaveOpcional: boolean;
}

const tabs: Array<{ id: TabId; label: string }> = [
  { id: 'geral', label: 'Geral' },
  { id: 'precos', label: 'Preços e Custos' },
  { id: 'estoque', label: 'Estoque' },
  { id: 'fiscal', label: 'Fiscal (Tributação)' },
  { id: 'compras', label: 'Compras' },
  { id: 'atacado', label: 'Atacado' },
  { id: 'ecommerce', label: 'E-commerce' },
  { id: 'avancado', label: 'Configurações Avançadas' }
];

const fiscalProfiles = {
  revenda_simples: {
    label: 'Revenda Simples Nacional',
    cfop: '5102',
    csosn: '102',
    origem: '0',
    icmsSt: false,
    cest: ''
  },
  produto_st: {
    label: 'Produto com ST',
    cfop: '5405',
    csosn: '500',
    origem: '0',
    icmsSt: true,
    cest: ''
  },
  servico: {
    label: 'Serviço',
    cfop: '5933',
    csosn: '400',
    origem: '0',
    icmsSt: false,
    cest: ''
  }
};

const cfopOptions = [
  { value: '5102', label: '5102 - Venda de mercadoria adquirida ou recebida de terceiros' },
  { value: '5405', label: '5405 - Venda de mercadoria sujeita a substituição tributária' },
  { value: '6102', label: '6102 - Venda interestadual de mercadoria adquirida de terceiros' },
  { value: '6404', label: '6404 - Venda interestadual com substituição tributária' },
  { value: '5933', label: '5933 - Prestação de serviço tributado pelo ISSQN' }
];

const csosnOptions = [
  { value: '101', label: '101 - Tributada pelo Simples Nacional com crédito' },
  { value: '102', label: '102 - Tributada pelo Simples Nacional sem crédito' },
  { value: '103', label: '103 - Isenção por faixa de receita bruta' },
  { value: '201', label: '201 - Simples Nacional com ST e crédito' },
  { value: '202', label: '202 - Simples Nacional com ST sem crédito' },
  { value: '400', label: '400 - Não tributada pelo Simples Nacional' },
  { value: '500', label: '500 - ICMS cobrado anteriormente por ST' },
  { value: '900', label: '900 - Outros' }
];

const origemOptions = [
  { value: '0', label: '0 - Nacional' },
  { value: '1', label: '1 - Estrangeira, importação direta' },
  { value: '2', label: '2 - Estrangeira, adquirida no mercado interno' },
  { value: '3', label: '3 - Nacional com conteúdo importado superior a 40%' },
  { value: '4', label: '4 - Nacional conforme processos produtivos básicos' },
  { value: '5', label: '5 - Nacional com conteúdo importado inferior ou igual a 40%' },
  { value: '8', label: '8 - Nacional com conteúdo importado superior a 70%' }
];

const cstOptions = [
  { value: '', label: 'Selecione...' },
  { value: '01', label: '01 - Operação tributável com alíquota básica' },
  { value: '04', label: '04 - Operação tributável monofásica' },
  { value: '06', label: '06 - Operação tributável alíquota zero' },
  { value: '07', label: '07 - Operação isenta' },
  { value: '49', label: '49 - Outras operações de saída' }
];

const emptyFormData: ProdutoFormData = {
  codigo: '',
  codigoAutomatico: true,
  nome: '',
  categoria: '',
  statusAtivo: true,
  quantidade: '',
  estoqueMinimo: '',
  estoqueMaximo: '',
  precoCusto: '',
  precoVenda: '',
  precoPromocional: '',
  comissaoPercentual: '',
  descontoMaximoPercentual: '',
  fornecedor: '',
  unidadeMedidaId: 'un',
  codigoBarras: '',
  marca: '',
  referencia: '',
  descricaoCurta: '',
  descricaoCompleta: '',
  observacoesInternas: '',
  imagemProduto: '',
  tags: '',
  controlarEstoque: true,
  localizacaoEstoque: '',
  permitirEstoqueNegativo: false,
  reservarEstoqueOrcamento: true,
  produtoFracionado: false,
  peso: '',
  altura: '',
  largura: '',
  comprimento: '',
  ncm: '',
  cfop: '5102',
  csosn: '400',
  origem: '0',
  perfilFiscal: '',
  cest: '',
  cstPis: '',
  cstCofins: '',
  aliquotaIcms: '',
  aliquotaPis: '',
  aliquotaCofins: '',
  reducaoBaseIcms: '',
  icmsSt: false,
  codigoAnp: '',
  beneficioFiscal: '',
  codigoProdutoFornecedor: '',
  ultimoCusto: '',
  dataUltimaCompra: '',
  leadTime: '',
  quantidadeMinimaCompra: '',
  ativarAtacado: false,
  quantidadeMinimaAtacado: '',
  skuSistema: '',
  slugUrl: '',
  pesoEnvio: '',
  seoTitulo: '',
  seoDescricao: '',
  descricaoMarketplace: '',
  imagensMarketplace: '',
  produzidoInternamente: false,
  produtoServico: false,
  produtoRevenda: true,
  bloquearVendaSemEstoque: false,
  exigirSerialLote: false,
  validade: '',
  controlarLote: false,
  permitirCashback: false,
  produtoDestaque: false,
  impedirVendaAbaixoCusto: false,
  autosaveOpcional: false
};

const toNumber = (value: string) => Number(String(value).replace(',', '.')) || 0;

const formatCurrency = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const slugify = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

const makeSku = (tenantId: string | null | undefined, code: string) => {
  const tenantPrefix = (tenantId || 'NX').replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase() || 'NX';
  const codePart = (code || '0001').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return `${tenantPrefix}-${codePart}`;
};

const normalizeAtacadoFaixas = (faixas: AtacadoFaixa[] | Array<Record<string, unknown>> | undefined): AtacadoFaixa[] => {
  if (!faixas?.length) {
    return [
      { id: '1', quantidadeInicial: '1', quantidadeFinal: '9', preco: '', ilimitado: false },
      { id: '2', quantidadeInicial: '10', quantidadeFinal: '49', preco: '', ilimitado: false },
      { id: '3', quantidadeInicial: '50', quantidadeFinal: '', preco: '', ilimitado: true }
    ];
  }

  return faixas.map((faixa, index) => {
    const quantidadeFinal = faixa.quantidadeFinal;
    return {
      id: String(faixa.id || index + 1),
      quantidadeInicial: String(faixa.quantidadeInicial ?? ''),
      quantidadeFinal: quantidadeFinal === null || quantidadeFinal === undefined ? '' : String(quantidadeFinal),
      preco: String(faixa.preco ?? ''),
      ilimitado: Boolean(faixa.ilimitado || quantidadeFinal === null)
    };
  });
};

const EstoqueForm: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditing = !!id;

  const [activeTab, setActiveTab] = useState<TabId>('geral');
  const [formData, setFormData] = useState<ProdutoFormData>(emptyFormData);
  const [atacadoFaixas, setAtacadoFaixas] = useState<AtacadoFaixa[]>([
    { id: '1', quantidadeInicial: '1', quantidadeFinal: '9', preco: '', ilimitado: false },
    { id: '2', quantidadeInicial: '10', quantidadeFinal: '49', preco: '', ilimitado: false },
    { id: '3', quantidadeInicial: '50', quantidadeFinal: '', preco: '', ilimitado: true }
  ]);
  const [historicoPrecos, setHistoricoPrecos] = useState<HistoricoPreco[]>([]);
  const [produtoOriginal, setProdutoOriginal] = useState<ProdutoOriginalData | null>(null);
  const [modoCadastro, setModoCadastro] = useState<'rapido' | 'avancado'>('avancado');
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(isEditing);
  const [categoriasDB, setCategoriasDB] = useState<string[]>([]);
  const [unidadesDB, setUnidadesDB] = useState<UnidadeMedida[]>([]);
  const [validarCadastroProduto, setValidarCadastroProduto] = useState(false);
  const [permitirVendaSemEstoque, setPermitirVendaSemEstoque] = useState(false);
  const { currentUser, tenantId, userRole } = useAuth();

  const fallbackUnidades: UnidadeMedida[] = [
    { id: 'un', sigla: 'UN', nome: 'UNIDADE', casasDecimais: 0, permiteFracionado: false },
    { id: 'kg', sigla: 'KG', nome: 'QUILOGRAMA', casasDecimais: 3, permiteFracionado: true },
    { id: 'lts', sigla: 'LTS', nome: 'LITRO', casasDecimais: 2, permiteFracionado: true },
    { id: 'mt', sigla: 'MT', nome: 'METRO', casasDecimais: 2, permiteFracionado: true }
  ];

  const activeUnidades = unidadesDB.length > 0 ? unidadesDB : fallbackUnidades;
  const isSuperAdmin = isPlatformAdminRole(userRole);

  const precoCusto = toNumber(formData.precoCusto);
  const precoVenda = toNumber(formData.precoVenda);
  const precoPromocional = toNumber(formData.precoPromocional);
  const margemLucro = precoCusto > 0 ? ((precoVenda - precoCusto) / precoCusto) * 100 : 0;
  const lucroEstimado = precoVenda - precoCusto;
  const sugestaoSlug = useMemo(() => slugify(formData.nome), [formData.nome]);
  const skuCalculado = useMemo(() => makeSku(tenantId, formData.codigo), [tenantId, formData.codigo]);
  const quantidadeEstoqueEditavel = !isEditing || permitirVendaSemEstoque;

  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        if (!currentUser) return;

        const configSnap = await getDoc(doc(db, 'configuracoes', tenantId || ''));
        if (configSnap.exists()) {
          const configData = configSnap.data();
          setValidarCadastroProduto(configData.validarCadastroProduto === true);
          setPermitirVendaSemEstoque(configData.venderSemEstoque === true);
        } else {
          setValidarCadastroProduto(false);
          setPermitirVendaSemEstoque(false);
        }

        const qCat = query(collection(db, 'categorias'), where('tenantId', '==', tenantId));
        const snapCat = await getDocs(qCat);
        const cats: string[] = [];
        snapCat.forEach(d => {
          const data = d.data();
          if (data.tipo === 'Peça' || data.tipo === 'Produto' || !data.tipo) cats.push(data.nome);
        });
        setCategoriasDB(cats);

        const qUni = query(collection(db, 'unidades_medida'), where('tenantId', '==', tenantId));
        const snapUni = await getDocs(qUni);
        const unis: UnidadeMedida[] = [];
        snapUni.forEach(d => {
          const uData = d.data();
          unis.push({
            id: d.id,
            sigla: uData.sigla || '',
            nome: uData.nome || '',
            casasDecimais: Number(uData.casasDecimais || 0),
            permiteFracionado: Boolean(uData.permiteFracionado || false)
          });
        });
        setUnidadesDB(unis);

        if (isEditing && id) {
          const docSnap = await getDoc(doc(db, 'estoque', id));
          if (docSnap.exists()) {
            const data = docSnap.data();
            setProdutoOriginal(data);
            setHistoricoPrecos(data.historicoPrecos || []);
            setAtacadoFaixas(normalizeAtacadoFaixas(data.atacado?.faixas || data.atacadoFaixas));
            setFormData({
              ...emptyFormData,
              codigo: data.codigo || '',
              codigoAutomatico: Boolean(data.codigoAutomatico ?? false),
              nome: data.nome || '',
              categoria: data.categoria || '',
              statusAtivo: Boolean(data.statusAtivo ?? data.ativo ?? true),
              quantidade: String(data.quantidade ?? data.estoque?.quantidadeAtual ?? '0'),
              estoqueMinimo: String(data.estoqueMinimo ?? data.estoque?.minimo ?? '0'),
              estoqueMaximo: String(data.estoqueMaximo ?? data.estoque?.maximo ?? ''),
              precoCusto: String(data.precoCusto ?? data.precos?.custo ?? '0.00'),
              precoVenda: String(data.precoVenda ?? data.precos?.venda ?? '0.00'),
              precoPromocional: String(data.precoPromocional ?? data.precos?.promocional ?? ''),
              comissaoPercentual: String(data.comissaoPercentual ?? data.precos?.comissaoPercentual ?? ''),
              descontoMaximoPercentual: String(data.descontoMaximoPercentual ?? data.precos?.descontoMaximoPercentual ?? ''),
              fornecedor: data.fornecedor || data.compras?.ultimoFornecedor || '',
              unidadeMedidaId: data.unidadeMedidaId || 'un',
              codigoBarras: data.codigoBarras || '',
              marca: data.marca || '',
              referencia: data.referencia || '',
              descricaoCurta: data.descricaoCurta || '',
              descricaoCompleta: data.descricaoCompleta || '',
              observacoesInternas: data.observacoesInternas || '',
              imagemProduto: data.imagemProduto || '',
              tags: Array.isArray(data.tags) ? data.tags.join(', ') : data.tags || '',
              controlarEstoque: Boolean(data.controlarEstoque ?? data.estoqueConfig?.controlarEstoque ?? true),
              localizacaoEstoque: data.localizacaoEstoque || data.estoqueConfig?.localizacao || '',
              permitirEstoqueNegativo: Boolean(data.permitirEstoqueNegativo ?? data.estoqueConfig?.permitirNegativo ?? false),
              reservarEstoqueOrcamento: Boolean(data.reservarEstoqueOrcamento ?? data.estoqueConfig?.reservarEmOrcamento ?? true),
              produtoFracionado: Boolean(data.produtoFracionado ?? data.estoqueConfig?.fracionado ?? false),
              peso: String(data.peso ?? data.estoqueConfig?.peso ?? ''),
              altura: String(data.altura ?? data.estoqueConfig?.altura ?? ''),
              largura: String(data.largura ?? data.estoqueConfig?.largura ?? ''),
              comprimento: String(data.comprimento ?? data.estoqueConfig?.comprimento ?? ''),
              ncm: data.ncm || data.fiscal?.ncm || '',
              cfop: data.cfop || data.fiscal?.cfopPadraoSaida || '5102',
              csosn: data.csosn || data.fiscal?.csosnCst || '400',
              origem: data.origem || data.fiscal?.origem || '0',
              perfilFiscal: data.perfilFiscal || data.fiscal?.perfilFiscal || '',
              cest: data.cest || data.fiscal?.cest || '',
              cstPis: data.cstPis || data.fiscal?.cstPis || '',
              cstCofins: data.cstCofins || data.fiscal?.cstCofins || '',
              aliquotaIcms: String(data.aliquotaIcms ?? data.fiscal?.aliquotaIcms ?? ''),
              aliquotaPis: String(data.aliquotaPis ?? data.fiscal?.aliquotaPis ?? ''),
              aliquotaCofins: String(data.aliquotaCofins ?? data.fiscal?.aliquotaCofins ?? ''),
              reducaoBaseIcms: String(data.reducaoBaseIcms ?? data.fiscal?.reducaoBaseIcms ?? ''),
              icmsSt: Boolean(data.icmsSt ?? data.fiscal?.icmsSt ?? false),
              codigoAnp: data.codigoAnp || data.fiscal?.codigoAnp || '',
              beneficioFiscal: data.beneficioFiscal || data.fiscal?.beneficioFiscal || '',
              codigoProdutoFornecedor: data.codigoProdutoFornecedor || data.compras?.codigoProdutoFornecedor || '',
              ultimoCusto: String(data.ultimoCusto ?? data.compras?.ultimoCusto ?? ''),
              dataUltimaCompra: data.dataUltimaCompra || data.compras?.dataUltimaCompra || '',
              leadTime: String(data.leadTime ?? data.compras?.leadTime ?? ''),
              quantidadeMinimaCompra: String(data.quantidadeMinimaCompra ?? data.compras?.quantidadeMinimaCompra ?? ''),
              ativarAtacado: Boolean(data.ativarAtacado ?? data.atacado?.ativo ?? false),
              quantidadeMinimaAtacado: String(data.quantidadeMinimaAtacado ?? data.atacado?.quantidadeMinima ?? ''),
              skuSistema: data.skuSistema || data.ecommerce?.skuSistema || makeSku(tenantId, data.codigo || ''),
              slugUrl: data.slugUrl || data.ecommerce?.slugUrl || slugify(data.nome || ''),
              pesoEnvio: String(data.pesoEnvio ?? data.ecommerce?.pesoEnvio ?? data.peso ?? ''),
              seoTitulo: data.seoTitulo || data.ecommerce?.seoTitulo || '',
              seoDescricao: data.seoDescricao || data.ecommerce?.seoDescricao || '',
              descricaoMarketplace: data.descricaoMarketplace || data.ecommerce?.descricaoMarketplace || '',
              imagensMarketplace: Array.isArray(data.ecommerce?.imagens) ? data.ecommerce.imagens.join('\n') : data.imagensMarketplace || '',
              produzidoInternamente: Boolean(data.produzidoInternamente ?? data.avancado?.produzidoInternamente ?? false),
              produtoServico: Boolean(data.produtoServico ?? data.avancado?.produtoServico ?? false),
              produtoRevenda: Boolean(data.produtoRevenda ?? data.avancado?.produtoRevenda ?? true),
              bloquearVendaSemEstoque: Boolean(data.bloquearVendaSemEstoque ?? data.avancado?.bloquearVendaSemEstoque ?? false),
              exigirSerialLote: Boolean(data.exigirSerialLote ?? data.avancado?.exigirSerialLote ?? false),
              validade: data.validade || data.avancado?.validade || '',
              controlarLote: Boolean(data.controlarLote ?? data.avancado?.controlarLote ?? false),
              permitirCashback: Boolean(data.permitirCashback ?? data.avancado?.permitirCashback ?? false),
              produtoDestaque: Boolean(data.produtoDestaque ?? data.avancado?.produtoDestaque ?? false),
              impedirVendaAbaixoCusto: Boolean(data.impedirVendaAbaixoCusto ?? data.precos?.impedirVendaAbaixoCusto ?? false),
              autosaveOpcional: Boolean(data.autosaveOpcional ?? false)
            });
          }
        } else {
          const q = query(collection(db, 'estoque'), where('tenantId', '==', tenantId));
          const snap = await getCountFromServer(q);
          const nextId = snap.data().count + 1;
          setFormData({
            ...emptyFormData,
            codigo: String(nextId),
            skuSistema: makeSku(tenantId, String(nextId))
          });
        }
      } catch (error) {
        console.error('Erro ao carregar dados:', error);
        showError('Erro ao carregar', 'Não foi possível carregar os dados do produto.');
      } finally {
        setIsFetching(false);
      }
    };
    fetchInitialData();
  }, [id, isEditing, tenantId, currentUser]);

  const updateField = (name: keyof ProdutoFormData, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => {
      const next = { ...prev, [name]: value };

      if (name === 'codigo' && !isSuperAdmin) {
        next.skuSistema = makeSku(tenantId, value);
      }

      if (name === 'nome') {
        const previousAutoSlug = !prev.slugUrl || prev.slugUrl === slugify(prev.nome);
        if (previousAutoSlug) next.slugUrl = slugify(value);
      }

      if (name === 'peso' && !prev.pesoEnvio) {
        next.pesoEnvio = value;
      }

      return next;
    });
  };

  const handleCheckbox = (name: keyof ProdutoFormData) => (e: React.ChangeEvent<HTMLInputElement>) => {
    updateField(name, e.target.checked);
  };

  const applyFiscalProfile = (profileKey: string) => {
    const profile = fiscalProfiles[profileKey as keyof typeof fiscalProfiles];
    if (!profile) {
      updateField('perfilFiscal', '');
      return;
    }

    setFormData(prev => ({
      ...prev,
      perfilFiscal: profileKey,
      cfop: profile.cfop,
      csosn: profile.csosn,
      origem: profile.origem,
      icmsSt: profile.icmsSt,
      cest: profile.cest || prev.cest
    }));
  };

  const addAtacadoFaixa = () => {
    setAtacadoFaixas(prev => [
      ...prev,
      { id: String(Date.now()), quantidadeInicial: '', quantidadeFinal: '', preco: '', ilimitado: false }
    ]);
  };

  const updateAtacadoFaixa = (faixaId: string, field: keyof AtacadoFaixa, value: string | boolean) => {
    setAtacadoFaixas(prev => prev.map(faixa => faixa.id === faixaId ? { ...faixa, [field]: value } : faixa));
  };

  const removeAtacadoFaixa = (faixaId: string) => {
    setAtacadoFaixas(prev => prev.filter(faixa => faixa.id !== faixaId));
  };

  const validateForm = () => {
    if (!formData.codigo.trim() || !formData.nome.trim()) {
      setActiveTab('geral');
      showError('Campos incompletos', 'Preencha o código interno e o nome do produto.');
      return false;
    }

    if (validarCadastroProduto) {
      if (precoVenda <= 0) {
        setActiveTab('precos');
        showError('Preço obrigatório', 'Informe o preço de venda do produto.');
        return false;
      }

      if (formData.quantidade.trim() === '' || toNumber(formData.quantidade) < 0) {
        setActiveTab('estoque');
        showError('Estoque inicial obrigatório', 'Informe a quantidade inicial de estoque do produto.');
        return false;
      }

      if (formData.ncm && !/^\d{8}$/.test(formData.ncm.replace(/\D/g, ''))) {
        setActiveTab('fiscal');
        showError('NCM inválido', 'O NCM deve conter exatamente 8 dígitos.');
        return false;
      }

      if (formData.impedirVendaAbaixoCusto && precoVenda > 0 && precoCusto > 0 && precoVenda < precoCusto) {
        setActiveTab('precos');
        showError('Preço abaixo do custo', 'A configuração atual impede salvar preço de venda abaixo do custo.');
        return false;
      }

      return true;
    }

    if (!formData.categoria.trim()) {
      setActiveTab('geral');
      showError('Categoria obrigatória', 'Selecione ou informe uma categoria para o produto.');
      return false;
    }

    if (!formData.unidadeMedidaId) {
      setActiveTab('geral');
      showError('Unidade obrigatória', 'Selecione a unidade de medida do produto.');
      return false;
    }

    if (formData.ncm && !/^\d{8}$/.test(formData.ncm.replace(/\D/g, ''))) {
      setActiveTab('fiscal');
      showError('NCM inválido', 'O NCM deve conter exatamente 8 dígitos.');
      return false;
    }

    if (!formData.ncm.trim() || !formData.cfop.trim() || !formData.csosn.trim() || !formData.origem.trim()) {
      setActiveTab('fiscal');
      showError('Dados fiscais obrigatórios', 'Preencha NCM, CFOP padrão de saída, origem e CSOSN/CST.');
      return false;
    }

    if (formData.impedirVendaAbaixoCusto && precoVenda > 0 && precoCusto > 0 && precoVenda < precoCusto) {
      setActiveTab('precos');
      showError('Preço abaixo do custo', 'A configuração atual impede salvar preço de venda abaixo do custo.');
      return false;
    }

    return true;
  };

  const checkUniqueSku = async (sku: string) => {
    if (!sku || !tenantId) return true;
    const qSku = query(collection(db, 'estoque'), where('tenantId', '==', tenantId), where('skuSistema', '==', sku));
    const snap = await getDocs(qSku);
    return snap.docs.every(item => item.id === id);
  };

  const handleSave = async (e?: React.FormEvent | React.MouseEvent) => {
    e?.preventDefault();
    if (!validateForm()) return;

    setIsLoading(true);

    try {
      const skuFinal = isSuperAdmin ? formData.skuSistema || skuCalculado : skuCalculado;
      const skuUnico = await checkUniqueSku(skuFinal);
      if (!skuUnico) {
        setActiveTab('ecommerce');
        showError('SKU duplicado', 'Já existe outro produto com este SKU nesta empresa.');
        return;
      }

      const selectedUnit = activeUnidades.find(u => u.id === formData.unidadeMedidaId) || activeUnidades.find(u => u.sigla === 'UN') || activeUnidades[0];
      const ultimoHistorico = [...historicoPrecos];
      const originalVenda = Number(produtoOriginal?.precoVenda ?? 0);
      const originalCusto = Number(produtoOriginal?.precoCusto ?? 0);
      const mudouPreco = isEditing && (originalVenda !== precoVenda || originalCusto !== precoCusto);

      if (mudouPreco) {
        ultimoHistorico.unshift({
          precoAnterior: originalVenda,
          precoNovo: precoVenda,
          custoAnterior: originalCusto,
          custoNovo: precoCusto,
          alteradoEm: new Date().toISOString(),
          usuarioId: currentUser?.uid
        });
      }

      const tags = formData.tags.split(',').map(tag => tag.trim()).filter(Boolean);
      const imagens = formData.imagensMarketplace.split('\n').map(img => img.trim()).filter(Boolean);
      const nomeProduto = formData.nome.toUpperCase().trim();

      const produtoData = {
        ...formData,
        nome: nomeProduto,
        codigo: formData.codigo.trim(),
        codigoAutomatico: formData.codigoAutomatico,
        categoria: formData.categoria.trim(),
        statusAtivo: formData.statusAtivo,
        ativo: formData.statusAtivo,
        permitirEstoqueNegativo: false,
        quantidade: toNumber(formData.quantidade),
        estoqueMinimo: toNumber(formData.estoqueMinimo),
        estoqueMaximo: toNumber(formData.estoqueMaximo),
        precoCusto,
        precoVenda,
        precoPromocional,
        margemLucro,
        lucroEstimado,
        comissaoPercentual: toNumber(formData.comissaoPercentual),
        descontoMaximoPercentual: toNumber(formData.descontoMaximoPercentual),
        ultimoCusto: toNumber(formData.ultimoCusto),
        leadTime: toNumber(formData.leadTime),
        quantidadeMinimaCompra: toNumber(formData.quantidadeMinimaCompra),
        quantidadeMinimaAtacado: toNumber(formData.quantidadeMinimaAtacado),
        peso: toNumber(formData.peso),
        altura: toNumber(formData.altura),
        largura: toNumber(formData.largura),
        comprimento: toNumber(formData.comprimento),
        pesoEnvio: toNumber(formData.pesoEnvio),
        aliquotaIcms: toNumber(formData.aliquotaIcms),
        aliquotaPis: toNumber(formData.aliquotaPis),
        aliquotaCofins: toNumber(formData.aliquotaCofins),
        reducaoBaseIcms: toNumber(formData.reducaoBaseIcms),
        ncm: formData.ncm.replace(/\D/g, ''),
        cfop: formData.cfop,
        csosn: formData.csosn,
        origem: formData.origem,
        skuSistema: skuFinal,
        slugUrl: formData.slugUrl || sugestaoSlug,
        tags,
        unidadeMedidaId: selectedUnit?.id || 'un',
        unidadeMedidaSigla: selectedUnit?.sigla || 'UN',
        unidadeMedidaCasasDecimais: selectedUnit ? Number(selectedUnit.casasDecimais) : 0,
        unidadeMedidaFracionado: selectedUnit ? Boolean(selectedUnit.permiteFracionado) : false,
        ultimaAlteracaoPreco: mudouPreco ? new Date().toISOString() : produtoOriginal?.ultimaAlteracaoPreco || null,
        historicoPrecos: ultimoHistorico,
        precos: {
          venda: precoVenda,
          promocional: precoPromocional,
          custo: precoCusto,
          margemLucro,
          lucroEstimado,
          comissaoPercentual: toNumber(formData.comissaoPercentual),
          descontoMaximoPercentual: toNumber(formData.descontoMaximoPercentual),
          impedirVendaAbaixoCusto: formData.impedirVendaAbaixoCusto,
          ultimaAlteracaoPreco: mudouPreco ? new Date().toISOString() : produtoOriginal?.ultimaAlteracaoPreco || null
        },
        estoqueConfig: {
          controlarEstoque: formData.controlarEstoque,
          quantidadeAtual: toNumber(formData.quantidade),
          minimo: toNumber(formData.estoqueMinimo),
          maximo: toNumber(formData.estoqueMaximo),
          localizacao: formData.localizacaoEstoque,
          permitirNegativo: false,
          reservarEmOrcamento: formData.reservarEstoqueOrcamento,
          fracionado: formData.produtoFracionado,
          peso: toNumber(formData.peso),
          altura: toNumber(formData.altura),
          largura: toNumber(formData.largura),
          comprimento: toNumber(formData.comprimento)
        },
        fiscal: {
          perfilFiscal: formData.perfilFiscal,
          ncm: formData.ncm.replace(/\D/g, ''),
          cfopPadraoSaida: formData.cfop,
          origem: formData.origem,
          csosnCst: formData.csosn,
          cest: formData.cest,
          cstPis: formData.cstPis,
          cstCofins: formData.cstCofins,
          aliquotaIcms: toNumber(formData.aliquotaIcms),
          aliquotaPis: toNumber(formData.aliquotaPis),
          aliquotaCofins: toNumber(formData.aliquotaCofins),
          reducaoBaseIcms: toNumber(formData.reducaoBaseIcms),
          icmsSt: formData.icmsSt,
          codigoAnp: formData.codigoAnp,
          beneficioFiscal: formData.beneficioFiscal
        },
        compras: {
          ultimoFornecedor: formData.fornecedor,
          codigoProdutoFornecedor: formData.codigoProdutoFornecedor,
          ultimoCusto: toNumber(formData.ultimoCusto),
          dataUltimaCompra: formData.dataUltimaCompra,
          leadTime: toNumber(formData.leadTime),
          quantidadeMinimaCompra: toNumber(formData.quantidadeMinimaCompra),
          mediaCustoCompra: toNumber(formData.ultimoCusto) || precoCusto
        },
        atacado: {
          ativo: formData.ativarAtacado,
          quantidadeMinima: toNumber(formData.quantidadeMinimaAtacado),
          faixas: atacadoFaixas.map(faixa => ({
            ...faixa,
            quantidadeInicial: toNumber(faixa.quantidadeInicial),
            quantidadeFinal: faixa.ilimitado ? null : toNumber(faixa.quantidadeFinal),
            preco: toNumber(faixa.preco)
          }))
        },
        ecommerce: {
          skuSistema: skuFinal,
          slugUrl: formData.slugUrl || sugestaoSlug,
          pesoEnvio: toNumber(formData.pesoEnvio),
          altura: toNumber(formData.altura),
          largura: toNumber(formData.largura),
          comprimento: toNumber(formData.comprimento),
          seoTitulo: formData.seoTitulo,
          seoDescricao: formData.seoDescricao,
          descricaoMarketplace: formData.descricaoMarketplace,
          imagens,
          preparadoParaNuvemshop: true
        },
        avancado: {
          produzidoInternamente: formData.produzidoInternamente,
          produtoServico: formData.produtoServico,
          produtoRevenda: formData.produtoRevenda,
          bloquearVendaSemEstoque: formData.bloquearVendaSemEstoque,
          exigirSerialLote: formData.exigirSerialLote,
          validade: formData.validade,
          controlarLote: formData.controlarLote,
          permitirCashback: formData.permitirCashback,
          produtoDestaque: formData.produtoDestaque
        },
        integracoes: {
          firebaseMultiempresa: true,
          preparadoNfeNfce: true,
          preparadoEcommerce: true,
          preparadoMarketplaces: true,
          colecoesFuturas: ['produtos', 'estoque', 'fiscal', 'atacado', 'historico_precos', 'movimentacoes', 'ecommerce']
        }
      };

      if (isEditing && id) {
        await updateDoc(doc(db, 'estoque', id), { ...produtoData, tenantId: tenantId || '', updatedAt: serverTimestamp() });
        try {
          const { createAuditLog } = await import('../../services/logService');
          createAuditLog({
            tenantId: tenantId || '',
            usuarioId: currentUser?.uid || '',
            usuarioEmail: currentUser?.email || currentUser?.uid || '',
            modulo: 'estoque',
            acao: 'edicao',
            descricao: `Produto ${produtoData.nome} editado. Estoque: ${produtoData.quantidade} ${produtoData.unidadeMedidaSigla}. Preço de venda: R$ ${produtoData.precoVenda.toFixed(2)}.`,
            registroRelacionadoId: id,
            status: 'sucesso'
          });
        } catch {
          // Ignorar erro de log de auditoria.
        }
        showSuccess('Produto atualizado!');
      } else {
        if (!currentUser) return;
        const newDocRef = await addDoc(collection(db, 'estoque'), {
          ...produtoData,
          tenantId: tenantId || '',
          createdAt: serverTimestamp()
        });
        try {
          const { createAuditLog } = await import('../../services/logService');
          createAuditLog({
            tenantId: tenantId || '',
            usuarioId: currentUser.uid,
            usuarioEmail: currentUser.email || currentUser.uid,
            modulo: 'estoque',
            acao: 'criacao',
            descricao: `Produto ${produtoData.nome} cadastrado. Estoque inicial: ${produtoData.quantidade} ${produtoData.unidadeMedidaSigla}. Preço de venda: R$ ${produtoData.precoVenda.toFixed(2)}.`,
            registroRelacionadoId: newDocRef.id,
            status: 'sucesso'
          });
        } catch {
          // Ignorar erro de log de auditoria.
        }
        showSuccess('Produto cadastrado!');
      }

      navigate('/estoque');
    } catch (error) {
      console.error('Erro ao salvar produto:', error);
      showError('Erro ao salvar', 'Erro ao salvar produto no estoque. Tente novamente.');
    } finally {
      setIsLoading(false);
    }
  };

  if (isFetching) {
    return (
      <div className="estoque-loading">
        <Loader2 size={20} className="spin-icon" />
        Carregando cadastro de produto...
      </div>
    );
  }

  return (
    <div className="estoque-page">
      <div className="page-header product-form-header">
        <div className="header-title-group">
          <button className="icon-btn back-btn" onClick={() => navigate('/estoque')} title="Voltar">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="page-title">{isEditing ? 'Editar Produto' : 'Novo Produto'}</h1>
            <p className="page-subtitle">Cadastro completo para estoque, fiscal, vendas e integrações</p>
          </div>
        </div>
        <div className="product-header-actions">
          <div className="mode-switch" aria-label="Modo de cadastro">
            <button type="button" className={modoCadastro === 'rapido' ? 'active' : ''} onClick={() => setModoCadastro('rapido')}>Rápido</button>
            <button type="button" className={modoCadastro === 'avancado' ? 'active' : ''} onClick={() => setModoCadastro('avancado')}>Avançado</button>
          </div>
          <button
            className="btn-primary"
            onClick={handleSave}
            disabled={isLoading}
            style={{ opacity: isLoading ? 0.7 : 1, display: 'flex', alignItems: 'center' }}
          >
            {isLoading ? (
              <Loader2 size={18} className="spin-icon" style={{ marginRight: 8 }} />
            ) : (
              <Save size={18} style={{ marginRight: 8 }} />
            )}
            {isLoading ? 'Salvando...' : 'Salvar Produto'}
          </button>
        </div>
      </div>

      <form className="product-form" onSubmit={handleSave}>
        <div className="product-tabs">
          {tabs
            .filter(tab => modoCadastro === 'avancado' || ['geral', 'precos', 'estoque', 'fiscal'].includes(tab.id))
            .map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`product-tab ${activeTab === tab.id ? 'active' : ''}`}
              >
                {tab.label}
              </button>
            ))}
        </div>

        <div className="form-container product-form-container">
          {activeTab === 'geral' && (
            <div className="card form-section product-card">
              <div className="section-header">
                <Package size={20} className="section-icon" />
                <div>
                  <h3>Dados Gerais</h3>
                  <p>Identificação do produto para vendas, estoque e busca rápida.</p>
                </div>
              </div>

              <div className="form-grid-3">
                <div className="input-group">
                  <label>Código interno *</label>
                  <input type="text" name="codigo" value={formData.codigo} readOnly required />
                  <span className="field-hint">Gerado automaticamente pelo sistema a cada novo produto. Não pode ser alterado manualmente.</span>
                </div>
                <label className="switch-row compact-switch">
                  <input type="checkbox" checked={formData.statusAtivo} onChange={handleCheckbox('statusAtivo')} />
                  <span>{formData.statusAtivo ? 'Produto ativo' : 'Produto inativo'}</span>
                </label>
              </div>

              <div className="input-group">
                <label>Nome do produto *</label>
                <input type="text" name="nome" placeholder="Ex: ARROZ TIPO 1 5KG" value={formData.nome} onChange={handleChange} required style={{ textTransform: 'uppercase' }} />
              </div>

              <div className="form-grid-3">
                <div className="input-group">
                  <label>Categoria *</label>
                  <input type="text" name="categoria" list="categorias-produto" value={formData.categoria} onChange={handleChange} required={!validarCadastroProduto} placeholder="Selecione ou digite uma categoria" />
                  <datalist id="categorias-produto">
                    {categoriasDB.map((cat, idx) => <option key={idx} value={cat} />)}
                  </datalist>
                </div>
                <div className="input-group">
                  <label>Unidade de medida *</label>
                  <select name="unidadeMedidaId" value={formData.unidadeMedidaId} onChange={handleChange} className="form-select" required={!validarCadastroProduto}>
                    {activeUnidades.map((uni) => <option key={uni.id} value={uni.id}>{uni.sigla} - {uni.nome}</option>)}
                  </select>
                </div>
                <div className="input-group">
                  <label>Código de barras</label>
                  <input type="text" name="codigoBarras" placeholder="EAN/GTIN" value={formData.codigoBarras} onChange={handleChange} />
                </div>
              </div>

              <div className="form-grid-3">
                <div className="input-group">
                  <label>Marca</label>
                  <input type="text" name="marca" value={formData.marca} onChange={handleChange} />
                </div>
                <div className="input-group">
                  <label>Referência</label>
                  <input type="text" name="referencia" value={formData.referencia} onChange={handleChange} />
                </div>
                <div className="input-group">
                  <label>Tags</label>
                  <input type="text" name="tags" placeholder="varejo, destaque, sazonal" value={formData.tags} onChange={handleChange} />
                </div>
              </div>

              <div className="grid-2-col">
                <div className="input-group">
                  <label>Descrição curta</label>
                  <textarea name="descricaoCurta" rows={3} value={formData.descricaoCurta} onChange={handleChange} />
                </div>
                <div className="input-group">
                  <label>Observações internas</label>
                  <textarea name="observacoesInternas" rows={3} value={formData.observacoesInternas} onChange={handleChange} />
                </div>
              </div>

              <div className="grid-2-col">
                <div className="input-group">
                  <label>Descrição completa</label>
                  <textarea name="descricaoCompleta" rows={5} value={formData.descricaoCompleta} onChange={handleChange} />
                </div>
                <div className="input-group">
                  <label>Imagem do produto</label>
                  <input type="url" name="imagemProduto" placeholder="URL da imagem ou caminho do upload" value={formData.imagemProduto} onChange={handleChange} />
                  <span className="field-hint">Estrutura pronta para upload e compressão automática em etapa futura.</span>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'precos' && (
            <div className="card form-section product-card">
              <div className="section-header">
                <DollarSign size={20} className="section-icon" />
                <div>
                  <h3>Preços, Custos e Margem</h3>
                  <p>Base para vendas, relatórios financeiros, comissão e rentabilidade.</p>
                </div>
              </div>

              <div className="form-grid-4">
                <div className="input-group">
                  <label>Preço de venda *</label>
                  <input type="number" name="precoVenda" step="0.01" min="0" value={formData.precoVenda} onChange={handleChange} required />
                </div>
                <div className="input-group">
                  <label>Preço promocional</label>
                  <input type="number" name="precoPromocional" step="0.01" min="0" value={formData.precoPromocional} onChange={handleChange} />
                </div>
                <div className="input-group">
                  <label>Custo do produto</label>
                  <input type="number" name="precoCusto" step="0.01" min="0" value={formData.precoCusto} onChange={handleChange} />
                </div>
                <div className="input-group">
                  <label>Última alteração</label>
                  <input type="text" value={produtoOriginal?.ultimaAlteracaoPreco ? new Date(produtoOriginal.ultimaAlteracaoPreco).toLocaleDateString('pt-BR') : 'Sem histórico'} readOnly />
                </div>
              </div>

              <div className="product-metrics">
                <div>
                  <span>Margem de lucro</span>
                  <strong className={margemLucro >= 0 ? 'metric-positive' : 'metric-negative'}>{margemLucro.toFixed(1)}%</strong>
                </div>
                <div>
                  <span>Lucro líquido estimado</span>
                  <strong className={lucroEstimado >= 0 ? 'metric-positive' : 'metric-negative'}>{formatCurrency(lucroEstimado)}</strong>
                </div>
                <div>
                  <span>Preço em promoção</span>
                  <strong>{precoPromocional > 0 ? formatCurrency(precoPromocional) : 'Inativo'}</strong>
                </div>
              </div>

              <div className="form-grid-3">
                <div className="input-group">
                  <label>Comissão (%)</label>
                  <input type="number" name="comissaoPercentual" step="0.01" min="0" value={formData.comissaoPercentual} onChange={handleChange} />
                </div>
                <div className="input-group">
                  <label>Desconto máximo (%)</label>
                  <input type="number" name="descontoMaximoPercentual" step="0.01" min="0" value={formData.descontoMaximoPercentual} onChange={handleChange} />
                </div>
                <label className="switch-row">
                  <input type="checkbox" checked={formData.impedirVendaAbaixoCusto} onChange={handleCheckbox('impedirVendaAbaixoCusto')} />
                  <span>Impedir venda abaixo do custo</span>
                </label>
              </div>

              <div className="info-panel">
                <strong>Histórico de alteração de preço</strong>
                {historicoPrecos.length > 0 ? (
                  <div className="history-list">
                    {historicoPrecos.slice(0, 4).map((item, index) => (
                      <span key={index}>
                        {new Date(item.alteradoEm).toLocaleDateString('pt-BR')} - {formatCurrency(item.precoAnterior)} para {formatCurrency(item.precoNovo)}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p>Nenhuma alteração registrada ainda. O histórico será criado automaticamente ao mudar preço ou custo.</p>
                )}
              </div>
            </div>
          )}

          {activeTab === 'estoque' && (
            <div className="card form-section product-card">
              <div className="section-header">
                <Package size={20} className="section-icon" />
                <div>
                  <h3>Controle de Estoque</h3>
                  <p>Configuração operacional para alertas, reservas e movimentações automáticas.</p>
                </div>
              </div>

              <div className="form-grid-3">
                <label className="switch-row">
                  <input type="checkbox" checked={formData.controlarEstoque} onChange={handleCheckbox('controlarEstoque')} />
                  <span>Controlar estoque</span>
                </label>
                <label className="switch-row">
                  <input type="checkbox" checked={formData.reservarEstoqueOrcamento} onChange={handleCheckbox('reservarEstoqueOrcamento')} />
                  <span>Reservar estoque em orçamento</span>
                </label>
              </div>

              <div className="form-grid-4">
                <div className="input-group">
                  <label>Quantidade atual</label>
                  <input type="number" name="quantidade" min="0" value={formData.quantidade} onChange={handleChange} disabled={!quantidadeEstoqueEditavel} required={validarCadastroProduto && !isEditing} />
                  {isEditing && (
                    <span className="field-hint">
                      {permitirVendaSemEstoque
                        ? 'Venda sem estoque está ativa; a quantidade pode ser ajustada manualmente.'
                        : 'Em produto já cadastrado, a quantidade muda por NFE, venda, cancelamento ou movimentação.'}
                    </span>
                  )}
                </div>
                <div className="input-group">
                  <label>Estoque mínimo</label>
                  <input type="number" name="estoqueMinimo" min="0" value={formData.estoqueMinimo} onChange={handleChange} />
                </div>
                <div className="input-group">
                  <label>Estoque máximo</label>
                  <input type="number" name="estoqueMaximo" min="0" value={formData.estoqueMaximo} onChange={handleChange} />
                </div>
                <div className="input-group">
                  <label>Localização</label>
                  <input type="text" name="localizacaoEstoque" placeholder="Corredor, prateleira, gaveta" value={formData.localizacaoEstoque} onChange={handleChange} />
                </div>
              </div>

              <div className="form-grid-4">
                <label className="switch-row">
                  <input type="checkbox" checked={formData.produtoFracionado} onChange={handleCheckbox('produtoFracionado')} />
                  <span>Produto fracionado</span>
                </label>
                <div className="input-group">
                  <label>Peso</label>
                  <input type="number" name="peso" step="0.001" min="0" value={formData.peso} onChange={handleChange} />
                </div>
                <div className="input-group">
                  <label>Altura</label>
                  <input type="number" name="altura" step="0.01" min="0" value={formData.altura} onChange={handleChange} />
                </div>
                <div className="input-group">
                  <label>Largura</label>
                  <input type="number" name="largura" step="0.01" min="0" value={formData.largura} onChange={handleChange} />
                </div>
                <div className="input-group">
                  <label>Comprimento</label>
                  <input type="number" name="comprimento" step="0.01" min="0" value={formData.comprimento} onChange={handleChange} />
                </div>
              </div>

              <div className="info-grid">
                <div className="info-panel">
                  <strong>Histórico de movimentação</strong>
                  <p>Preparado para entradas, saídas, cancelamentos de venda e ajustes manuais vinculados ao produto.</p>
                </div>
                <div className="info-panel">
                  <strong>Alertas de estoque mínimo</strong>
                  <p>O dashboard e relatórios podem usar estoque mínimo, máximo e localização para reposição.</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'fiscal' && (
            <div className="card form-section product-card">
              <div className="section-header">
                <DollarSign size={20} className="section-icon" />
                <div>
                  <h3>Fiscal (Tributação)</h3>
                  <p>Estrutura preparada para NF-e, NFC-e, perfis fiscais e regras por regime.</p>
                </div>
              </div>

              <div className="input-group">
                <label>Perfil fiscal automático</label>
                <select value={formData.perfilFiscal} onChange={(e) => applyFiscalProfile(e.target.value)} className="form-select">
                  <option value="">Selecionar perfil...</option>
                  {Object.entries(fiscalProfiles).map(([key, profile]) => <option key={key} value={key}>{profile.label}</option>)}
                </select>
                <span className="field-hint">Ao selecionar um perfil, CFOP, CSOSN, origem e ST são preenchidos automaticamente.</span>
              </div>

              <div className="form-grid-4">
                <div className="input-group">
                  <label>NCM *</label>
                  <input type="text" name="ncm" maxLength={8} placeholder="8 dígitos" value={formData.ncm} onChange={handleChange} required={!validarCadastroProduto} />
                  <span className="field-hint">Obrigatório para emissão fiscal. Use apenas números.</span>
                </div>
                <div className="input-group">
                  <label>CFOP padrão saída *</label>
                  <select name="cfop" value={formData.cfop} onChange={handleChange} className="form-select" required={!validarCadastroProduto}>
                    {cfopOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </div>
                <div className="input-group">
                  <label>Origem da mercadoria *</label>
                  <select name="origem" value={formData.origem} onChange={handleChange} className="form-select" required={!validarCadastroProduto}>
                    {origemOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </div>
                <div className="input-group">
                  <label>CSOSN ou CST *</label>
                  <select name="csosn" value={formData.csosn} onChange={handleChange} className="form-select" required={!validarCadastroProduto}>
                    {csosnOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="form-grid-4">
                <div className="input-group">
                  <label>CEST</label>
                  <input type="text" name="cest" value={formData.cest} onChange={handleChange} />
                </div>
                <div className="input-group">
                  <label>CST PIS</label>
                  <select name="cstPis" value={formData.cstPis} onChange={handleChange} className="form-select">
                    {cstOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </div>
                <div className="input-group">
                  <label>CST COFINS</label>
                  <select name="cstCofins" value={formData.cstCofins} onChange={handleChange} className="form-select">
                    {cstOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </div>
                <label className="switch-row">
                  <input type="checkbox" checked={formData.icmsSt} onChange={handleCheckbox('icmsSt')} />
                  <span>ICMS ST</span>
                </label>
              </div>

              <div className="form-grid-4">
                <div className="input-group">
                  <label>Alíquota ICMS (%)</label>
                  <input type="number" name="aliquotaIcms" step="0.01" min="0" value={formData.aliquotaIcms} onChange={handleChange} />
                </div>
                <div className="input-group">
                  <label>Alíquota PIS (%)</label>
                  <input type="number" name="aliquotaPis" step="0.01" min="0" value={formData.aliquotaPis} onChange={handleChange} />
                </div>
                <div className="input-group">
                  <label>Alíquota COFINS (%)</label>
                  <input type="number" name="aliquotaCofins" step="0.01" min="0" value={formData.aliquotaCofins} onChange={handleChange} />
                </div>
                <div className="input-group">
                  <label>Redução base ICMS (%)</label>
                  <input type="number" name="reducaoBaseIcms" step="0.01" min="0" value={formData.reducaoBaseIcms} onChange={handleChange} />
                </div>
              </div>

              <div className="grid-2-col">
                <div className="input-group">
                  <label>Código ANP</label>
                  <input type="text" name="codigoAnp" value={formData.codigoAnp} onChange={handleChange} />
                </div>
                <div className="input-group">
                  <label>Benefício fiscal</label>
                  <input type="text" name="beneficioFiscal" value={formData.beneficioFiscal} onChange={handleChange} />
                </div>
              </div>

              <div className="fiscal-tip">
                <strong>Dica fiscal</strong>
                <p>Revenda no Simples Nacional costuma usar CFOP 5102, CSOSN 102 e origem 0. Produtos com substituição tributária geralmente exigem CEST e CSOSN 500. Confirme sempre com a contabilidade da empresa.</p>
              </div>
            </div>
          )}

          {activeTab === 'compras' && (
            <div className="card form-section product-card">
              <div className="section-header">
                <Package size={20} className="section-icon" />
                <div>
                  <h3>Compras e Fornecedores</h3>
                  <p>Dados para reposição, lead time e análise de custo médio.</p>
                </div>
              </div>

              <div className="form-grid-3">
                <div className="input-group">
                  <label>Último fornecedor</label>
                  <input type="text" name="fornecedor" value={formData.fornecedor} onChange={handleChange} />
                </div>
                <div className="input-group">
                  <label>Código produto fornecedor</label>
                  <input type="text" name="codigoProdutoFornecedor" value={formData.codigoProdutoFornecedor} onChange={handleChange} />
                </div>
                <div className="input-group">
                  <label>Último custo</label>
                  <input type="number" name="ultimoCusto" step="0.01" min="0" value={formData.ultimoCusto} onChange={handleChange} />
                </div>
              </div>

              <div className="form-grid-3">
                <div className="input-group">
                  <label>Data última compra</label>
                  <input type="date" name="dataUltimaCompra" value={formData.dataUltimaCompra} onChange={handleChange} />
                </div>
                <div className="input-group">
                  <label>Lead time (dias)</label>
                  <input type="number" name="leadTime" min="0" value={formData.leadTime} onChange={handleChange} />
                </div>
                <div className="input-group">
                  <label>Quantidade mínima compra</label>
                  <input type="number" name="quantidadeMinimaCompra" min="0" value={formData.quantidadeMinimaCompra} onChange={handleChange} />
                </div>
              </div>

              <div className="info-grid">
                <div className="info-panel">
                  <strong>Histórico de compras</strong>
                  <p>Preparado para consolidar notas de entrada, últimos fornecedores utilizados e média de custo.</p>
                </div>
                <div className="info-panel">
                  <strong>Média de custo compra</strong>
                  <p>{formatCurrency(toNumber(formData.ultimoCusto) || precoCusto)} será usada como referência gerencial.</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'atacado' && (
            <div className="card form-section product-card">
              <div className="section-header">
                <DollarSign size={20} className="section-icon" />
                <div>
                  <h3>Pauta de Atacado</h3>
                  <p>Faixas dinâmicas para varejo, atacado e campanhas por quantidade.</p>
                </div>
              </div>

              <div className="form-grid-3">
                <label className="switch-row">
                  <input type="checkbox" checked={formData.ativarAtacado} onChange={handleCheckbox('ativarAtacado')} />
                  <span>Ativar atacado</span>
                </label>
                <div className="input-group">
                  <label>Quantidade mínima</label>
                  <input type="number" name="quantidadeMinimaAtacado" min="0" value={formData.quantidadeMinimaAtacado} onChange={handleChange} />
                </div>
                <div className="info-panel compact-panel">
                  <strong>Economia no pedido</strong>
                  <p>Pedidos de venda poderão calcular a melhor faixa automaticamente.</p>
                </div>
              </div>

              <div className="tier-table">
                <div className="tier-row tier-head">
                  <span>Qtd. inicial</span>
                  <span>Qtd. final</span>
                  <span>Preço</span>
                  <span>Ilimitada</span>
                  <span></span>
                </div>
                {atacadoFaixas.map((faixa) => (
                  <div className="tier-row" key={faixa.id}>
                    <input type="number" min="0" value={faixa.quantidadeInicial} onChange={(e) => updateAtacadoFaixa(faixa.id, 'quantidadeInicial', e.target.value)} />
                    <input type="number" min="0" value={faixa.quantidadeFinal} disabled={faixa.ilimitado} onChange={(e) => updateAtacadoFaixa(faixa.id, 'quantidadeFinal', e.target.value)} />
                    <input type="number" min="0" step="0.01" value={faixa.preco} onChange={(e) => updateAtacadoFaixa(faixa.id, 'preco', e.target.value)} />
                    <label className="tier-check">
                      <input type="checkbox" checked={faixa.ilimitado} onChange={(e) => updateAtacadoFaixa(faixa.id, 'ilimitado', e.target.checked)} />
                    </label>
                    <button type="button" className="btn-secondary danger-lite" onClick={() => removeAtacadoFaixa(faixa.id)}>Remover</button>
                  </div>
                ))}
              </div>
              <button type="button" className="btn-secondary add-tier-btn" onClick={addAtacadoFaixa}>Adicionar faixa</button>
            </div>
          )}

          {activeTab === 'ecommerce' && (
            <div className="card form-section product-card">
              <div className="section-header">
                <Package size={20} className="section-icon" />
                <div>
                  <h3>E-commerce e Marketplaces</h3>
                  <p>Preparado para Nuvemshop, marketplaces, SEO e imagens múltiplas.</p>
                </div>
              </div>

              <div className="form-grid-3">
                <div className="input-group">
                  <label>SKU automático do sistema</label>
                  <input type="text" name="skuSistema" value={formData.skuSistema || skuCalculado} onChange={handleChange} readOnly={!isSuperAdmin} />
                  <span className="field-hint">{isSuperAdmin ? 'SuperAdmin pode ajustar manualmente.' : 'Somente SuperAdmin pode alterar o SKU.'}</span>
                </div>
                <div className="input-group">
                  <label>Slug URL</label>
                  <input type="text" name="slugUrl" value={formData.slugUrl} onChange={handleChange} placeholder={sugestaoSlug} />
                </div>
                <div className="input-group">
                  <label>Peso envio</label>
                  <input type="number" name="pesoEnvio" step="0.001" min="0" value={formData.pesoEnvio} onChange={handleChange} />
                </div>
              </div>

              <div className="grid-2-col">
                <div className="input-group">
                  <label>SEO título</label>
                  <input type="text" name="seoTitulo" value={formData.seoTitulo} onChange={handleChange} />
                </div>
                <div className="input-group">
                  <label>SEO descrição</label>
                  <input type="text" name="seoDescricao" value={formData.seoDescricao} onChange={handleChange} />
                </div>
              </div>

              <div className="grid-2-col">
                <div className="input-group">
                  <label>Descrição marketplace</label>
                  <textarea name="descricaoMarketplace" rows={6} value={formData.descricaoMarketplace} onChange={handleChange} />
                </div>
                <div className="input-group">
                  <label>Imagens múltiplas</label>
                  <textarea name="imagensMarketplace" rows={6} placeholder="Uma URL por linha" value={formData.imagensMarketplace} onChange={handleChange} />
                  <span className="field-hint">Estrutura pronta para upload múltiplo e compressão automática.</span>
                </div>
              </div>

              <div className="ecommerce-preview">
                <div>
                  <span>Preview do produto</span>
                  <strong>{formData.nome || 'Nome do produto'}</strong>
                  <p>/{formData.slugUrl || sugestaoSlug || 'produto'}</p>
                </div>
                <div>
                  <span>Identificador de integração</span>
                  <strong>{formData.skuSistema || skuCalculado}</strong>
                  <p>SKU único por empresa para futuras sincronizações.</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'avancado' && (
            <div className="card form-section product-card">
              <div className="section-header">
                <Package size={20} className="section-icon" />
                <div>
                  <h3>Configurações Avançadas</h3>
                  <p>Regras especiais para venda, produção, rastreabilidade e benefícios.</p>
                </div>
              </div>

              <div className="settings-grid">
                {[
                  ['produzidoInternamente', 'Produto produzido internamente'],
                  ['produtoServico', 'Produto serviço'],
                  ['produtoRevenda', 'Produto revenda'],
                  ['bloquearVendaSemEstoque', 'Bloquear venda sem estoque'],
                  ['exigirSerialLote', 'Exigir serial/lote'],
                  ['controlarLote', 'Controlar lote'],
                  ['permitirCashback', 'Permitir cashback'],
                  ['produtoDestaque', 'Produto destaque'],
                  ['autosaveOpcional', 'Auto save opcional']
                ].map(([field, label]) => (
                  <label className="switch-row" key={field}>
                    <input type="checkbox" checked={Boolean(formData[field as keyof ProdutoFormData])} onChange={handleCheckbox(field as keyof ProdutoFormData)} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>

              <div className="input-group">
                <label>Validade</label>
                <input type="date" name="validade" value={formData.validade} onChange={handleChange} />
              </div>
            </div>
          )}
        </div>
      </form>
    </div>
  );
};

export default EstoqueForm;
