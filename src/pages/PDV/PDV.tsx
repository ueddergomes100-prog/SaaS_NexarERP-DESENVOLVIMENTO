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
  summarizePayments,
  toCents,
  type PaymentDraft,
  type PaymentRecord,
} from '../../utils/financeDomain';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import { DEFAULT_PRODUCT_SEARCH_MODE, type ProductSearchMode } from '../../utils/productSearch';
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
  makePdvSessionStorageKey,
  toCurrencyInput,
} from './pdvHelpers';
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
  const cardFeeSchedulesByBrand = buildCardFeeSchedulesByBrand(bandeirasCartao);

  const productInputRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [products, setProducts] = useState<PdvProduct[]>([]);
  const [clients, setClients] = useState<PdvClient[]>([]);
  const [allowNegativeStock, setAllowNegativeStock] = useState(false);
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
    userPermissions?.includes('vendas.pedidos');

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

  const validateQuantity = useCallback((product: PdvProduct, nextQuantity: number) => {
    if (nextQuantity <= 0) return false;
    if (!isValidSaleQuantity(nextQuantity, product.unidadeMedidaFracionado)) {
      showError('Operação bloqueada', `O produto ${product.nome} não permite quantidade fracionada.`);
      return false;
    }
    if (!allowNegativeStock && nextQuantity > Number(product.quantidade || 0)) {
      showError('Estoque insuficiente', `Disponível: ${Number(product.quantidade || 0).toLocaleString('pt-BR')}.`);
      return false;
    }
    return true;
  }, [allowNegativeStock]);

  const addProductToCart = useCallback((product: PdvProduct, quantity = 1) => {
    if (!session) {
      void openSession();
      return;
    }

    setCartItems((current) => {
      const existing = current.find((item) => item.productId === product.id);
      const nextQuantity = (existing?.quantidade || 0) + quantity;
      if (!validateQuantity(product, nextQuantity)) return current;

      if (existing) {
        setSelectedItemId(existing.id);
        return current.map((item) => item.id === existing.id ? { ...item, quantidade: nextQuantity } : item);
      }

      const nextItem = makeCartItemFromProduct(product, quantity);
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
      if (product && !validateQuantity(product, quantity)) return [item];
      return [{ ...item, quantidade: quantity }];
    }));
  }, [products, validateQuantity]);

  const updateItemDiscount = useCallback((itemId: string, discountCents: number) => {
    setCartItems((current) => current.map((item) => {
      if (item.id !== itemId) return item;
      const lineGross = Math.round(item.precoUnitarioCentavos * item.quantidade);
      return { ...item, descontoCentavos: clampDiscountCents(discountCents, lineGross) };
    }));
  }, []);

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
      inputAttributes: { min: '0.001', step: selectedItem.unidadeMedidaFracionado === true ? '0.001' : '1' },
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
          cartItems.map((item) => ({ id: item.productId, nome: item.nome, quantidade: item.quantidade })),
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
          clienteId: selectedClient?.id || null,
          clienteNome,
          itens,
          valorTotalItens: fromCents(totals.subtotalCentavos),
          valorTotalItensCentavos: totals.subtotalCentavos,
          valorTotalDescontos: fromCents(totals.descontoTotalCentavos),
          valorTotalDescontosCentavos: totals.descontoTotalCentavos,
          descontoItensCentavos: totals.itensDescontoCentavos,
          descontoVendaCentavos: totals.vendaDescontoCentavos,
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
      setProducts((current) => current.map((product) => {
        const soldItem = cartItems.find((item) => item.productId === product.id);
        return soldItem ? { ...product, quantidade: Math.max(0, product.quantidade - soldItem.quantidade) } : product;
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
              onSelect={(product) => addProductToCart(product, 1)}
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
          />

          <PdvSummary
            totals={totals}
            client={selectedClient}
            session={session}
            disabled={cartItems.length === 0}
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
