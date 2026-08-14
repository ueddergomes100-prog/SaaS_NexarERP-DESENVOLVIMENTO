import React, { useState, useEffect, useRef } from 'react';
import { Upload, FileText, Package, CheckCircle, Save, ArrowLeft, Trash2, AlertTriangle, Truck, Loader2, History } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTabs } from '../../contexts/TabsContext';
import { collection, query, where, getDocs, doc, getDoc, addDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError, NexusSwal } from '../../utils/alerts';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { addDaysToDateInput } from '../../utils/dateTime';
import {
  DEFAULT_REGIME_TRIBUTARIO,
  matchProdutoFromXmlItem,
  matchMateriaPrimaFromXmlItem,
  usesCsosn,
  CSOSN_OPTIONS,
  ICMS_CST_OPTIONS,
  type EstoqueItemForMatch,
  type MateriaPrimaItemForMatch,
  type RegimeTributario,
} from '../../utils/fiscalDomain';
import {
  buildNotaFiscalEntradaRecord,
  buildInitialItemEntradaConfig,
  type NotaFiscalEntradaItemRecord,
  type ItemEntradaConfig,
} from '../../utils/entradaNfeDomain';
import Swal from 'sweetalert2';

interface ParsedItem {
  codigo: string;
  descricao: string;
  ncm: string;
  cfop: string;
  ean: string;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
}

interface Duplicata {
  numero: string;
  vencimento: string;
  valor: number;
}

interface ParsedXML {
  fornecedorNome: string;
  fornecedorCnpj: string;
  numeroNF: string;
  dataEmissao: string;
  valorTotal: number;
  items: ParsedItem[];
  duplicatas: Duplicata[];
}

interface EstoqueItem extends EstoqueItemForMatch {
  quantidade: number;
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
}

type FornecedorStatus = 'idle' | 'checking' | 'found' | 'missing';

const currencyFormat = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const campoLabelStyle: React.CSSProperties = { fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' };
const campoInputStyle: React.CSSProperties = { padding: '8px 10px', fontSize: '13px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', width: '100%' };

const EntradaNFE: React.FC = () => {
  const navigate = useNavigate();
  const { openTab } = useTabs();
  const { tenantId, currentUser } = useAuth();
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Estado com dados parseados
  const [parsedData, setParsedData] = useState<ParsedXML | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Estoque e materia-prima atuais para busca rápida local
  const [estoqueAtual, setEstoqueAtual] = useState<EstoqueItem[]>([]);
  const [materiasPrimasAtuais, setMateriasPrimasAtuais] = useState<MateriaPrimaItem[]>([]);

  // Classificacao (Revenda/Materia-Prima) + precificacao/tributacao por
  // item da nota (Fatia 2/N) -- array paralelo a parsedData.items,
  // inicializado so depois que o fornecedor resolve (ver efeito abaixo),
  // pra nao classificar errado um item que so seria reconhecido pelo
  // codigo que ESSE fornecedor usa (camada 2 do matching).
  const [itemConfigs, setItemConfigs] = useState<ItemEntradaConfig[]>([]);

  // Reconciliação do fornecedor do XML com o cadastro de Fornecedores --
  // a confirmação da entrada fica bloqueada até haver um fornecedor
  // vinculado (decisão combinada com o usuário: não deixa entrar nota
  // com fornecedor "texto livre" sem cadastro).
  const [fornecedorMatch, setFornecedorMatch] = useState<{ id: string; nome: string } | null>(null);
  const [fornecedorStatus, setFornecedorStatus] = useState<FornecedorStatus>('idle');
  const [showFornecedorModal, setShowFornecedorModal] = useState(false);
  const [fornecedorForm, setFornecedorForm] = useState({ nome: '', cnpj: '', telefone: '', email: '' });
  const [isSavingFornecedor, setIsSavingFornecedor] = useState(false);

  // Regime tributario do tenant -- decide o CSOSN/CST default gravado num
  // produto novo criado pela importacao (mesmo padrao de leitura direta
  // de configuracoes/{tenantId} ja usado em EstoqueForm.tsx/NFE.tsx).
  const [regimeTributario, setRegimeTributario] = useState<RegimeTributario>(DEFAULT_REGIME_TRIBUTARIO);

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
            quantidade: Number(data.quantidade || 0),
          });
        });
        setMateriasPrimasAtuais(list);
      } catch (err) {
        console.error("Erro ao carregar matérias-primas para reconciliação:", err);
      }
    };
    const fetchRegimeTributario = async () => {
      if (!tenantId) return;
      try {
        const configSnap = await getDoc(doc(db, 'configuracoes', tenantId));
        setRegimeTributario((configSnap.data()?.regimeTributario ?? DEFAULT_REGIME_TRIBUTARIO) as RegimeTributario);
      } catch (err) {
        console.error("Erro ao carregar regime tributário:", err);
      }
    };
    fetchEstoque();
    fetchMateriasPrimas();
    fetchRegimeTributario();
  }, [tenantId]);

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
    const configs = parsedData.items.map((item) => {
      const { produto: pecaExistente } = matchProdutoFromXmlItem(item, estoqueAtual, fornecedorMatch.id);
      if (pecaExistente) {
        return buildInitialItemEntradaConfig(item.valorUnitario, pecaExistente, null, usaCsosn);
      }
      const materiaPrimaExistente = matchMateriaPrimaFromXmlItem(item, materiasPrimasAtuais);
      return buildInitialItemEntradaConfig(item.valorUnitario, null, materiaPrimaExistente?.id || null, usaCsosn);
    });
    setItemConfigs(configs);
  }, [parsedData, fornecedorStatus, fornecedorMatch, estoqueAtual, materiasPrimasAtuais, regimeTributario]);

  const handleAlterarTipoItem = (idx: number, tipo: ItemEntradaConfig['tipo']) => {
    setItemConfigs((prev) => prev.map((config, i) => (i === idx ? { ...config, tipo } : config)));
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

  // Executa o parser do XML
  const processFile = (file: File) => {
    setSelectedFile(file);
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, "text/xml");

        // Verifica se houve erro de parse no navegador
        const parseError = xmlDoc.getElementsByTagName("parsererror");
        if (parseError.length > 0) {
          throw new Error("Formato do arquivo XML corrompido ou inválido.");
        }

        const getValue = (tagName: string, parentNode: Element | Document = xmlDoc) => {
          const elements = parentNode.getElementsByTagName(tagName);
          return elements.length > 0 ? elements[0].textContent || '' : '';
        };

        // Dados do Emitente (Fornecedor)
        const emitNode = xmlDoc.getElementsByTagName("emit")[0];
        const fornecedorNome = emitNode ? getValue("xNome", emitNode) : 'FORNECEDOR DESCONHECIDO';
        const fornecedorCnpj = emitNode ? getValue("CNPJ", emitNode) : '';

        // Dados da Nota
        const ideNode = xmlDoc.getElementsByTagName("ide")[0];
        const numeroNF = ideNode ? getValue("nNF", ideNode) : '000000';
        const dataEmissaoRaw = ideNode ? (getValue("dhEmi", ideNode) || getValue("dEmi", ideNode)) : '';
        const dataEmissao = dataEmissaoRaw ? dataEmissaoRaw.split('T')[0] : new Date().toISOString().split('T')[0];

        // Totais
        const totalNode = xmlDoc.getElementsByTagName("ICMSTot")[0];
        const valorTotal = totalNode ? Number(getValue("vNF", totalNode) || 0) : 0;

        // Duplicatas (parcelas de pagamento), se a nota trouxer -- vira
        // um título de Contas a Pagar por parcela; sem duplicata, a
        // entrada lança um único título com vencimento padrão.
        const dupNodes = xmlDoc.getElementsByTagName("dup");
        const duplicatas: Duplicata[] = [];
        for (let i = 0; i < dupNodes.length; i++) {
          const dupNode = dupNodes[i];
          const vencimento = getValue("dVenc", dupNode);
          duplicatas.push({
            numero: getValue("nDup", dupNode) || String(i + 1),
            vencimento: vencimento || dataEmissao,
            valor: Number(getValue("vDup", dupNode) || 0)
          });
        }

        // Itens da Nota
        const detNodes = xmlDoc.getElementsByTagName("det");
        const items: ParsedItem[] = [];

        for (let i = 0; i < detNodes.length; i++) {
          const detNode = detNodes[i];
          const prodNode = detNode.getElementsByTagName("prod")[0];
          if (prodNode) {
            const eanBruto = getValue("cEAN", prodNode);
            items.push({
              codigo: getValue("cProd", prodNode),
              descricao: getValue("xProd", prodNode),
              ncm: getValue("NCM", prodNode),
              cfop: getValue("CFOP", prodNode),
              // XML costuma trazer "SEM GTIN" quando o produto nao tem
              // codigo de barras -- nao e um EAN de verdade, nao usar pra
              // matching.
              ean: eanBruto && eanBruto.toUpperCase() !== 'SEM GTIN' ? eanBruto : '',
              unidade: getValue("uCom", prodNode) || 'UN',
              quantidade: Number(getValue("qCom", prodNode) || 0),
              valorUnitario: Number(getValue("vUnCom", prodNode) || 0),
              valorTotal: Number(getValue("vProd", prodNode) || 0)
            });
          }
        }

        if (items.length === 0) {
          throw new Error("Nenhum produto identificado no corpo da nota XML.");
        }

        setParsedData({
          fornecedorNome,
          fornecedorCnpj,
          numeroNF,
          dataEmissao,
          valorTotal,
          items,
          duplicatas
        });

      } catch (err) {
        console.error(err);
        showError('Erro no Processamento', (err as Error).message || 'Não foi possível ler os nós fiscais do arquivo XML.');
        setSelectedFile(null);
        setParsedData(null);
      }
    };

    reader.readAsText(file);
  };

  // Salva dados no Firestore
  const handleConfirmarEntrada = async () => {
    if (!parsedData || !tenantId || !currentUser || !fornecedorMatch) return;
    if (itemConfigs.length !== parsedData.items.length) return;

    // Todo item de Revenda precisa de preco de venda valido antes de
    // gravar -- e o pedido central desta fatia, nao da pra deixar passar
    // em branco/zero silenciosamente como o markup automatico fazia antes.
    const itemSemPreco = parsedData.items.find((item, idx) => {
      const config = itemConfigs[idx];
      return config.tipo === 'revenda' && !(Number(config.precoVenda) > 0);
    });
    if (itemSemPreco) {
      showError('Preço de venda obrigatório', `Informe um preço de venda válido para "${itemSemPreco.descricao}" antes de confirmar.`);
      return;
    }

    setIsProcessing(true);

    NexusSwal.fire({
      title: 'Importando NF-e...',
      text: 'Buscando produtos em estoque e lançando contas a pagar...',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    try {
      let pecasAtualizadas = 0;
      let pecasCriadas = 0;
      let materiasPrimasAtualizadas = 0;
      let materiasPrimasCriadas = 0;
      // Historico da nota de entrada (Fatia 0/N) -- so acumula os dados
      // aqui, a gravacao acontece depois dos dois loops (itens + titulos).
      const notaItens: NotaFiscalEntradaItemRecord[] = [];

      for (let idx = 0; idx < parsedData.items.length; idx++) {
        const item = parsedData.items[idx];
        const config = itemConfigs[idx];

        if (config.tipo === 'materia_prima') {
          if (config.classificacao === 'materia_prima' && config.matchId) {
            const materiaPrimaExistente = materiasPrimasAtuais.find((m) => m.id === config.matchId);
            const novaQuantidade = (materiaPrimaExistente?.quantidade || 0) + item.quantidade;
            await updateDoc(doc(db, 'materias_primas', config.matchId), {
              quantidade: novaQuantidade,
              precoCusto: item.valorUnitario,
              fornecedor: fornecedorMatch.nome,
              updatedAt: serverTimestamp(),
              ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), `Entrada de NF ${parsedData.numeroNF}`),
            });
            materiasPrimasAtualizadas++;
            notaItens.push({
              itemId: config.matchId,
              tipo: 'materia_prima',
              codigoXml: item.codigo,
              descricaoXml: item.descricao,
              quantidade: item.quantidade,
              valorUnitario: item.valorUnitario,
              novo: false,
            });
          } else {
            // Simplificacao deliberada, mesma do cadastro manual de
            // Materia-Prima (Modulo 4 Fatia 0): unidade e fornecedor ficam
            // como texto livre, sem linkar a Unidades de Medida/Fornecedores.
            const novaMateriaPrimaRef = await addDoc(collection(db, 'materias_primas'), {
              codigo: item.codigo,
              nome: item.descricao.toUpperCase(),
              categoria: 'DIVERSOS',
              unidade: item.unidade.toUpperCase() || 'UN',
              quantidade: item.quantidade,
              estoqueMinimo: 0,
              precoCusto: item.valorUnitario,
              fornecedor: fornecedorMatch.nome,
              tenantId,
              createdAt: serverTimestamp(),
              ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
            });
            materiasPrimasCriadas++;
            notaItens.push({
              itemId: novaMateriaPrimaRef.id,
              tipo: 'materia_prima',
              codigoXml: item.codigo,
              descricaoXml: item.descricao,
              quantidade: item.quantidade,
              valorUnitario: item.valorUnitario,
              novo: true,
            });
          }
          continue;
        }

        // tipo === 'revenda' -- precificacao/tributacao vem do que o
        // usuario preencheu na tela (itemConfigs), nao mais de um markup
        // fixo. Fora do Simples Nacional, os campos extra de ICMS/PIS/
        // COFINS tambem sao gravados; dentro do Simples, so CSOSN/origem
        // importam (usesCsosn), entao os demais nem sao enviados.
        const camposFiscais: Record<string, unknown> = {
          precoVenda: Number(config.precoVenda) || 0,
          csosn: config.csosn,
        };
        if (!usesCsosn(regimeTributario)) {
          camposFiscais.aliquotaIcms = Number(config.aliquotaIcms) || 0;
          camposFiscais.reducaoBaseIcms = Number(config.reducaoBaseIcms) || 0;
          camposFiscais.cstPis = config.cstPis;
          camposFiscais.aliquotaPis = Number(config.aliquotaPis) || 0;
          camposFiscais.cstCofins = config.cstCofins;
          camposFiscais.aliquotaCofins = Number(config.aliquotaCofins) || 0;
        }

        if (config.classificacao === 'estoque' && config.matchId) {
          // Incrementa quantidade e memoriza o codigo que este fornecedor
          // usa pra este item, pra a proxima importacao dele cair direto
          // na camada 2 (mais rapida e confiavel que NCM+nome).
          const pecaExistente = estoqueAtual.find((p) => p.id === config.matchId);
          const novaQuantidade = (pecaExistente?.quantidade || 0) + item.quantidade;
          await updateDoc(doc(db, 'estoque', config.matchId), {
            quantidade: novaQuantidade,
            precoCusto: item.valorUnitario,
            fornecedor: fornecedorMatch.nome,
            fornecedorId: fornecedorMatch.id,
            [`codigosFornecedor.${fornecedorMatch.id}`]: item.codigo,
            ...camposFiscais,
            updatedAt: serverTimestamp(),
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), `Entrada de NF ${parsedData.numeroNF}`),
          });
          pecasAtualizadas++;
          notaItens.push({
            itemId: config.matchId,
            tipo: 'revenda',
            codigoXml: item.codigo,
            descricaoXml: item.descricao,
            quantidade: item.quantidade,
            valorUnitario: item.valorUnitario,
            novo: false,
          });
        } else {
          // Cria novo produto ja gravando NCM, CFOP, EAN e a precificacao/
          // tributacao que o usuario preencheu na tela (antes era um
          // markup de 50% + CSOSN default fixo, sem input do usuario).
          const novoProdutoRef = await addDoc(collection(db, 'estoque'), {
            codigo: item.codigo,
            nome: item.descricao.toUpperCase(),
            quantidade: item.quantidade,
            estoqueMinimo: 0,
            precoCusto: item.valorUnitario,
            fornecedor: fornecedorMatch.nome,
            fornecedorId: fornecedorMatch.id,
            codigosFornecedor: { [fornecedorMatch.id]: item.codigo },
            categoria: 'DIVERSOS',
            unidadeMedidaId: 'un',
            unidadeMedidaSigla: item.unidade.toUpperCase() || 'UN',
            unidadeMedidaCasasDecimais: 0,
            ncm: item.ncm.replace(/\D/g, ''),
            cfop: item.cfop,
            codigoBarras: item.ean,
            origem: '0',
            ...camposFiscais,
            tenantId,
            createdAt: serverTimestamp(),
            ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
          });
          pecasCriadas++;
          notaItens.push({
            itemId: novoProdutoRef.id,
            tipo: 'revenda',
            codigoXml: item.codigo,
            descricaoXml: item.descricao,
            quantidade: item.quantidade,
            valorUnitario: item.valorUnitario,
            novo: true,
          });
        }
      }

      // Lança a(s) conta(s) a pagar -- uma por duplicata da nota, ou um
      // único título com vencimento padrão (emissão + 30 dias) quando o
      // XML não trouxer duplicatas.
      const duplicatasParaLancar = parsedData.duplicatas.length > 0
        ? parsedData.duplicatas
        : [{ numero: '1', vencimento: addDaysToDateInput(parsedData.dataEmissao, 30), valor: parsedData.valorTotal }];

      const titulosPagarIds: string[] = [];

      for (let i = 0; i < duplicatasParaLancar.length; i++) {
        const parcela = duplicatasParaLancar[i];
        const descricaoParcela = duplicatasParaLancar.length > 1
          ? `COMPRA NF ${parsedData.numeroNF} - ${fornecedorMatch.nome} (Parcela ${i + 1}/${duplicatasParaLancar.length})`
          : `COMPRA NF ${parsedData.numeroNF} - ${fornecedorMatch.nome}`;

        const tituloRef = await addDoc(collection(db, 'transacoes'), {
          descricao: descricaoParcela,
          data: parcela.vencimento,
          valor: parcela.valor,
          categoria: 'FORNECEDORES DE PEÇAS',
          status: 'Pendente',
          tipo: 'saida',
          fornecedorId: fornecedorMatch.id,
          fornecedorNome: fornecedorMatch.nome,
          tenantId,
          createdAt: serverTimestamp(),
          ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
        });
        titulosPagarIds.push(tituloRef.id);
      }

      // Historico da nota de entrada (Fatia 0/N -- fundacao). So grava o
      // registro pra habilitar listagem/exclusao nas fatias seguintes;
      // nao muda nada do que ja acontecia em estoque/transacoes acima.
      await addDoc(collection(db, 'notas_fiscais_entrada'), {
        ...buildNotaFiscalEntradaRecord({
          numeroNF: parsedData.numeroNF,
          dataEmissao: parsedData.dataEmissao,
          valorTotal: parsedData.valorTotal,
          fornecedorId: fornecedorMatch.id,
          fornecedorNome: fornecedorMatch.nome,
          fornecedorCnpj: parsedData.fornecedorCnpj,
          itens: notaItens,
          titulosPagarIds,
        }),
        tenantId,
        createdAt: serverTimestamp(),
        ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
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
          descricao: `Importação de XML NF ${parsedData.numeroNF} (${fornecedorMatch.nome}) realizada. ${pecasAtualizadas} produtos atualizados, ${pecasCriadas} novos produtos cadastrados, ${materiasPrimasAtualizadas} matérias-primas atualizadas, ${materiasPrimasCriadas} novas matérias-primas cadastradas. ${duplicatasParaLancar.length} título(s) lançado(s) em Contas a Pagar totalizando R$ ${parsedData.valorTotal.toFixed(2)}.`,
          status: 'sucesso'
        });
      } catch {
        // Ignora erros ao registrar auditoria
      }

      Swal.close();
      const resumoMateriaPrima = (materiasPrimasAtualizadas + materiasPrimasCriadas) > 0
        ? ` e ${materiasPrimasAtualizadas} matéria(s)-prima(s) atualizada(s) + ${materiasPrimasCriadas} nova(s)`
        : '';
      showSuccess(`Sucesso! ${pecasAtualizadas} produtos incrementados e ${pecasCriadas} novos itens criados no estoque${resumoMateriaPrima}.`);

      // Reseta tela
      handleRemoverFile();
      navigate('/estoque');

    } catch (err) {
      console.error(err);
      Swal.close();
      showError('Erro na Importação', (err as Error).message || 'Falha ao salvar itens no banco de dados.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRemoverFile = () => {
    setSelectedFile(null);
    setParsedData(null);
    setFornecedorMatch(null);
    setFornecedorStatus('idle');
    setShowFornecedorModal(false);
    setItemConfigs([]);
    itemConfigsInitializedForRef.current = null;
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
        // Dropzone
        <div className="form-grid">
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

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
                  <div>
                    <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Fornecedor</label>
                    <strong style={{ fontSize: '15px', color: 'var(--text-primary)' }}>{parsedData.fornecedorNome}</strong>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>CNPJ do Fornecedor</label>
                    <strong style={{ fontSize: '15px', color: 'var(--text-primary)' }}>
                      {parsedData.fornecedorCnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")}
                    </strong>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Número da NF-e</label>
                    <strong style={{ fontSize: '15px', color: 'var(--text-primary)' }}>{parsedData.numeroNF}</strong>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Data de Emissão</label>
                    <strong style={{ fontSize: '15px', color: 'var(--text-primary)' }}>
                      {parsedData.dataEmissao.split('-').reverse().join('/')}
                    </strong>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Valor Total da Nota</label>
                    <strong style={{ fontSize: '18px', color: '#10b981', fontWeight: 'bold' }}>
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(parsedData.valorTotal)}
                    </strong>
                  </div>
                </div>
              </div>

              {/* Card Contas a Pagar */}
              <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                  <FileText size={18} color="var(--accent-purple)" />
                  <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>
                    Títulos a lançar em Contas a Pagar {parsedData.duplicatas.length > 0 ? `(${parsedData.duplicatas.length} duplicata(s) da nota)` : '(sem duplicata na nota — vencimento padrão de 30 dias)'}
                  </h3>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {(parsedData.duplicatas.length > 0
                    ? parsedData.duplicatas
                    : [{ numero: '1', vencimento: addDaysToDateInput(parsedData.dataEmissao, 30), valor: parsedData.valorTotal }]
                  ).map((parcela, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', fontSize: '13px' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Parcela {parcela.numero} — vence em {parcela.vencimento.split('-').reverse().join('/')}</span>
                      <strong style={{ color: 'var(--text-primary)' }}>
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(parcela.valor)}
                      </strong>
                    </div>
                  ))}
                </div>
              </div>

              {/* Itens da nota: classificacao Revenda/Materia-Prima +
                  precificacao/tributacao (Fatia 2/N do F22) */}
              <div className="card" style={{ padding: '0', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Package size={20} color="var(--accent-purple)" />
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Itens Encontrados no XML ({parsedData.items.length})</h3>
                </div>

                {parsedData.items.map((item, idx) => {
                  const config = itemConfigs[idx];
                  if (!config) return null;

                  const correspondenteEstoque = config.classificacao === 'estoque'
                    ? estoqueAtual.find((p) => p.id === config.matchId)
                    : undefined;
                  const correspondenteMateriaPrima = config.classificacao === 'materia_prima'
                    ? materiasPrimasAtuais.find((m) => m.id === config.matchId)
                    : undefined;
                  const usaCsosn = usesCsosn(regimeTributario);

                  return (
                    <div key={idx} style={{ padding: '18px 24px', borderBottom: idx < parsedData.items.length - 1 ? '1px solid var(--border-color)' : 'none' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
                        <div>
                          <strong style={{ fontSize: '14px' }}>{item.descricao}</strong>
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                            Código XML: {item.codigo} · NCM: {item.ncm} · {item.quantidade} {item.unidade} × {currencyFormat.format(item.valorUnitario)} = <strong>{currencyFormat.format(item.valorTotal)}</strong>
                          </div>
                        </div>

                        {config.classificacao === 'estoque' && (
                          <span style={{ padding: '4px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#10b981', whiteSpace: 'nowrap' }}>
                            Mesclar Estoque (Revenda){correspondenteEstoque ? ` — +${correspondenteEstoque.quantidade} cadastrados` : ''}
                          </span>
                        )}
                        {config.classificacao === 'materia_prima' && (
                          <span style={{ padding: '4px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, backgroundColor: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', whiteSpace: 'nowrap' }}>
                            Mesclar Matéria-Prima{correspondenteMateriaPrima ? ` — +${correspondenteMateriaPrima.quantidade} cadastrados` : ''}
                          </span>
                        )}
                        {config.classificacao === 'novo' && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Item novo — classificar como:</span>
                            <select
                              value={config.tipo}
                              onChange={(e) => handleAlterarTipoItem(idx, e.target.value as ItemEntradaConfig['tipo'])}
                              className="form-select"
                              style={{ padding: '6px 10px', fontSize: '13px' }}
                            >
                              <option value="revenda">Produto de Revenda</option>
                              <option value="materia_prima">Matéria-Prima</option>
                            </select>
                          </div>
                        )}
                      </div>

                      {config.tipo === 'revenda' ? (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', padding: '14px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
                          <div className="input-group">
                            <label style={campoLabelStyle}>Preço de Venda *</label>
                            <input
                              type="number" step="0.01" min="0"
                              value={config.precoVenda}
                              onChange={(e) => handleAlterarCampoItem(idx, 'precoVenda', e.target.value)}
                              style={campoInputStyle}
                            />
                          </div>
                          <div className="input-group">
                            <label style={campoLabelStyle}>{usaCsosn ? 'CSOSN' : 'CST ICMS'}</label>
                            <select
                              value={config.csosn}
                              onChange={(e) => handleAlterarCampoItem(idx, 'csosn', e.target.value)}
                              className="form-select"
                              style={campoInputStyle}
                            >
                              <option value="">Selecione...</option>
                              {(usaCsosn ? CSOSN_OPTIONS : ICMS_CST_OPTIONS).map((opt) => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                          </div>

                          {!usaCsosn && (
                            <>
                              <div className="input-group">
                                <label style={campoLabelStyle}>Alíquota ICMS (%)</label>
                                <input type="number" step="0.01" min="0" value={config.aliquotaIcms} onChange={(e) => handleAlterarCampoItem(idx, 'aliquotaIcms', e.target.value)} style={campoInputStyle} />
                              </div>
                              <div className="input-group">
                                <label style={campoLabelStyle}>Redução Base ICMS (%)</label>
                                <input type="number" step="0.01" min="0" value={config.reducaoBaseIcms} onChange={(e) => handleAlterarCampoItem(idx, 'reducaoBaseIcms', e.target.value)} style={campoInputStyle} />
                              </div>
                              <div className="input-group">
                                <label style={campoLabelStyle}>CST PIS</label>
                                <input type="text" value={config.cstPis} onChange={(e) => handleAlterarCampoItem(idx, 'cstPis', e.target.value)} style={campoInputStyle} />
                              </div>
                              <div className="input-group">
                                <label style={campoLabelStyle}>Alíquota PIS (%)</label>
                                <input type="number" step="0.01" min="0" value={config.aliquotaPis} onChange={(e) => handleAlterarCampoItem(idx, 'aliquotaPis', e.target.value)} style={campoInputStyle} />
                              </div>
                              <div className="input-group">
                                <label style={campoLabelStyle}>CST COFINS</label>
                                <input type="text" value={config.cstCofins} onChange={(e) => handleAlterarCampoItem(idx, 'cstCofins', e.target.value)} style={campoInputStyle} />
                              </div>
                              <div className="input-group">
                                <label style={campoLabelStyle}>Alíquota COFINS (%)</label>
                                <input type="number" step="0.01" min="0" value={config.aliquotaCofins} onChange={(e) => handleAlterarCampoItem(idx, 'aliquotaCofins', e.target.value)} style={campoInputStyle} />
                              </div>
                            </>
                          )}
                        </div>
                      ) : (
                        <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                          Matéria-prima: sem preço de venda nem tributação — entra no estoque de produção pelo custo de {currencyFormat.format(item.valorUnitario)}.
                        </p>
                      )}
                    </div>
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
                  onChange={(e) => setFornecedorForm({ ...fornecedorForm, nome: e.target.value })}
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
