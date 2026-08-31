import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { 
  ArrowLeft, Save, User, Car, FileText, Loader2, Plus, Trash2, 
  Calendar, Package, Wrench, Printer, ShoppingCart, Share2, X
} from 'lucide-react';
import {
  addDoc, collection, updateDoc, doc, getDoc, getDocs,
  getCountFromServer, serverTimestamp, query, where, runTransaction
} from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError, showWarning, NexusSwal } from '../../utils/alerts';
import { applyStockAdjustments, formatSequenceValue, getCurrentMaxSequence, getNextTenantSequenceValue, reserveTenantSequence, writeTenantSequenceValue } from '../../utils/firestoreAtomic';
import { isValidSaleQuantity } from '../../utils/saleQuantity';
import {
  avisoUnidadeMedidaAusente,
  resolveUnidadeMedidaProduto,
  temUnidadeMedidaCadastrada,
  type UnidadeMedidaProduto,
} from '../../utils/unidadeMedidaDomain';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { fromCents, toCents } from '../../utils/financeDomain';
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
import { getProximoCodigoCliente } from '../../utils/clienteCodigo';
import CadastroRapidoClienteModal, { type ClienteCadastradoRapido } from '../../components/common/CadastroRapidoClienteModal';
import DescontoInput, { type DescontoInputValue } from '../../components/finance/DescontoInput';
import SolicitarAprovacaoDescontoModal, { type AprovacaoDesconto } from '../../components/common/SolicitarAprovacaoDescontoModal';
import { useTenantCollection } from '../../hooks/useTenantCollection';
import ClientAutocomplete from '../../components/common/ClientAutocomplete';
import ProductAutocomplete from '../../components/common/ProductAutocomplete';
import ProductSearchModal from '../../components/common/ProductSearchModal';
import '../OS/OS.css';

interface ClienteBasico { id: string; nome: string; telefone: string; codigo?: string; }
interface ServicoData { id: string; nome: string; preco: number; }
interface ItemOrcamento {
  id: string;
  nome: string;
  preco: number;
  quantidade: number;
  tipo: 'servico' | 'peca';
  unidadeMedidaSigla?: string;
  unidadeMedidaFracionado?: boolean;
  unidadeMedidaCasasDecimais?: number;
}
const renderPecaRow = (p: PecaOrcamento) => (
  <>
    <span>{p.nome}</span>
    <span style={{ color: '#10b981' }}>R$ {p.precoVenda.toFixed(2)}</span>
  </>
);

interface PecaOrcamento {
  id: string;
  nome: string;
  precoVenda: number;
  quantidade?: number;
  codigo?: string;
  codigoBarras?: string;
  referencia?: string;
  skuSistema?: string;
  marca?: string;
  categoria?: string;
  fornecedor?: string;
  unidadeMedidaSigla?: string;
  unidadeMedidaFracionado?: boolean;
  unidadeMedidaCasasDecimais?: number;
}
interface VeiculoBasico { id: string; placa: string; modelo: string; ano: string; cor: string; clienteId: string; }

const OrcamentoForm: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditing = !!id;
  
  const [formData, setFormData] = useState({
    clienteId: null as string | null,
    clienteNome: '',
    clienteTelefone: '',
    placa: '', 
    modelo: '', 
    ano: '', 
    cor: '',
    observacoes: '',
    status: 'Pendente', 
    numeroOrcamento: '',
    validadeDias: '15',
  });

  const [isLoading, setIsLoading] = useState(false);
  // Trava sincrona de duplo-clique, compartilhada pelos tres caminhos que
  // gravam nesta tela (salvar orcamento, gerar OS, finalizar venda). O
  // estado isLoading desabilita o botao, mas so no render seguinte -- dois
  // cliques no mesmo frame passariam os dois e gerariam documento
  // duplicado. Mesmo padrao de submitLockRef no PedidoVendaForm.
  const submitLockRef = useRef(false);
  const [isFetching, setIsFetching] = useState(isEditing);
  const [permitirVendaSemEstoque, setPermitirVendaSemEstoque] = useState(false);
  const [descontoInput, setDescontoInput] = useState<DescontoInputValue>({ tipo: 'valor', valor: '' });
  const [limiteDescontoOrcamento, setLimiteDescontoOrcamento] = useState<LimiteDescontoConfig | null>(null);
  const [modoLimiteDesconto, setModoLimiteDesconto] = useState<ModoLimiteDesconto>('avisar');
  const [modoValidacaoCliente, setModoValidacaoCliente] = useState<ModoValidacaoCliente>(DEFAULT_MODO_VALIDACAO_CLIENTE);
  const [cadastroRapidoAberto, setCadastroRapidoAberto] = useState(false);
  const [showAprovacaoDesconto, setShowAprovacaoDesconto] = useState(false);
  const [aprovacaoDesconto, setAprovacaoDesconto] = useState<AprovacaoDesconto | null>(null);
  const [veiculosDisponiveis, setVeiculosDisponiveis] = useState<VeiculoBasico[]>([]);
  const [veiculosDoCliente, setVeiculosDoCliente] = useState<VeiculoBasico[]>([]);
  const [isVeiculoDropdownOpen, setIsVeiculoDropdownOpen] = useState(false);
  
  const [servicosCatalogo, setServicosCatalogo] = useState<ServicoData[]>([]);
  const [servicoNomeInput, setServicoNomeInput] = useState('');
  const [servicoPrecoInput, setServicoPrecoInput] = useState('');
  
  const [pecasEstoque, setPecasEstoque] = useState<PecaOrcamento[]>([]);
  const [pecaNomeInput, setPecaNomeInput] = useState('');
  const [pecaPrecoInput, setPecaPrecoInput] = useState('');
  const [pecaSelecionada, setPecaSelecionada] = useState<PecaOrcamento | null>(null);
  const [isPecaSearchModalOpen, setIsPecaSearchModalOpen] = useState(false);

  const [itens, setItens] = useState<ItemOrcamento[]>([]);

  const { currentUser, tenantId } = useAuth();
  const { items: clientesDisponiveis } = useTenantCollection<ClienteBasico>('clientes', tenantId);

  const [isServicoDropdownOpen, setIsServicoDropdownOpen] = useState(false);

  const servicoDropdownRef = useRef<HTMLDivElement>(null);
  const servicoNomeInputRef = useRef<HTMLInputElement>(null);
  const pecaNomeInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (servicoDropdownRef.current && !servicoDropdownRef.current.contains(event.target as Node)) setIsServicoDropdownOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Uma aprovacao de senha so vale pro estado do momento -- mudar item ou
  // desconto depois invalida.
  const primeiraRenderAprovacaoRef = useRef(true);
  useEffect(() => {
    if (primeiraRenderAprovacaoRef.current) {
      primeiraRenderAprovacaoRef.current = false;
      return;
    }
    setAprovacaoDesconto(null);
  }, [itens, descontoInput]);

  useEffect(() => {
    const fetchInitialData = async () => {
      if (!currentUser || !tenantId) return;

      try {
        const qV = query(collection(db, 'veiculos'), where('tenantId', '==', tenantId));
        const snapV = await getDocs(qV);
        const dataV: VeiculoBasico[] = [];
        // Campos opcionais no cadastro de veiculo (Ano, Cor) podem faltar no
        // documento -- sem o fallback, o autofill do orcamento copiava
        // undefined pro formData e o Firestore recusava o save inteiro
        // (mesmo bug corrigido em OSForm.tsx -- regra 3 do CLAUDE.md).
        snapV.forEach((doc) => dataV.push({
          id: doc.id,
          placa: doc.data().placa || '',
          modelo: doc.data().modelo || '',
          ano: doc.data().ano || '',
          cor: doc.data().cor || '',
          clienteId: doc.data().clienteId || '',
        }));
        setVeiculosDisponiveis(dataV);

        const qS = query(collection(db, 'servicos'), where('tenantId', '==', tenantId));
        const snapS = await getDocs(qS);
        const dataS: ServicoData[] = [];
        snapS.forEach((doc) => dataS.push({ id: doc.id, nome: doc.data().nome, preco: doc.data().preco }));
        setServicosCatalogo(dataS);

        const qE = query(collection(db, 'estoque'), where('tenantId', '==', tenantId));
        const snapE = await getDocs(qE);
        const dataE: PecaOrcamento[] = [];
        snapE.forEach((doc) => {
          const data = doc.data();
          dataE.push({
            id: doc.id,
            nome: data.nome || '',
            precoVenda: Number(data.precoVenda ?? 0),
            quantidade: Number(data.quantidade ?? 0),
            codigo: data.codigo || '',
            codigoBarras: data.codigoBarras || '',
            referencia: data.referencia || '',
            skuSistema: data.skuSistema || '',
            marca: data.marca || '',
            categoria: data.categoria || '',
            fornecedor: data.fornecedor || '',
            unidadeMedidaSigla: data.unidadeMedidaSigla,
            unidadeMedidaFracionado: data.unidadeMedidaFracionado,
            unidadeMedidaCasasDecimais: data.unidadeMedidaCasasDecimais,
          });
        });
        setPecasEstoque(dataE);

        // Fetch Configurações
        try {
          const configRef = doc(db, 'configuracoes', tenantId);
          const configSnap = await getDoc(configRef);
          if (configSnap.exists()) {
            const config = configSnap.data();
            setPermitirVendaSemEstoque(config.venderSemEstoque === true);
            setLimiteDescontoOrcamento(parseLimiteDescontoConfig(config.limiteDescontoOrcamento));
            setModoLimiteDesconto(parseModoLimiteDesconto(config.modoLimiteDesconto));
            setModoValidacaoCliente(parseModoValidacaoCliente(config.modoValidacaoCliente));
          }
        } catch (err) { console.error(err); }

        if (isEditing && id) {
          const docRef = doc(db, 'orcamentos', id);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const data = docSnap.data();
            setFormData({
              clienteId: data.clienteId || null,
              clienteNome: data.clienteNome || '',
              clienteTelefone: data.clienteTelefone || '',
              placa: data.placa || '',
              modelo: data.modelo || '',
              ano: data.ano || '',
              cor: data.cor || '',
              observacoes: data.observacoes || '',
              status: data.status || 'Pendente',
              numeroOrcamento: data.numeroOrcamento || '',
              validadeDias: data.validadeDias || '15',
            });
            
            const loadedItens: ItemOrcamento[] = [];
            if (data.servicos) data.servicos.forEach((s: any) => loadedItens.push({ ...s, tipo: 'servico' }));
            if (data.pecas) data.pecas.forEach((p: any) => loadedItens.push({ ...p, tipo: 'peca' }));
            setItens(loadedItens);
            if (data.desconto) {
              setDescontoInput({
                tipo: data.desconto.tipo === 'percentual' ? 'percentual' : 'valor',
                valor: Number(data.desconto.valorInformado) > 0 ? String(data.desconto.valorInformado) : '',
              });
            }
          }
        } else {
          const snap = await getCountFromServer(query(collection(db, 'orcamentos'), where('tenantId', '==', tenantId)));
          const nextNum = String(snap.data().count + 1).padStart(4, '0');
          setFormData(prev => ({ ...prev, numeroOrcamento: nextNum }));
        }
      } catch (error) {
        console.error("Erro ao carregar dados:", error);
      } finally {
        setIsFetching(false);
      }
    };
    fetchInitialData();
  }, [id, isEditing, currentUser, tenantId]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
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
    setPecaSelecionada(null);
  };

  // Mesma checagem de bloquear/perguntar que ja rodava so no Salvar (ver
  // handleSubmit) -- disparada tambem ao sair do campo, pra nao deixar o
  // usuario montar o orcamento inteiro antes de descobrir que o cliente
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

  const handleAddItem = (tipo: 'servico' | 'peca') => {
    const nome = tipo === 'servico' ? servicoNomeInput : pecaNomeInput;
    const preco = tipo === 'servico' ? servicoPrecoInput : pecaPrecoInput;

    if (!nome || !preco) return;

    const precoNum = parseFloat(preco.replace(',', '.'));

    let existingId: string | undefined;
    let unidadeMedida: UnidadeMedidaProduto | null = null;

    if (tipo === 'peca') {
      const peca = pecaSelecionada || pecasEstoque.find(p => p.nome.toLowerCase() === nome.toLowerCase());
      existingId = peca?.id;

      if (!permitirVendaSemEstoque && peca && 1 > (peca.quantidade || 0)) {
        showError('Estoque Insuficiente', `Você tem apenas ${peca.quantidade || 0} un. no estoque. Venda sem estoque desativada.`);
        return;
      }

      // Toda peca sai daqui com as 3 unidades preenchidas -- 'UN' quando o
      // cadastro nao tem. Ver a regra em unidadeMedidaDomain.ts.
      unidadeMedida = resolveUnidadeMedidaProduto(peca);
      // O aviso so faz sentido pra peca que EXISTE no estoque sem unidade:
      // e' o caso que o usuario consegue resolver sozinho, editando o
      // produto. Peca avulsa (digitada na hora, fora do catalogo) nao tem
      // cadastro pra corrigir -- recebe o padrao calada.
      if (peca && !temUnidadeMedidaCadastrada(peca)) {
        const aviso = avisoUnidadeMedidaAusente(peca.nome);
        showWarning(aviso.title, aviso.text);
      }
    } else {
      existingId = servicosCatalogo.find(s => s.nome.toLowerCase() === nome.toLowerCase())?.id;
    }

    const novoItem: ItemOrcamento = {
      id: existingId || 'avulso',
      nome: nome.toUpperCase(),
      preco: precoNum,
      quantidade: 1,
      tipo,
      // Servico continua SEM os 3 campos, de proposito: servico nao tem
      // unidade de medida, nao existe "UN de servico" -- o fallback vale
      // pra produto, nao pra mao de obra. Peca sempre traz os 3
      // preenchidos, entao nenhum `undefined` chega no Firestore (que
      // recusa: "Unsupported field value: undefined").
      ...(unidadeMedida ?? {}),
    };

    setItens([...itens, novoItem]);

    if (tipo === 'servico') {
      setServicoNomeInput('');
      setServicoPrecoInput('');
      servicoNomeInputRef.current?.focus();
    } else {
      setPecaNomeInput('');
      setPecaPrecoInput('');
      setPecaSelecionada(null);
      pecaNomeInputRef.current?.focus();
    }
  };

  const removeItem = (index: number) => {
    setItens(itens.filter((_, i) => i !== index));
  };

  const updateItemQtd = (index: number, qtd: number) => {
    const novos = [...itens];
    const item = novos[index];

    if (item.tipo === 'peca') {
      if (!isValidSaleQuantity(qtd, item.unidadeMedidaFracionado, item.unidadeMedidaCasasDecimais)) {
        showError('Operação Bloqueada', item.unidadeMedidaFracionado
          ? `A quantidade de ${item.nome} aceita no máximo ${item.unidadeMedidaCasasDecimais ?? 0} casa(s) decimal(is), conforme a unidade ${item.unidadeMedidaSigla || 'UN'}.`
          : `A peça ${item.nome} está configurada na unidade ${item.unidadeMedidaSigla || 'UN'}, que NÃO permite venda fracionada. Utilize uma quantidade inteira.`);
        return;
      }

      if (!permitirVendaSemEstoque) {
        const pecaEstoque = pecasEstoque.find(p => p.id === item.id);
        if (pecaEstoque && qtd > (pecaEstoque.quantidade || 0)) {
          showError('Estoque Insuficiente', `Você tem apenas ${pecaEstoque.quantidade || 0} un. no estoque.`);
          return;
        }
      }

      novos[index].quantidade = qtd;
      setItens(novos);
      return;
    }

    novos[index].quantidade = Math.max(1, qtd);
    setItens(novos);
  };

  const totalServicos = itens.filter(i => i.tipo === 'servico').reduce((acc, curr) => acc + (curr.preco * curr.quantidade), 0);
  const totalPecas = itens.filter(i => i.tipo === 'peca').reduce((acc, curr) => acc + (curr.preco * curr.quantidade), 0);
  const subtotalOrcamento = totalServicos + totalPecas;
  const subtotalOrcamentoCents = toCents(subtotalOrcamento);
  const descontoCents = calcularDescontoCents(descontoInput.tipo, descontoInput.valor, subtotalOrcamentoCents);
  const desconto = fromCents(descontoCents);
  const totalGeral = Math.max(0, subtotalOrcamento - desconto);
  const checagemLimiteDesconto = checarLimiteTotal(limiteDescontoOrcamento, subtotalOrcamentoCents, descontoCents);

  const handleSave = async (e?: React.FormEvent) => {
    if (submitLockRef.current) return;
    if (e) e.preventDefault();
    if (!formData.clienteNome) {
      showError('Erro', 'Informe o nome do cliente.');
      return;
    }

    // Nivel 2 (sistema): desconto TOTAL do orcamento contra o limite
    // configurado pra esta tela. Checado a cada salvamento (o orcamento nao
    // tem um "finalizar" separado como OS/Pedido -- salvar JA e' o que o
    // cliente ve).
    if (checagemLimiteDesconto.excedeu) {
      if (modoLimiteDesconto === 'bloquear') {
        showError('Desconto acima do limite', `O desconto deste orçamento (${checagemLimiteDesconto.percentualAplicado.toFixed(1)}%) excede o limite configurado. Reduza o desconto para continuar.`);
        return;
      }
      if (modoLimiteDesconto === 'senha' && !aprovacaoDesconto) {
        setShowAprovacaoDesconto(true);
        return;
      }
      if (modoLimiteDesconto === 'avisar') {
        const confirm = await NexusSwal.fire({
          title: 'Desconto acima do limite',
          text: `O desconto deste orçamento (${checagemLimiteDesconto.percentualAplicado.toFixed(1)}%) excede o limite configurado. Deseja salvar mesmo assim?`,
          icon: 'warning',
          showCancelButton: true,
          confirmButtonText: 'Salvar mesmo assim',
          cancelButtonText: 'Revisar desconto',
        });
        if (!confirm.isConfirmed) return;
      }
    }

    const nomeClienteFormatado = formData.clienteNome.toUpperCase().trim();
    const clienteEncontrado = clientesDisponiveis.find(c => c.nome.toUpperCase() === nomeClienteFormatado);

    const acaoValidacaoCliente = resolverAcaoValidacaoCliente(modoValidacaoCliente, !!clienteEncontrado, formData.clienteNome.trim());
    if (acaoValidacaoCliente.tipo === 'bloquear') {
      showError('Cliente não cadastrado', acaoValidacaoCliente.motivo);
      return;
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
      return;
    }

    submitLockRef.current = true;
    setIsLoading(true);
    try {
      if (!currentUser || !tenantId) return;

      // Cadastrar Cliente (se nao existir) -- ate esta fatia, Orcamento
      // nunca linkava clienteId, so guardava clienteNome como texto livre.
      let clienteIdParaSalvar: string | null = clienteEncontrado?.id || null;
      if (!clienteEncontrado) {
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

      const dataToSave = {
        ...formData,
        clienteId: clienteIdParaSalvar,
        clienteNome: nomeClienteFormatado,
        servicos: itens.filter(i => i.tipo === 'servico'),
        pecas: itens.filter(i => i.tipo === 'peca'),
        valorTotal: totalGeral,
        // Snapshot do desconto -- consumido pelo relatorio de descontos
        // concedidos (Fatia 6). Nao e' herdado por Converter em OS/Venda de
        // proposito: cada conversao gera um documento novo que passa pela
        // PROPRIA checagem de limite daquela tela.
        desconto: {
          tipo: descontoInput.tipo,
          valorInformado: Number(descontoInput.valor.replace(',', '.')) || 0,
          valorAplicadoCentavos: descontoCents,
          excedeuLimite: checagemLimiteDesconto.excedeu,
          ...(checagemLimiteDesconto.excedeu && aprovacaoDesconto
            ? { aprovacao: { modo: 'senha' as const, ...aprovacaoDesconto, aprovadoEm: new Date().toISOString() } }
            : {}),
        },
        tenantId,
        updatedAt: serverTimestamp(),
      };

      if (isEditing && id) {
        await updateDoc(doc(db, 'orcamentos', id), {
          ...dataToSave,
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp()),
        });
      } else {
        let finalNumeroOrcamento = formData.numeroOrcamento;
        const currentMaxOrcamento = await getCurrentMaxSequence(db, 'orcamentos', tenantId, 'numeroOrcamento').catch(() => 0);

        await runTransaction(db, async (transaction) => {
          const nextOrcamento = await reserveTenantSequence(transaction, db, tenantId, 'orcamentos', currentMaxOrcamento);
          finalNumeroOrcamento = formatSequenceValue(nextOrcamento, 4);
          const newOrcamentoRef = doc(collection(db, 'orcamentos'));
          transaction.set(newOrcamentoRef, {
            ...dataToSave,
            numeroOrcamento: finalNumeroOrcamento,
            createdAt: serverTimestamp(),
            ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
          });
        });
        setFormData(prev => ({ ...prev, numeroOrcamento: finalNumeroOrcamento }));
      }

      showSuccess(`Orçamento ${isEditing ? 'atualizado' : 'criado'}!`);
      navigate('/orcamentos');
    } catch (error) {
      // Bare catch sem log escondia a causa real de qualquer falha aqui --
      // achado ao diagnosticar esta feature, corrigido de passagem.
      console.error('Erro ao salvar orçamento:', error);
      showError('Erro', 'Não foi possível salvar o orçamento.');
    } finally {
      setIsLoading(false);
      submitLockRef.current = false;
    }
  };

  const handleConvertToOS = async () => {
    if (submitLockRef.current) return;
    const confirm = await NexusSwal.fire({
      title: 'Converter para OS?',
      text: 'Será criada uma nova Ordem de Serviço.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sim, Gerar OS',
      cancelButtonText: 'Cancelar'
    });

      if (confirm.isConfirmed) {
      submitLockRef.current = true;
      setIsLoading(true);
      try {
        if (!tenantId) throw new Error('Tenant nao carregado.');
        if (!currentUser) throw new Error('Usuário não autenticado.');
        const currentMaxOs = await getCurrentMaxSequence(db, 'ordens_de_servico', tenantId, 'numeroOS').catch(() => 0);
        let newOsId = '';

        await runTransaction(db, async (transaction) => {
          const nextOs = await reserveTenantSequence(transaction, db, tenantId, 'ordens_de_servico', currentMaxOs);
          const newRef = doc(collection(db, 'ordens_de_servico'));
          newOsId = newRef.id;

          transaction.set(newRef, {
            numeroOS: formatSequenceValue(nextOs, 2),
            clienteId: formData.clienteId,
            clienteNome: formData.clienteNome.toUpperCase(),
            clienteTelefone: formData.clienteTelefone,
            placa: formData.placa,
            modelo: formData.modelo,
            ano: formData.ano,
            cor: formData.cor,
            status: 'Orçamento Aprovado',
            servicos: itens.filter(i => i.tipo === 'servico'),
            pecas: itens.filter(i => i.tipo === 'peca'),
            valorTotal: totalGeral,
            tenantId,
            createdAt: serverTimestamp(),
            orcamentoId: id,
            ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
          });

          if (id) {
            transaction.update(doc(db, 'orcamentos', id), {
              status: 'Finalizado',
              ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Convertido em OS'),
            });
          }
        });
        showSuccess('Convertido em OS!');
        navigate(`/os/editar/${newOsId}`);
      } catch {
        showError('Erro ao converter');
      } finally {
        setIsLoading(false);
        submitLockRef.current = false;
      }
    }
  };

  const handleConvertToVenda = async () => {
    if (submitLockRef.current) return;
    const confirm = await NexusSwal.fire({
      title: 'Converter para Venda?',
      text: 'Isso criará um Pedido de Venda e baixará o estoque.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sim, Finalizar Venda',
      cancelButtonText: 'Cancelar'
    });

    if (confirm.isConfirmed) {
      submitLockRef.current = true;
      setIsLoading(true);
      try {
        // Filtrar apenas PEÇAS para a Venda
        const soPecas = itens.filter(i => i.tipo === 'peca');
        const valorProdutos = soPecas.reduce((acc, i) => acc + (i.preco * i.quantidade), 0);

        if (soPecas.length === 0) {
          showError('Erro', 'Este orçamento não contém peças para gerar uma venda.');
          setIsLoading(false);
          return;
        }

        if (!tenantId) throw new Error('Tenant nao carregado.');
        if (!currentUser) throw new Error('Usuário não autenticado.');
        const currentMaxPedido = await getCurrentMaxSequence(db, 'pedidos_venda', tenantId, 'numeroPedido').catch(() => 0);

        await runTransaction(db, async (transaction) => {
          const nextPedido = await getNextTenantSequenceValue(transaction, db, tenantId, 'pedidos_venda', currentMaxPedido);
          const newVendaRef = doc(collection(db, 'pedidos_venda'));
          const vendaItens = soPecas.map(i => ({
            id: i.id,
            nome: i.nome,
            precoUnitario: i.preco,
            quantidade: i.quantidade,
            desconto: 0,
            subtotal: i.preco * i.quantidade
          }));

          await applyStockAdjustments(
            transaction,
            db,
            vendaItens.map(item => ({ id: item.id, nome: item.nome, quantidade: item.quantidade })),
            'decrement',
            permitirVendaSemEstoque
          );

          writeTenantSequenceValue(transaction, db, tenantId, 'pedidos_venda', nextPedido);

          transaction.set(newVendaRef, {
            numeroPedido: formatSequenceValue(nextPedido, 4),
            clienteNome: formData.clienteNome.toUpperCase(),
            itens: vendaItens,
            valorTotalItens: valorProdutos,
            valorTotalDescontos: 0,
            valorTotal: valorProdutos,
            formaPagamento: 'Dinheiro',
            status: 'Finalizada',
            tenantId,
            usuarioResponsavelId: currentUser.uid,
            createdAt: serverTimestamp(),
            orcamentoId: id,
            ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
          });

          transaction.set(doc(collection(db, 'transacoes')), {
            descricao: `Venda via Orçamento #${formData.numeroOrcamento}`,
            categoria: 'Venda de Peças',
            valor: valorProdutos,
            tipo: 'entrada',
            status: 'Paga',
            formaPagamento: 'Dinheiro',
            tenantId,
            createdAt: serverTimestamp(),
            pedidoId: newVendaRef.id,
            ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
          });

          if (id) {
            transaction.update(doc(db, 'orcamentos', id), {
              status: 'Finalizado',
              ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Convertido em venda'),
            });
          }
        });
        showSuccess('Venda realizada com sucesso!');
        navigate('/pedidos-venda');
      } catch {
        showError('Erro ao converter');
      } finally {
        setIsLoading(false);
        submitLockRef.current = false;
      }
    }
  };

  const handleShareWhatsApp = () => {
    const texto = `Olá! Segue o seu orçamento *#${formData.numeroOrcamento}* da *Sistema Nexus*.\n\n` +
      `*Cliente:* ${formData.clienteNome}\n` +
      `*Total:* R$ ${totalGeral.toFixed(2)}\n\n` +
      `Aguardamos sua aprovação!`;
    const url = `https://wa.me/${formData.clienteTelefone.replace(/\D/g, '')}?text=${encodeURIComponent(texto)}`;
    window.open(url, '_blank');
  };

  if (isFetching) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '16px' }}>
        <Loader2 size={48} className="spin-icon" color="var(--accent-purple)" />
        <p style={{ color: 'var(--text-muted)' }}>Carregando dados do orçamento...</p>
      </div>
    );
  }

  return (
    <div className="os-page">
      <div className="page-header">
        <div className="header-title-group">
          <button className="icon-btn back-btn" onClick={() => navigate('/orcamentos')}><ArrowLeft size={20} /></button>
          <div>
            <h1 className="page-title">{isEditing ? 'Editar Orçamento' : 'Novo Orçamento'}</h1>
            <p className="page-subtitle">{isEditing ? `Orçamento #${formData.numeroOrcamento}` : 'Crie uma nova proposta comercial'}</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          {isEditing && (
            <>
              <button className="btn-secondary" onClick={handleShareWhatsApp} title="Compartilhar WhatsApp">
                <Share2 size={18} />
              </button>
              <button className="btn-secondary" onClick={() => navigate(`/orcamentos/print/${id}`)}>
                <Printer size={18} />
              </button>
              {formData.status !== 'Convertido' && (
                <>
                  <button className="btn-secondary" onClick={handleConvertToOS} style={{ color: '#8b5cf6', borderColor: 'rgba(139, 92, 246, 0.3)' }}>
                    <Wrench size={18} style={{ marginRight: 8 }} /> OS
                  </button>
                  <button className="btn-secondary" onClick={handleConvertToVenda} style={{ color: '#10b981', borderColor: 'rgba(16, 185, 129, 0.3)' }}>
                    <ShoppingCart size={18} style={{ marginRight: 8 }} /> Venda
                  </button>
                </>
              )}
            </>
          )}
          <button className="btn-primary" onClick={() => handleSave()} disabled={isLoading}>
            {isLoading ? <Loader2 size={18} className="spin-icon" /> : <Save size={18} style={{ marginRight: 8 }} />}
            {isLoading ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>

      <div className="form-grid">
        <div className="form-column">
          <div className="card form-section">
            <div className="section-header">
              <User size={20} className="section-icon" />
              <h3>Dados do Cliente</h3>
            </div>
            <div className="input-group" style={{ position: 'relative' }}>
              <label>Cliente</label>
              <ClientAutocomplete
                value={formData.clienteNome}
                onChange={(value) => setFormData({ ...formData, clienteId: null, clienteNome: value })}
                clients={clientesDisponiveis}
                onBlur={handleClienteBlur}
                onSelect={(cliente) => {
                  const vDoCliente = veiculosDisponiveis.filter(v => v.clienteId === cliente.id);
                  if (vDoCliente.length === 1) {
                    const v = vDoCliente[0];
                    setFormData({ ...formData, clienteId: cliente.id, clienteNome: cliente.nome, clienteTelefone: cliente.telefone, placa: v.placa || '', modelo: v.modelo || '', ano: v.ano || '', cor: v.cor || '' });
                    setVeiculosDoCliente([]);
                    setIsVeiculoDropdownOpen(false);
                  } else if (vDoCliente.length > 1) {
                    setFormData({ ...formData, clienteId: cliente.id, clienteNome: cliente.nome, clienteTelefone: cliente.telefone });
                    setVeiculosDoCliente(vDoCliente);
                    setIsVeiculoDropdownOpen(true);
                  } else {
                    setFormData({ ...formData, clienteId: cliente.id, clienteNome: cliente.nome, clienteTelefone: cliente.telefone });
                    setVeiculosDoCliente([]);
                    setIsVeiculoDropdownOpen(false);
                  }
                }}
                placeholder="Busque ou digite o nome"
                ariaLabel="Buscar cliente"
                emptyHint={
                  modoValidacaoCliente === 'bloquear' ? (
                    <>Cliente não cadastrado. Use o botão "Cadastrar Cliente" abaixo.</>
                  ) : modoValidacaoCliente === 'perguntar' ? (
                    <>Cliente não cadastrado. Você será perguntado se quer cadastrar ao salvar.</>
                  ) : undefined
                }
                renderItem={(cliente) => (
                  <>
                    <span>{cliente.codigo ? `#${cliente.codigo} — ${cliente.nome}` : cliente.nome}</span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{cliente.telefone}</span>
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
              <label>WhatsApp / Telefone</label>
              <input type="text" name="clienteTelefone" value={formData.clienteTelefone} onChange={handleChange} placeholder="(00) 00000-0000" />
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
                        setFormData(prev => ({...prev, placa: v.placa || '', modelo: v.modelo || '', ano: v.ano || '', cor: v.cor || ''}));
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
              <div className="input-group"><label>Placa</label><input type="text" name="placa" value={formData.placa} onChange={handleChange} placeholder="AAA-0000" style={{ textTransform: 'uppercase' }} /></div>
              <div className="input-group"><label>Modelo</label><input type="text" name="modelo" value={formData.modelo} onChange={handleChange} placeholder="Ex: Civic" /></div>
              <div className="input-group"><label>Ano</label><input type="text" name="ano" value={formData.ano} onChange={handleChange} placeholder="2020" /></div>
              <div className="input-group"><label>Cor</label><input type="text" name="cor" value={formData.cor} onChange={handleChange} placeholder="Prata" /></div>
            </div>
          </div>

          <div className="card form-section">
            <div className="section-header">
              <Calendar size={20} className="section-icon" />
              <h3>Validade e Status</h3>
            </div>
            <div className="grid-2-col">
              <div className="input-group">
                <label>Validade (Dias)</label>
                <input type="number" name="validadeDias" value={formData.validadeDias} onChange={handleChange} />
              </div>
              <div className="input-group">
                <label>Status</label>
                <select name="status" value={formData.status} onChange={handleChange} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}>
                  <option value="Pendente">Pendente</option>
                  <option value="Aprovado">Aprovado</option>
                  <option value="Recusado">Recusado</option>
                  {formData.status === 'Convertido' && <option value="Convertido">Convertido</option>}
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className="form-column">
          <div className="card form-section">
            <div className="section-header">
              <Wrench size={20} className="section-icon" />
              <h3>Produtos e Serviços</h3>
            </div>
            
            <div className="item-add-container">
              <div className="item-add-row">
                <div style={{ position: 'relative' }} ref={servicoDropdownRef}>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px', display: 'block' }}>Serviço</label>
                  <input
                    type="text"
                    placeholder="Nome do Serviço..."
                    value={servicoNomeInput}
                    ref={servicoNomeInputRef}
                    onChange={(e) => { setServicoNomeInput(e.target.value); setIsServicoDropdownOpen(true); }}
                    onFocus={() => setIsServicoDropdownOpen(true)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddItem('servico'); } }}
                    style={{ paddingRight: '42px' }}
                  />
                  {servicoNomeInput && (
                    <button
                      type="button"
                      onClick={handleClearServicoInput}
                      className="clear-selection-btn"
                      title="Limpar seleção"
                      style={{ top: 'calc(50% + 10px)' }}
                    >
                      <X size={16} />
                    </button>
                  )}
                  {isServicoDropdownOpen && servicosCatalogo.filter(s => s.nome.toLowerCase().includes(servicoNomeInput.toLowerCase())).length > 0 && (
                    <div className="select-dropdown">
                      {servicosCatalogo.filter(s => s.nome.toLowerCase().includes(servicoNomeInput.toLowerCase())).map(s => (
                        <div key={s.id} className="select-option" onClick={() => {
                          setServicoNomeInput(s.nome);
                          setServicoPrecoInput(s.preco.toString());
                          setIsServicoDropdownOpen(false);
                        }}>
                          <span>{s.nome}</span>
                          <span style={{ color: '#10b981' }}>R$ {s.preco.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px', display: 'block' }}>Preço</label>
                  <input type="text" placeholder="R$ 0,00" value={servicoPrecoInput} onChange={(e) => setServicoPrecoInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddItem('servico'); } }} />
                </div>
                <button className="add-item-btn" onClick={() => handleAddItem('servico')} title="Adicionar Serviço">
                  <Plus size={20} />
                </button>
              </div>

              <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '8px 0' }}></div>

              <div className="item-add-row">
                <div style={{ position: 'relative' }}>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px', display: 'block' }}>Produto</label>
                  <ProductAutocomplete
                    value={pecaNomeInput}
                    products={pecasEstoque}
                    inputRef={pecaNomeInputRef}
                    onChange={(value) => {
                      setPecaNomeInput(value);
                      const existsExact = pecasEstoque.find(p => p.nome.toLowerCase() === value.toLowerCase());
                      setPecaSelecionada(existsExact || null);
                    }}
                    onSelect={(p) => {
                      setPecaNomeInput(p.nome);
                      setPecaPrecoInput(p.precoVenda.toString());
                      setPecaSelecionada(p);
                    }}
                    placeholder="Nome do Produto..."
                    ariaLabel="Buscar produto"
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
                      style={{ top: 'calc(50% + 10px)' }}
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
                      setPecaPrecoInput(p.precoVenda.toString());
                      setPecaSelecionada(p);
                    }}
                    renderItem={renderPecaRow}
                    initialQuery={pecaNomeInput}
                    title="Buscar produto"
                  />
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px', display: 'block' }}>Preço</label>
                  <input type="text" placeholder="R$ 0,00" value={pecaPrecoInput} onChange={(e) => setPecaPrecoInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddItem('peca'); } }} />
                </div>
                <button className="add-item-btn" onClick={() => handleAddItem('peca')} title="Adicionar Produto">
                  <Plus size={20} />
                </button>
              </div>
            </div>

            <div className="items-list">
              {itens.map((item, index) => (
                <div key={index} className="item-row">
                  <div className="item-info">
                    <div className="item-name">{item.nome}</div>
                    <div className="item-type">{item.tipo === 'servico' ? 'Mão de Obra' : 'Produto'}</div>
                  </div>
                  <div className="item-actions">
                    <input
                      type="number"
                      className="item-qty-input"
                      min="0.001"
                      step={item.tipo === 'peca' && item.unidadeMedidaFracionado ? 'any' : '1'}
                      value={item.quantidade}
                      onChange={(e) => updateItemQtd(index, Number(e.target.value))}
                    />
                    <div className="item-total-price">
                      R$ {(item.preco * item.quantidade).toFixed(2)}
                    </div>
                    <button className="delete-item-btn" onClick={() => removeItem(index)}>
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              ))}
              {itens.length === 0 && (
                <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)', border: '2px dashed var(--border-color)', borderRadius: 'var(--radius-lg)', backgroundColor: 'rgba(255,255,255,0.02)' }}>
                  <Package size={32} style={{ opacity: 0.1, marginBottom: '8px' }} />
                  <p>Nenhum item adicionado ao orçamento.</p>
                </div>
              )}
            </div>
          </div>

          <div className="card form-section totals-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)', fontSize: '14px' }}>
              <span>Mão de Obra:</span>
              <span style={{ fontWeight: 600 }}>R$ {totalServicos.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)', fontSize: '14px' }}>
              <span>Produtos:</span>
              <span style={{ fontWeight: 600 }}>R$ {totalPecas.toFixed(2)}</span>
            </div>
            {desconto > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#ef4444', fontSize: '14px' }}>
                <span>Desconto:</span>
                <span style={{ fontWeight: 600 }}>- R$ {desconto.toFixed(2)}</span>
              </div>
            )}

            <div style={{ margin: '12px 0', maxWidth: '260px' }}>
              <DescontoInput
                label="Desconto"
                idPrefix="orcamento-desconto"
                value={descontoInput}
                onChange={setDescontoInput}
              />
            </div>

            {checagemLimiteDesconto.excedeu && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 12px', padding: '10px 12px', borderRadius: 'var(--radius-md)', backgroundColor: 'rgba(239, 68, 68, 0.12)', color: '#ef4444', fontSize: '12px' }}>
                Desconto de {checagemLimiteDesconto.percentualAplicado.toFixed(1)}% acima do limite configurado para Orçamento.
              </div>
            )}

            <div className="grand-total-row">
              <span className="grand-total-label">TOTAL GERAL</span>
              <span className="grand-total-value">R$ {totalGeral.toFixed(2)}</span>
            </div>
          </div>

          <SolicitarAprovacaoDescontoModal
            open={showAprovacaoDesconto}
            tenantId={tenantId}
            motivo={`Desconto de ${checagemLimiteDesconto.percentualAplicado.toFixed(1)}% neste orçamento, acima do limite configurado. Confirme com a senha de um aprovador para salvar.`}
            onClose={() => setShowAprovacaoDesconto(false)}
            onAprovado={(aprovacao) => setAprovacaoDesconto(aprovacao)}
          />

          <CadastroRapidoClienteModal
            open={cadastroRapidoAberto}
            nomeInicial={formData.clienteNome}
            onClose={() => setCadastroRapidoAberto(false)}
            onCriado={(cliente: ClienteCadastradoRapido) => setFormData({ ...formData, clienteId: cliente.id, clienteNome: cliente.nome, clienteTelefone: cliente.telefone || formData.clienteTelefone })}
          />

          <div className="card form-section">
            <div className="section-header">
              <FileText size={20} className="section-icon" />
              <h3>Observações Internas / Cliente</h3>
            </div>
            <textarea name="observacoes" value={formData.observacoes} onChange={handleChange} placeholder="Ex: Desconto condicionado ao pagamento à vista..." rows={4} style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px', color: 'var(--text-primary)' }} />
          </div>
      </div>
    </div>

    <div className="form-actions-bottom" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px', marginBottom: '40px' }}>
      <button 
        className="btn-primary" 
        onClick={() => handleSave()} 
          disabled={isLoading}
          style={{ 
            padding: '16px 32px', 
            borderRadius: '8px',
            fontSize: '16px', 
            fontWeight: 'bold', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '8px',
            transition: 'all 0.2s ease'
          }}
        >
          {isLoading ? <Loader2 size={20} className="spin-icon" /> : <Save size={20} />}
          {isLoading ? 'Salvando...' : 'SALVAR ORÇAMENTO'}
        </button>
      </div>
    </div>

  );
};

export default OrcamentoForm;
