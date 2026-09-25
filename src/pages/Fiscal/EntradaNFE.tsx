import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Upload, FileText, Package, CheckCircle, Save, ArrowLeft, Trash2, AlertTriangle, Truck, Loader2, History, Search, Printer } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTabs } from '../../contexts/TabsContext';
import { collection, query, where, getDocs, doc, getDoc, addDoc, increment, runTransaction, serverTimestamp, type DocumentData, type DocumentSnapshot } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError, showWarning, NexusSwal } from '../../utils/alerts';
import ClientAutocomplete from '../../components/common/ClientAutocomplete';
import { useTenantCollection } from '../../hooks/useTenantCollection';
import { notaRecebidaService, NotaRecebidaError } from '../../services/notaRecebidaService';
import {
  credorDoFrete,
  descricaoDoTituloDeFrete,
  erroDoFrete,
  freteGeraTituloProprio,
  somenteDigitos,
  vencimentoDoFrete,
  type DadosDoFrete,
} from '../../utils/freteEntradaDomain';
import {
  buscarCadastros,
  configDoItemSemVinculo,
  configDoItemVinculado,
  dadosFiscaisParaCompletar,
  sugerirVinculos,
  type TipoCadastro,
} from '../../utils/vinculoItemNfeDomain';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { aplicarCaixaAltaCadastro } from '../../utils/textoCadastroDomain';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import {
  DEFAULT_REGIME_TRIBUTARIO,
  matchProdutoFromXmlItem,
  matchMateriaPrimaFromXmlItem,
  usesCsosn,
  type EstoqueItemForMatch,
  type MateriaPrimaItemForMatch,
  type RegimeTributario,
} from '../../utils/fiscalDomain';
import {
  buildNotaFiscalEntradaRecord,
  buildInitialItemEntradaConfig,
  cfopDeSaidaSugerido,
  mensagemDeNotaDuplicada,
  primeiraNotaAtiva,
  semUndefined,
  type NotaFiscalEntradaItemRecord,
  type ItemEntradaConfig,
} from '../../utils/entradaNfeDomain';
import { contextoDeReajuste, sincronizarCustosSemFalhar } from '../../services/custoProducaoService';
import { mostrarImpactoDeCusto } from '../../utils/impactoCustoAlert';
import type { MudancaDeCusto } from '../../utils/custoProducaoDomain';
import CabecalhoDaNota from '../../components/fiscal/entrada/CabecalhoDaNota';
import TotaisDaNotaCard from '../../components/fiscal/entrada/TotaisDaNotaCard';
import PagamentoCard, { type BancoParaEntrada } from '../../components/fiscal/entrada/PagamentoCard';
import { campoInputStyle } from '../../components/fiscal/entrada/estilos';
import ItemDaNotaCard, { type CadastroVinculado } from '../../components/fiscal/entrada/ItemDaNotaCard';
import PdfVisualizador from '../../components/common/PdfVisualizador';
import { parseNfeXml, rotuloDaFormaDePagamento, type ItemDaNota, type NotaParseada } from '../../utils/nfeXmlDomain';
import {
  calcularCustoDaEntrada,
  conferirNota,
  custoMedioPonderado,
  custoUnitarioNoEstoque,
  fatorValido,
  opcoesDeCustoPorRegime,
  quantidadeNoEstoque,
  type OpcoesDeCustoDeEntrada,
} from '../../utils/custoEntradaDomain';
import { numeroDaTela, precoPadraoDeItemNovo, precoPeloMarkup } from '../../utils/precificacaoEntradaDomain';
import {
  CATEGORIAS_DE_COMPRA,
  conferirParcelas,
  erroDoPagamentoAVista,
  parcelasIniciais,
  type DestinoDoPagamento,
  type ModoDePagamento,
} from '../../utils/pagamentoEntradaDomain';
import { camposDoTituloEmCheque, erroDosCheques, type ParcelaComCheque } from '../../utils/chequeEmitidoDomain';
import { compactarXml } from '../../utils/xmlCompactoDomain';
import { fromCents, toCents } from '../../utils/financeDomain';
import Swal from 'sweetalert2';

/** Item da nota: tudo que o XML trouxe + o total do produto com o nome que a tela ja usava. */
interface ParsedItem extends ItemDaNota {
  valorTotal: number;
}

interface Duplicata {
  numero: string;
  vencimento: string;
  valor: number;
}

interface ParsedXML {
  /** Leitura completa da nota (chave, serie, impostos, transporte...). */
  nota: NotaParseada;
  /** XML original: guardado compactado junto da entrada e usado no DANFE. */
  xmlTexto: string;
  fornecedorNome: string;
  fornecedorCnpj: string;
  numeroNF: string;
  dataEmissao: string;
  valorTotal: number;
  /** vFrete do XML: frete cobrado pelo PROPRIO fornecedor, dentro da nota.
   *  Vira o valor inicial do campo de frete (editavel). */
  valorFreteXml: number;
  items: ParsedItem[];
  duplicatas: Duplicata[];
}

interface EstoqueItem extends EstoqueItemForMatch {
  quantidade: number;
  precoCusto?: number;
  unidadeMedidaSigla?: string;
  descontoMaximoPercentual?: number;
  atacado?: { ativo?: boolean; quantidadeMinima?: number; faixas?: Array<{ preco?: number; quantidadeInicial?: number }> };
  /** fornecedorId -> quantas unidades de estoque em 1 unidade da nota (aprendido). */
  fatoresFornecedor?: Record<string, number>;
  precoVenda?: number;
  csosn?: string;
  aliquotaIcms?: number;
  reducaoBaseIcms?: number;
  cstPis?: string;
  aliquotaPis?: number;
  cstCofins?: string;
  aliquotaCofins?: number;
}

interface MateriaPrimaItem extends MateriaPrimaItemForMatch {
  quantidade: number;
  precoCusto?: number;
  unidade?: string;
  fatoresFornecedor?: Record<string, number>;
}

type FornecedorStatus = 'idle' | 'checking' | 'found' | 'missing';

const currencyFormat = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const EntradaNFE: React.FC = () => {
  const navigate = useNavigate();
  const { openTab } = useTabs();
  const { tenantId, currentUser } = useAuth();
  const [dragActive, setDragActive] = useState(false);
  /**
   * BUSCA DA NOTA PELA CHAVE (2026-09-21).
   *
   * Alternativa ao arquivo XML: digita os 44 numeros e o sistema puxa a nota
   * da SEFAZ (via Spedy). O XML completo so' vem depois da MANIFESTACAO, que
   * e' ato fiscal -- por isso ha um passo de confirmacao no meio, nunca
   * automatico. Ver src/services/notaRecebidaService.ts.
   */
  const [chaveBusca, setChaveBusca] = useState('');
  const [buscandoPorChave, setBuscandoPorChave] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Estado com dados parseados
  const [parsedData, setParsedData] = useState<ParsedXML | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Estoque e materia-prima atuais para busca rápida local
  const [estoqueAtual, setEstoqueAtual] = useState<EstoqueItem[]>([]);
  const [materiasPrimasAtuais, setMateriasPrimasAtuais] = useState<MateriaPrimaItem[]>([]);
  // Insumos (material de consumo): cadastro proprio, mesmo formato da materia-prima.
  const [insumosAtuais, setInsumosAtuais] = useState<MateriaPrimaItem[]>([]);
  // Sobe a cada nota importada: recarrega estoque/materia-prima. Sem isso a
  // proxima nota da mesma sessao enxergava o cadastro de ANTES da anterior
  // (produto criado na nota 1 nao era reconhecido na nota 2 e duplicava).
  const [versaoDosCadastros, setVersaoDosCadastros] = useState(0);

  // Classificacao (Revenda/Materia-Prima) + precificacao/tributacao por
  // item da nota (Fatia 2/N) -- array paralelo a parsedData.items,
  // inicializado so depois que o fornecedor resolve (ver efeito abaixo),
  // pra nao classificar errado um item que so seria reconhecido pelo
  // codigo que ESSE fornecedor usa (camada 2 do matching).
  const [itemConfigs, setItemConfigs] = useState<ItemEntradaConfig[]>([]);

  // Entrada de nota completa (2026-09-24): dados que o outro ERP pede na
  // entrada e o nosso nao tinha.
  const [dataEntrada, setDataEntrada] = useState(getDateInputInTimeZone());
  const [observacao, setObservacao] = useState('');
  const [opcoesCusto, setOpcoesCusto] = useState<OpcoesDeCustoDeEntrada>(opcoesDeCustoPorRegime('simples_nacional'));
  const [divergenciaAceita, setDivergenciaAceita] = useState(false);
  const [modoPagamento, setModoPagamento] = useState<ModoDePagamento>('prazo');
  const [parcelas, setParcelas] = useState<ParcelaComCheque[]>([]);
  const [parcelasAceitas, setParcelasAceitas] = useState(false);
  const [categoriaDespesa, setCategoriaDespesa] = useState<string>(CATEGORIAS_DE_COMPRA[0]);
  // Plano de contas de despesas da empresa (Configuracoes); vazio = lista padrao de compras.
  const [categoriasDaEmpresa, setCategoriasDaEmpresa] = useState<string[]>([]);
  const [formaPrevista, setFormaPrevista] = useState('Boleto');
  // Cheque nunca e' 'a vista': o dinheiro so' sai quando o cheque compensa.
  const modoPagamentoEfetivo: ModoDePagamento = formaPrevista === 'Cheque' ? 'prazo' : modoPagamento;
  const [destinoPagamento, setDestinoPagamento] = useState<DestinoDoPagamento>('caixa');
  const [bancoId, setBancoId] = useState('');
  const [bancos, setBancos] = useState<BancoParaEntrada[]>([]);
  // Texto de markup enquanto a pessoa digita (senao o campo "pula" a cada tecla).
  const [markupDigitado, setMarkupDigitado] = useState<Record<string, string>>({});
  const [danfe, setDanfe] = useState<{ blob: Blob; nome: string } | null>(null);
  const [gerandoDanfe, setGerandoDanfe] = useState(false);

  // Reconciliação do fornecedor do XML com o cadastro de Fornecedores --
  // a confirmação da entrada fica bloqueada até haver um fornecedor
  // vinculado (decisão combinada com o usuário: não deixa entrar nota
  // com fornecedor "texto livre" sem cadastro).
  const [fornecedorMatch, setFornecedorMatch] = useState<{ id: string; nome: string } | null>(null);
  /**
   * FRETE / CONHECIMENTO DE TRANSPORTE (2026-09-21).
   *
   * O valor entra no CUSTO dos produtos (rateado por valor) e, quando ha
   * transportadora, vira um titulo A PAGAR proprio dela -- separado do titulo
   * do fornecedor da mercadoria. Ver src/utils/freteEntradaDomain.ts.
   */
  const [frete, setFrete] = useState<DadosDoFrete>({ valor: 0, chaveCte: '', transportadoraId: '', transportadoraNome: '', vencimento: '', lancarNoFornecedor: false });
  const [buscaTransportadora, setBuscaTransportadora] = useState('');
  /**
   * A transportadora e' um FORNECEDOR do tipo Transportadora -- o cadastro de
   * fornecedor ja tem esse tipo, e o titulo do frete e' uma conta a pagar
   * como qualquer outra. Criar uma colecao separada duplicaria cadastro,
   * codigo, busca por CNPJ e o agrupamento de Contas a Pagar sem ganho.
   *
   * A lista traz todos os fornecedores (nao so' os do tipo Transportadora):
   * quem ainda nao marcou o tipo no cadastro conseguiria escolher assim
   * mesmo, em vez de travar no meio da entrada. O selo na lista mostra quais
   * ja estao marcados.
   */
  const { items: fornecedoresAtuais } = useTenantCollection<{ id: string; nome?: string; codigo?: string; tipo?: string; ativo?: boolean }>('fornecedores', tenantId);
  const [fornecedorStatus, setFornecedorStatus] = useState<FornecedorStatus>('idle');
  const [showFornecedorModal, setShowFornecedorModal] = useState(false);
  const [fornecedorForm, setFornecedorForm] = useState({ nome: '', cnpj: '', telefone: '', email: '' });
  const [isSavingFornecedor, setIsSavingFornecedor] = useState(false);

  // Regime tributario do tenant -- decide o CSOSN/CST default gravado num
  // produto novo criado pela importacao (mesmo padrao de leitura direta
  // de configuracoes/{tenantId} ja usado em EstoqueForm.tsx/NFE.tsx).
  const [regimeTributario, setRegimeTributario] = useState<RegimeTributario>(DEFAULT_REGIME_TRIBUTARIO);
  useEffect(() => {
    setOpcoesCusto(opcoesDeCustoPorRegime(regimeTributario));
  }, [regimeTributario]);

  // Custo REAL de cada item (frete, seguro, despesas, IPI, ST, desconto, creditos)
  // e a conferencia da nota contra ela mesma.
  const custosDosItens = useMemo(
    () => (parsedData ? calcularCustoDaEntrada(parsedData.items, parsedData.nota.totais, frete.valor, opcoesCusto) : []),
    [parsedData, frete.valor, opcoesCusto],
  );
  const conferencia = useMemo(
    () => (parsedData ? conferirNota(parsedData.items, parsedData.nota.totais) : null),
    [parsedData],
  );

  // Item NOVO (ou sem preco) acompanha o custo real com o markup padrao ate a
  // pessoa mexer no preco. Produto que JA tem preco nunca e' reajustado aqui.
  useEffect(() => {
    if (!parsedData) return;
    setItemConfigs((anteriores) => {
      let mudou = false;
      const proximas = anteriores.map((config, idx) => {
        const item = parsedData.items[idx];
        if (!item || config.tipo !== 'revenda' || config.precoEditado) return config;
        const custoUn = custoUnitarioNoEstoque(custosDosItens[idx]?.custoTotal ?? 0, item.quantidade, config.fator);
        const sugerido = precoPadraoDeItemNovo(custoUn);
        if (sugerido > 0 && Math.abs(sugerido - numeroDaTela(config.precoVenda)) > 0.004) {
          mudou = true;
          return { ...config, precoVenda: String(sugerido) };
        }
        return config;
      });
      return mudou ? proximas : anteriores;
    });
  }, [parsedData, custosDosItens, itemConfigs]);

  // Carrega produtos em estoque no carregamento para acelerar a reconciliação
  useEffect(() => {
    const fetchEstoque = async () => {
      if (!tenantId) return;
      try {
        const q = query(collection(db, 'estoque'), where('tenantId', '==', tenantId));
        const snap = await getDocs(q);
        const list: EstoqueItem[] = [];
        snap.forEach(d => {
          const data = d.data();
          list.push({
            id: d.id,
            codigo: data.codigo || '',
            nome: data.nome || '',
            codigoBarras: data.codigoBarras || '',
            ncm: data.ncm || data.fiscal?.ncm || '',
            codigosFornecedor: data.codigosFornecedor || {},
            quantidade: Number(data.quantidade || 0),
            precoCusto: Number(data.precoCusto ?? data.precos?.custo ?? 0),
            unidadeMedidaSigla: data.unidadeMedidaSigla || data.unidade || '',
            descontoMaximoPercentual: data.descontoMaximoPercentual !== undefined ? Number(data.descontoMaximoPercentual) : undefined,
            atacado: data.atacado || undefined,
            fatoresFornecedor: data.fatoresFornecedor || {},
            precoVenda: data.precoVenda !== undefined ? Number(data.precoVenda) : undefined,
            csosn: data.csosn || undefined,
            aliquotaIcms: data.aliquotaIcms !== undefined ? Number(data.aliquotaIcms) : undefined,
            reducaoBaseIcms: data.reducaoBaseIcms !== undefined ? Number(data.reducaoBaseIcms) : undefined,
            cstPis: data.cstPis || undefined,
            aliquotaPis: data.aliquotaPis !== undefined ? Number(data.aliquotaPis) : undefined,
            cstCofins: data.cstCofins || undefined,
            aliquotaCofins: data.aliquotaCofins !== undefined ? Number(data.aliquotaCofins) : undefined,
          });
        });
        setEstoqueAtual(list);
      } catch (err) {
        console.error("Erro ao carregar estoque para reconciliação:", err);
      }
    };
    const fetchMateriasPrimas = async () => {
      if (!tenantId) return;
      try {
        const q = query(collection(db, 'materias_primas'), where('tenantId', '==', tenantId));
        const snap = await getDocs(q);
        const list: MateriaPrimaItem[] = [];
        snap.forEach(d => {
          const data = d.data();
          list.push({
            id: d.id,
            codigo: data.codigo || '',
            nome: data.nome || '',
            codigosFornecedor: data.codigosFornecedor || {},
            quantidade: Number(data.quantidade || 0),
            precoCusto: Number(data.precoCusto || 0),
            unidade: data.unidade || '',
            fatoresFornecedor: data.fatoresFornecedor || {},
          });
        });
        setMateriasPrimasAtuais(list);
      } catch (err) {
        console.error("Erro ao carregar matérias-primas para reconciliação:", err);
      }
    };
    const fetchInsumos = async () => {
      if (!tenantId) return;
      try {
        const snap = await getDocs(query(collection(db, 'insumos'), where('tenantId', '==', tenantId)));
        setInsumosAtuais(snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            codigo: data.codigo || '',
            nome: data.nome || '',
            codigosFornecedor: data.codigosFornecedor || {},
            quantidade: Number(data.quantidade || 0),
            precoCusto: Number(data.precoCusto || 0),
            unidade: data.unidade || '',
            fatoresFornecedor: data.fatoresFornecedor || {},
          } as MateriaPrimaItem;
        }));
      } catch (err) {
        // Sem acesso a coleção (permissão) a entrada segue: só não reconhece insumos sozinha.
        console.error("Erro ao carregar insumos para reconciliação:", err);
      }
    };
    const fetchRegimeTributario = async () => {
      if (!tenantId) return;
      try {
        const configSnap = await getDoc(doc(db, 'configuracoes', tenantId));
        setRegimeTributario((configSnap.data()?.regimeTributario ?? DEFAULT_REGIME_TRIBUTARIO) as RegimeTributario);
        const plano = configSnap.data()?.planoContasDespesas;
        const listaDoPlano: string[] = Array.isArray(plano) ? plano : (typeof plano === 'string' ? plano.split(String.fromCharCode(10)) : []);
        const categoriasLimpas = listaDoPlano.map((c) => String(c).trim()).filter(Boolean);
        setCategoriasDaEmpresa(categoriasLimpas);
        if (categoriasLimpas.length > 0) {
          const preferida = categoriasLimpas.find((c) => c.toUpperCase() === CATEGORIAS_DE_COMPRA[0]) ?? categoriasLimpas[0];
          setCategoriaDespesa(preferida);
        }
      } catch (err) {
        console.error("Erro ao carregar regime tributário:", err);
      }
    };
    const fetchBancos = async () => {
      if (!tenantId) return;
      try {
        const snap = await getDocs(query(collection(db, 'bancos'), where('tenantId', '==', tenantId), where('ativo', '==', true)));
        setBancos(snap.docs.map((d) => ({ id: d.id, nome: String(d.data().nome || d.data().banco || 'Banco') })));
      } catch (err) {
        console.error('Erro ao carregar bancos:', err);
      }
    };
    fetchEstoque();
    fetchMateriasPrimas();
    fetchInsumos();
    fetchRegimeTributario();
    fetchBancos();
  }, [tenantId, versaoDosCadastros]);

  // Assim que o XML é lido, reconcilia o fornecedor pelo CNPJ com o
  // cadastro de Fornecedores. Sem match, abre o popup de cadastro rápido
  // e bloqueia a confirmação até ele ser preenchido.
  useEffect(() => {
    const checkFornecedor = async () => {
      if (!parsedData || !tenantId) return;
      setFornecedorStatus('checking');
      setFornecedorMatch(null);

      const cnpjDigits = parsedData.fornecedorCnpj.replace(/\D/g, '');
      try {
        if (cnpjDigits) {
          const q = query(
            collection(db, 'fornecedores'),
            where('tenantId', '==', tenantId),
            where('cnpj', '==', cnpjDigits)
          );
          const snap = await getDocs(q);
          if (!snap.empty) {
            const match = snap.docs[0];
            setFornecedorMatch({ id: match.id, nome: (match.data().nome as string) || parsedData.fornecedorNome });
            setFornecedorStatus('found');
            setShowFornecedorModal(false);
            return;
          }
        }

        setFornecedorStatus('missing');
        setFornecedorForm({ nome: parsedData.fornecedorNome, cnpj: cnpjDigits, telefone: '', email: '' });
        setShowFornecedorModal(true);
      } catch (err) {
        console.error('Erro ao verificar fornecedor:', err);
        setFornecedorStatus('missing');
        setFornecedorForm({ nome: parsedData.fornecedorNome, cnpj: cnpjDigits, telefone: '', email: '' });
        setShowFornecedorModal(true);
      }
    };

    checkFornecedor();
  }, [parsedData, tenantId]);

  // Classificacao (Revenda/Materia-Prima) + precificacao inicial por item
  // (Fatia 2/N) -- so roda depois que o fornecedor resolve (ver comentario
  // no state de itemConfigs). Recalcula so uma vez por arquivo importado
  // (nao reseta o que o usuario ja editou se o fornecedor for confirmado
  // de novo por algum motivo).
  const itemConfigsInitializedForRef = useRef<ParsedXML | null>(null);
  useEffect(() => {
    if (!parsedData) {
      setItemConfigs([]);
      itemConfigsInitializedForRef.current = null;
      return;
    }
    if (fornecedorStatus !== 'found' || !fornecedorMatch) return;
    if (itemConfigsInitializedForRef.current === parsedData) return;

    itemConfigsInitializedForRef.current = parsedData;
    const usaCsosn = usesCsosn(regimeTributario);
    const configs = parsedData.items.map((item): ItemEntradaConfig => {
      const { produto: pecaExistente, layer } = matchProdutoFromXmlItem(item, estoqueAtual, fornecedorMatch.id);
      if (pecaExistente) {
        return {
          ...buildInitialItemEntradaConfig(item.valorUnitario, pecaExistente, null, usaCsosn),
          origemVinculo: layer === 'ncm_nome' ? 'nome' : (layer ?? 'automatico'),
          fator: String(fatorValido(pecaExistente.fatoresFornecedor?.[fornecedorMatch.id])),
        };
      }
      const materiaPrimaExistente = matchMateriaPrimaFromXmlItem(item, materiasPrimasAtuais, fornecedorMatch.id);
      const insumoExistente = materiaPrimaExistente ? null : matchMateriaPrimaFromXmlItem(item, insumosAtuais, fornecedorMatch.id);
      const inicial = buildInitialItemEntradaConfig(item.valorUnitario, null, materiaPrimaExistente?.id || null, usaCsosn, insumoExistente?.id || null);
      const reconhecido = materiaPrimaExistente ?? insumoExistente;
      return reconhecido
        ? { ...inicial, origemVinculo: 'automatico', fator: String(fatorValido(reconhecido.fatoresFornecedor?.[fornecedorMatch.id])) }
        : inicial;
    });
    setItemConfigs(configs);
  }, [parsedData, fornecedorStatus, fornecedorMatch, estoqueAtual, materiasPrimasAtuais, insumosAtuais, regimeTributario]);

  const handleAlterarTipoItem = (idx: number, tipo: ItemEntradaConfig['tipo']) => {
    setItemConfigs((prev) => prev.map((config, i) => (i === idx ? { ...config, tipo } : config)));
  };

  /**
   * VINCULO MANUAL (2026-09-24): liga o item da nota a um produto/materia-prima
   * que ja existe, em vez de cadastrar de novo. Na confirmacao o codigo que o
   * fornecedor usa fica guardado no cadastro, e da proxima vez o sistema
   * vincula sozinho.
   */
  const [vinculoAberto, setVinculoAberto] = useState<number | null>(null);
  const [buscaVinculo, setBuscaVinculo] = useState('');

  const handleVincularItem = (idx: number, tipo: TipoCadastro, id: string) => {
    if (!parsedData) return;
    const item = parsedData.items[idx];
    const fiscal = tipo === 'estoque' ? estoqueAtual.find((p) => p.id === id) : undefined;
    const config = configDoItemVinculado({ tipo, id, fiscal }, item.valorUnitario, usesCsosn(regimeTributario));
    const cadastroEscolhido = tipo === 'estoque' ? fiscal : (tipo === 'insumo' ? insumosAtuais : materiasPrimasAtuais).find((m) => m.id === id);
    const fatorAprendido = String(fatorValido(cadastroEscolhido?.fatoresFornecedor?.[fornecedorMatch?.id ?? '']));
    setItemConfigs((prev) => prev.map((atual, i) => (i === idx ? { ...config, origemVinculo: 'manual', fator: fatorAprendido } : atual)));
    setVinculoAberto(null);
    setBuscaVinculo('');
  };

  const handleDesvincularItem = (idx: number) => {
    if (!parsedData) return;
    const config = configDoItemSemVinculo(parsedData.items[idx].valorUnitario, usesCsosn(regimeTributario));
    setItemConfigs((prev) => prev.map((atual, i) => (i === idx ? config : atual)));
  };

  const renderPainelDeVinculo = (idx: number, item: ParsedItem) => {
    if (!fornecedorMatch) return null;
    const sugestoes = sugerirVinculos(item, estoqueAtual, materiasPrimasAtuais, fornecedorMatch.id, 5, insumosAtuais);
    const resultados = buscaVinculo.trim() ? buscarCadastros(buscaVinculo, estoqueAtual, materiasPrimasAtuais, 20, insumosAtuais) : [];
    const rotuloTipo = (tipo: TipoCadastro) => (tipo === 'estoque' ? 'Produto' : (tipo === 'insumo' ? 'Insumo' : 'Matéria-prima'));
    const linhaStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', width: '100%', textAlign: 'left', padding: '8px 12px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '13px' };

    return (
      <div style={{ marginBottom: '14px', padding: '14px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
        <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginBottom: '10px', lineHeight: 1.5 }}>
          Escolha o cadastro que corresponde a <strong>{item.descricao}</strong>. O estoque será somado nele e, nas próximas notas
          deste fornecedor com o código <strong>{item.codigo || '—'}</strong>, o sistema vincula sozinho.
        </div>

        {sugestoes.length > 0 && (
          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 600 }}>SUGESTÕES</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {sugestoes.map((sugestao) => (
                <button key={`${sugestao.tipo}-${sugestao.id}`} type="button" style={linhaStyle} onClick={() => handleVincularItem(idx, sugestao.tipo, sugestao.id)}>
                  <span>
                    <strong>{sugestao.nome}</strong>
                    <span style={{ color: 'var(--text-muted)', marginLeft: '8px' }}>
                      {sugestao.codigo ? `cód. ${sugestao.codigo} · ` : ''}{rotuloTipo(sugestao.tipo)}
                    </span>
                    <span style={{ display: 'block', fontSize: '11.5px', color: 'var(--text-muted)' }}>{sugestao.motivos.join(' · ')}</span>
                  </span>
                  <span style={{ fontWeight: 700, color: sugestao.pontuacao >= 80 ? '#10b981' : '#f59e0b', whiteSpace: 'nowrap' }}>{sugestao.pontuacao}%</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 600 }}>BUSCAR NO CADASTRO</div>
        <input
          type="text"
          value={buscaVinculo}
          onChange={(e) => setBuscaVinculo(e.target.value)}
          placeholder="Nome, código ou código de barras..."
          aria-label="Buscar produto ou matéria-prima para vincular"
          style={{ ...campoInputStyle, marginBottom: '8px' }}
        />
        {buscaVinculo.trim() && resultados.length === 0 && (
          <div style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>
            Nada encontrado para "{buscaVinculo.trim()}". Confira a escrita ou deixe o item como novo.
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '240px', overflowY: 'auto' }}>
          {resultados.map((resultado) => (
            <button key={`${resultado.tipo}-${resultado.id}`} type="button" style={linhaStyle} onClick={() => handleVincularItem(idx, resultado.tipo, resultado.id)}>
              <span>
                <strong>{resultado.nome}</strong>
                <span style={{ color: 'var(--text-muted)', marginLeft: '8px' }}>
                  {resultado.codigo ? `cód. ${resultado.codigo} · ` : ''}{rotuloTipo(resultado.tipo)}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  };

  const handleAbrirVinculo = (idx: number) => {
    setBuscaVinculo('');
    setVinculoAberto((atual) => (atual === idx ? null : idx));
  };

  const handleAlterarConfigItem = (idx: number, patch: Partial<ItemEntradaConfig>) => {
    setItemConfigs((prev) => prev.map((config, i) => (i === idx ? { ...config, ...patch } : config)));
  };

  /** Custo por unidade de ESTOQUE do item (custo real da entrada / quantidade ja convertida). */
  const custoUnitarioDoItem = (idx: number): number => {
    const item = parsedData?.items[idx];
    if (!item) return 0;
    return custoUnitarioNoEstoque(custosDosItens[idx]?.custoTotal ?? 0, item.quantidade, itemConfigs[idx]?.fator);
  };

  const limparMarkup = (chave: string) => setMarkupDigitado((atual) => {
    if (!(chave in atual)) return atual;
    const resto = { ...atual };
    delete resto[chave];
    return resto;
  });

  const handlePrecoVarejo = (idx: number, texto: string) => {
    handleAlterarConfigItem(idx, { precoVenda: texto, precoEditado: true });
    limparMarkup(`${idx}-v`);
  };
  const handleMarkupVarejo = (idx: number, texto: string) => {
    setMarkupDigitado((atual) => ({ ...atual, [`${idx}-v`]: texto }));
    const preco = precoPeloMarkup(custoUnitarioDoItem(idx), texto);
    if (preco !== null) handleAlterarConfigItem(idx, { precoVenda: String(preco), precoEditado: true });
  };
  const handlePrecoAtacado = (idx: number, texto: string) => {
    handleAlterarConfigItem(idx, { atacadoPreco: texto });
    limparMarkup(`${idx}-a`);
  };
  const handleMarkupAtacado = (idx: number, texto: string) => {
    setMarkupDigitado((atual) => ({ ...atual, [`${idx}-a`]: texto }));
    const preco = precoPeloMarkup(custoUnitarioDoItem(idx), texto);
    if (preco !== null) handleAlterarConfigItem(idx, { atacadoPreco: String(preco) });
  };

  /** DANFE feito do XML que ja esta na tela -- antes de dar entrada. */
  const handleImprimirDanfe = async () => {
    if (!parsedData) return;
    setGerandoDanfe(true);
    try {
      const { gerarDanfePdf, nomeDoArquivoDanfe } = await import('../../utils/danfePdf');
      const pdf = gerarDanfePdf(parsedData.nota);
      setDanfe({ blob: pdf.output('blob'), nome: nomeDoArquivoDanfe(parsedData.nota) });
    } catch (erro) {
      console.error('Erro ao gerar o DANFE:', erro);
      showError('Não foi possível gerar o DANFE', 'O XML foi lido, mas o desenho do DANFE falhou. Tente de novo; se persistir, imprima pelo portal da SEFAZ.');
    } finally {
      setGerandoDanfe(false);
    }
  };

  const handleAlterarCampoItem = (idx: number, campo: keyof ItemEntradaConfig, valor: string) => {
    setItemConfigs((prev) => prev.map((config, i) => (i === idx ? { ...config, [campo]: valor } : config)));
  };

  const handleSalvarFornecedor = async () => {
    if (!fornecedorForm.nome.trim()) {
      showError('Nome obrigatório', 'Informe o nome/razão social do fornecedor.');
      return;
    }
    if (fornecedorForm.cnpj && fornecedorForm.cnpj.length !== 11 && fornecedorForm.cnpj.length !== 14) {
      showError('Documento inválido', 'O CNPJ deve ter 14 dígitos (ou 11 para CPF), apenas números.');
      return;
    }
    if (!currentUser || !tenantId) return;

    setIsSavingFornecedor(true);
    try {
      const nomeFinal = fornecedorForm.nome.toUpperCase().trim();
      const docRef = await addDoc(collection(db, 'fornecedores'), {
        nome: nomeFinal,
        cnpj: fornecedorForm.cnpj,
        telefone: fornecedorForm.telefone,
        email: fornecedorForm.email,
        tenantId,
        createdAt: serverTimestamp(),
        ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
      });
      setFornecedorMatch({ id: docRef.id, nome: nomeFinal });
      setFornecedorStatus('found');
      setShowFornecedorModal(false);
      showSuccess('Fornecedor cadastrado! Pode continuar a importação.');
    } catch (err) {
      console.error('Erro ao cadastrar fornecedor:', err);
      showError('Erro ao cadastrar', 'Não foi possível salvar o fornecedor. Tente novamente.');
    } finally {
      setIsSavingFornecedor(false);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.name.endsWith('.xml')) {
        processFile(file);
      } else {
        showError('Arquivo Inválido', 'Por favor, envie apenas arquivos no formato XML.');
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.name.endsWith('.xml')) {
        processFile(file);
      } else {
        showError('Arquivo Inválido', 'Por favor, envie apenas arquivos no formato XML.');
      }
    }
  };

  /** Le um XML que veio da SEFAZ (texto) pelo MESMO caminho do arquivo: o
   *  parser, a conferencia e a importacao nao mudam em nada. */
  const processarXmlDeTexto = (xml: string, nomeArquivo: string) => {
    const arquivo = new File([xml], nomeArquivo, { type: 'text/xml' });
    processFile(arquivo);
  };

  const buscarNotaPelaChave = async (modo: 'importar' | 'danfe' = 'importar') => {
    const digitos = chaveBusca.replace(/\D/g, '');
    if (digitos.length !== 44) {
      showError('Chave incompleta', `A chave de acesso tem 44 números. Você digitou ${digitos.length}.`);
      return;
    }
    setBuscandoPorChave(true);
    try {
      let resposta = await notaRecebidaService.buscar(digitos);

      // A SEFAZ so' libera o XML completo depois da manifestacao. Isso e' um
      // registro em nome da empresa, entao PERGUNTA antes -- nunca sozinho.
      if (resposta.situacao === 'manifestar') {
        const nota = resposta.nota;
        const confirma = await NexusSwal.fire({
          icon: 'question',
          title: 'Registrar a ciência desta nota?',
          html: [
            nota ? `<strong>${nota.emitenteNome}</strong>` : '',
            nota ? `Nota ${nota.numero} — ${currencyFormat.format(nota.valorTotal)}` : '',
            '',
            'A SEFAZ só entrega o XML completo depois que a empresa registra a <strong>Ciência da Operação</strong>.',
            'Isso é um registro fiscal em nome da empresa e fica no histórico da SEFAZ.',
          ].filter(Boolean).join('<br/>'),
          showCancelButton: true,
          confirmButtonText: 'Sim, registrar ciência',
          cancelButtonText: 'Agora não',
        });
        if (!confirma.isConfirmed) return;
        if (!nota?.id) {
          showError('Nota não identificada', 'Busque a chave novamente antes de registrar a ciência.');
          return;
        }
        resposta = await notaRecebidaService.manifestar(nota.id);
      }

      if (resposta.situacao === 'aguardando') {
        showWarning('Ciência registrada', resposta.aviso || 'O XML deve chegar em instantes. Busque a chave de novo.');
        return;
      }
      if (!resposta.xml) {
        showError('XML indisponível', 'A nota foi encontrada, mas o XML ainda não está disponível. Tente de novo em instantes.');
        return;
      }

      if (modo === 'danfe') {
        // So imprimir: o DANFE sai do XML sem a nota entrar no estoque.
        const notaDaChave = parseNfeXml(resposta.xml);
        const { gerarDanfePdf, nomeDoArquivoDanfe } = await import('../../utils/danfePdf');
        setDanfe({ blob: gerarDanfePdf(notaDaChave).output('blob'), nome: nomeDoArquivoDanfe(notaDaChave) });
        return;
      }
      processarXmlDeTexto(resposta.xml, `nota-${digitos.slice(-6)}.xml`);
      setChaveBusca('');
    } catch (erro) {
      const mensagem = erro instanceof NotaRecebidaError
        ? erro.message
        : 'Não foi possível buscar a nota agora. Tente novamente ou use o arquivo XML.';
      showError('Não foi possível buscar a nota', mensagem);
    } finally {
      setBuscandoPorChave(false);
    }
  };

  // Le o XML da nota (arquivo ou vindo da SEFAZ) pela leitura completa: chave,
  // serie, impostos, transporte, pagamento, lote... (ver nfeXmlDomain.ts).
  const processFile = (file: File) => {
    setSelectedFile(file);
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const texto = e.target?.result as string;
        const nota = parseNfeXml(texto);
        const hoje = getDateInputInTimeZone();
        const dataEmissao = nota.dataEmissao || hoje;

        setParsedData({
          nota,
          xmlTexto: texto,
          fornecedorNome: nota.emitente.nome || 'FORNECEDOR DESCONHECIDO',
          fornecedorCnpj: nota.emitente.documento,
          numeroNF: nota.numero || '000000',
          dataEmissao,
          valorTotal: nota.totais.total,
          valorFreteXml: nota.totais.frete,
          items: nota.itens.map((item) => ({ ...item, valorTotal: item.valorProduto })),
          duplicatas: nota.duplicatas.map((d) => ({ numero: d.numero, vencimento: d.vencimento || dataEmissao, valor: d.valor })),
        });
        // Frete embutido ja vem preenchido, sem transportadora: quem cobrou
        // foi o fornecedor da mercadoria, entao nao gera titulo separado.
        setFrete({ valor: nota.totais.frete, chaveCte: '', transportadoraId: '', transportadoraNome: '', vencimento: '', lancarNoFornecedor: false });
        setBuscaTransportadora('');
        setDataEntrada(hoje);
        setObservacao('');
        setDivergenciaAceita(false);
        setOpcoesCusto(opcoesDeCustoPorRegime(regimeTributario));
        setModoPagamento('prazo');
        setParcelas(parcelasIniciais(nota.duplicatas, dataEmissao, nota.totais.total));
        setParcelasAceitas(false);
        setCategoriaDespesa(CATEGORIAS_DE_COMPRA[0]);
        setFormaPrevista(({ '01': 'Dinheiro', '02': 'Cheque', '03': 'Cartão', '04': 'Cartão', '14': 'Boleto', '15': 'Boleto', '16': 'Transferência', '17': 'PIX', '18': 'Transferência' } as Record<string, string>)[nota.pagamentos[0]?.forma ?? ''] ?? 'Boleto');
        setDestinoPagamento('caixa');
        setBancoId('');
        setMarkupDigitado({});
        setVinculoAberto(null);
      } catch (err) {
        console.error(err);
        showError('Erro no Processamento', (err as Error).message || 'Não foi possível ler os nós fiscais do arquivo XML.');
        setSelectedFile(null);
        setParsedData(null);
      }
    };

    reader.readAsText(file);
  };

  /**
   * Nota ja lancada? Confere pela CHAVE (a prova de que e' a mesma nota) e,
   * para entrada antiga sem chave, por fornecedor + numero (+ serie). Nota
   * EXCLUIDA nao conta: excluir e' justamente como se libera lancar de novo.
   */
  const verificarNotaDuplicada = async (nota: NotaParseada, fornecedorId: string, numeroNF: string) => {
    if (!tenantId) return null;
    const colecaoNotas = collection(db, 'notas_fiscais_entrada');
    const encontradas: Array<{ numeroNF: string; dataEmissao: string; fornecedorNome: string; status?: string }> = [];
    if (nota.chave) {
      const porChave = await getDocs(query(colecaoNotas, where('tenantId', '==', tenantId), where('chaveAcesso', '==', nota.chave)));
      porChave.forEach((d) => encontradas.push(d.data() as (typeof encontradas)[number]));
    }
    const porNumero = await getDocs(query(colecaoNotas, where('tenantId', '==', tenantId), where('fornecedorId', '==', fornecedorId), where('numeroNF', '==', numeroNF)));
    porNumero.forEach((d) => {
      const dados = d.data();
      const mesmaSerie = !dados.serie || !nota.serie || dados.serie === nota.serie;
      if (mesmaSerie) encontradas.push(dados as (typeof encontradas)[number]);
    });
    return primeiraNotaAtiva(encontradas);
  };

  // Salva dados no Firestore
  const handleConfirmarEntrada = async () => {
    if (!parsedData || !tenantId || !currentUser || !fornecedorMatch) return;
    if (itemConfigs.length !== parsedData.items.length) return;
    const nota = parsedData.nota;

    // ------------------------------------------------------------ validacoes
    for (let idx = 0; idx < parsedData.items.length; idx++) {
      const item = parsedData.items[idx];
      const config = itemConfigs[idx];
      if (config.classificacao !== 'novo' && !(Number(config.fator) > 0)) {
        showError('Conversão de unidade', `Informe quantas unidades do estoque cabem em 1 ${item.unidade} de "${item.descricao}" (use 1 se a nota e o estoque usam a mesma unidade).`);
        return;
      }
      if (config.tipo !== 'revenda') continue;
      // Todo item de Revenda precisa de preco de venda valido antes de gravar.
      if (!(numeroDaTela(config.precoVenda) > 0)) {
        showError('Preço de venda obrigatório', `Informe um preço de venda válido para "${item.descricao}" antes de confirmar.`);
        return;
      }
      const descontoMaximo = numeroDaTela(config.descontoMaximo);
      if (descontoMaximo < 0 || descontoMaximo > 100) {
        showError('Desconto máximo inválido', `O desconto máximo de "${item.descricao}" precisa estar entre 0% e 100%.`);
        return;
      }
      if (config.atacadoAtivo && !config.atacadoBloqueado) {
        if (!(numeroDaTela(config.atacadoPreco) > 0) || !(numeroDaTela(config.atacadoQtdMinima) > 0)) {
          showError('Atacado incompleto', `Informe a quantidade mínima e o preço de atacado de "${item.descricao}", ou desligue o atacado desse item.`);
          return;
        }
      }
    }

    const problemaNoFrete = erroDoFrete(frete);
    if (problemaNoFrete) {
      showError('Confira o frete', problemaNoFrete);
      return;
    }

    if (conferencia && !conferencia.ok && !divergenciaAceita) {
      showError('A nota não confere', `${conferencia.avisos.join(' ')} Marque "Conferi e quero lançar mesmo assim" em Totais e conferência, ou confira o arquivo XML.`);
      return;
    }

    const totalDevido = nota.totais.total;
    if (modoPagamentoEfetivo === 'prazo') {
      const conferenciaParcelas = conferirParcelas(parcelas, totalDevido);
      if (conferenciaParcelas.erro) {
        showError('Confira as parcelas', conferenciaParcelas.erro);
        return;
      }
      if (formaPrevista === 'Cheque') {
        const erroCheques = erroDosCheques(parcelas, bancos);
        if (erroCheques) {
          showError('Confira os cheques', erroCheques);
          return;
        }
      }
      if (conferenciaParcelas.aviso && !parcelasAceitas) {
        showError('As parcelas não fecham com a nota', `${conferenciaParcelas.aviso} Ajuste os valores ou marque "Conferi as parcelas e quero lançar assim".`);
        return;
      }
    } else {
      const erroAVista = erroDoPagamentoAVista({ destino: destinoPagamento, bancoId });
      if (erroAVista) {
        showError('Pagamento à vista', erroAVista);
        return;
      }
    }

    // Uma nota entra numa unica gravacao (tudo ou nada): limite do Firestore por transacao.
    if (parsedData.items.length + parcelas.length + 6 > 450) {
      showError('Nota muito grande', 'Esta nota tem itens demais para entrar de uma vez. Divida o XML em duas partes ou fale com o suporte.');
      return;
    }

    setIsProcessing(true);

    NexusSwal.fire({
      title: 'Importando NF-e...',
      text: 'Conferindo se a nota já foi lançada, somando estoque e lançando contas a pagar...',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    try {
      const jaLancada = await verificarNotaDuplicada(nota, fornecedorMatch.id, parsedData.numeroNF);
      if (jaLancada) {
        Swal.close();
        showError('Nota já lançada', mensagemDeNotaDuplicada(jaLancada));
        return;
      }

      // ---------------------------------------------------------- plano da entrada
      const agora = new Date();
      const hojeIso = getDateInputInTimeZone();
      const motivoDoHistorico = `Entrada de NF ${parsedData.numeroNF}`;
      const usaCsosnNaEntrada = usesCsosn(regimeTributario);

      const itensPlano = parsedData.items.map((item, idx) => {
        const config = itemConfigs[idx];
        const custo = custosDosItens[idx];
        const fator = config.classificacao === 'novo' ? 1 : fatorValido(config.fator);
        const ehMateriaPrima = config.tipo === 'materia_prima';
        const ehInsumo = config.tipo === 'insumo';
        const vinculado = config.classificacao !== 'novo' && Boolean(config.matchId);
        const colecao = ehInsumo ? 'insumos' : (ehMateriaPrima ? 'materias_primas' : 'estoque');
        return {
          item,
          idx,
          config,
          custo,
          fator,
          ehMateriaPrima,
          ehInsumo,
          vinculado,
          quantidadeEstoque: quantidadeNoEstoque(item.quantidade, fator),
          custoUn: custoUnitarioNoEstoque(custo?.custoTotal ?? 0, item.quantidade, fator),
          ref: vinculado ? doc(db, colecao, config.matchId as string) : doc(collection(db, colecao)),
        };
      });

      const titulosRefs = modoPagamentoEfetivo === 'prazo' ? parcelas.map(() => doc(collection(db, 'transacoes'))) : [doc(collection(db, 'transacoes'))];
      const tituloFreteRef = freteGeraTituloProprio(frete) ? doc(collection(db, 'transacoes')) : null;
      const notaRef = doc(collection(db, 'notas_fiscais_entrada'));
      const titulosPagarIds = [...titulosRefs.map((ref) => ref.id), ...(tituloFreteRef ? [tituloFreteRef.id] : [])];
      const bancoRef = modoPagamentoEfetivo === 'avista' && destinoPagamento === 'banco' ? doc(db, 'bancos', bancoId) : null;
      const bancoNome = bancos.find((b) => b.id === bancoId)?.nome || '';
      const xmlCompacto = await compactarXml(parsedData.xmlTexto);

      let pecasAtualizadas = 0;
      let pecasCriadas = 0;
      let materiasPrimasAtualizadas = 0;
      let materiasPrimasCriadas = 0;
      let insumosAtualizados = 0;
      let insumosCriados = 0;
      const notaItens: NotaFiscalEntradaItemRecord[] = [];
      // O custo que mudou em cada cadastro alimenta o recalculo do custo dos
      // produtos acabados que usam esses componentes.
      const mudancasDeCusto = new Map<string, MudancaDeCusto>();
      const registrarMudancaDeCusto = (origem: MudancaDeCusto['origem'], id: string, nome: string, custoAnterior: number, custoNovo: number) => {
        const chave = `${origem}:${id}`;
        const existente = mudancasDeCusto.get(chave);
        mudancasDeCusto.set(chave, { origem, id, nome, custoAnterior: existente ? existente.custoAnterior : custoAnterior, custoNovo });
      };

      // ---------------------------------------------------------- gravacao unica
      // TUDO OU NADA (2026-09-24): estoque, custos, titulos, banco e o registro
      // da nota entram na MESMA transacao. Antes eram gravacoes soltas: uma
      // falha no meio deixava o estoque somado sem titulo (ou o contrario).
      await runTransaction(db, async (transaction) => {
        // A transacao pode ser repetida pelo Firestore: recomeca do zero.
        notaItens.length = 0;
        mudancasDeCusto.clear();
        pecasAtualizadas = 0;
        pecasCriadas = 0;
        materiasPrimasAtualizadas = 0;
        materiasPrimasCriadas = 0;
        insumosAtualizados = 0;
        insumosCriados = 0;

        // 1. LEITURAS -- todas antes de qualquer escrita (regra do Firestore).
        const snapshots = new Map<string, DocumentSnapshot<DocumentData>>();
        for (const plano of itensPlano) {
          if (plano.vinculado && !snapshots.has(plano.ref.path)) snapshots.set(plano.ref.path, await transaction.get(plano.ref));
        }
        const bancoSnap = bancoRef ? await transaction.get(bancoRef) : null;
        if (bancoRef && !bancoSnap?.exists()) {
          throw new Error('O banco selecionado não foi encontrado. Atualize a página e tente novamente.');
        }
        for (const plano of itensPlano) {
          if (plano.vinculado && !snapshots.get(plano.ref.path)?.exists()) {
            throw new Error(`O cadastro vinculado a "${plano.item.descricao}" não existe mais. Vincule outro cadastro ou cadastre o item como novo.`);
          }
        }

        // Estado corrente de cada cadastro DENTRO desta nota: dois itens no
        // mesmo cadastro somam sobre o resultado do primeiro, nao sobre o banco.
        const estados = new Map<string, { quantidade: number; custoMedio: number; precoCusto: number; precoVenda: number; historico: unknown[] }>();

        // 2. ESCRITAS
        for (const plano of itensPlano) {
          const { item, config, ref, quantidadeEstoque, custoUn, custo, fator } = plano;
          const impostosDoItem = {
            icms: { origem: item.icms.origem, situacao: item.icms.situacao, base: item.icms.base, aliquota: item.icms.aliquota, valor: item.icms.valor, baseSt: item.icms.baseSt, valorSt: item.icms.valorSt },
            ipi: { situacao: item.ipi.situacao, aliquota: item.ipi.aliquota, valor: item.ipi.valor },
            pis: { situacao: item.pis.situacao, aliquota: item.pis.aliquota, valor: item.pis.valor },
            cofins: { situacao: item.cofins.situacao, aliquota: item.cofins.aliquota, valor: item.cofins.valor },
          };
          const detalhesDoRegistro = {
            ncm: item.ncm,
            cest: item.cest,
            ean: item.ean,
            cfop: item.cfop,
            unidadeNota: item.unidade,
            fator,
            quantidadeEstoque,
            custoTotal: custo?.custoTotal ?? 0,
            custoUnitarioEstoque: custoUn,
            impostos: impostosDoItem,
            lote: config.lote.trim() || item.lotes[0]?.numero || '',
            validade: config.validade || item.lotes[0]?.validade || '',
          };
          const lote = detalhesDoRegistro.lote;
          const validade = detalhesDoRegistro.validade;
          const camposDeLote = { ...(lote ? { lote } : {}), ...(validade ? { validade } : {}) };
          const camposDoFornecedor = {
            ...(item.codigo ? { [`codigosFornecedor.${fornecedorMatch.id}`]: item.codigo } : {}),
            [`fatoresFornecedor.${fornecedorMatch.id}`]: fator,
          };

          // ------------------------------------------------------------ materia-prima
          if (plano.ehMateriaPrima || plano.ehInsumo) {
            const tipoDoRegistro = plano.ehInsumo ? 'insumo' : 'materia_prima';
            if (plano.vinculado) {
              const dados = snapshots.get(ref.path)?.data() ?? {};
              const estado = estados.get(ref.path) ?? { quantidade: Number(dados.quantidade || 0), custoMedio: Number(dados.custoMedio ?? dados.precoCusto ?? 0), precoCusto: Number(dados.precoCusto || 0), precoVenda: 0, historico: [] };
              // Insumo nao compoe produto acabado: so a materia-prima realimenta o custo dele.
              if (!plano.ehInsumo) registrarMudancaDeCusto('materia_prima', ref.id, String(dados.nome || item.descricao), estados.has(ref.path) ? estado.precoCusto : Number(dados.precoCusto || 0), custoUn);
              const custoMedio = custoMedioPonderado(estado.quantidade, estado.custoMedio, quantidadeEstoque, custoUn);
              estados.set(ref.path, { ...estado, quantidade: estado.quantidade + quantidadeEstoque, custoMedio, precoCusto: custoUn });
              transaction.update(ref, semUndefined({
                quantidade: increment(quantidadeEstoque),
                precoCusto: custoUn,
                ultimoCusto: custoUn,
                custoMedio,
                fornecedor: fornecedorMatch.nome,
                ...camposDoFornecedor,
                ...camposDeLote,
                updatedAt: serverTimestamp(),
                ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), motivoDoHistorico),
              }));
              if (plano.ehInsumo) insumosAtualizados++; else materiasPrimasAtualizadas++;
              notaItens.push({ itemId: ref.id, tipo: tipoDoRegistro, codigoXml: item.codigo, descricaoXml: item.descricao, quantidade: item.quantidade, valorUnitario: item.valorUnitario, novo: false, ...detalhesDoRegistro });
            } else {
              // Simplificacao deliberada, mesma do cadastro manual de
              // Materia-Prima: unidade e fornecedor ficam como texto livre.
              transaction.set(ref, semUndefined({
                codigo: item.codigo,
                nome: item.descricao.toUpperCase(),
                categoria: 'DIVERSOS',
                unidade: item.unidade.toUpperCase() || 'UN',
                quantidade: quantidadeEstoque,
                estoqueMinimo: 0,
                precoCusto: custoUn,
                ultimoCusto: custoUn,
                custoMedio: custoUn,
                fornecedor: fornecedorMatch.nome,
                ...(item.codigo ? { codigosFornecedor: { [fornecedorMatch.id]: item.codigo } } : {}),
                fatoresFornecedor: { [fornecedorMatch.id]: 1 },
                ...camposDeLote,
                tenantId,
                createdAt: serverTimestamp(),
                ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
              }));
              if (plano.ehInsumo) insumosCriados++; else materiasPrimasCriadas++;
              notaItens.push({ itemId: ref.id, tipo: tipoDoRegistro, codigoXml: item.codigo, descricaoXml: item.descricao, quantidade: item.quantidade, valorUnitario: item.valorUnitario, novo: true, ...detalhesDoRegistro });
            }
            continue;
          }

          // ------------------------------------------------------------ revenda
          // Precificacao/tributacao vem do que a pessoa preencheu na tela. Fora
          // do Simples Nacional, os campos de ICMS/PIS/COFINS tambem sao
          // gravados; dentro do Simples, so CSOSN/origem importam.
          const precoNovo = numeroDaTela(config.precoVenda);
          const camposFiscais: Record<string, unknown> = { precoVenda: precoNovo, csosn: config.csosn };
          if (!usaCsosnNaEntrada) {
            camposFiscais.aliquotaIcms = Number(config.aliquotaIcms) || 0;
            camposFiscais.reducaoBaseIcms = Number(config.reducaoBaseIcms) || 0;
            camposFiscais.cstPis = config.cstPis;
            camposFiscais.aliquotaPis = Number(config.aliquotaPis) || 0;
            camposFiscais.cstCofins = config.cstCofins;
            camposFiscais.aliquotaCofins = Number(config.aliquotaCofins) || 0;
          }
          const descontoMaximo = config.descontoMaximo.trim() === '' ? null : numeroDaTela(config.descontoMaximo);
          const atacadoQuantidade = numeroDaTela(config.atacadoQtdMinima);
          const atacadoPreco = numeroDaTela(config.atacadoPreco);
          const margem = custoUn > 0 && precoNovo > 0 ? ((precoNovo - custoUn) / custoUn) * 100 : 0;

          if (plano.vinculado) {
            const dados = snapshots.get(ref.path)?.data() ?? {};
            const estado = estados.get(ref.path) ?? {
              quantidade: Number(dados.quantidade || 0),
              custoMedio: Number(dados.custoMedio ?? dados.precoCusto ?? dados.precos?.custo ?? 0),
              precoCusto: Number(dados.precoCusto ?? dados.precos?.custo ?? 0),
              precoVenda: Number(dados.precoVenda ?? dados.precos?.venda ?? 0),
              historico: Array.isArray(dados.historicoPrecos) ? dados.historicoPrecos : [],
            };
            registrarMudancaDeCusto('estoque', ref.id, String(dados.nome || item.descricao), estados.has(ref.path) ? estado.precoCusto : Number(dados.precoCusto ?? dados.precos?.custo ?? 0), custoUn);
            const custoMedio = custoMedioPonderado(estado.quantidade, estado.custoMedio, quantidadeEstoque, custoUn);
            const mudouPreco = Math.abs(precoNovo - estado.precoVenda) >= 0.005;
            const mudouCusto = Math.abs(custoUn - estado.precoCusto) >= 0.00005;
            const historico = mudouPreco || mudouCusto
              ? [{ precoAnterior: estado.precoVenda, precoNovo, custoAnterior: estado.precoCusto, custoNovo: custoUn, alteradoEm: agora.toISOString(), usuarioId: currentUser.uid, motivo: `${motivoDoHistorico}${mudouPreco ? ' (preço de venda alterado na entrada)' : ''}` }, ...estado.historico].slice(0, 200)
              : estado.historico;
            estados.set(ref.path, { quantidade: estado.quantidade + quantidadeEstoque, custoMedio, precoCusto: custoUn, precoVenda: precoNovo, historico });

            const completar = dadosFiscaisParaCompletar(item, { codigoBarras: dados.codigoBarras, ncm: dados.ncm ?? dados.fiscal?.ncm });
            const completarCest = !String(dados.cest || '').trim() && item.cest.length === 7 ? { cest: item.cest } : {};
            const temPrecos = Boolean(dados.precos) && typeof dados.precos === 'object';
            const atacadoAtualizado = !config.atacadoBloqueado
              ? (config.atacadoAtivo
                ? {
                  atacado: { ...(dados.atacado || {}), ativo: true, quantidadeMinima: atacadoQuantidade, faixas: [{ id: dados.atacado?.faixas?.[0]?.id || 'faixa-entrada-nfe', quantidadeInicial: atacadoQuantidade, quantidadeFinal: null, ilimitado: true, preco: atacadoPreco }] },
                  ativarAtacado: true,
                  quantidadeMinimaAtacado: atacadoQuantidade,
                }
                : (dados.atacado?.ativo ? { 'atacado.ativo': false, ativarAtacado: false } : {}))
              : {};

            transaction.update(ref, semUndefined({
              ...completar,
              ...completarCest,
              quantidade: increment(quantidadeEstoque),
              precoCusto: custoUn,
              ultimoCusto: custoUn,
              custoMedio,
              fornecedor: fornecedorMatch.nome,
              fornecedorId: fornecedorMatch.id,
              ...camposDoFornecedor,
              ...camposDeLote,
              ...camposFiscais,
              margemLucro: margem,
              lucroEstimado: precoNovo - custoUn,
              ...(descontoMaximo !== null ? { descontoMaximoPercentual: descontoMaximo } : {}),
              ...atacadoAtualizado,
              ...(mudouPreco || mudouCusto ? { historicoPrecos: historico } : {}),
              ...(mudouPreco ? { custoNaUltimaPrecificacao: custoUn, ultimaAlteracaoPreco: agora.toISOString() } : {}),
              ...(temPrecos ? { 'precos.custo': custoUn, 'precos.venda': precoNovo, 'precos.margemLucro': margem, 'precos.lucroEstimado': precoNovo - custoUn } : {}),
              updatedAt: serverTimestamp(),
              ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), motivoDoHistorico),
            }));
            pecasAtualizadas++;
            notaItens.push({ itemId: ref.id, tipo: 'revenda', codigoXml: item.codigo, descricaoXml: item.descricao, quantidade: item.quantidade, valorUnitario: item.valorUnitario, novo: false, ...detalhesDoRegistro });
          } else {
            // Produto novo: NCM, CEST, EAN, origem e CFOP vem da nota; preco e
            // tributacao, do que a pessoa preencheu na tela.
            transaction.set(ref, semUndefined({
              codigo: item.codigo,
              nome: item.descricao.toUpperCase(),
              quantidade: quantidadeEstoque,
              estoqueMinimo: 0,
              precoCusto: custoUn,
              ultimoCusto: custoUn,
              custoMedio: custoUn,
              fornecedor: fornecedorMatch.nome,
              fornecedorId: fornecedorMatch.id,
              codigosFornecedor: item.codigo ? { [fornecedorMatch.id]: item.codigo } : {},
              fatoresFornecedor: { [fornecedorMatch.id]: 1 },
              categoria: 'DIVERSOS',
              unidadeMedidaId: 'un',
              unidadeMedidaSigla: item.unidade.toUpperCase() || 'UN',
              unidadeMedidaCasasDecimais: 0,
              ncm: item.ncm,
              ...(item.cest.length === 7 ? { cest: item.cest } : {}),
              cfop: cfopDeSaidaSugerido(item.cfop),
              codigoBarras: item.ean,
              origem: item.icms.origem || '0',
              ...camposDeLote,
              ...camposFiscais,
              margemLucro: margem,
              lucroEstimado: precoNovo - custoUn,
              custoNaUltimaPrecificacao: custoUn,
              ...(descontoMaximo !== null ? { descontoMaximoPercentual: descontoMaximo } : {}),
              ...(config.atacadoAtivo && !config.atacadoBloqueado
                ? {
                  atacado: { ativo: true, quantidadeMinima: atacadoQuantidade, faixas: [{ id: 'faixa-entrada-nfe', quantidadeInicial: atacadoQuantidade, quantidadeFinal: null, ilimitado: true, preco: atacadoPreco }] },
                  ativarAtacado: true,
                  quantidadeMinimaAtacado: atacadoQuantidade,
                }
                : {}),
              tenantId,
              createdAt: serverTimestamp(),
              ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
            }));
            pecasCriadas++;
            notaItens.push({ itemId: ref.id, tipo: 'revenda', codigoXml: item.codigo, descricaoXml: item.descricao, quantidade: item.quantidade, valorUnitario: item.valorUnitario, novo: true, ...detalhesDoRegistro });
          }
        }

        // ------------------------------------------------------------ contas a pagar
        const categoria = categoriaDespesa;
        if (modoPagamentoEfetivo === 'prazo') {
          parcelas.forEach((parcela, indice) => {
            const descricaoParcela = parcelas.length > 1
              ? `COMPRA NF ${parsedData.numeroNF} - ${fornecedorMatch.nome} (Parcela ${indice + 1}/${parcelas.length})`
              : `COMPRA NF ${parsedData.numeroNF} - ${fornecedorMatch.nome}`;
            transaction.set(titulosRefs[indice], {
              descricao: descricaoParcela,
              data: parcela.vencimento,
              valor: parcela.valor,
              valorCentavos: toCents(parcela.valor),
              categoria: categoria.toUpperCase().trim(),
              status: 'Pendente',
              tipo: 'saida',
              formaPagamentoPrevista: formaPrevista,
              // Cheque emitido: o titulo entra na fila de Cheques (Emitidos) e o banco so' e'
              // debitado quando a compensacao for confirmada la.
              ...(formaPrevista === 'Cheque' ? camposDoTituloEmCheque(parcela, bancos) : {}),
              ...(parcelas.length > 1 ? { parcela: indice + 1, totalParcelas: parcelas.length } : {}),
              fornecedorId: fornecedorMatch.id,
              fornecedorNome: fornecedorMatch.nome,
              notaFiscalEntradaNumero: parsedData.numeroNF,
              tenantId,
              createdAt: serverTimestamp(),
              ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
            });
          });
        } else {
          // Pago na entrada: titulo PAGO e, se saiu de banco, o saldo debitado
          // (mesmo desenho da Nota Avulsa a vista).
          const valorCentavos = toCents(totalDevido);
          transaction.set(titulosRefs[0], {
            descricao: `COMPRA NF ${parsedData.numeroNF} - ${fornecedorMatch.nome}`,
            data: hojeIso,
            dataPagamento: hojeIso,
            valor: fromCents(valorCentavos),
            valorCentavos,
            categoria,
            status: 'Paga',
            tipo: 'saida',
            formaPagamento: destinoPagamento === 'banco' ? (formaPrevista === 'Dinheiro' ? 'Transferência' : formaPrevista) : 'Dinheiro',
            naturezaFinanceira: destinoPagamento === 'banco' ? 'bancario_digital' : 'caixa_fisico',
            movimentaCaixaFisico: destinoPagamento === 'caixa',
            ...(destinoPagamento === 'banco' ? { bancoId, bancoNome } : {}),
            fornecedorId: fornecedorMatch.id,
            fornecedorNome: fornecedorMatch.nome,
            notaFiscalEntradaNumero: parsedData.numeroNF,
            tenantId,
            createdAt: serverTimestamp(),
            ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
          });
          if (bancoRef && bancoSnap) {
            transaction.update(bancoRef, {
              saldoCentavos: Number(bancoSnap.data()?.saldoCentavos || 0) - valorCentavos,
              updatedAt: serverTimestamp(),
              ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), motivoDoHistorico),
            });
          }
        }

        // Frete de transportadora (ou frete a prazo do fornecedor) vira um titulo
        // SEPARADO, com vencimento proprio. Frete embutido na nota nao passa por
        // aqui -- ja esta no custo e quem cobra e' o mesmo fornecedor.
        if (tituloFreteRef) {
          const chaveCte = somenteDigitos(frete.chaveCte);
          const credorFrete = credorDoFrete(frete, fornecedorMatch);
          transaction.set(tituloFreteRef, {
            descricao: descricaoDoTituloDeFrete(parsedData.numeroNF, { ...frete, transportadoraNome: credorFrete.nome }),
            data: vencimentoDoFrete(frete, parsedData.dataEmissao),
            valor: frete.valor,
            categoria: 'FRETES',
            status: 'Pendente',
            tipo: 'saida',
            fornecedorId: credorFrete.id,
            fornecedorNome: credorFrete.nome,
            ...(chaveCte ? { chaveCte } : {}),
            notaFiscalEntradaNumero: parsedData.numeroNF,
            tenantId,
            createdAt: serverTimestamp(),
            ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
          });
        }

        // ------------------------------------------------------------ registro da nota
        transaction.set(notaRef, {
          ...buildNotaFiscalEntradaRecord({
            numeroNF: parsedData.numeroNF,
            dataEmissao: parsedData.dataEmissao,
            valorTotal: parsedData.valorTotal,
            fornecedorId: fornecedorMatch.id,
            fornecedorNome: fornecedorMatch.nome,
            fornecedorCnpj: parsedData.fornecedorCnpj,
            itens: notaItens,
            titulosPagarIds,
            chaveAcesso: nota.chave || undefined,
            serie: nota.serie || undefined,
            modelo: nota.modelo || undefined,
            naturezaOperacao: nota.naturezaOperacao || undefined,
            dataEntrada,
            observacao: observacao.trim() || undefined,
            totais: { ...nota.totais },
            custo: { creditarIcms: opcoesCusto.creditarIcms, creditarPisCofins: opcoesCusto.creditarPisCofins, frete: frete.valor },
            pagamento: {
              modo: modoPagamentoEfetivo,
              categoria: categoriaDespesa,
              forma: formaPrevista,
              parcelas: modoPagamentoEfetivo === 'prazo' ? parcelas : [],
              ...(modoPagamentoEfetivo === 'avista' ? { destino: destinoPagamento, ...(destinoPagamento === 'banco' ? { bancoId, bancoNome } : {}) } : {}),
            },
            transporte: {
              modalidadeFrete: nota.transporte.modalidadeFrete,
              transportadora: nota.transporte.transportadoraNome,
              transportadoraDocumento: nota.transporte.transportadoraDocumento,
              placa: nota.transporte.placa,
              volumes: nota.transporte.volumes,
            },
            xmlGzipBase64: xmlCompacto || undefined,
          }),
          tenantId,
          createdAt: serverTimestamp(),
          ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
        });
      });

      // Cria log de auditoria
      try {
        const { createAuditLog } = await import('../../services/logService');
        await createAuditLog({
          tenantId,
          usuarioId: currentUser?.uid || '',
          usuarioEmail: currentUser?.email || '',
          modulo: 'estoque',
          acao: 'criacao',
          descricao: `Importação de XML NF ${parsedData.numeroNF} (${fornecedorMatch.nome}) realizada. ${pecasAtualizadas} produtos atualizados, ${pecasCriadas} novos produtos cadastrados, ${materiasPrimasAtualizadas} matérias-primas atualizadas, ${materiasPrimasCriadas} novas matérias-primas cadastradas, ${insumosAtualizados} insumos atualizados, ${insumosCriados} novos insumos cadastrados. ${titulosPagarIds.length} título(s) em Contas a Pagar, nota de R$ ${totalDevido.toFixed(2)}${modoPagamentoEfetivo === 'avista' ? ', paga à vista' : ''}.`,
          status: 'sucesso'
        });
      } catch {
        // Ignora erros ao registrar auditoria
      }

      // CUSTO DOS PRODUTOS ACABADOS: o custo de materia-prima/semiacabado mudou
      // nesta nota, e todo produto produzido que a usa precisa acompanhar.
      // Falha aqui vira aviso -- a nota ja foi gravada e nao pode ser desfeita.
      const impactoDeCusto = await sincronizarCustosSemFalhar({
        tenantId,
        usuarioId: currentUser.uid,
        origemDaMudanca: `Entrada de NF ${parsedData.numeroNF}`,
        mudancas: Array.from(mudancasDeCusto.values()),
      }, { mostrarAviso: false });

      Swal.close();
      setVersaoDosCadastros((versao) => versao + 1);

      // FICA NA TELA DE ENTRADA (pedido do dono, 2026-09-21): quem da entrada
      // tem uma PILHA de notas pra lancar. O resumo aparece no pop-up, com
      // atalho pra quem realmente quiser sair.
      const linhasResumo = [
        `${pecasAtualizadas} produto(s) com estoque incrementado`,
        `${pecasCriadas} produto(s) novo(s) cadastrado(s)`,
        ...(materiasPrimasAtualizadas > 0 ? [`${materiasPrimasAtualizadas} matéria(s)-prima(s) atualizada(s)`] : []),
        ...(materiasPrimasCriadas > 0 ? [`${materiasPrimasCriadas} matéria(s)-prima(s) nova(s)`] : []),
        ...(insumosAtualizados > 0 ? [`${insumosAtualizados} insumo(s) atualizado(s)`] : []),
        ...(insumosCriados > 0 ? [`${insumosCriados} insumo(s) novo(s)`] : []),
        `${titulosPagarIds.length} título(s) em Contas a Pagar${freteGeraTituloProprio(frete) ? ' (incluindo o do frete)' : ''}${modoPagamentoEfetivo === 'avista' ? ' — nota paga à vista' : ''}`,
      ];
      const numeroImportado = parsedData.numeroNF;

      handleRemoverFile();

      const escolha = await NexusSwal.fire({
        icon: 'success',
        title: `Nota ${numeroImportado} importada`,
        html: linhasResumo.map((linha) => `• ${linha}`).join('<br/>'),
        showDenyButton: true,
        confirmButtonText: 'Importar outra nota',
        denyButtonText: 'Ver histórico',
        denyButtonColor: '#3f3f46',
      });

      // Depois do resumo, o aviso de custo: a pessoa escolhe manter os precos
      // ou reajustar os produtos acabados afetados (nunca automatico).
      if (impactoDeCusto) {
        await mostrarImpactoDeCusto(impactoDeCusto, 'O custo dos produtos acabados mudou com esta nota', contextoDeReajuste(tenantId, currentUser.uid));
      }
      if (escolha.isDenied) openTab('/fiscal/entrada-nfe/historico');

    } catch (err) {
      console.error(err);
      Swal.close();
      showError('Erro na Importação', (err as Error).message || 'Falha ao salvar itens no banco de dados. Nada foi gravado: você pode tentar de novo.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRemoverFile = () => {
    setSelectedFile(null);
    setParsedData(null);
    setFrete({ valor: 0, chaveCte: '', transportadoraId: '', transportadoraNome: '', vencimento: '', lancarNoFornecedor: false });
    setBuscaTransportadora('');
    setFornecedorMatch(null);
    setFornecedorStatus('idle');
    setShowFornecedorModal(false);
    setItemConfigs([]);
    itemConfigsInitializedForRef.current = null;
    setDataEntrada(getDateInputInTimeZone());
    setObservacao('');
    setDivergenciaAceita(false);
    setModoPagamento('prazo');
    setParcelas([]);
    setParcelasAceitas(false);
    setDestinoPagamento('caixa');
    setBancoId('');
    setMarkupDigitado({});
    setVinculoAberto(null);
    setDanfe(null);
  };

  return (
    <div className="os-page" style={{ padding: '24px' }}>
      <div className="page-header" style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button className="icon-btn back-btn" onClick={() => navigate('/estoque')} title="Voltar para Estoque">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '24px', margin: 0 }}>
              <FileText size={28} color="var(--accent-purple)" />
              Entrada de Nota Fiscal (XML)
            </h1>
            <p className="page-subtitle" style={{ color: 'var(--text-muted)', margin: 0 }}>
              Importe notas fiscais (.xml) para dar entrada automática de produtos no estoque e registrar a despesa no contas a pagar.
            </p>
          </div>
        </div>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => openTab('/fiscal/entrada-nfe/historico')}
          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <History size={16} /> Ver Histórico
        </button>
      </div>

      {!selectedFile ? (
        // Chave de acesso + dropzone
        <div className="form-grid">
          <div className="card" style={{ gridColumn: 'span 12', padding: '24px 32px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <Search size={18} color="var(--accent-purple)" />
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Buscar a nota pela chave de acesso</h3>
            </div>
            <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', margin: '0 0 14px', lineHeight: 1.5 }}>
              Digite os 44 números e o sistema busca a nota direto na SEFAZ, sem precisar do arquivo. Aparecem aqui as notas
              emitidas contra o CNPJ da sua empresa nos <strong>últimos 90 dias</strong>. Se a SEFAZ ainda não liberou o XML
              completo, o sistema pergunta antes de registrar a ciência da operação.
            </p>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <input
                type="text"
                inputMode="numeric"
                value={chaveBusca}
                onChange={(e) => setChaveBusca(e.target.value.replace(/\D/g, '').slice(0, 44))}
                onKeyDown={(e) => { if (e.key === 'Enter' && !buscandoPorChave) void buscarNotaPelaChave(); }}
                placeholder="Cole ou digite a chave de acesso (44 números)"
                disabled={buscandoPorChave}
                style={{ flex: 1, minWidth: '320px', padding: '12px 14px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: '14px', letterSpacing: '0.5px' }}
              />
              <button
                type="button"
                className="btn-primary"
                onClick={() => void buscarNotaPelaChave()}
                disabled={buscandoPorChave || chaveBusca.replace(/\D/g, '').length !== 44}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: buscandoPorChave || chaveBusca.replace(/\D/g, '').length !== 44 ? 0.5 : 1 }}
              >
                {buscandoPorChave ? <Loader2 size={16} className="spin-icon" /> : <Search size={16} />}
                {buscandoPorChave ? 'Buscando na SEFAZ...' : 'Buscar nota'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void buscarNotaPelaChave('danfe')}
                disabled={buscandoPorChave || chaveBusca.replace(/\D/g, '').length !== 44}
                title="Imprime o DANFE da nota sem dar entrada no estoque"
                style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: buscandoPorChave || chaveBusca.replace(/\D/g, '').length !== 44 ? 0.5 : 1 }}
              >
                <Printer size={16} /> Só imprimir o DANFE
              </button>
            </div>
            {chaveBusca.length > 0 && (
              <span style={{ fontSize: '11.5px', color: 'var(--text-muted)', display: 'block', marginTop: '8px' }}>
                {chaveBusca.replace(/\D/g, '').length} de 44 números
              </span>
            )}
          </div>

          <div className="card" style={{ gridColumn: 'span 12', padding: '48px 32px', textAlign: 'center', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)' }}>
            <div
              style={{
                border: `2px dashed ${dragActive ? 'var(--accent-purple)' : 'var(--border-color)'}`,
                borderRadius: 'var(--radius-lg)',
                padding: '64px 24px',
                backgroundColor: dragActive ? 'rgba(139, 92, 246, 0.05)' : 'var(--bg-tertiary)',
                transition: 'all 0.3s ease',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '16px'
              }}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => document.getElementById('xml-upload')?.click()}
            >
              <input
                type="file"
                id="xml-upload"
                accept=".xml"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
              <Upload size={54} color={dragActive ? 'var(--accent-purple)' : 'var(--text-muted)'} style={{ opacity: 0.8 }} />
              <div>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: 600 }}>Arraste o arquivo XML da nota aqui</h3>
                <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '14px' }}>ou clique para selecionar o arquivo no seu computador</p>
              </div>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px', padding: '4px 12px', backgroundColor: 'var(--bg-secondary)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                Somente arquivos XML da SEFAZ
              </span>
            </div>
          </div>
        </div>
      ) : (
        // Preview dos dados lidos
        <div className="form-grid" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {parsedData && (
            <>
              {/* Card Cabeçalho */}
              <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '16px', marginBottom: '20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <CheckCircle size={22} color="#10b981" />
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '16px' }}>Arquivo XML lido com sucesso!</span>
                  </div>
                  <button className="btn-secondary" onClick={handleRemoverFile} style={{ color: '#ef4444', borderColor: '#ef444450', display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', fontSize: '13px' }}>
                    <Trash2 size={15} /> Remover Arquivo
                  </button>
                </div>

                {fornecedorStatus === 'checking' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', backgroundColor: 'rgba(139, 92, 246, 0.08)', border: '1px solid rgba(139, 92, 246, 0.2)', borderRadius: 'var(--radius-md)', marginBottom: '20px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                    <Loader2 size={16} className="spin-icon" />
                    Verificando cadastro do fornecedor...
                  </div>
                )}
                {fornecedorStatus === 'found' && fornecedorMatch && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', backgroundColor: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.25)', borderRadius: 'var(--radius-md)', marginBottom: '20px', fontSize: '13px', color: '#10b981', fontWeight: 600 }}>
                    <Truck size={16} />
                    Fornecedor vinculado: {fornecedorMatch.nome}
                  </div>
                )}
                {fornecedorStatus === 'missing' && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '12px 16px', backgroundColor: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: 'var(--radius-md)', marginBottom: '20px', fontSize: '13px', color: '#ef4444', fontWeight: 600 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <AlertTriangle size={16} />
                      Fornecedor não cadastrado — cadastre antes de confirmar a importação
                    </span>
                    <button type="button" className="btn-secondary" onClick={() => setShowFornecedorModal(true)} style={{ padding: '6px 12px', fontSize: '12px' }}>
                      Cadastrar agora
                    </button>
                  </div>
                )}

              </div>

              <CabecalhoDaNota
                nota={parsedData.nota}
                fornecedorNome={fornecedorMatch?.nome || parsedData.fornecedorNome}
                fornecedorCadastrado={fornecedorStatus === 'found'}
                dataEntrada={dataEntrada}
                onDataEntrada={setDataEntrada}
                observacao={observacao}
                onObservacao={setObservacao}
                onImprimirDanfe={() => void handleImprimirDanfe()}
                gerandoDanfe={gerandoDanfe}
              />

              {conferencia && (
                <TotaisDaNotaCard
                  nota={parsedData.nota}
                  conferencia={conferencia}
                  opcoes={opcoesCusto}
                  onOpcoes={setOpcoesCusto}
                  rotuloDoRegime={regimeTributario === 'simples_nacional' ? 'Simples Nacional' : regimeTributario === 'lucro_presumido' ? 'Lucro Presumido' : 'Lucro Real'}
                  divergenciaAceita={divergenciaAceita}
                  onAceitarDivergencia={setDivergenciaAceita}
                />
              )}

              {/* Frete / Conhecimento de transporte (CT-e) */}
              <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <Truck size={18} color="var(--accent-purple)" />
                  <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Frete / Conhecimento de Transporte</h3>
                </div>
                <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', margin: '0 0 16px', lineHeight: 1.5 }}>
                  O valor do frete é <strong>dividido entre os produtos</strong> (proporcional ao valor de cada um) e entra no
                  custo que vai para o estoque. Informando a <strong>transportadora</strong>, o frete vira um título a pagar
                  separado, no nome dela. Frete que o próprio fornecedor cobrou dentro da nota já vem preenchido — nesse caso
                  deixe a transportadora em branco. Se o fornecedor cobra o frete <strong>a prazo, fora das duplicatas</strong>, marque a
                  opção abaixo para lançar o título dele no Contas a Pagar.
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
                  <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>Valor do frete (R$)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={frete.valor || ''}
                      onChange={(e) => setFrete({ ...frete, valor: Math.max(0, Number(e.target.value) || 0) })}
                      placeholder="0,00"
                      style={{ padding: '10px 12px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontWeight: 600 }}
                    />
                    {parsedData.valorFreteXml > 0 && (
                      <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                        A nota já trouxe {currencyFormat.format(parsedData.valorFreteXml)} de frete.
                      </span>
                    )}
                  </div>

                  <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>Transportadora</label>
                    <ClientAutocomplete
                      value={buscaTransportadora}
                      onChange={(valor) => {
                        setBuscaTransportadora(valor);
                        if (!valor.trim()) setFrete((atual) => ({ ...atual, transportadoraId: '', transportadoraNome: '' }));
                      }}
                      clients={fornecedoresAtuais}
                      onSelect={(f) => {
                        const nome = String(f.nome || '').trim();
                        setFrete((atual) => ({ ...atual, transportadoraId: f.id, transportadoraNome: nome }));
                        setBuscaTransportadora(nome);
                      }}
                      renderItem={(f: { id: string; nome?: string; codigo?: string | null; tipo?: string }) => (
                        <span>
                          {f.codigo ? `${f.codigo} · ${f.nome}` : f.nome}
                          {f.tipo === 'Transportadora' && (
                            <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--accent-purple)', fontWeight: 700 }}>TRANSPORTADORA</span>
                          )}
                        </span>
                      )}
                      placeholder="Buscar transportadora..."
                      ariaLabel="Buscar transportadora"
                      emptyHint={<span>Não achou? Cadastre em Cadastros &gt; Fornecedores com o tipo <strong>Transportadora</strong>.</span>}
                    />
                  </div>

                  <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>Chave do CT-e (44 números)</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={frete.chaveCte}
                      onChange={(e) => setFrete({ ...frete, chaveCte: somenteDigitos(e.target.value).slice(0, 44) })}
                      placeholder="Opcional — cole a chave do conhecimento"
                      style={{ padding: '10px 12px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: '13px' }}
                    />
                    {frete.chaveCte.length > 0 && (
                      <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>{somenteDigitos(frete.chaveCte).length} de 44</span>
                    )}
                  </div>

                  <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>Vencimento do frete</label>
                    <input
                      type="date"
                      value={vencimentoDoFrete(frete, parsedData.dataEmissao)}
                      onChange={(e) => setFrete({ ...frete, vencimento: e.target.value })}
                      style={{ padding: '10px 12px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
                    />
                    <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>Padrão: 30 dias da emissão da nota.</span>
                  </div>
                </div>

                {!frete.transportadoraId && (
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginTop: '14px', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={frete.lancarNoFornecedor === true}
                      onChange={(e) => setFrete({ ...frete, lancarNoFornecedor: e.target.checked })}
                      style={{ marginTop: '3px' }}
                    />
                    <span>
                      O frete é cobrado <strong>a prazo pelo próprio fornecedor</strong>, fora das duplicatas da nota — lançar um título a pagar
                      separado no nome de {fornecedorMatch?.nome || 'fornecedor'}.
                      <span style={{ display: 'block', fontSize: '11.5px', color: 'var(--text-muted)' }}>
                        Só marque se as duplicatas acima <strong>não</strong> incluem o frete; senão ele seria pago em dobro.
                      </span>
                    </span>
                  </label>
                )}

                {erroDoFrete(frete) && (
                  <div style={{ marginTop: '14px', padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid #f59e0b', color: '#fbbf24', fontSize: '13px' }}>
                    {erroDoFrete(frete)}
                  </div>
                )}

                {frete.valor > 0 && !erroDoFrete(frete) && (
                  <div style={{ marginTop: '14px', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    {currencyFormat.format(frete.valor)} entra no custo dos {parsedData.items.length} produto(s).{' '}
                    {freteGeraTituloProprio(frete)
                      ? <>Vai gerar <strong>mais um título</strong> a pagar, de {credorDoFrete(frete, fornecedorMatch ?? { id: '', nome: '' }).nome}, vencendo em {vencimentoDoFrete(frete, parsedData.dataEmissao).split('-').reverse().join('/')}.</>
                      : <>Sem transportadora: <strong>não</strong> gera título separado (quem cobra é o fornecedor da nota).</>}
                  </div>
                )}
              </div>

              <PagamentoCard
                modo={modoPagamento}
                onModo={(modo) => { setModoPagamento(modo); setParcelasAceitas(false); }}
                parcelas={parcelas}
                onParcelas={setParcelas}
                totalDaNota={parsedData.nota.totais.total}
                dataEmissao={parsedData.dataEmissao}
                formaPrevista={formaPrevista}
                onFormaPrevista={setFormaPrevista}
                categoria={categoriaDespesa}
                onCategoria={setCategoriaDespesa}
                categoriasDaEmpresa={categoriasDaEmpresa}
                destino={destinoPagamento}
                onDestino={setDestinoPagamento}
                bancoId={bancoId}
                onBancoId={setBancoId}
                bancos={bancos}
                parcelasAceitas={parcelasAceitas}
                onAceitarParcelas={setParcelasAceitas}
                formaNoXml={parsedData.nota.pagamentos.map((p) => `${rotuloDaFormaDePagamento(p.forma)} ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.valor)}`).join(' + ')}
              />

              {/* Itens da nota: classificacao Revenda/Materia-Prima +
                  precificacao/tributacao (Fatia 2/N do F22) */}
              <div className="card" style={{ padding: '0', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Package size={20} color="var(--accent-purple)" />
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Itens Encontrados no XML ({parsedData.items.length})</h3>
                </div>
                {itemConfigs.some((c) => c.classificacao === 'novo') && (
                  <div style={{ padding: '10px 24px', borderBottom: '1px solid var(--border-color)', fontSize: '12.5px', color: '#fbbf24', lineHeight: 1.5 }}>
                    {itemConfigs.filter((c) => c.classificacao === 'novo').length} item(ns) serão cadastrados como <strong>novos</strong>. Se algum já existe no seu
                    cadastro, use <strong>"Já tenho este item cadastrado — vincular"</strong> para não duplicar; o sistema guarda o vínculo e reconhece sozinho nas próximas notas deste fornecedor.
                  </div>
                )}

                {parsedData.items.map((item, idx) => {
                  const config = itemConfigs[idx];
                  if (!config) return null;

                  const correspondenteEstoque = config.classificacao === 'estoque'
                    ? estoqueAtual.find((p) => p.id === config.matchId)
                    : undefined;
                  const correspondenteMateriaPrima = config.classificacao === 'materia_prima'
                    ? materiasPrimasAtuais.find((m) => m.id === config.matchId)
                    : undefined;
                  const correspondenteInsumo = config.classificacao === 'insumo'
                    ? insumosAtuais.find((i) => i.id === config.matchId)
                    : undefined;
                  const cadastro: CadastroVinculado | undefined = correspondenteEstoque
                    ? { nome: correspondenteEstoque.nome, quantidade: correspondenteEstoque.quantidade, precoCusto: correspondenteEstoque.precoCusto, precoVenda: correspondenteEstoque.precoVenda, unidade: correspondenteEstoque.unidadeMedidaSigla }
                    : (correspondenteMateriaPrima ?? correspondenteInsumo)
                      ? { nome: (correspondenteMateriaPrima ?? correspondenteInsumo)!.nome, quantidade: (correspondenteMateriaPrima ?? correspondenteInsumo)!.quantidade, precoCusto: (correspondenteMateriaPrima ?? correspondenteInsumo)!.precoCusto, unidade: (correspondenteMateriaPrima ?? correspondenteInsumo)!.unidade }
                      : undefined;

                  return (
                    <ItemDaNotaCard
                      key={idx}
                      indice={idx}
                      total={parsedData.items.length}
                      item={item}
                      config={config}
                      custo={custosDosItens[idx]}
                      custoUnitarioEstoque={custoUnitarioDoItem(idx)}
                      cadastro={cadastro}
                      usaCsosn={usesCsosn(regimeTributario)}
                      markupVarejoDigitado={markupDigitado[`${idx}-v`]}
                      markupAtacadoDigitado={markupDigitado[`${idx}-a`]}
                      onAlterarTipo={(tipo) => handleAlterarTipoItem(idx, tipo)}
                      onAlterarConfig={(patch) => handleAlterarConfigItem(idx, patch)}
                      onAlterarCampo={(campo, valor) => handleAlterarCampoItem(idx, campo, valor)}
                      onPrecoVarejo={(texto) => handlePrecoVarejo(idx, texto)}
                      onMarkupVarejo={(texto) => handleMarkupVarejo(idx, texto)}
                      onPrecoAtacado={(texto) => handlePrecoAtacado(idx, texto)}
                      onMarkupAtacado={(texto) => handleMarkupAtacado(idx, texto)}
                      onAbrirVinculo={() => handleAbrirVinculo(idx)}
                      onDesvincular={() => handleDesvincularItem(idx)}
                      painelDeVinculo={vinculoAberto === idx ? renderPainelDeVinculo(idx, item) : null}
                    />
                  );
                })}
              </div>

              {/* Ações */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '16px', marginTop: '16px' }}>
                {fornecedorStatus !== 'found' && (
                  <span style={{ fontSize: '13px', color: '#ef4444' }}>Cadastre o fornecedor para liberar a confirmação</span>
                )}
                <button
                  className="btn-secondary"
                  onClick={handleRemoverFile}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  Cancelar
                </button>
                <button
                  className="btn-primary"
                  onClick={handleConfirmarEntrada}
                  disabled={isProcessing || fornecedorStatus !== 'found' || itemConfigs.length !== parsedData.items.length}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 24px', backgroundColor: '#10b981', borderColor: '#10b981', boxShadow: '0 0 15px rgba(16, 185, 129, 0.3)', opacity: (isProcessing || fornecedorStatus !== 'found' || itemConfigs.length !== parsedData.items.length) ? 0.5 : 1, cursor: (isProcessing || fornecedorStatus !== 'found' || itemConfigs.length !== parsedData.items.length) ? 'not-allowed' : 'pointer' }}
                >
                  <Save size={18} />
                  {isProcessing ? 'Gravando dados...' : 'Confirmar Importação no Estoque'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {danfe && <PdfVisualizador titulo="DANFE" nomeArquivo={danfe.nome} pdf={danfe.blob} onFechar={() => setDanfe(null)} />}

      {showFornecedorModal && parsedData && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '24px' }}>
          <div className="card" style={{ width: '100%', maxWidth: '480px', padding: '28px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <Truck size={22} color="var(--accent-purple)" />
              <h2 style={{ margin: 0, fontSize: '18px' }}>Cadastrar Fornecedor</h2>
            </div>
            <p style={{ margin: '0 0 20px', color: 'var(--text-muted)', fontSize: '13px', lineHeight: 1.5 }}>
              O fornecedor <strong>{parsedData.fornecedorNome}</strong> não está cadastrado. Confirme os dados abaixo para cadastrá-lo e liberar a importação da nota.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="input-group">
                <label>Nome / Razão Social *</label>
                <input
                  type="text"
                  value={fornecedorForm.nome}
                  onChange={(e) => setFornecedorForm({ ...fornecedorForm, nome: aplicarCaixaAltaCadastro(e.target, e.target.value) })}
                  style={{ textTransform: 'uppercase', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)', width: '100%' }}
                />
              </div>
              <div className="input-group">
                <label>CNPJ / CPF (apenas números)</label>
                <input
                  type="text"
                  value={fornecedorForm.cnpj}
                  onChange={(e) => setFornecedorForm({ ...fornecedorForm, cnpj: e.target.value.replace(/\D/g, '').slice(0, 14) })}
                  style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)', width: '100%' }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="input-group">
                  <label>Telefone</label>
                  <input
                    type="text"
                    placeholder="(00) 00000-0000"
                    value={fornecedorForm.telefone}
                    onChange={(e) => setFornecedorForm({ ...fornecedorForm, telefone: e.target.value })}
                    style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)', width: '100%' }}
                  />
                </div>
                <div className="input-group">
                  <label>E-mail</label>
                  <input
                    type="email"
                    value={fornecedorForm.email}
                    onChange={(e) => setFornecedorForm({ ...fornecedorForm, email: e.target.value })}
                    style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)', width: '100%' }}
                  />
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
              <button type="button" className="btn-secondary" onClick={handleRemoverFile} disabled={isSavingFornecedor}>
                Cancelar importação
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleSalvarFornecedor}
                disabled={isSavingFornecedor}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: isSavingFornecedor ? 0.7 : 1 }}
              >
                {isSavingFornecedor ? <Loader2 size={16} className="spin-icon" /> : <Save size={16} />}
                {isSavingFornecedor ? 'Salvando...' : 'Cadastrar e continuar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EntradaNFE;
