import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, Package, DollarSign, Loader2, Factory, Plus, Trash2 } from 'lucide-react';
import { collection, addDoc, updateDoc, doc, getDoc, getDocs, getCountFromServer, serverTimestamp, query, where, setDoc, deleteField } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError } from '../../utils/alerts';
import { isPlatformAdminRole } from '../../utils/roles';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { DEFAULT_REGIME_TRIBUTARIO, ICMS_CST_OPTIONS, CSOSN_OPTIONS, usesCsosn, type RegimeTributario } from '../../utils/fiscalDomain';
import { computeAvailableStock } from '../../utils/estoqueReservaDomain';
import { DEFAULT_VENDER_POR_EMBALAGEM, formatFatorConversao, normalizeEmbalagens } from '../../utils/embalagemDomain';
import { parseComissaoPercentualInput } from '../../utils/financeDomain';
import { isValidSaleQuantity } from '../../utils/saleQuantity';
import './Estoque.css';

interface UnidadeMedida {
  id: string;
  sigla: string;
  nome: string;
  casasDecimais: number;
  permiteFracionado: boolean;
}

type TabId = 'geral' | 'precos' | 'historico' | 'estoque' | 'fiscal' | 'compras' | 'embalagens' | 'composicao' | 'atacado' | 'ecommerce' | 'avancado';

/** Linha da aba Embalagens no formato do formulario (campos como string, igual
 * a AtacadoFaixa). Vira Embalagem de verdade so no handleSave, quando a unidade
 * escolhida e resolvida contra unidadesDB. */
interface EmbalagemFormRow {
  id: string;
  unidadeMedidaId: string;
  descricao: string;
  fatorConversao: string;
  precoVenda: string;
  codigoBarras: string;
  ativo: boolean;
}

const makeEmbalagemRowId = () => `emb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const emptyEmbalagemRow = (): EmbalagemFormRow => ({
  id: '',
  unidadeMedidaId: '',
  descricao: '',
  fatorConversao: '1',
  precoVenda: '',
  codigoBarras: '',
  ativo: true,
});

interface MateriaPrimaOption {
  id: string;
  nome: string;
  unidade: string;
  precoCusto: number;
}

interface ComposicaoItem {
  materiaPrimaId: string;
  materiaPrimaNome: string;
  unidade: string;
  quantidade: number;
}

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
  /** Formato legado: produto antigo guarda preco aqui, nao nos campos
   * planos acima. A carga do formulario ja lia isso; a deteccao de
   * alteracao de preco tambem precisa. */
  precos?: { venda?: number; custo?: number };
  ultimaAlteracaoPreco?: string | null;
  quantidadeReservada?: number;
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
  /** Campos novos (2026-08-28): so o dado, ainda sem logica de venda --
   * o resto do sistema (Pedido de Venda, OS, PDV) continua vendendo pelo
   * precoVenda de sempre. Existem pra guardar os dois precos que o
   * sistema antigo de um cliente exportava, ate a logica de qual preco
   * usar em cada forma de pagamento ser desenhada numa fatia futura. */
  precoAVista: string;
  precoAPrazo: string;
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
  pesoLiquidoUnitarioKg: string;
  origem: string;
  perfilFiscal: string;
  cest: string;
  cstPis: string;
  cstCofins: string;
  cstIbs: string;
  cstCbs: string;
  cstIpi: string;
  aliquotaIcms: string;
  aliquotaPis: string;
  aliquotaCofins: string;
  aliquotaIbs: string;
  aliquotaCbs: string;
  aliquotaIpi: string;
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
  lote: string;
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
  { id: 'historico', label: 'Histórico de Preços' },
  { id: 'estoque', label: 'Estoque' },
  { id: 'fiscal', label: 'Fiscal (Tributação)' },
  { id: 'compras', label: 'Compras' },
  { id: 'embalagens', label: 'Embalagens' },
  { id: 'composicao', label: 'Composição (Produção)' },
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
  { value: '5933', label: '5933 - Prestação de serviço tributado pelo ISSQN' },
  { value: '7101', label: '7101 - Venda de produção do estabelecimento, destinada ao exterior' },
  { value: '7102', label: '7102 - Venda de mercadoria adquirida ou recebida de terceiros, destinada ao exterior' }
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
  precoAVista: '',
  precoAPrazo: '',
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
  pesoLiquidoUnitarioKg: '',
  origem: '0',
  perfilFiscal: '',
  cest: '',
  cstPis: '',
  cstCofins: '',
  cstIbs: '',
  cstCbs: '',
  cstIpi: '',
  aliquotaIcms: '',
  aliquotaPis: '',
  aliquotaCofins: '',
  aliquotaIbs: '',
  aliquotaCbs: '',
  aliquotaIpi: '',
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
  lote: '',
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
  // Embalagens (vender o mesmo produto em KG, UN ou SC). O estoque continua
  // na unidade base; cada embalagem so diz quantas unidades base ela consome.
  const [embalagens, setEmbalagens] = useState<EmbalagemFormRow[]>([]);
  const [novaEmbalagem, setNovaEmbalagem] = useState<EmbalagemFormRow>(emptyEmbalagemRow);
  const [venderPorEmbalagem, setVenderPorEmbalagem] = useState(DEFAULT_VENDER_POR_EMBALAGEM);
  const [historicoPrecos, setHistoricoPrecos] = useState<HistoricoPreco[]>([]);
  /** id -> nome, so pra traduzir o `usuarioId` gravado em cada alteracao de
   * preco. "Alterado por 8Kx9..." nao serve pra ninguem conferir nada. */
  const [nomesUsuarios, setNomesUsuarios] = useState<Record<string, string>>({});
  const [produtoOriginal, setProdutoOriginal] = useState<ProdutoOriginalData | null>(null);
  const [modoCadastro, setModoCadastro] = useState<'rapido' | 'avancado'>('avancado');

  // Composicao (Modulo 4, sub-etapa "a"): quais materias-primas e em que
  // quantidade sao consumidas pra produzir 1 unidade deste produto.
  // Guardado num documento proprio em produtos_composicao/{produtoId} --
  // colecao separada, nao mexe no documento de estoque em si.
  const [materiasPrimasDisponiveis, setMateriasPrimasDisponiveis] = useState<MateriaPrimaOption[]>([]);
  const [composicaoItens, setComposicaoItens] = useState<ComposicaoItem[]>([]);
  const [composicaoLoading, setComposicaoLoading] = useState(false);
  const [isSavingComposicao, setIsSavingComposicao] = useState(false);
  const [novaMateriaPrimaId, setNovaMateriaPrimaId] = useState('');
  const [novaQuantidade, setNovaQuantidade] = useState('1');
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(isEditing);
  const [categoriasDB, setCategoriasDB] = useState<string[]>([]);
  const [unidadesDB, setUnidadesDB] = useState<UnidadeMedida[]>([]);
  const [validarCadastroProduto, setValidarCadastroProduto] = useState(false);
  const [permitirVendaSemEstoque, setPermitirVendaSemEstoque] = useState(false);
  const [regimeTributario, setRegimeTributario] = useState<RegimeTributario>(DEFAULT_REGIME_TRIBUTARIO);
  const { currentUser, tenantId, userRole, userPermissions, isOwner } = useAuth();

  const fallbackUnidades: UnidadeMedida[] = [
    { id: 'un', sigla: 'UN', nome: 'UNIDADE', casasDecimais: 0, permiteFracionado: false },
    { id: 'kg', sigla: 'KG', nome: 'QUILOGRAMA', casasDecimais: 3, permiteFracionado: true },
    { id: 'lts', sigla: 'LTS', nome: 'LITRO', casasDecimais: 2, permiteFracionado: true },
    { id: 'mt', sigla: 'MT', nome: 'METRO', casasDecimais: 2, permiteFracionado: true }
  ];

  const activeUnidades = unidadesDB.length > 0 ? unidadesDB : fallbackUnidades;
  const isSuperAdmin = isPlatformAdminRole(userRole);
  // Segunda camada de defesa, alem da lista (EstoqueList.tsx) nao oferecer o
  // duplo clique: sem isto, quem so tem "ver a lista" abria o cadastro
  // inteiro (custo, margem, fornecedor) digitando a URL direto.
  const canEditProduto = isOwner || isSuperAdmin || (userPermissions && userPermissions.includes('cadastros.estoque_alterar'));

  useEffect(() => {
    if (!canEditProduto) {
      showError('Sem permissão', 'Você não tem permissão para abrir o cadastro de produto. Peça ao administrador para liberar "Estoque: Abrir Cadastro de Produto".');
      navigate('/estoque');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEditProduto]);
  /** Sigla da unidade base do produto -- e nela que o estoque e' controlado,
   * e e' contra ela que o fator de conversao de cada embalagem e' expresso. */
  const baseUnidadeSigla = activeUnidades.find(u => u.id === formData.unidadeMedidaId)?.sigla || 'UN';

  // Produto "produzido internamente" com composicao cadastrada: o custo
  // nao e mais digitado a mao, e a soma de (quantidade x custo unitario)
  // de cada materia-prima da composicao -- puxado do cadastro de
  // Materia-Prima, nao de um valor fixo salvo aqui. Produto de revenda
  // (nao produzido aqui) continua com o custo manual/da nota fiscal, como
  // sempre foi.
  const custoComposicao = useMemo(() => (
    composicaoItens.reduce((soma, item) => {
      const materiaPrima = materiasPrimasDisponiveis.find(mp => mp.id === item.materiaPrimaId);
      return soma + item.quantidade * (materiaPrima?.precoCusto || 0);
    }, 0)
  ), [composicaoItens, materiasPrimasDisponiveis]);
  const custoCalculadoPelaComposicao = formData.produzidoInternamente && composicaoItens.length > 0;
  const precoCusto = custoCalculadoPelaComposicao ? custoComposicao : toNumber(formData.precoCusto);
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
          setVenderPorEmbalagem(configData.venderPorEmbalagem ?? DEFAULT_VENDER_POR_EMBALAGEM);
          setRegimeTributario((configData.regimeTributario ?? DEFAULT_REGIME_TRIBUTARIO) as RegimeTributario);
        } else {
          setValidarCadastroProduto(false);
          setPermitirVendaSemEstoque(false);
          setVenderPorEmbalagem(DEFAULT_VENDER_POR_EMBALAGEM);
          setRegimeTributario(DEFAULT_REGIME_TRIBUTARIO);
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
            setEmbalagens(normalizeEmbalagens(data.embalagens).map((embalagem) => ({
              id: embalagem.id,
              unidadeMedidaId: embalagem.unidadeMedidaId,
              descricao: embalagem.descricao,
              fatorConversao: String(embalagem.fatorConversao),
              precoVenda: embalagem.precoVenda > 0 ? String(embalagem.precoVenda) : '',
              codigoBarras: embalagem.codigoBarras,
              ativo: embalagem.ativo,
            })));
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
              precoAVista: data.precoAVista != null ? String(data.precoAVista) : (data.precos?.aVista != null ? String(data.precos.aVista) : ''),
              precoAPrazo: data.precoAPrazo != null ? String(data.precoAPrazo) : (data.precos?.aPrazo != null ? String(data.precos.aPrazo) : ''),
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
              pesoLiquidoUnitarioKg: String(data.pesoLiquidoUnitarioKg ?? ''),
              origem: data.origem || data.fiscal?.origem || '0',
              perfilFiscal: data.perfilFiscal || data.fiscal?.perfilFiscal || '',
              cest: data.cest || data.fiscal?.cest || '',
              cstPis: data.cstPis || data.fiscal?.cstPis || '',
              cstCofins: data.cstCofins || data.fiscal?.cstCofins || '',
              cstIbs: data.cstIbs || data.fiscal?.cstIbs || '',
              cstCbs: data.cstCbs || data.fiscal?.cstCbs || '',
              cstIpi: data.cstIpi || data.fiscal?.cstIpi || '',
              aliquotaIcms: String(data.aliquotaIcms ?? data.fiscal?.aliquotaIcms ?? ''),
              aliquotaPis: String(data.aliquotaPis ?? data.fiscal?.aliquotaPis ?? ''),
              aliquotaCofins: String(data.aliquotaCofins ?? data.fiscal?.aliquotaCofins ?? ''),
              aliquotaIbs: String(data.aliquotaIbs ?? data.fiscal?.aliquotaIbs ?? ''),
              aliquotaCbs: String(data.aliquotaCbs ?? data.fiscal?.aliquotaCbs ?? ''),
              aliquotaIpi: String(data.aliquotaIpi ?? data.fiscal?.aliquotaIpi ?? ''),
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
              lote: data.lote || data.avancado?.lote || '',
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

  // Nomes dos usuarios que alteraram preco, pra aba Historico de Precos.
  // So busca quando ha historico de verdade -- produto novo ou sem alteracao
  // nenhuma nao precisa ler a colecao de usuarios.
  useEffect(() => {
    if (!tenantId || !currentUser || historicoPrecos.length === 0) return;
    if (Object.keys(nomesUsuarios).length > 0) return;

    const fetchNomes = async () => {
      try {
        const snap = await getDocs(query(collection(db, 'usuarios'), where('tenantId', '==', tenantId)));
        const mapa: Record<string, string> = {};
        snap.forEach((documento) => {
          const data = documento.data();
          mapa[documento.id] = data.nome || data.nomeResponsavel || data.email || '';
        });
        setNomesUsuarios(mapa);
      } catch (err) {
        // Sem permissao de ler usuarios o historico ainda vale -- so mostra
        // o id em vez do nome. Nao e' motivo pra quebrar a aba.
        console.error('Erro ao carregar nomes de usuários do histórico de preços:', err);
      }
    };

    void fetchNomes();
  }, [tenantId, currentUser, historicoPrecos.length, nomesUsuarios]);

  // Composicao: so faz sentido pra um produto ja salvo (precisa do id).
  // Carrega o catalogo de materias-primas do tenant e a composicao ja
  // salva pra este produto, se existir.
  useEffect(() => {
    if (!isEditing || !id || !tenantId || !currentUser) return;

    const fetchComposicao = async () => {
      setComposicaoLoading(true);
      try {
        const qMp = query(collection(db, 'materias_primas'), where('tenantId', '==', tenantId));
        const snapMp = await getDocs(qMp);
        const materiasPrimas: MateriaPrimaOption[] = [];
        snapMp.forEach(d => {
          const data = d.data();
          materiasPrimas.push({ id: d.id, nome: data.nome || '', unidade: data.unidade || 'UN', precoCusto: Number(data.precoCusto || 0) });
        });
        materiasPrimas.sort((a, b) => a.nome.localeCompare(b.nome));
        setMateriasPrimasDisponiveis(materiasPrimas);

        const composicaoSnap = await getDoc(doc(db, 'produtos_composicao', id));
        if (composicaoSnap.exists()) {
          const data = composicaoSnap.data();
          setComposicaoItens(Array.isArray(data.itens) ? data.itens : []);
        } else {
          setComposicaoItens([]);
        }
      } catch (error) {
        console.error('Erro ao carregar composição:', error);
        showError('Erro ao carregar', 'Não foi possível carregar a composição deste produto.');
      } finally {
        setComposicaoLoading(false);
      }
    };
    fetchComposicao();
  }, [id, isEditing, tenantId, currentUser]);

  const handleAdicionarItemComposicao = () => {
    if (!novaMateriaPrimaId) {
      showError('Selecione uma matéria-prima', 'Escolha qual matéria-prima entra na composição.');
      return;
    }
    const quantidadeNum = Number(novaQuantidade);
    if (!Number.isFinite(quantidadeNum) || quantidadeNum <= 0) {
      showError('Quantidade inválida', 'Informe uma quantidade maior que zero.');
      return;
    }
    if (composicaoItens.some(item => item.materiaPrimaId === novaMateriaPrimaId)) {
      showError('Já adicionada', 'Essa matéria-prima já está na composição. Remova antes de adicionar de novo.');
      return;
    }
    const materiaPrima = materiasPrimasDisponiveis.find(mp => mp.id === novaMateriaPrimaId);
    if (!materiaPrima) return;

    setComposicaoItens(prev => [...prev, {
      materiaPrimaId: materiaPrima.id,
      materiaPrimaNome: materiaPrima.nome,
      unidade: materiaPrima.unidade,
      quantidade: quantidadeNum
    }]);
    setNovaMateriaPrimaId('');
    setNovaQuantidade('1');
  };

  const handleRemoverItemComposicao = (materiaPrimaId: string) => {
    setComposicaoItens(prev => prev.filter(item => item.materiaPrimaId !== materiaPrimaId));
  };

  const handleSalvarComposicao = async () => {
    if (!id || !tenantId || !currentUser) return;
    setIsSavingComposicao(true);
    try {
      await setDoc(doc(db, 'produtos_composicao', id), {
        produtoId: id,
        itens: composicaoItens,
        tenantId,
        updatedAt: serverTimestamp(),
        ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp()),
      }, { merge: true });
      showSuccess('Composição salva!');
    } catch (error) {
      console.error('Erro ao salvar composição:', error);
      showError('Erro ao salvar', 'Não foi possível salvar a composição.');
    } finally {
      setIsSavingComposicao(false);
    }
  };

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

  const handleAddEmbalagem = () => {
    const fator = toNumber(novaEmbalagem.fatorConversao);
    if (!novaEmbalagem.unidadeMedidaId) {
      showError('Embalagem incompleta', 'Selecione a unidade de medida da embalagem.');
      return;
    }
    if (fator <= 0) {
      showError('Embalagem inválida', 'O fator de conversão deve ser maior que zero.');
      return;
    }
    // Duas embalagens na mesma unidade viram duas opcoes com o mesmo rotulo no
    // seletor da venda -- o operador nao teria como diferenciar.
    if (embalagens.some(e => e.unidadeMedidaId === novaEmbalagem.unidadeMedidaId)) {
      showError('Unidade repetida', 'Já existe uma embalagem cadastrada nesta unidade de medida.');
      return;
    }
    if (novaEmbalagem.unidadeMedidaId === formData.unidadeMedidaId) {
      showError('Unidade repetida', 'Esta já é a unidade base do produto — ela sempre aparece na venda, sem precisar de embalagem.');
      return;
    }

    setEmbalagens(prev => [...prev, { ...novaEmbalagem, id: makeEmbalagemRowId() }]);
    setNovaEmbalagem(emptyEmbalagemRow());
  };

  const updateEmbalagem = (embalagemId: string, field: keyof EmbalagemFormRow, value: string | boolean) => {
    setEmbalagens(prev => prev.map(e => e.id === embalagemId ? { ...e, [field]: value } : e));
  };

  const removeEmbalagem = (embalagemId: string) => {
    setEmbalagens(prev => prev.filter(e => e.id !== embalagemId));
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
    if (!currentUser) return;

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

      // Mesma regra unica de quantidade fracionada usada em Pedido de Venda,
      // OS, Orcamento, PDV e Ajuste Manual de Estoque (saleQuantity.ts) --
      // sem isso, um produto na unidade UN (nao fracionavel) aceitava
      // quantidade inicial "1.5" no proprio cadastro.
      if (quantidadeEstoqueEditavel && formData.quantidade.trim() !== '') {
        const unidadeFracionadaCadastro = Boolean(selectedUnit?.permiteFracionado) && formData.produtoFracionado;
        const casasDecimaisCadastro = selectedUnit ? Number(selectedUnit.casasDecimais) : 0;
        const quantidadeInicial = toNumber(formData.quantidade);
        if (quantidadeInicial > 0 && !isValidSaleQuantity(quantidadeInicial, unidadeFracionadaCadastro, casasDecimaisCadastro)) {
          setActiveTab('estoque');
          showError('Quantidade inválida', unidadeFracionadaCadastro
            ? `A quantidade aceita no máximo ${casasDecimaisCadastro} casa(s) decimal(is), conforme a unidade ${selectedUnit?.sigla || 'UN'}.`
            : `Este produto está na unidade ${selectedUnit?.sigla || 'UN'}, que NÃO permite quantidade fracionada. Utilize um número inteiro.`);
          return;
        }
      }

      const ultimoHistorico = [...historicoPrecos];
      // Mesmo fallback que a carga do formulario usa (`data.precos?.venda`):
      // produto legado guarda preco no objeto `precos`, nao nos campos
      // planos. Sem isso o "preco anterior" vinha 0 e a primeira gravacao
      // registrava uma alteracao falsa de R$ 0,00 para o preco atual, mesmo
      // sem ninguem ter mudado nada.
      const originalVenda = Number(produtoOriginal?.precoVenda ?? produtoOriginal?.precos?.venda ?? 0);
      const originalCusto = Number(produtoOriginal?.precoCusto ?? produtoOriginal?.precos?.custo ?? 0);
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
      // Comissao do produto e' OPCIONAL: em branco, a comissao da venda cai
      // pro cadastro do vendedor/config do sistema (ver resolveComissaoPercentual
      // em financeDomain.ts). Por isso nao pode gravar 0 quando o campo
      // ficou em branco -- zero e "nao configurado" precisam ser distintos.
      const comissaoPercentualValor = parseComissaoPercentualInput(formData.comissaoPercentual);
      // Mesma logica de "em branco != zero" da comissao: preco a vista/a
      // prazo em branco significa "nao preenchido ainda", nao "gratis".
      const precoAVistaValor = parseComissaoPercentualInput(formData.precoAVista);
      const precoAPrazoValor = parseComissaoPercentualInput(formData.precoAPrazo);

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
        precoAVista: precoAVistaValor,
        precoAPrazo: precoAPrazoValor,
        margemLucro,
        lucroEstimado,
        comissaoPercentual: comissaoPercentualValor,
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
        aliquotaIbs: toNumber(formData.aliquotaIbs),
        aliquotaCbs: toNumber(formData.aliquotaCbs),
        aliquotaIpi: toNumber(formData.aliquotaIpi),
        reducaoBaseIcms: toNumber(formData.reducaoBaseIcms),
        ncm: formData.ncm.replace(/\D/g, ''),
        cfop: formData.cfop,
        csosn: formData.csosn,
        // Peso liquido POR UNIDADE (kg), usado so pra converter a
        // quantidade comercial (unidade) pra tributavel (quilo) na hora
        // de emitir nota de CFOP de exportacao -- ver fiscalDomain.ts.
        // Distinto do campo "peso" (frete/e-commerce), nunca usado em
        // nota fiscal.
        pesoLiquidoUnitarioKg: toNumber(formData.pesoLiquidoUnitarioKg),
        cstIpi: formData.cstIpi,
        origem: formData.origem,
        skuSistema: skuFinal,
        slugUrl: formData.slugUrl || sugestaoSlug,
        tags,
        unidadeMedidaId: selectedUnit?.id || 'un',
        unidadeMedidaSigla: selectedUnit?.sigla || 'UN',
        unidadeMedidaCasasDecimais: selectedUnit ? Number(selectedUnit.casasDecimais) : 0,
        // So permite venda fracionada quando as DUAS coisas estao marcadas:
        // a Unidade de Medida (permiteFracionado) E o produto em si
        // ("Produto fracionado", formData.produtoFracionado) -- uma unidade
        // fracionavel como KG nao obriga todo produto nela a vender fracionado.
        unidadeMedidaFracionado: selectedUnit ? Boolean(selectedUnit.permiteFracionado) && formData.produtoFracionado : false,
        // Embalagens: cada uma resolve a propria unidade contra unidadesDB e
        // desnormaliza sigla/casas decimais, mesmo padrao da unidade base
        // acima. Diferenca deliberada: aqui `unidadeMedidaFracionado` vem so
        // da unidade, sem o AND com "Produto fracionado" -- quem decide se um
        // saco pode ser vendido pela metade e a unidade da embalagem, nao o
        // fato do produto ser fracionavel a granel.
        embalagens: embalagens
          .filter(embalagem => toNumber(embalagem.fatorConversao) > 0)
          .map(embalagem => {
            const unidadeEmbalagem = activeUnidades.find(u => u.id === embalagem.unidadeMedidaId);
            return {
              id: embalagem.id,
              unidadeMedidaId: embalagem.unidadeMedidaId,
              unidadeMedidaSigla: unidadeEmbalagem?.sigla || 'UN',
              unidadeMedidaCasasDecimais: unidadeEmbalagem ? Number(unidadeEmbalagem.casasDecimais) : 0,
              unidadeMedidaFracionado: Boolean(unidadeEmbalagem?.permiteFracionado),
              descricao: embalagem.descricao.trim(),
              fatorConversao: toNumber(embalagem.fatorConversao),
              precoVenda: toNumber(embalagem.precoVenda),
              codigoBarras: embalagem.codigoBarras.trim(),
              ativo: embalagem.ativo,
            };
          }),
        ultimaAlteracaoPreco: mudouPreco ? new Date().toISOString() : produtoOriginal?.ultimaAlteracaoPreco || null,
        historicoPrecos: ultimoHistorico,
        precos: {
          venda: precoVenda,
          promocional: precoPromocional,
          custo: precoCusto,
          margemLucro,
          lucroEstimado,
          ...(comissaoPercentualValor !== undefined ? { comissaoPercentual: comissaoPercentualValor } : {}),
          ...(precoAVistaValor !== undefined ? { aVista: precoAVistaValor } : {}),
          ...(precoAPrazoValor !== undefined ? { aPrazo: precoAPrazoValor } : {}),
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
          cstIbs: formData.cstIbs,
          cstCbs: formData.cstCbs,
          cstIpi: formData.cstIpi,
          aliquotaIcms: toNumber(formData.aliquotaIcms),
          aliquotaPis: toNumber(formData.aliquotaPis),
          aliquotaCofins: toNumber(formData.aliquotaCofins),
          aliquotaIbs: toNumber(formData.aliquotaIbs),
          aliquotaCbs: toNumber(formData.aliquotaCbs),
          aliquotaIpi: toNumber(formData.aliquotaIpi),
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
          lote: formData.lote,
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
      // Nunca gravar undefined no Firestore (CLAUDE.md) -- em branco, a
      // chave precisa sumir de vez, nao so ficar com valor undefined.
      if (comissaoPercentualValor === undefined) delete (produtoData as Record<string, unknown>).comissaoPercentual;
      if (precoAVistaValor === undefined) delete (produtoData as Record<string, unknown>).precoAVista;
      if (precoAPrazoValor === undefined) delete (produtoData as Record<string, unknown>).precoAPrazo;

      if (isEditing && id) {
        await updateDoc(doc(db, 'estoque', id), {
          ...produtoData,
          // updateDoc so mescla campos que aparecem no payload -- so OMITIR
          // a chave (como fez o delete acima) deixaria uma comissao antiga
          // gravada intacta se o usuario limpou o campo pra voltar ao
          // fallback do vendedor/sistema. deleteField() remove de verdade.
          ...(comissaoPercentualValor === undefined ? { comissaoPercentual: deleteField() } : {}),
          ...(precoAVistaValor === undefined ? { precoAVista: deleteField() } : {}),
          ...(precoAPrazoValor === undefined ? { precoAPrazo: deleteField() } : {}),
          tenantId: tenantId || '',
          updatedAt: serverTimestamp(),
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp()),
        });
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
        const newDocRef = await addDoc(collection(db, 'estoque'), {
          ...produtoData,
          tenantId: tenantId || '',
          createdAt: serverTimestamp(),
          ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
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

  if (!canEditProduto) {
    return (
      <div className="estoque-loading">
        <Loader2 size={20} className="spin-icon" />
        Redirecionando...
      </div>
    );
  }

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
            .filter(tab => modoCadastro === 'avancado' || ['geral', 'precos', 'historico', 'estoque', 'fiscal'].includes(tab.id))
            // A aba Embalagens acompanha a chave "Vender por embalagem" das
            // Configuracoes. Desligar so esconde: nenhuma embalagem ja
            // cadastrada e apagada, e religar traz tudo de volta.
            .filter(tab => tab.id !== 'embalagens' || venderPorEmbalagem)
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
                  <select name="categoria" value={formData.categoria} onChange={handleChange} className="form-select" required={!validarCadastroProduto}>
                    {categoriasDB.map((cat, idx) => <option key={idx} value={cat}>{cat}</option>)}
                  </select>
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
                  <input
                    type="number"
                    name="precoCusto"
                    step="0.01"
                    min="0"
                    value={custoCalculadoPelaComposicao ? precoCusto.toFixed(2) : formData.precoCusto}
                    onChange={handleChange}
                    readOnly={custoCalculadoPelaComposicao}
                    disabled={custoCalculadoPelaComposicao}
                  />
                  {custoCalculadoPelaComposicao && (
                    <span className="field-hint">Calculado automaticamente pela composição (aba "Composição"), não editável aqui.</span>
                  )}
                </div>
                <div className="input-group">
                  <label>Última alteração</label>
                  <input type="text" value={produtoOriginal?.ultimaAlteracaoPreco ? new Date(produtoOriginal.ultimaAlteracaoPreco).toLocaleDateString('pt-BR') : 'Sem histórico'} readOnly />
                </div>
                <div className="input-group">
                  <label>Preço à vista</label>
                  <input type="number" name="precoAVista" step="0.01" min="0" placeholder="Ainda sem uso na venda" value={formData.precoAVista} onChange={handleChange} />
                  <span className="field-hint">Só o dado, por enquanto — a venda continua usando o "Preço de venda" acima.</span>
                </div>
                <div className="input-group">
                  <label>Preço a prazo</label>
                  <input type="number" name="precoAPrazo" step="0.01" min="0" placeholder="Ainda sem uso na venda" value={formData.precoAPrazo} onChange={handleChange} />
                  <span className="field-hint">Só o dado, por enquanto — a venda continua usando o "Preço de venda" acima.</span>
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
                  <input type="number" name="comissaoPercentual" step="0.01" min="0" value={formData.comissaoPercentual} onChange={handleChange} placeholder="Sem comissão própria" />
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Em branco, a venda usa a comissão do vendedor ou do sistema.</span>
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
                  <>
                    <div className="history-list">
                      {historicoPrecos.slice(0, 3).map((item, index) => (
                        <span key={index}>
                          {new Date(item.alteradoEm).toLocaleDateString('pt-BR')} — venda {formatCurrency(item.precoAnterior)} para {formatCurrency(item.precoNovo)}
                        </span>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setActiveTab('historico')}
                      style={{ marginTop: '12px' }}
                    >
                      Ver histórico completo ({historicoPrecos.length} alteraç{historicoPrecos.length === 1 ? 'ão' : 'ões'})
                    </button>
                  </>
                ) : (
                  <p>Nenhuma alteração registrada ainda. O histórico será criado automaticamente ao mudar preço ou custo.</p>
                )}
              </div>
            </div>
          )}

          {/* Historico de Precos: somente leitura. Cada linha e' uma gravacao
              do produto em que o preco de venda OU o custo mudou -- os dois
              ficam lado a lado porque a pergunta real de quem abre isso e'
              "a margem melhorou ou piorou?", que nenhum dos dois responde
              sozinho. Registro novo entra no topo (o save faz unshift). */}
          {activeTab === 'historico' && (
            <div className="card form-section product-card">
              <div className="section-header">
                <h3>Histórico de Preços</h3>
              </div>

              {historicoPrecos.length === 0 ? (
                <div className="info-panel">
                  <p style={{ margin: 0 }}>
                    Nenhuma alteração de preço registrada neste produto ainda.
                    O registro é criado automaticamente sempre que o preço de venda
                    ou o preço de custo mudar e o produto for salvo.
                  </p>
                </div>
              ) : (
                <>
                  <div className="info-panel" style={{ marginBottom: '16px' }}>
                    <p style={{ margin: 0 }}>
                      {historicoPrecos.length} alteraç{historicoPrecos.length === 1 ? 'ão registrada' : 'ões registradas'}, da mais recente para a mais antiga.
                      Cada linha mostra como o preço estava <strong>antes</strong> e como ficou <strong>depois</strong> daquela gravação.
                    </p>
                  </div>

                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ backgroundColor: 'var(--bg-tertiary)', textAlign: 'left' }}>
                          <th style={{ padding: '12px', fontSize: '13px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Data</th>
                          <th style={{ padding: '12px', fontSize: '13px', color: 'var(--text-muted)' }}>Alterado por</th>
                          <th style={{ padding: '12px', fontSize: '13px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Custo</th>
                          <th style={{ padding: '12px', fontSize: '13px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Venda</th>
                          <th style={{ padding: '12px', fontSize: '13px', color: 'var(--text-muted)', textAlign: 'right', whiteSpace: 'nowrap' }}>Margem depois</th>
                        </tr>
                      </thead>
                      <tbody>
                        {historicoPrecos.map((item, index) => {
                          const custoMudou = Number(item.custoAnterior) !== Number(item.custoNovo);
                          const vendaMudou = Number(item.precoAnterior) !== Number(item.precoNovo);
                          const margemDepois = Number(item.custoNovo) > 0
                            ? ((Number(item.precoNovo) - Number(item.custoNovo)) / Number(item.custoNovo)) * 100
                            : null;
                          const alteradoEm = new Date(item.alteradoEm);
                          const nomeUsuario = item.usuarioId
                            ? (nomesUsuarios[item.usuarioId] || item.usuarioId)
                            : 'Não identificado';

                          return (
                            <tr key={`${item.alteradoEm}-${index}`} style={{ borderBottom: '1px solid var(--border-color)' }}>
                              <td style={{ padding: '12px', whiteSpace: 'nowrap' }}>
                                {Number.isNaN(alteradoEm.getTime())
                                  ? '—'
                                  : alteradoEm.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                              </td>
                              <td style={{ padding: '12px', color: 'var(--text-secondary)' }}>{nomeUsuario}</td>
                              <td style={{ padding: '12px', whiteSpace: 'nowrap' }}>
                                {custoMudou ? (
                                  <>
                                    <span style={{ color: 'var(--text-muted)', textDecoration: 'line-through' }}>
                                      {formatCurrency(Number(item.custoAnterior))}
                                    </span>
                                    {' → '}
                                    <strong style={{ color: Number(item.custoNovo) > Number(item.custoAnterior) ? '#ef4444' : '#10b981' }}>
                                      {formatCurrency(Number(item.custoNovo))}
                                    </strong>
                                  </>
                                ) : (
                                  <span style={{ color: 'var(--text-muted)' }}>
                                    {formatCurrency(Number(item.custoNovo))} (sem mudança)
                                  </span>
                                )}
                              </td>
                              <td style={{ padding: '12px', whiteSpace: 'nowrap' }}>
                                {vendaMudou ? (
                                  <>
                                    <span style={{ color: 'var(--text-muted)', textDecoration: 'line-through' }}>
                                      {formatCurrency(Number(item.precoAnterior))}
                                    </span>
                                    {' → '}
                                    <strong style={{ color: Number(item.precoNovo) > Number(item.precoAnterior) ? '#10b981' : '#ef4444' }}>
                                      {formatCurrency(Number(item.precoNovo))}
                                    </strong>
                                  </>
                                ) : (
                                  <span style={{ color: 'var(--text-muted)' }}>
                                    {formatCurrency(Number(item.precoNovo))} (sem mudança)
                                  </span>
                                )}
                              </td>
                              <td style={{ padding: '12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                {margemDepois === null
                                  ? <span style={{ color: 'var(--text-muted)' }}>—</span>
                                  : <span style={{ color: margemDepois < 0 ? '#ef4444' : 'var(--text-primary)' }}>
                                      {margemDepois.toFixed(1)}%
                                    </span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
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
                        : (
                          <>
                            Em produto já cadastrado, a quantidade muda por NFE, venda, cancelamento, movimentação ou pelo{' '}
                            <button
                              type="button"
                              className="link-button"
                              onClick={() => navigate(`/estoque/ajuste?produtoId=${id}`)}
                            >
                              Ajuste Manual de Estoque
                            </button>.
                          </>
                        )}
                    </span>
                  )}
                  {isEditing && Number(produtoOriginal?.quantidadeReservada) > 0 && (
                    <span className="field-hint">
                      Disponível: {computeAvailableStock(Number(formData.quantidade), produtoOriginal?.quantidadeReservada)}
                      {' '}({produtoOriginal?.quantidadeReservada} reservado em Ordens de Serviço)
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

              {usesCsosn(regimeTributario) && (
                <div className="input-group">
                  <label>Perfil fiscal automático</label>
                  <select value={formData.perfilFiscal} onChange={(e) => applyFiscalProfile(e.target.value)} className="form-select">
                    <option value="">Selecionar perfil...</option>
                    {Object.entries(fiscalProfiles).map(([key, profile]) => <option key={key} value={key}>{profile.label}</option>)}
                  </select>
                  <span className="field-hint">Ao selecionar um perfil, CFOP, CSOSN, origem e ST são preenchidos automaticamente.</span>
                </div>
              )}

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
                  <label>Peso líquido por unidade (kg)</label>
                  <input type="number" name="pesoLiquidoUnitarioKg" step="0.001" min="0" placeholder="Ex: 0.500" value={formData.pesoLiquidoUnitarioKg} onChange={handleChange} />
                  <span className="field-hint">Obrigatório só para CFOP de exportação (7101/7102) — usado pra converter a quantidade vendida em unidade pra quilo na nota fiscal, exigência da SEFAZ para operações de exportação.</span>
                </div>
                <div className="input-group">
                  <label>{usesCsosn(regimeTributario) ? 'CSOSN *' : 'CST de ICMS *'}</label>
                  <select name="csosn" value={formData.csosn} onChange={handleChange} className="form-select" required={!validarCadastroProduto}>
                    {(usesCsosn(regimeTributario) ? CSOSN_OPTIONS : ICMS_CST_OPTIONS).map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
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

              <div className="form-grid-4">
                <div className="input-group">
                  <label>CST IPI</label>
                  <select name="cstIpi" value={formData.cstIpi} onChange={handleChange} className="form-select">
                    {cstOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </div>
                <div className="input-group">
                  <label>Alíquota IPI (%)</label>
                  <input type="number" name="aliquotaIpi" step="0.01" min="0" value={formData.aliquotaIpi} onChange={handleChange} />
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

              <div className="form-grid-4">
                <div className="input-group">
                  <label>CST IBS</label>
                  <select name="cstIbs" value={formData.cstIbs} onChange={handleChange} className="form-select">
                    {cstOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </div>
                <div className="input-group">
                  <label>Alíquota IBS (%)</label>
                  <input type="number" name="aliquotaIbs" step="0.01" min="0" value={formData.aliquotaIbs} onChange={handleChange} />
                </div>
                <div className="input-group">
                  <label>CST CBS</label>
                  <select name="cstCbs" value={formData.cstCbs} onChange={handleChange} className="form-select">
                    {cstOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </div>
                <div className="input-group">
                  <label>Alíquota CBS (%)</label>
                  <input type="number" name="aliquotaCbs" step="0.01" min="0" value={formData.aliquotaCbs} onChange={handleChange} />
                </div>
              </div>
              <span className="field-hint">IBS e CBS são os novos tributos da Reforma Tributária (substituem gradualmente ICMS/ISS e PIS/COFINS até 2033).</span>

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

          {activeTab === 'embalagens' && (
            <div className="card form-section product-card">
              <div className="section-header">
                <Package size={20} className="section-icon" />
                <div>
                  <h3>Embalagens</h3>
                  <p>Formas alternativas de vender este produto. O estoque continua sendo controlado em {baseUnidadeSigla} — vender 1 embalagem baixa o fator de conversão dela.</p>
                </div>
              </div>

              <div className="form-grid-3" style={{ alignItems: 'flex-end' }}>
                <div className="input-group">
                  <label>Unidade de medida</label>
                  <select
                    value={novaEmbalagem.unidadeMedidaId}
                    onChange={(e) => setNovaEmbalagem(prev => ({ ...prev, unidadeMedidaId: e.target.value }))}
                  >
                    <option value="">Selecione...</option>
                    {activeUnidades.map(unidade => (
                      <option key={unidade.id} value={unidade.id}>{unidade.sigla} — {unidade.nome}</option>
                    ))}
                  </select>
                </div>
                <div className="input-group">
                  <label>Fator de conversão (em {baseUnidadeSigla})</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={novaEmbalagem.fatorConversao}
                    onChange={(e) => setNovaEmbalagem(prev => ({ ...prev, fatorConversao: e.target.value }))}
                  />
                </div>
                <div className="input-group">
                  <label>Preço de venda</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder={`Vazio = ${formatCurrency(precoVenda)} × fator`}
                    value={novaEmbalagem.precoVenda}
                    onChange={(e) => setNovaEmbalagem(prev => ({ ...prev, precoVenda: e.target.value }))}
                  />
                </div>
                <div className="input-group">
                  <label>Código de barras</label>
                  <input
                    value={novaEmbalagem.codigoBarras}
                    onChange={(e) => setNovaEmbalagem(prev => ({ ...prev, codigoBarras: e.target.value }))}
                  />
                </div>
                <div className="input-group">
                  <label>Descrição</label>
                  <input
                    placeholder="Ex.: Saco de 20kg"
                    value={novaEmbalagem.descricao}
                    onChange={(e) => setNovaEmbalagem(prev => ({ ...prev, descricao: e.target.value }))}
                  />
                </div>
                <button type="button" className="btn-secondary" onClick={handleAddEmbalagem} style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
                  <Plus size={16} /> Adicionar embalagem
                </button>
              </div>

              <div className="table-wrapper" style={{ marginTop: '20px' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Unidade</th>
                      <th>Fator</th>
                      <th>Preço</th>
                      <th>Código de barras</th>
                      <th>Descrição</th>
                      <th>Ativa</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {embalagens.length === 0 ? (
                      <tr>
                        <td colSpan={7} style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
                          Nenhuma embalagem cadastrada. O produto é vendido apenas em {baseUnidadeSigla}.
                        </td>
                      </tr>
                    ) : (
                      embalagens.map(embalagem => {
                        const unidadeEmbalagem = activeUnidades.find(u => u.id === embalagem.unidadeMedidaId);
                        const fator = toNumber(embalagem.fatorConversao);
                        const precoEfetivo = toNumber(embalagem.precoVenda) > 0
                          ? toNumber(embalagem.precoVenda)
                          : precoVenda * fator;
                        return (
                          <tr key={embalagem.id} style={{ opacity: embalagem.ativo ? 1 : 0.5 }}>
                            <td>
                              <strong>{unidadeEmbalagem?.sigla || '—'}</strong>
                              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                1 {unidadeEmbalagem?.sigla || '?'} = {formatFatorConversao(fator)} {baseUnidadeSigla}
                              </div>
                            </td>
                            <td style={{ maxWidth: '120px' }}>
                              <input
                                type="number"
                                step="any"
                                min="0"
                                value={embalagem.fatorConversao}
                                onChange={(e) => updateEmbalagem(embalagem.id, 'fatorConversao', e.target.value)}
                              />
                            </td>
                            <td style={{ maxWidth: '140px' }}>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder={formatCurrency(precoEfetivo)}
                                value={embalagem.precoVenda}
                                onChange={(e) => updateEmbalagem(embalagem.id, 'precoVenda', e.target.value)}
                              />
                            </td>
                            <td style={{ maxWidth: '180px' }}>
                              <input
                                value={embalagem.codigoBarras}
                                onChange={(e) => updateEmbalagem(embalagem.id, 'codigoBarras', e.target.value)}
                              />
                            </td>
                            <td>
                              <input
                                value={embalagem.descricao}
                                onChange={(e) => updateEmbalagem(embalagem.id, 'descricao', e.target.value)}
                              />
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <input
                                type="checkbox"
                                checked={embalagem.ativo}
                                onChange={(e) => updateEmbalagem(embalagem.id, 'ativo', e.target.checked)}
                              />
                            </td>
                            <td>
                              <button type="button" className="icon-btn" style={{ color: '#ef4444' }} title="Remover" onClick={() => removeEmbalagem(embalagem.id)}>
                                <Trash2 size={16} />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="info-panel compact-panel" style={{ marginTop: '16px' }}>
                <strong>Como isso aparece na venda</strong>
                <p>
                  O operador escolhe a unidade ao lado da quantidade: {baseUnidadeSigla}
                  {embalagens.filter(e => e.ativo).map(e => {
                    const sigla = activeUnidades.find(u => u.id === e.unidadeMedidaId)?.sigla || 'UN';
                    return ` ou ${sigla}(${formatFatorConversao(toNumber(e.fatorConversao))})`;
                  }).join('')}.
                  Desativar uma embalagem tira ela do seletor sem apagar o cadastro.
                </p>
              </div>
            </div>
          )}

          {activeTab === 'composicao' && (
            <div className="card form-section product-card">
              <div className="section-header">
                <Factory size={20} className="section-icon" />
                <div>
                  <h3>Composição (Produção)</h3>
                  <p>Matérias-primas e quantidades necessárias para produzir 1 unidade deste produto.</p>
                </div>
              </div>

              {!isEditing ? (
                <div className="info-panel">
                  <strong>Salve o produto primeiro</strong>
                  <p>A composição só pode ser definida depois que o produto for salvo pela primeira vez.</p>
                </div>
              ) : composicaoLoading ? (
                <p>Carregando composição...</p>
              ) : (
                <>
                  {materiasPrimasDisponiveis.length === 0 ? (
                    <div className="info-panel">
                      <strong>Nenhuma matéria-prima cadastrada</strong>
                      <p>Cadastre matérias-primas em Cadastros → Matéria-Prima antes de montar a composição.</p>
                    </div>
                  ) : (
                    <>
                      <div className="form-grid-3" style={{ alignItems: 'flex-end' }}>
                        <div className="input-group">
                          <label>Matéria-Prima</label>
                          <select value={novaMateriaPrimaId} onChange={(e) => setNovaMateriaPrimaId(e.target.value)}>
                            <option value="">Selecione...</option>
                            {materiasPrimasDisponiveis
                              .filter(mp => !composicaoItens.some(item => item.materiaPrimaId === mp.id))
                              .map(mp => (
                                <option key={mp.id} value={mp.id}>{mp.nome}</option>
                              ))}
                          </select>
                        </div>
                        <div className="input-group">
                          <label>Quantidade por unidade produzida</label>
                          <input type="number" step="any" min="0" value={novaQuantidade} onChange={(e) => setNovaQuantidade(e.target.value)} />
                        </div>
                        <button type="button" className="btn-secondary" onClick={handleAdicionarItemComposicao} style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
                          <Plus size={16} /> Adicionar
                        </button>
                      </div>

                      <div className="table-wrapper" style={{ marginTop: '20px' }}>
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>Matéria-Prima</th>
                              <th>Quantidade por unidade</th>
                              <th>Ações</th>
                            </tr>
                          </thead>
                          <tbody>
                            {composicaoItens.length === 0 ? (
                              <tr>
                                <td colSpan={3} style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
                                  Nenhuma matéria-prima adicionada ainda.
                                </td>
                              </tr>
                            ) : (
                              composicaoItens.map(item => (
                                <tr key={item.materiaPrimaId}>
                                  <td>{item.materiaPrimaNome}</td>
                                  <td>{item.quantidade} {item.unidade}</td>
                                  <td>
                                    <button type="button" className="icon-btn" style={{ color: '#ef4444' }} title="Remover" onClick={() => handleRemoverItemComposicao(item.materiaPrimaId)}>
                                      <Trash2 size={16} />
                                    </button>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}

                  {composicaoItens.length > 0 && (
                    <div className="info-panel" style={{ marginTop: '20px' }}>
                      <strong>Custo total da composição: {formatCurrency(custoComposicao)}</strong>
                      <p>
                        {formData.produzidoInternamente
                          ? 'Este valor substitui automaticamente o "Custo do produto" na aba Preços e Custos, somando (quantidade × custo unitário) de cada matéria-prima.'
                          : 'Marque "Produto produzido internamente" na aba Configurações Avançadas para este valor ser usado como custo do produto.'}
                      </p>
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={handleSalvarComposicao}
                      disabled={isSavingComposicao}
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: isSavingComposicao ? 0.7 : 1 }}
                    >
                      {isSavingComposicao ? <Loader2 size={16} className="spin-icon" /> : <Save size={16} />}
                      {isSavingComposicao ? 'Salvando...' : 'Salvar Composição'}
                    </button>
                  </div>
                </>
              )}
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

              <div className="form-grid-3">
                <div className="input-group">
                  <label>Lote</label>
                  <input type="text" name="lote" placeholder="Ex: L2026-08" value={formData.lote} onChange={handleChange} />
                </div>
                <div className="input-group">
                  <label>Validade</label>
                  <input type="date" name="validade" value={formData.validade} onChange={handleChange} />
                </div>
              </div>
            </div>
          )}
        </div>
      </form>
    </div>
  );
};

export default EstoqueForm;
