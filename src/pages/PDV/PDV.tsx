import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, LockKeyhole, Maximize2, PackageSearch, Store, X } from 'lucide-react';
import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { NexusSwal, showError, showSuccess } from '../../utils/alerts';
import { isPlatformAdminRole, isTenantManagerRole } from '../../utils/roles';
import {
  applyStockAdjustments,
  formatSequenceValue,
  getCurrentMaxSequence,
  getNextTenantSequenceValue,
  writeTenantSequenceValue,
} from '../../utils/firestoreAtomic';
import {
  buildCardFeeSchedulesByBrand,
  buildCommissionSnapshot,
  explodeInstallmentPaymentRecords,
  fromCents,
  normalizePayments,
  resolveBancoPadraoSimplificado,
  summarizePayments,
  toCents,
  type PaymentDraft,
  type PaymentRecord,
} from '../../utils/financeDomain';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import { DEFAULT_PRODUCT_SEARCH_MODE, findEmbalagemIdByExactCode, type ProductSearchMode } from '../../utils/productSearch';
import { isValidSaleQuantity } from '../../utils/saleQuantity';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { useTenantCollection } from '../../hooks/useTenantCollection';
import CartPanel from './components/CartPanel';
import ClientModal from './components/ClientModal';
import DiscountModal from './components/DiscountModal';
import PaymentModal from './components/PaymentModal';
import PdvSummary from './components/PdvSummary';
import ProductSearch from './components/ProductSearch';
import SangriaModal from './components/SangriaModal';
import {
  buildPdvFinanceConfig,
  calculatePdvTotals,
  clampDiscountCents,
  currency,
  defaultPdvFinanceConfig,
  fromCurrencyInput,
  makeCartItemFromProduct,
  makeCartLineId,
  makePdvSessionStorageKey,
  toCurrencyInput,
} from './pdvHelpers';
import {
  DEFAULT_VENDER_POR_EMBALAGEM,
  buildOpcoesUnidadeVenda,
  findOpcaoUnidadeVenda,
  toBaseQuantity,
  toStockAdjustmentItems,
  type OpcaoUnidadeVenda,
} from '../../utils/embalagemDomain';
import {
  DEFAULT_MODO_LIMITE_DESCONTO,
  checarLimiteTotal,
  excedeLimiteItem,
  parseLimiteDescontoConfig,
  parseModoLimiteDesconto,
  type LimiteDescontoConfig,
  type ModoLimiteDesconto,
} from '../../utils/descontoDomain';
import SolicitarAprovacaoDescontoModal, { type AprovacaoDesconto } from '../../components/common/SolicitarAprovacaoDescontoModal';
import type { CaixaSangria, PdvCartItem, PdvClient, PdvProduct, PdvSession } from './types';
import hennderIcon from '../../assets/hennder-icon.svg';
import './PDV.css';

interface BandeiraCartao {
  id: string;
  nome: string;
  taxaDebitoPercentual?: number;
  taxasCreditoPorParcela?: Record<string, number>;
  prazoRecebimentoCreditoDias?: number;
  prazoRecebimentoDebitoDias?: number;
}
interface Banco { id: string; nome: string; ativo: boolean; }

const normalizeText = (value: unknown) => String(value || '').trim();

const PDV: React.FC = () => {
  const navigate = useNavigate();
  const {
    currentUser,
    tenantId,
    userRole,
    userPermissions,
    isOwner,
    isPlatformAdmin,
    blockedModules,
    selectedTenant,
    needsTenantSelection,
  } = useAuth();
  const { items: bandeirasCartao } = useTenantCollection<BandeiraCartao>('bandeiras_cartao', tenantId);
  const { items: bancosDisponiveis } = useTenantCollection<Banco>('bancos', tenantId);
  const cardFeeSchedulesByBrand = buildCardFeeSchedulesByBrand(bandeirasCartao);
  const bancoPadraoSimplificado = resolveBancoPadraoSimplificado(bancosDisponiveis);

  const productInputRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [products, setProducts] = useState<PdvProduct[]>([]);
  const [clients, setClients] = useState<PdvClient[]>([]);
  const [allowNegativeStock, setAllowNegativeStock] = useState(false);
  const [venderPorEmbalagem, setVenderPorEmbalagem] = useState(DEFAULT_VENDER_POR_EMBALAGEM);
  const [limiteDescontoPdv, setLimiteDescontoPdv] = useState<LimiteDescontoConfig | null>(null);
  const [modoLimiteDesconto, setModoLimiteDesconto] = useState<ModoLimiteDesconto>(DEFAULT_MODO_LIMITE_DESCONTO);
  const [showAprovacaoDesconto, setShowAprovacaoDesconto] = useState(false);
  const [aprovacaoDesconto, setAprovacaoDesconto] = useState<AprovacaoDesconto | null>(null);
  const [productSearchMode, setProductSearchMode] = useState<ProductSearchMode>(DEFAULT_PRODUCT_SEARCH_MODE);
  const [financeConfig, setFinanceConfig] = useState(defaultPdvFinanceConfig);
  const [session, setSession] = useState<PdvSession | null>(null);
  const [search, setSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<PdvProduct | null>(null);
  const [cartItems, setCartItems] = useState<PdvCartItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState('');
  const [selectedClient, setSelectedClient] = useState<PdvClient | null>(null);
  const [saleDiscountCents, setSaleDiscountCents] = useState(0);
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [discountModalOpen, setDiscountModalOpen] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);

  const hasPdvAccess = isOwner ||
    isPlatformAdminRole(userRole) ||
    isTenantManagerRole(userRole) ||
    userPermissions?.includes('vendas.pdv');

  // O PDV vive fora do sistema de abas/TabPane (ver App.tsx), entao nao
  // herda automaticamente a checagem de blockedModules que toda outra tela
  // ganha de graca -- sem isso, bloquear o modulo "comercial.pedidos" pelo
  // SuperAdmin nao tinha nenhum efeito aqui (auditoria 2026-08-05).
  const isPdvModuleBlocked = !isPlatformAdmin && blockedModules?.includes('comercial.pedidos');

  const sessionStorageKey = useMemo(
    () => makePdvSessionStorageKey(tenantId, currentUser?.uid),
    [currentUser?.uid, tenantId],
  );

  const operatorName = currentUser?.displayName || currentUser?.email?.split('@')[0] || 'Operador';

  const totals = useMemo(
    () => calculatePdvTotals(cartItems, saleDiscountCents),
    [cartItems, saleDiscountCents],
  );

  // Nivel 2 (sistema): desconto TOTAL do cupom (itens + desconto geral)
  // contra o limite configurado pro PDV.
  const checagemLimiteDesconto = useMemo(
    () => checarLimiteTotal(limiteDescontoPdv, totals.subtotalCentavos, totals.descontoTotalCentavos),
    [limiteDescontoPdv, totals.subtotalCentavos, totals.descontoTotalCentavos],
  );

  // Uma aprovacao de senha so vale pro carrinho do momento -- mudar item ou
  // desconto depois invalida.
  const primeiraRenderAprovacaoRef = useRef(true);
  useEffect(() => {
    if (primeiraRenderAprovacaoRef.current) {
      primeiraRenderAprovacaoRef.current = false;
      return;
    }
    setAprovacaoDesconto(null);
  }, [cartItems, saleDiscountCents]);

  const selectedItem = useMemo(
    () => cartItems.find((item) => item.id === selectedItemId) || cartItems[cartItems.length - 1] || null,
    [cartItems, selectedItemId],
  );

  useEffect(() => {
    if (!currentUser || !tenantId || needsTenantSelection) return;

    let active = true;
    const loadData = async () => {
      setLoading(true);
      try {
        const [productsSnap, clientsSnap, configSnap] = await Promise.all([
          getDocs(query(collection(db, 'estoque'), where('tenantId', '==', tenantId))),
          getDocs(query(collection(db, 'clientes'), where('tenantId', '==', tenantId))),
          getDoc(doc(db, 'configuracoes', tenantId)),
        ]);

        if (!active) return;

        const nextProducts = productsSnap.docs
          .map((document) => {
            const data = document.data();
            return {
              id: document.id,
              nome: normalizeText(data.nome),
              codigo: normalizeText(data.codigo),
              codigoBarras: normalizeText(data.codigoBarras),
              referencia: normalizeText(data.referencia),
              skuSistema: normalizeText(data.skuSistema || data.ecommerce?.skuSistema),
              categoria: normalizeText(data.categoria),
              precoVenda: Number(data.precoVenda ?? data.precos?.venda ?? 0),
              quantidade: Number(data.quantidade ?? data.estoque?.quantidadeAtual ?? 0),
              imagemProduto: normalizeText(data.imagemProduto),
              unidadeMedidaSigla: normalizeText(data.unidadeMedidaSigla) || 'UN',
              unidadeMedidaCasasDecimais: Number(data.unidadeMedidaCasasDecimais ?? 0),
              unidadeMedidaFracionado: data.unidadeMedidaFracionado,
              statusAtivo: data.statusAtivo ?? data.ativo ?? true,
              embalagens: data.embalagens,
              descontoMaximoPercentual: data.descontoMaximoPercentual,
            } as PdvProduct;
          })
          .filter((product) => product.nome && product.statusAtivo !== false)
          .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

        const nextClients = clientsSnap.docs
          .map((document) => {
            const data = document.data();
            return {
              id: document.id,
              nome: normalizeText(data.nome),
              telefone: normalizeText(data.telefone),
              documento: normalizeText(data.documento),
              email: normalizeText(data.email),
              isPadrao: Boolean(data.isPadrao),
            } as PdvClient;
          })
          .filter((client) => client.nome)
          .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

        const configData = configSnap.exists() ? configSnap.data() : null;
        setProducts(nextProducts);
        setClients(nextClients);
        setAllowNegativeStock(configData?.venderSemEstoque === true);
        setVenderPorEmbalagem(configData?.venderPorEmbalagem ?? DEFAULT_VENDER_POR_EMBALAGEM);
        setLimiteDescontoPdv(parseLimiteDescontoConfig(configData?.limiteDescontoPdv));
        setModoLimiteDesconto(parseModoLimiteDesconto(configData?.modoLimiteDesconto));
        setProductSearchMode(configData?.buscaProdutoModo === 'exata' ? 'exata' : DEFAULT_PRODUCT_SEARCH_MODE);
        setFinanceConfig(buildPdvFinanceConfig(configData));
      } catch (error) {
        console.error('Erro ao carregar dados do PDV:', error);
        showError('Erro ao carregar PDV', 'Não foi possível buscar produtos, clientes e configurações.');
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadData();
    const savedSession = localStorage.getItem(sessionStorageKey);
    if (savedSession) {
      try {
        const cachedSession = JSON.parse(savedSession) as PdvSession;
        // Mostra o cache local otimisticamente (evita bloquear o mount numa
        // rodada de rede), mas a fonte da verdade e o Firestore -- confirma
        // em paralelo que a sessao continua aberta no servidor (pode ter
        // sido fechada em outro dispositivo/aba).
        setSession(cachedSession);
        void (async () => {
          try {
            const snapAtual = await getDoc(doc(db, 'caixas_pdv', cachedSession.id));
            if (!active) return;
            if (!snapAtual.exists() || snapAtual.data().status !== 'aberto') {
              setSession(null);
              localStorage.removeItem(sessionStorageKey);
            }
          } catch (error) {
            console.error('Erro ao validar sessão de caixa aberta:', error);
          }
        })();
      } catch {
        localStorage.removeItem(sessionStorageKey);
      }
    }

    return () => {
      active = false;
    };
  }, [currentUser, needsTenantSelection, sessionStorageKey, tenantId]);

  useEffect(() => {
    productInputRef.current?.focus();
  }, [cartItems.length, paymentModalOpen]);

  const resetSale = useCallback(() => {
    setSearch('');
    setSelectedProduct(null);
    setCartItems([]);
    setSelectedItemId('');
    setSelectedClient(null);
    setSaleDiscountCents(0);
    setPaymentModalOpen(false);
    setDiscountModalOpen(false);
    setClientModalOpen(false);
  }, []);

  const openSession = useCallback(async () => {
    if (!currentUser || !tenantId) return;

    let saldoAnteriorSugeridoCentavos: number | null = null;
    try {
      const qUltimoFechamento = query(
        collection(db, 'caixas_pdv'),
        where('tenantId', '==', tenantId),
        where('operadorId', '==', currentUser.uid),
        where('status', '==', 'fechado'),
        orderBy('fechadoEm', 'desc'),
        limit(1),
      );
      const snapUltimo = await getDocs(qUltimoFechamento);
      if (!snapUltimo.empty) {
        saldoAnteriorSugeridoCentavos = Number(snapUltimo.docs[0].data().saldoFinalInformadoCentavos ?? 0);
      }
    } catch (error) {
      console.error('Erro ao buscar saldo anterior do caixa:', error);
    }

    const result = await NexusSwal.fire({
      title: 'Abrir caixa',
      text: saldoAnteriorSugeridoCentavos !== null
        ? `Saldo do último fechamento: ${currency.format(fromCents(saldoAnteriorSugeridoCentavos))}. Confirme ou ajuste o saldo inicial em dinheiro.`
        : 'Informe o saldo inicial em dinheiro.',
      input: 'number',
      inputValue: saldoAnteriorSugeridoCentavos !== null ? toCurrencyInput(saldoAnteriorSugeridoCentavos) : '0.00',
      inputAttributes: { min: '0', step: '0.01' },
      showCancelButton: true,
      confirmButtonText: 'Abrir caixa',
      cancelButtonText: 'Cancelar',
    });

    if (!result.isConfirmed) return;

    const saldoInicialCentavos = fromCurrencyInput(result.value || 0);
    const saldoAnteriorConfirmado = saldoAnteriorSugeridoCentavos !== null && saldoInicialCentavos === saldoAnteriorSugeridoCentavos;

    try {
      const novaSessaoRef = await addDoc(collection(db, 'caixas_pdv'), {
        tenantId,
        operadorId: currentUser.uid,
        operadorNome: operatorName,
        status: 'aberto',
        saldoInicialCentavos,
        saldoAnteriorSugeridoCentavos,
        saldoAnteriorConfirmado,
        fechadoEm: null,
        saldoFinalInformadoCentavos: null,
        saldoEsperadoCentavos: null,
        diferencaCentavos: null,
        sangrias: [],
        totalSangriasCentavos: 0,
        createdAt: serverTimestamp(),
        ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
      });

      const nextSession: PdvSession = {
        id: novaSessaoRef.id,
        tenantId,
        operadorId: currentUser.uid,
        operadorNome: operatorName,
        status: 'aberto',
        saldoInicialCentavos,
        saldoAnteriorSugeridoCentavos,
        saldoAnteriorConfirmado,
        abertoEm: new Date().toISOString(),
        fechadoEm: null,
        saldoFinalInformadoCentavos: null,
        saldoEsperadoCentavos: null,
        diferencaCentavos: null,
        sangrias: [],
        totalSangriasCentavos: 0,
      };
      setSession(nextSession);
      localStorage.setItem(sessionStorageKey, JSON.stringify(nextSession));
      showSuccess('Caixa aberto');

      const { createAuditLog } = await import('../../services/logService');
      createAuditLog({
        tenantId,
        usuarioId: currentUser.uid,
        usuarioEmail: currentUser.email || '',
        modulo: 'financeiro',
        acao: 'abrir_caixa',
        descricao: `Caixa aberto por ${operatorName} com saldo inicial de ${currency.format(fromCents(saldoInicialCentavos))}.`,
        registroRelacionadoId: novaSessaoRef.id,
        status: 'sucesso',
      });
    } catch (error) {
      console.error('Erro ao abrir caixa:', error);
      showError('Erro ao abrir caixa', 'Não foi possível abrir o caixa. Tente novamente.');
    }
  }, [currentUser, operatorName, sessionStorageKey, tenantId]);

  const closeSession = async () => {
    if (!session || !currentUser || !tenantId) return;

    if (cartItems.length > 0) {
      const confirmation = await NexusSwal.fire({
        title: 'Fechar caixa?',
        text: 'Existe uma venda em andamento. Ela será limpa antes do fechamento.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Fechar caixa',
        cancelButtonText: 'Voltar',
      });
      if (!confirmation.isConfirmed) return;
    }

    let saldoEsperadoCentavos = session.saldoInicialCentavos - session.totalSangriasCentavos;
    try {
      const qVendasEmDinheiro = query(
        collection(db, 'transacoes'),
        where('tenantId', '==', tenantId),
        where('pdvSessionId', '==', session.id),
        where('movimentaCaixaFisico', '==', true),
      );
      const snapVendas = await getDocs(qVendasEmDinheiro);
      snapVendas.forEach((docSnap) => {
        saldoEsperadoCentavos += Number(docSnap.data().valorCentavos || 0);
      });
    } catch (error) {
      console.error('Erro ao calcular saldo esperado do caixa:', error);
    }

    const result = await NexusSwal.fire({
      title: 'Fechar caixa',
      text: `Saldo esperado em dinheiro: ${currency.format(fromCents(saldoEsperadoCentavos))}. Informe o valor contado fisicamente no caixa.`,
      input: 'number',
      inputValue: toCurrencyInput(saldoEsperadoCentavos),
      inputAttributes: { min: '0', step: '0.01' },
      showCancelButton: true,
      confirmButtonText: 'Fechar caixa',
      cancelButtonText: 'Cancelar',
    });

    if (!result.isConfirmed) return;

    const saldoFinalInformadoCentavos = fromCurrencyInput(result.value || 0);
    const diferencaCentavos = saldoFinalInformadoCentavos - saldoEsperadoCentavos;

    try {
      await updateDoc(doc(db, 'caixas_pdv', session.id), {
        status: 'fechado',
        fechadoEm: serverTimestamp(),
        saldoFinalInformadoCentavos,
        saldoEsperadoCentavos,
        diferencaCentavos,
        updatedAt: serverTimestamp(),
        ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Caixa fechado'),
      });

      const { createAuditLog } = await import('../../services/logService');
      createAuditLog({
        tenantId,
        usuarioId: currentUser.uid,
        usuarioEmail: currentUser.email || '',
        modulo: 'financeiro',
        acao: 'fechar_caixa',
        descricao: `Caixa fechado por ${operatorName}. Esperado: ${currency.format(fromCents(saldoEsperadoCentavos))}, informado: ${currency.format(fromCents(saldoFinalInformadoCentavos))}, diferença: ${currency.format(fromCents(diferencaCentavos))}.`,
        registroRelacionadoId: session.id,
        status: 'sucesso',
      });

      resetSale();
      setSession(null);
      localStorage.removeItem(sessionStorageKey);
      showSuccess('Caixa fechado');
    } catch (error) {
      console.error('Erro ao fechar caixa:', error);
      showError('Erro ao fechar caixa', 'Não foi possível fechar o caixa. Tente novamente.');
    }
  };

  const [sangriaModalOpen, setSangriaModalOpen] = useState(false);

  const registrarSangria = useCallback(async (valorCentavos: number, motivo: string) => {
    if (!session || !currentUser || !tenantId) return;

    const novaSangria: CaixaSangria = {
      id: crypto.randomUUID(),
      valorCentavos,
      motivo,
      registradoEm: new Date().toISOString(),
      registradoPor: currentUser.uid,
      registradoPorNome: operatorName,
    };

    try {
      await updateDoc(doc(db, 'caixas_pdv', session.id), {
        sangrias: arrayUnion(novaSangria),
        totalSangriasCentavos: increment(valorCentavos),
        updatedAt: serverTimestamp(),
        ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), `Sangria de ${currency.format(fromCents(valorCentavos))}`),
      });

      const nextSession: PdvSession = {
        ...session,
        sangrias: [...session.sangrias, novaSangria],
        totalSangriasCentavos: session.totalSangriasCentavos + valorCentavos,
      };
      setSession(nextSession);
      localStorage.setItem(sessionStorageKey, JSON.stringify(nextSession));
      showSuccess('Sangria registrada');

      const { createAuditLog } = await import('../../services/logService');
      createAuditLog({
        tenantId,
        usuarioId: currentUser.uid,
        usuarioEmail: currentUser.email || '',
        modulo: 'financeiro',
        acao: 'sangria_caixa',
        descricao: `Sangria de ${currency.format(fromCents(valorCentavos))} (${motivo}) registrada por ${operatorName}.`,
        registroRelacionadoId: session.id,
        status: 'sucesso',
      });
    } catch (error) {
      console.error('Erro ao registrar sangria:', error);
      showError('Erro ao registrar sangria', 'Não foi possível registrar a sangria. Tente novamente.');
    }
  }, [currentUser, operatorName, session, sessionStorageKey, tenantId]);

  /** Valida contra a unidade REALMENTE vendida: um saco continua indivisivel
   * mesmo num produto fracionavel em quilo, e o estoque e sempre comparado
   * na unidade base (2 sacos de 20kg exigem 40kg de saldo). */
  const validateQuantity = useCallback((product: PdvProduct, nextQuantity: number, opcao?: OpcaoUnidadeVenda) => {
    if (nextQuantity <= 0) return false;
    const permiteFracionado = opcao ? opcao.permiteFracionado : product.unidadeMedidaFracionado;
    const casasDecimais = opcao?.casasDecimais ?? product.unidadeMedidaCasasDecimais;
    const sigla = opcao?.sigla || product.unidadeMedidaSigla || 'UN';
    if (!isValidSaleQuantity(nextQuantity, permiteFracionado, casasDecimais)) {
      showError('Operação bloqueada', permiteFracionado
        ? `A quantidade de ${product.nome} aceita no máximo ${casasDecimais ?? 0} casa(s) decimal(is), conforme a unidade ${sigla}.`
        : `${product.nome} está sendo vendido na unidade ${sigla}, que não permite quantidade fracionada.`);
      return false;
    }
    const quantidadeBase = toBaseQuantity(nextQuantity, opcao?.fatorConversao);
    if (!allowNegativeStock && quantidadeBase > Number(product.quantidade || 0)) {
      const siglaBase = product.unidadeMedidaSigla || 'UN';
      showError('Estoque insuficiente', (opcao?.fatorConversao ?? 1) === 1
        ? `Disponível: ${Number(product.quantidade || 0).toLocaleString('pt-BR')}.`
        : `${nextQuantity} ${sigla} consome ${quantidadeBase} ${siglaBase}, mas há apenas ${Number(product.quantidade || 0).toLocaleString('pt-BR')} ${siglaBase}.`);
      return false;
    }
    return true;
  }, [allowNegativeStock]);

  /** Quando o termo pesquisado e' o codigo de barras de uma embalagem, o item
   * entra ja naquela unidade -- bipar o saco lanca 1 SC (e baixa 20 kg), nao
   * 1 kg. Termo que nao bate com EAN de embalagem devolve undefined e o
   * produto cai na unidade base, como sempre. */
  const resolveScannedUnit = useCallback((product: PdvProduct): OpcaoUnidadeVenda | undefined => {
    if (!venderPorEmbalagem) return undefined;
    const embalagemId = findEmbalagemIdByExactCode(product, search);
    if (!embalagemId) return undefined;
    return findOpcaoUnidadeVenda(buildOpcoesUnidadeVenda(product), embalagemId);
  }, [search, venderPorEmbalagem]);

  const addProductToCart = useCallback((product: PdvProduct, quantity = 1, opcao?: OpcaoUnidadeVenda) => {
    if (!session) {
      void openSession();
      return;
    }

    const opcaoFinal = opcao || buildOpcoesUnidadeVenda(product)[0];
    const lineId = makeCartLineId(product.id, opcaoFinal.embalagemId);

    setCartItems((current) => {
      // Funde por LINHA (produto + embalagem), nao por produto: bipar o saco
      // depois de ja ter vendido a granel nao pode somar na linha do quilo.
      const existing = current.find((item) => item.id === lineId);
      const nextQuantity = (existing?.quantidade || 0) + quantity;
      if (!validateQuantity(product, nextQuantity, opcaoFinal)) return current;

      if (existing) {
        setSelectedItemId(existing.id);
        return current.map((item) => item.id === existing.id
          ? {
              ...item,
              quantidade: nextQuantity,
              ...(item.embalagemId ? { quantidadeBase: toBaseQuantity(nextQuantity, item.fatorConversao) } : {}),
            }
          : item);
      }

      const nextItem = makeCartItemFromProduct(product, quantity, opcaoFinal);
      setSelectedItemId(nextItem.id);
      return [...current, nextItem];
    });

    setSelectedProduct(product);
    setSearch('');
  }, [openSession, session, validateQuantity]);

  const updateItemQuantity = useCallback((itemId: string, quantity: number) => {
    setCartItems((current) => current.flatMap((item) => {
      if (item.id !== itemId) return [item];
      if (quantity <= 0) return [];
      const product = products.find((entry) => entry.id === item.productId);
      const opcao = product
        ? findOpcaoUnidadeVenda(buildOpcoesUnidadeVenda(product), item.embalagemId)
        : undefined;
      if (product && !validateQuantity(product, quantity, opcao)) return [item];
      return [{
        ...item,
        quantidade: quantity,
        ...(item.embalagemId ? { quantidadeBase: toBaseQuantity(quantity, item.fatorConversao) } : {}),
      }];
    }));
  }, [products, validateQuantity]);

  /** Opcoes de unidade por linha do carrinho, so quando a chave esta ligada.
   * Desligada = mapa vazio, e o CartPanel nem renderiza o seletor. */
  const unitOptionsByItemId = useMemo(() => {
    if (!venderPorEmbalagem) return {};
    return cartItems.reduce<Record<string, OpcaoUnidadeVenda[]>>((mapa, item) => {
      const product = products.find((entry) => entry.id === item.productId);
      if (product) mapa[item.id] = buildOpcoesUnidadeVenda(product);
      return mapa;
    }, {});
  }, [cartItems, products, venderPorEmbalagem]);

  /** Troca a unidade de uma linha ja lancada. Se ja existir outra linha na
   * unidade de destino, as duas seriam a mesma coisa -- em vez de criar id
   * duplicado, recusa e explica. */
  const changeItemUnit = useCallback((itemId: string, embalagemId: string) => {
    setCartItems((current) => {
      const item = current.find((entry) => entry.id === itemId);
      if (!item) return current;
      const product = products.find((entry) => entry.id === item.productId);
      if (!product) return current;

      const opcao = findOpcaoUnidadeVenda(buildOpcoesUnidadeVenda(product), embalagemId);
      const novoId = makeCartLineId(item.productId, opcao.embalagemId);
      if (novoId === item.id) return current;
      if (current.some((entry) => entry.id === novoId)) {
        showError('Unidade já lançada', `${product.nome} já está no cupom em ${opcao.sigla}. Altere a quantidade daquela linha.`);
        return current;
      }
      if (!validateQuantity(product, item.quantidade, opcao)) return current;

      setSelectedItemId(novoId);
      return current.map((entry) => entry.id !== itemId ? entry : {
        ...entry,
        id: novoId,
        // O preco acompanha a unidade -- o saco nao custa o mesmo que o quilo.
        precoUnitarioCentavos: toCents(opcao.precoVenda),
        // Desconto em reais foi calculado sobre o preco antigo; mante-lo aqui
        // aplicaria um abatimento sem relacao com o novo valor da linha.
        descontoCentavos: 0,
        unidadeMedidaSigla: opcao.sigla,
        unidadeMedidaCasasDecimais: opcao.casasDecimais,
        unidadeMedidaFracionado: opcao.permiteFracionado,
        embalagemId: opcao.embalagemId || undefined,
        fatorConversao: opcao.embalagemId ? opcao.fatorConversao : undefined,
        quantidadeBase: opcao.embalagemId ? toBaseQuantity(entry.quantidade, opcao.fatorConversao) : undefined,
      });
    });
  }, [products, validateQuantity]);

  const updateItemDiscount = useCallback((itemId: string, discountCents: number) => {
    setCartItems((current) => current.map((item) => {
      if (item.id !== itemId) return item;
      const lineGross = Math.round(item.precoUnitarioCentavos * item.quantidade);
      const clamped = clampDiscountCents(discountCents, lineGross);
      // Nivel 1 (produto): se o PRODUTO define seu proprio limite, ele e' o
      // piso -- sempre bloqueia, independente do modo configurado.
      const produto = products.find((p) => p.id === item.productId);
      if (produto && excedeLimiteItem(produto, clamped, lineGross)) {
        showError(
          'Desconto acima do limite do produto',
          `${item.nome} aceita no máximo ${produto.descontoMaximoPercentual}% de desconto, definido no próprio cadastro.`,
        );
        return item;
      }
      return { ...item, descontoCentavos: clamped };
    }));
  }, [products]);

  const removeItem = useCallback((itemId: string) => {
    setCartItems((current) => current.filter((item) => item.id !== itemId));
    if (selectedItemId === itemId) setSelectedItemId('');
  }, [selectedItemId]);

  const clearSale = async () => {
    if (cartItems.length === 0) return;
    const result = await NexusSwal.fire({
      title: 'Limpar venda?',
      text: 'Todos os itens e pagamentos desta venda serão removidos.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Limpar',
      cancelButtonText: 'Cancelar',
    });
    if (result.isConfirmed) resetSale();
  };

  const askSelectedItemQuantity = useCallback(async () => {
    if (!selectedItem) return;
    const result = await NexusSwal.fire({
      title: 'Alterar quantidade',
      text: selectedItem.nome,
      input: 'number',
      inputValue: String(selectedItem.quantidade),
      inputAttributes: { min: '0', step: selectedItem.unidadeMedidaFracionado === true ? 'any' : '1' },
      showCancelButton: true,
      confirmButtonText: 'Aplicar',
      cancelButtonText: 'Cancelar',
    });
    if (result.isConfirmed) {
      updateItemQuantity(selectedItem.id, Number(result.value || 0));
    }
  }, [selectedItem, updateItemQuantity]);

  const finalizeSale = async (drafts: PaymentDraft[], observation: string) => {
    if (!currentUser || !tenantId || !session) return;
    if (cartItems.length === 0) {
      showError('Venda vazia', 'Adicione pelo menos um produto.');
      return;
    }

    if (checagemLimiteDesconto.excedeu) {
      if (modoLimiteDesconto === 'bloquear') {
        showError('Desconto acima do limite', `O desconto deste cupom (${checagemLimiteDesconto.percentualAplicado.toFixed(1)}%) excede o limite configurado. Reduza o desconto para continuar.`);
        return;
      }
      if (modoLimiteDesconto === 'senha' && !aprovacaoDesconto) {
        setShowAprovacaoDesconto(true);
        return;
      }
      if (modoLimiteDesconto === 'avisar') {
        const confirm = await NexusSwal.fire({
          title: 'Desconto acima do limite',
          text: `O desconto deste cupom (${checagemLimiteDesconto.percentualAplicado.toFixed(1)}%) excede o limite configurado. Deseja finalizar mesmo assim?`,
          icon: 'warning',
          showCancelButton: true,
          confirmButtonText: 'Finalizar mesmo assim',
          cancelButtonText: 'Revisar desconto',
        });
        if (!confirm.isConfirmed) return;
      }
    }

    let paymentRecords: PaymentRecord[];
    try {
      paymentRecords = normalizePayments(totals.totalCentavos, drafts, {
        saleDate: getDateInputInTimeZone(),
        operationLabel: 'venda PDV',
        maxCreditInstallments: financeConfig.maxCreditInstallments || undefined,
        creditFeePercentByInstallment: financeConfig.creditFeePercentByInstallment,
        debitFeePercent: financeConfig.debitFeePercent,
        creditSettlementDays: financeConfig.creditSettlementDays,
        debitSettlementDays: financeConfig.debitSettlementDays,
        cardFeeSchedulesByBrand,
        pagamentoCartaoSimplificadoAtivo: financeConfig.pagamentoCartaoSimplificadoAtivo,
        bancoPadraoSimplificado,
      });
    } catch (error) {
      showError('Pagamento inválido', error instanceof Error ? error.message : 'Revise os pagamentos.');
      return;
    }
    paymentRecords = explodeInstallmentPaymentRecords(paymentRecords);

    setSaving(true);
    try {
      const currentMaxPedido = await getCurrentMaxSequence(db, 'pedidos_venda', tenantId, 'numeroPedido').catch(() => 0);
      let finalNumeroPedido = '';
      let newPedidoId = '';
      const paymentSummary = summarizePayments(paymentRecords);
      const saleDate = getDateInputInTimeZone();

      const bankCreditsByBanco = new Map<string, number>();
      paymentRecords.forEach((payment) => {
        if (payment.status === 'confirmado' && payment.bancoId) {
          bankCreditsByBanco.set(payment.bancoId, (bankCreditsByBanco.get(payment.bancoId) || 0) + payment.valorCentavos);
        }
      });

      await runTransaction(db, async (transaction) => {
        const nextPedido = await getNextTenantSequenceValue(transaction, db, tenantId, 'pedidos_venda', currentMaxPedido);
        const sellerSnap = await transaction.get(doc(db, 'usuarios', currentUser.uid));
        const sellerProfile = sellerSnap.exists() ? sellerSnap.data() : {};
        if (!sellerSnap.exists() || sellerProfile.tenantId !== tenantId) {
          throw new Error('O operador não pertence à empresa ativa.');
        }
        const sellerName = sellerProfile.nome || sellerProfile.nomeResponsavel || operatorName;

        const bankBalancesById = new Map<string, number>();
        for (const bancoId of bankCreditsByBanco.keys()) {
          const bancoSnap = await transaction.get(doc(db, 'bancos', bancoId));
          if (!bancoSnap.exists()) throw new Error('O banco de destino selecionado não foi encontrado.');
          bankBalancesById.set(bancoId, Number(bancoSnap.data().saldoCentavos || 0));
        }

        finalNumeroPedido = formatSequenceValue(nextPedido, 4);
        const newPedidoRef = doc(collection(db, 'pedidos_venda'));
        newPedidoId = newPedidoRef.id;

        await applyStockAdjustments(
          transaction,
          db,
          toStockAdjustmentItems(cartItems.map((item) => ({
            id: item.productId,
            nome: item.nome,
            quantidade: item.quantidade,
            fatorConversao: item.fatorConversao,
          }))),
          'decrement',
          allowNegativeStock,
        );

        writeTenantSequenceValue(transaction, db, tenantId, 'pedidos_venda', nextPedido);

        const persistedPayments = paymentRecords.map((payment, index) => ({
          ...payment,
          transactionId: index === 0 ? newPedidoRef.id : `${newPedidoRef.id}_pag_${index + 1}`,
        }));
        const saleDiscountShare = totals.vendaDescontoCentavos;
        const grossItemsCents = Math.max(1, totals.subtotalCentavos);
        const itens = cartItems.map((item) => {
          const lineGrossCents = Math.round(item.precoUnitarioCentavos * item.quantidade);
          const proportionalSaleDiscount = Math.round(saleDiscountShare * (lineGrossCents / grossItemsCents));
          const totalDiscountCents = Math.min(lineGrossCents, item.descontoCentavos + proportionalSaleDiscount);
          const subtotalCents = Math.max(0, lineGrossCents - totalDiscountCents);
          return {
            id: item.productId,
            nome: item.nome,
            precoUnitario: fromCents(item.precoUnitarioCentavos),
            precoUnitarioCentavos: item.precoUnitarioCentavos,
            quantidade: item.quantidade,
            desconto: fromCents(totalDiscountCents),
            descontoCentavos: totalDiscountCents,
            subtotal: fromCents(subtotalCents),
            subtotalCentavos: subtotalCents,
            unidadeMedidaSigla: item.unidadeMedidaSigla,
            unidadeMedidaCasasDecimais: item.unidadeMedidaCasasDecimais,
            // Mesmo contrato do Pedido de Venda: item na unidade base nao
            // ganha campo de embalagem, para nao mudar o formato historico.
            ...(item.embalagemId
              ? {
                  embalagemId: item.embalagemId,
                  fatorConversao: item.fatorConversao,
                  quantidadeBase: item.quantidadeBase,
                }
              : {}),
          };
        });

        const commissionSnapshot = buildCommissionSnapshot({
          sellerId: currentUser.uid,
          sellerName,
          baseCents: itens.reduce((sum, item) => sum + Number(item.subtotalCentavos || toCents(item.subtotal)), 0),
          profile: sellerProfile,
        });
        const clienteNome = selectedClient?.nome || 'CONSUMIDOR FINAL';

        transaction.set(newPedidoRef, {
          numeroPedido: finalNumeroPedido,
          // O 'pdv' ja era gravado em cada TRANSACOES de pagamento (F16),
          // mas nunca no documento da venda em si -- sem isso, nao ha como
          // distinguir uma venda de balcao de um Pedido de Venda comum so
          // olhando pedidos_venda/{id}. Achado montando o relatorio da
          // Fatia 6 (Descontos Concedidos), que precisa separar as origens.
          sourceOrigin: 'pdv',
          clienteId: selectedClient?.id || null,
          clienteNome,
          itens,
          valorTotalItens: fromCents(totals.subtotalCentavos),
          valorTotalItensCentavos: totals.subtotalCentavos,
          valorTotalDescontos: fromCents(totals.descontoTotalCentavos),
          valorTotalDescontosCentavos: totals.descontoTotalCentavos,
          descontoItensCentavos: totals.itensDescontoCentavos,
          descontoVendaCentavos: totals.vendaDescontoCentavos,
          // Snapshot no mesmo formato usado por Pedido/OS/Orcamento, pro
          // relatorio de descontos concedidos (Fatia 6) ler os 4 de igual
          // pra igual. DiscountModal so devolve o valor final em centavos
          // (nao guarda se o operador escolheu % ou R$), entao aqui sempre
          // registra como 'valor' -- o total concedido fica certo mesmo
          // assim, so o "tipo" nao reflete a escolha original do operador.
          descontoGeral: {
            tipo: 'valor' as const,
            valorInformado: fromCents(totals.descontoTotalCentavos),
            valorAplicadoCentavos: totals.descontoTotalCentavos,
            excedeuLimite: checagemLimiteDesconto.excedeu,
            ...(checagemLimiteDesconto.excedeu && aprovacaoDesconto
              ? { aprovacao: { modo: 'senha' as const, ...aprovacaoDesconto, aprovadoEm: new Date().toISOString() } }
              : {}),
          },
          frete: 0,
          encargos: 0,
          valorTotal: fromCents(totals.totalCentavos),
          valorTotalCentavos: totals.totalCentavos,
          formaPagamento: paymentSummary.paymentMethodLabel,
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
          dataVenda: saleDate,
          status: 'Finalizada',
          origem: 'pdv',
          pdvSessionId: session.id,
          observacao: observation.trim(),
          tenantId,
          usuarioResponsavelId: currentUser.uid,
          vendedorId: currentUser.uid,
          vendedorNome: sellerName,
          comissao: commissionSnapshot,
          createdAt: serverTimestamp(),
          ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
        });

        bankCreditsByBanco.forEach((deltaCents, bancoId) => {
          transaction.update(doc(db, 'bancos', bancoId), {
            saldoCentavos: (bankBalancesById.get(bancoId) || 0) + deltaCents,
            updatedAt: serverTimestamp(),
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), `Crédito da venda PDV #${finalNumeroPedido}`),
          });
        });

        persistedPayments.forEach((payment) => {
          const parcelaLabel = payment.cartao?.numero
            ? ` (Parcela ${payment.cartao.numero}/${payment.cartao.totalParcelas})`
            : '';
          transaction.set(doc(db, 'transacoes', payment.transactionId), {
            descricao: `PDV #${finalNumeroPedido} - ${payment.formaPagamento}${parcelaLabel}`,
            categoria: 'Venda de Peças',
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
            data: payment.dataVencimento || saleDate,
            dataVencimento: payment.dataVencimento || null,
            dataPrevistaRecebimento: payment.dataPrevistaRecebimento || null,
            cartao: payment.cartao || null,
            pedidoId: newPedidoRef.id,
            sourceType: 'pedido_venda',
            sourceId: newPedidoRef.id,
            sourceOrigin: 'pdv',
            pdvSessionId: session.id,
            paymentIndex: payment.indice,
            idempotencyKey: `pdv:${newPedidoRef.id}:pagamento:${payment.indice}`,
            clienteId: selectedClient?.id || null,
            clienteNome,
            usuarioResponsavelId: currentUser.uid,
            vendedorId: currentUser.uid,
            tenantId,
            createdAt: serverTimestamp(),
            ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
          });
        });
      });

      const { createAuditLog } = await import('../../services/logService');
      createAuditLog({
        tenantId,
        usuarioId: currentUser.uid,
        usuarioEmail: currentUser.email || '',
        modulo: 'vendas',
        acao: 'criar_pdv',
        descricao: `Venda PDV #${finalNumeroPedido} finalizada no valor de ${toCurrencyInput(totals.totalCentavos)}.`,
        status: 'sucesso',
      });

      showSuccess(`Venda PDV #${finalNumeroPedido} finalizada`);
      // Espelha localmente a baixa que a transacao acabou de fazer. Soma TODAS
      // as linhas do mesmo produto (ele pode aparecer em quilo e em saco ao
      // mesmo tempo) e sempre na unidade base.
      setProducts((current) => current.map((product) => {
        const vendidoBase = cartItems
          .filter((item) => item.productId === product.id)
          .reduce((soma, item) => soma + toBaseQuantity(item.quantidade, item.fatorConversao), 0);
        return vendidoBase > 0
          ? { ...product, quantidade: Math.max(0, product.quantidade - vendidoBase) }
          : product;
      }));
      resetSale();
      setPaymentModalOpen(false);
      if (newPedidoId) {
        console.info('Venda PDV criada:', newPedidoId);
      }
    } catch (error) {
      console.error('Erro ao finalizar PDV:', error);
      showError('Erro ao finalizar venda', error instanceof Error ? error.message : 'Tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const handleShortcuts = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (paymentModalOpen || discountModalOpen || clientModalOpen) {
          setPaymentModalOpen(false);
          setDiscountModalOpen(false);
          setClientModalOpen(false);
        }
        return;
      }

      if (!hasPdvAccess) return;
      if (event.key === 'F2') { event.preventDefault(); setClientModalOpen(true); }
      if (event.key === 'F3') { event.preventDefault(); productInputRef.current?.focus(); }
      if (event.key === 'F4') { event.preventDefault(); if (cartItems.length > 0) setDiscountModalOpen(true); }
      if (event.key === 'F5') { event.preventDefault(); void askSelectedItemQuantity(); }
      if (event.key === 'F6' || event.key === 'F7') {
        event.preventDefault();
        if (cartItems.length > 0 && session) setPaymentModalOpen(true);
      }
    };

    window.addEventListener('keydown', handleShortcuts);
    return () => window.removeEventListener('keydown', handleShortcuts);
  }, [askSelectedItemQuantity, cartItems.length, clientModalOpen, discountModalOpen, hasPdvAccess, paymentModalOpen, session]);

  if (needsTenantSelection) {
    return (
      <div className="pdv-access-state">
        <LockKeyhole size={42} />
        <h1>Selecione uma empresa ativa</h1>
        <p>O PDV precisa de uma base de empresa antes de abrir o caixa.</p>
      </div>
    );
  }

  if (isPdvModuleBlocked) {
    return (
      <div className="pdv-access-state">
        <LockKeyhole size={42} />
        <h1>Módulo não disponível</h1>
        <p>O módulo de Pedidos de Venda está desativado para a sua conta. Entre em contato com o administrador do sistema para atualizar o plano.</p>
      </div>
    );
  }

  if (!hasPdvAccess) {
    return (
      <div className="pdv-access-state">
        <LockKeyhole size={42} />
        <h1>Acesso não permitido</h1>
        <p>Seu usuário precisa da permissão de pedidos de venda para usar o PDV.</p>
      </div>
    );
  }

  return (
    <div className="pdv-shell">
      <header className="pdv-topbar">
        <div className="pdv-brand">
          <button type="button" onClick={() => navigate('/dashboard')} title="Voltar para a retaguarda">
            <ArrowLeft size={20} />
          </button>
          <img src={hennderIcon} alt="Hennder ERP" className="pdv-logo" />
          <span>
            <small>{selectedTenant?.nomeOficina || 'Hennder Company'}</small>
            <strong>Frente de Caixa</strong>
          </span>
        </div>
        <div className="pdv-status">
          {loading ? <Loader2 className="spin-animation" size={18} /> : <Store size={18} />}
          <span>{session ? 'Caixa aberto' : 'Caixa fechado'}</span>
        </div>
        <div className="pdv-window-actions">
          <button type="button" title="Tela cheia" onClick={() => document.documentElement.requestFullscreen?.()}>
            <Maximize2 size={18} />
          </button>
          <button type="button" title="Sair do PDV" onClick={() => navigate('/dashboard')}>
            <X size={20} />
          </button>
        </div>
      </header>

      {loading ? (
        <div className="pdv-loading">
          <Loader2 className="spin-animation" size={34} />
          <span>Carregando PDV...</span>
        </div>
      ) : (
        <main className="pdv-main">
          <div className="pdv-left">
            <ProductSearch
              value={search}
              products={products}
              selectedProduct={selectedProduct}
              inputRef={productInputRef}
              mode={productSearchMode}
              disabled={!session}
              onChange={setSearch}
              onSelect={(product) => addProductToCart(product, 1, resolveScannedUnit(product))}
            />

            {!session && (
              <div className="pdv-closed-overlay">
                <PackageSearch size={30} />
                <strong>Abra o caixa para iniciar as vendas</strong>
                <button type="button" className="btn-primary" onClick={openSession}>Abrir caixa</button>
              </div>
            )}
          </div>

          <CartPanel
            items={cartItems}
            selectedItemId={selectedItemId}
            onSelectItem={setSelectedItemId}
            onQuantityChange={updateItemQuantity}
            onDiscountChange={updateItemDiscount}
            onRemoveItem={removeItem}
            unitOptionsByItemId={unitOptionsByItemId}
            onUnitChange={venderPorEmbalagem ? changeItemUnit : undefined}
          />

          <PdvSummary
            totals={totals}
            client={selectedClient}
            session={session}
            disabled={cartItems.length === 0}
            discountWarning={checagemLimiteDesconto.excedeu ? `Desconto de ${checagemLimiteDesconto.percentualAplicado.toFixed(1)}% acima do limite configurado.` : undefined}
            onOpenClient={() => setClientModalOpen(true)}
            onOpenDiscount={() => setDiscountModalOpen(true)}
            onOpenPayment={() => setPaymentModalOpen(true)}
            onClearSale={clearSale}
            onOpenSession={openSession}
            onCloseSession={closeSession}
            onOpenSangria={() => setSangriaModalOpen(true)}
          />
        </main>
      )}

      <ClientModal
        open={clientModalOpen}
        clients={clients}
        selectedClient={selectedClient}
        onClose={() => setClientModalOpen(false)}
        onSelect={setSelectedClient}
      />

      <SangriaModal
        open={sangriaModalOpen}
        onClose={() => setSangriaModalOpen(false)}
        onConfirm={registrarSangria}
      />

      <SolicitarAprovacaoDescontoModal
        open={showAprovacaoDesconto}
        tenantId={tenantId}
        motivo={`Desconto de ${checagemLimiteDesconto.percentualAplicado.toFixed(1)}% neste cupom, acima do limite configurado. Confirme com a senha de um aprovador para finalizar.`}
        onClose={() => setShowAprovacaoDesconto(false)}
        onAprovado={(aprovacao) => setAprovacaoDesconto(aprovacao)}
      />

      <DiscountModal
        open={discountModalOpen}
        subtotalCents={totals.subtotalCentavos}
        itemDiscountCents={totals.itensDescontoCentavos}
        saleDiscountCents={saleDiscountCents}
        onClose={() => setDiscountModalOpen(false)}
        onApply={setSaleDiscountCents}
      />

      <PaymentModal
        open={paymentModalOpen}
        totalCents={totals.totalCentavos}
        financeConfig={financeConfig}
        tenantId={tenantId}
        saving={saving}
        onClose={() => setPaymentModalOpen(false)}
        onFinalize={finalizeSale}
      />
    </div>
  );
};

export default PDV;
