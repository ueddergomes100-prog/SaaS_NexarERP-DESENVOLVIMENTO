import React, { useEffect, useState } from 'react';
import { collection, query, onSnapshot, where, doc, getDocs, serverTimestamp, runTransaction } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError, NexusSwal } from '../../utils/alerts';
import { CheckCircle, Clock, X, Wallet, AlertCircle, MessageCircle, ChevronDown, ChevronRight, User, Search } from 'lucide-react';
import {
  applyPaymentReceipt,
  financialNatureForPayment,
  fromCents,
  paymentRequiresBankAccount,
  settledFinancialNatureForPayment,
  summarizePayments,
  toCents,
  transactionDueDateInput,
  transactionNetAmount,
  type PaymentMethod,
  type PaymentRecord,
} from '../../utils/financeDomain';
import { differenceInCalendarDays, getDateInputInTimeZone } from '../../utils/dateTime';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { filtrarLancamentosVisiveis } from '../../utils/visibilidadeVendasDomain';
import './Financeiro.css';

interface TransacaoData {
  id: string;
  data: string;
  descricao: string;
  categoria: string;
  valor: number;
  valorCentavos?: number;
  tipo: 'entrada' | 'saida';
  status: 'Paga' | 'Pendente';
  formaPagamento?: string;
  osId?: string;
  dataPagamento?: string;
  createdAt?: any;
  clienteId?: string | null;
  clienteNome?: string;
  pedidoId?: string;
  paymentIndex?: number;
  movimentaCaixaFisico?: boolean;
  naturezaFinanceira?: string;
  dataVencimento?: string;
  dataPrevistaRecebimento?: string;
  sourceType?: string;
  vendedorId?: string;
  usuarioResponsavelId?: string;
  criadoPor?: string;
}

interface GrupoCliente {
  chave: string;
  clienteId: string | null;
  clienteNome: string;
  transacoes: TransacaoData[];
  totalPendente: number;
  vencimentoMaisAntigo: string | null;
  diasAtrasoMax: number;
}

/** Regra compartilhada com o Dashboard -- ver transactionDueDateInput. */
const dataReferenciaTransacao = (t: TransacaoData) => transactionDueDateInput(t) || undefined;

const paymentMethods: PaymentMethod[] = [
  'Dinheiro',
  'Pix',
  'Cartão de Crédito',
  'Cartão de Débito',
  'Transferência',
  'Boleto',
  'Pagamento a Prazo',
  'Crédito de Devolução',
  'Outros',
];

const asPaymentMethod = (value: unknown): PaymentMethod => {
  const normalized = String(value || '');
  return paymentMethods.includes(normalized as PaymentMethod)
    ? normalized as PaymentMethod
    : 'Outros';
};

const legacyPaymentForTransaction = (
  transactionId: string,
  transactionData: Record<string, any>,
): PaymentRecord => {
  const method = asPaymentMethod(transactionData.formaPagamento);
  const valueCents = Number(transactionData.valorCentavos ?? toCents(transactionData.valor));
  return {
    id: transactionId,
    indice: Number(transactionData.paymentIndex || 1),
    formaPagamento: method,
    condicaoPagamento: transactionData.condicaoPagamento === 'aprazo' || method === 'Pagamento a Prazo'
      ? 'aprazo'
      : 'avista',
    valorCentavos: valueCents,
    valor: fromCents(valueCents),
    status: transactionData.status === 'Paga' ? 'confirmado' : 'pendente',
    naturezaFinanceira: financialNatureForPayment(method),
    movimentaCaixaFisico: transactionData.status === 'Paga' && method === 'Dinheiro',
    transactionId,
  };
};

const ContasReceber: React.FC = () => {
  const [transacoes, setTransacoes] = useState<TransacaoData[]>([]);
  const [loading, setLoading] = useState(true);
  const { currentUser, tenantId, vendasVisiveisDeUsuarioId } = useAuth();
  
  const [modalConciliacao, setModalConciliacao] = useState<{ ativo: boolean, transacao: TransacaoData | null, creditos: any[], saldoTotal: number }>({
    ativo: false, transacao: null, creditos: [], saldoTotal: 0
  });
  const [valorAbater, setValorAbater] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [clientesExpandidos, setClientesExpandidos] = useState<Set<string>>(new Set());
  const [buscaCliente, setBuscaCliente] = useState('');

  const confirmarRecebimento = async (
    t: TransacaoData,
    formaPgto: PaymentMethod,
    bancoId?: string,
    bancoNome?: string,
  ) => {
    if (!tenantId || !currentUser) return;
    const transactionRef = doc(db, 'transacoes', t.id);
    const paymentDate = getDateInputInTimeZone();

    await runTransaction(db, async (transaction) => {
      const transactionSnap = await transaction.get(transactionRef);
      if (!transactionSnap.exists()) throw new Error('Conta a receber não encontrada.');
      const transactionData = transactionSnap.data();
      if (transactionData.status === 'Paga') return;
      if (transactionData.status === 'Cancelada') {
        throw new Error('Uma conta cancelada não pode ser recebida.');
      }

      let sourceRef = null;
      let sourceSnap = null;
      const saleId = transactionData.pedidoId || t.pedidoId;
      const serviceOrderId = transactionData.osId || t.osId;
      if (saleId) {
        sourceRef = doc(db, 'pedidos_venda', saleId);
        sourceSnap = await transaction.get(sourceRef);
      } else if (serviceOrderId) {
        sourceRef = doc(db, 'ordens_de_servico', serviceOrderId);
        sourceSnap = await transaction.get(sourceRef);
      }
      if (sourceSnap?.exists() && sourceSnap.data().status === 'Cancelada') {
        throw new Error(saleId ? 'A venda vinculada está cancelada.' : 'A OS vinculada está cancelada.');
      }

      const amountCents = Number(transactionData.valorCentavos ?? toCents(transactionData.valor));
      const settlementNature = settledFinancialNatureForPayment(formaPgto);

      const bancoRef = bancoId ? doc(db, 'bancos', bancoId) : null;
      let bancoSaldoAtualCentavos = 0;
      if (bancoRef) {
        const bancoSnap = await transaction.get(bancoRef);
        if (!bancoSnap.exists()) throw new Error('O banco selecionado não foi encontrado.');
        bancoSaldoAtualCentavos = Number(bancoSnap.data().saldoCentavos || 0);
      }

      transaction.update(transactionRef, {
        status: 'Paga',
        formaPagamentoOriginal: transactionData.formaPagamentoOriginal || transactionData.formaPagamento || null,
        formaPagamento: formaPgto,
        valorCentavos: amountCents,
        valor: fromCents(amountCents),
        dataPagamento: paymentDate,
        naturezaFinanceira: settlementNature,
        movimentaCaixaFisico: formaPgto === 'Dinheiro',
        ...(bancoRef ? { bancoId, bancoNome: bancoNome || null } : {}),
        recebidoEm: serverTimestamp(),
        updatedAt: serverTimestamp(),
        ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Recebimento confirmado'),
      });

      if (bancoRef) {
        transaction.update(bancoRef, {
          saldoCentavos: bancoSaldoAtualCentavos + amountCents,
          updatedAt: serverTimestamp(),
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), `Recebimento de "${t.descricao}"`),
        });
      }

      if (sourceRef && sourceSnap?.exists()) {
        const sourceData = sourceSnap.data();
        const payments: PaymentRecord[] = Array.isArray(sourceData.pagamentos) && sourceData.pagamentos.length > 0
          ? sourceData.pagamentos
          : [legacyPaymentForTransaction(t.id, transactionData)];
        const updatedPayments = applyPaymentReceipt(payments, {
          transactionId: t.id,
          paymentIndex: transactionData.paymentIndex,
          amountCents,
          method: formaPgto,
          receiptId: t.id,
          receivedAt: paymentDate,
        });
        const summary = summarizePayments(updatedPayments);

        transaction.update(sourceRef, {
          pagamentos: updatedPayments,
          totalRecebidoCentavos: summary.receivedCents,
          totalRecebido: summary.received,
          totalPendenteCentavos: summary.pendingCents,
          totalPendente: summary.pending,
          totalTaxasPagamentoCentavos: summary.cardFeeCents,
          totalTaxasPagamento: summary.cardFee,
          totalLiquidoFinanceiroCentavos: summary.financialNetCents,
          totalLiquidoFinanceiro: summary.financialNet,
          statusPagamento: summary.pendingCents === 0
            ? 'Paga'
            : summary.receivedCents > 0
              ? 'Parcial'
              : 'Pendente',
          updatedAt: serverTimestamp(),
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Recebimento confirmado em Contas a Receber'),
        });
      }
    });
  };

  useEffect(() => {
    if (!currentUser) return;
    
    // Escutar TODAS as transacoes de entrada para poder calcular o recebido de hoje
    const q = query(
      collection(db, 'transacoes'), 
      where('tenantId', '==', tenantId),
      where('tipo', '==', 'entrada')
    );

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const data: TransacaoData[] = [];
      querySnapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() } as TransacaoData);
      });
      data.sort((a, b) => {
        const dateA = a.createdAt?.seconds || 0;
        const dateB = b.createdAt?.seconds || 0;
        return dateB - dateA;
      });
      // Visibilidade de vendas: some so o que veio de venda de OUTRO
      // vendedor. Recebimento de OS, credito e lancamento manual continuam
      // na lista -- ver src/utils/visibilidadeVendasDomain.ts.
      setTransacoes(filtrarLancamentosVisiveis(data, vendasVisiveisDeUsuarioId));
      setLoading(false);
    }, (error) => {
      console.error("Erro ao buscar contas a receber:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser, tenantId, vendasVisiveisDeUsuarioId]);

  const solicitarFormaRecebimento = async (t: TransacaoData) => {
    const result = await NexusSwal.fire({
      title: 'Confirmar Recebimento?',
      text: `Selecione como foi recebido o valor líquido de R$ ${transactionNetAmount(t).toFixed(2)} referente a ${t.descricao}:`,
      icon: 'question',
      input: 'select',
      inputOptions: {
        'Dinheiro': 'Dinheiro',
        'Pix': 'Pix',
        'Cartão de Crédito': 'Cartão de Crédito',
        'Cartão de Débito': 'Cartão de Débito',
        'Transferência': 'Transferência',
        'Outros': 'Outros'
      },
      inputPlaceholder: 'Selecione a forma de recebimento',
      inputValue: t.formaPagamento && ['Dinheiro', 'Pix', 'Cartão de Crédito', 'Cartão de Débito', 'Transferência', 'Outros'].includes(t.formaPagamento) ? t.formaPagamento : '',
      showCancelButton: true,
      confirmButtonText: 'Confirmar recebimento',
      cancelButtonText: 'Cancelar',
      inputValidator: (value) => value ? undefined : 'Você precisa selecionar uma forma de recebimento!'
    });

    if (!result.isConfirmed) return;
    const formaPgto = result.value as PaymentMethod;

    let bancoId: string | undefined;
    let bancoNome: string | undefined;
    if (paymentRequiresBankAccount(formaPgto)) {
      const qBancos = query(
        collection(db, 'bancos'),
        where('tenantId', '==', tenantId),
        where('ativo', '==', true),
      );
      const snapBancos = await getDocs(qBancos);
      const bancosDisponiveis = snapBancos.docs.map((d) => ({ id: d.id, nome: String(d.data().nome || '') }));
      if (bancosDisponiveis.length === 0) {
        showError('Nenhum banco cadastrado', 'Cadastre um banco em Cadastros > Bancos antes de confirmar este recebimento.');
        return;
      }
      const bancoResult = await NexusSwal.fire({
        title: 'Em qual banco caiu?',
        input: 'select',
        inputOptions: Object.fromEntries(bancosDisponiveis.map((b) => [b.id, b.nome])),
        inputPlaceholder: 'Selecione o banco',
        showCancelButton: true,
        confirmButtonText: 'Confirmar',
        cancelButtonText: 'Cancelar',
        inputValidator: (value) => (value ? undefined : 'Selecione um banco.'),
      });
      if (!bancoResult.isConfirmed) return;
      bancoId = bancoResult.value as string;
      bancoNome = bancosDisponiveis.find((b) => b.id === bancoId)?.nome;
    }

    try {
      await confirmarRecebimento(t, formaPgto, bancoId, bancoNome);
      showSuccess(formaPgto === 'Dinheiro'
        ? 'Recebimento confirmado e lançado no caixa físico!'
        : 'Recebimento confirmado no fluxo financeiro correspondente!');
    } catch (error) {
      console.error('Erro ao confirmar recebimento:', error);
      showError('Erro', error instanceof Error ? error.message : 'Não foi possível aprovar a transação.');
    }
  };

  const handleConciliar = async (t: TransacaoData) => {
    let saldoCredito = 0;
    const creditosAtivos: any[] = [];
    
    if (t.clienteNome) {
      const qC = query(
        collection(db, 'creditos_cliente'), 
        where('tenantId', '==', tenantId), 
        where('clienteNome', '==', t.clienteNome), 
        where('status', 'in', ['disponivel', 'usado_parcial'])
      );
      const snapC = await getDocs(qC);
      snapC.forEach(d => {
        const data = d.data();
        if (data.saldoDisponivel > 0) {
          creditosAtivos.push({ id: d.id, ...data });
          saldoCredito += data.saldoDisponivel;
        }
      });
    }

    if (saldoCredito > 0) {
      const sugerido = Math.min(t.valor, saldoCredito);
      setValorAbater(sugerido);
      setModalConciliacao({ ativo: true, transacao: t, creditos: creditosAtivos, saldoTotal: saldoCredito });
      return;
    }

    await solicitarFormaRecebimento(t);
  };

  const confirmarBaixaComCredito = async (valorInformado = valorAbater) => {
    const t = modalConciliacao.transacao;
    if (!t || !currentUser || !tenantId) return;

    if (valorInformado <= 0) {
      fecharModalConciliacao();
      await solicitarFormaRecebimento(t);
      return;
    }

    const creditCents = toCents(valorInformado);
    const expectedTransactionCents = Number(t.valorCentavos ?? toCents(t.valor));
    if (
      creditCents <= 0 ||
      creditCents > toCents(modalConciliacao.saldoTotal) ||
      creditCents > expectedTransactionCents
    ) {
      showError('Erro', 'Valor de abatimento inválido.');
      return;
    }

    setIsProcessing(true);
    try {
      const transactionRef = doc(db, 'transacoes', t.id);
      const creditPaymentRef = doc(collection(db, 'transacoes'));
      const creditRefs = modalConciliacao.creditos.map((credit) => doc(db, 'creditos_cliente', credit.id));
      const paymentDate = getDateInputInTimeZone();

      let remainingCents = 0;
      await runTransaction(db, async (transaction) => {
        const transactionSnap = await transaction.get(transactionRef);
        if (!transactionSnap.exists()) throw new Error('Conta a receber não encontrada.');
        const transactionData = transactionSnap.data();
        if (transactionData.status !== 'Pendente') {
          throw new Error('Esta conta já foi processada ou cancelada.');
        }
        const currentTransactionCents = Number(transactionData.valorCentavos ?? toCents(transactionData.valor));
        if (currentTransactionCents !== expectedTransactionCents) {
          throw new Error('O saldo da conta foi alterado. Reabra a conciliação.');
        }

        const creditSnapshots = await Promise.all(creditRefs.map((creditRef) => transaction.get(creditRef)));
        const saleId = transactionData.pedidoId || t.pedidoId;
        const serviceOrderId = transactionData.osId || t.osId;
        const sourceRef = saleId
          ? doc(db, 'pedidos_venda', saleId)
          : serviceOrderId
            ? doc(db, 'ordens_de_servico', serviceOrderId)
            : null;
        const sourceSnap = sourceRef ? await transaction.get(sourceRef) : null;
        if (sourceSnap?.exists() && sourceSnap.data().status === 'Cancelada') {
          throw new Error(saleId ? 'A venda vinculada está cancelada.' : 'A OS vinculada está cancelada.');
        }

        let remainingCreditCents = creditCents;
        const creditUpdates: Array<{ ref: ReturnType<typeof doc>; balanceCents: number }> = [];
        creditSnapshots.forEach((creditSnap, index) => {
          if (remainingCreditCents <= 0 || !creditSnap.exists()) return;
          const creditData = creditSnap.data();
          if (creditData.tenantId !== tenantId || !['disponivel', 'usado_parcial'].includes(creditData.status)) return;
          const availableCents = Number(creditData.saldoDisponivelCentavos ?? toCents(creditData.saldoDisponivel));
          const usedCents = Math.min(availableCents, remainingCreditCents);
          if (usedCents <= 0) return;
          creditUpdates.push({ ref: creditRefs[index], balanceCents: availableCents - usedCents });
          remainingCreditCents -= usedCents;
        });
        if (remainingCreditCents > 0) {
          throw new Error('O saldo de crédito disponível foi alterado. Reabra a conciliação.');
        }

        remainingCents = currentTransactionCents - creditCents;
        creditUpdates.forEach(({ ref, balanceCents }) => {
          transaction.update(ref, {
            saldoDisponivelCentavos: balanceCents,
            saldoDisponivel: fromCents(balanceCents),
            status: balanceCents <= 0 ? 'esgotado' : 'usado_parcial',
            updatedAt: serverTimestamp(),
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Crédito usado na baixa'),
          });
        });

        const receiptTransactionId = remainingCents === 0 ? t.id : creditPaymentRef.id;
        if (remainingCents === 0) {
          transaction.update(transactionRef, {
            status: 'Paga',
            formaPagamentoOriginal: transactionData.formaPagamentoOriginal || transactionData.formaPagamento || null,
            formaPagamento: 'Crédito de Devolução',
            naturezaFinanceira: 'credito_cliente',
            movimentaCaixaFisico: false,
            dataPagamento: paymentDate,
            recebidoEm: serverTimestamp(),
            observacao: `Pagamento realizado utilizando ${fromCents(creditCents).toFixed(2)} em crédito do cliente.`,
            updatedAt: serverTimestamp(),
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Quitada com crédito de devolução'),
          });
        } else {
          transaction.update(transactionRef, {
            valorCentavos: remainingCents,
            valor: fromCents(remainingCents),
            observacao: `Abatimento de R$ ${fromCents(creditCents).toFixed(2)} em crédito; saldo pendente de R$ ${fromCents(remainingCents).toFixed(2)}.`,
            updatedAt: serverTimestamp(),
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Abatida parcialmente com crédito de devolução'),
          });
          transaction.set(creditPaymentRef, {
            descricao: `${transactionData.descricao || t.descricao} - Crédito de devolução`,
            categoria: transactionData.categoria || t.categoria,
            valorCentavos: creditCents,
            valor: fromCents(creditCents),
            tipo: 'entrada',
            status: 'Paga',
            formaPagamento: 'Crédito de Devolução',
            naturezaFinanceira: 'credito_cliente',
            movimentaCaixaFisico: false,
            data: paymentDate,
            dataPagamento: paymentDate,
            recebidoEm: serverTimestamp(),
            clienteNome: transactionData.clienteNome || t.clienteNome || null,
            pedidoId: saleId || null,
            osId: serviceOrderId || null,
            sourcePaymentTransactionId: t.id,
            idempotencyKey: `credito:${creditPaymentRef.id}`,
            tenantId,
            createdAt: serverTimestamp(),
            ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
          });
        }

        if (sourceRef && sourceSnap?.exists()) {
          const sourceData = sourceSnap.data();
          const payments: PaymentRecord[] = Array.isArray(sourceData.pagamentos) && sourceData.pagamentos.length > 0
            ? sourceData.pagamentos
            : [legacyPaymentForTransaction(t.id, transactionData)];
          const updatedPayments = applyPaymentReceipt(payments, {
            transactionId: t.id,
            paymentIndex: transactionData.paymentIndex,
            amountCents: creditCents,
            method: 'Crédito de Devolução',
            receiptId: receiptTransactionId,
            receivedAt: paymentDate,
          });
          const summary = summarizePayments(updatedPayments);
          transaction.update(sourceRef, {
            pagamentos: updatedPayments,
            totalRecebidoCentavos: summary.receivedCents,
            totalRecebido: summary.received,
            totalPendenteCentavos: summary.pendingCents,
            totalPendente: summary.pending,
            totalTaxasPagamentoCentavos: summary.cardFeeCents,
            totalTaxasPagamento: summary.cardFee,
            totalLiquidoFinanceiroCentavos: summary.financialNetCents,
            totalLiquidoFinanceiro: summary.financialNet,
            statusPagamento: summary.pendingCents === 0
              ? 'Paga'
              : summary.receivedCents > 0
                ? 'Parcial'
                : 'Pendente',
            updatedAt: serverTimestamp(),
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Baixa com crédito de devolução'),
          });
        }
      });

      showSuccess(remainingCents === 0
        ? 'Conta quitada com o crédito do cliente!'
        : `Crédito aplicado. Restam R$ ${fromCents(remainingCents).toFixed(2)} pendentes.`);
      fecharModalConciliacao();
    } catch (error) {
      console.error(error);
      showError('Erro', error instanceof Error ? error.message : 'Ocorreu um erro ao processar o abatimento.');
    } finally {
      setIsProcessing(false);
    }
  };

  const fecharModalConciliacao = () => {
    setModalConciliacao({ ativo: false, transacao: null, creditos: [], saldoTotal: 0 });
    setValorAbater(0);
  };

  const handleCobrarWhatsApp = (t: TransacaoData) => {
    const nomeCliente = t.clienteNome || 'Cliente';
    const valorMsg = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(t.valor));
    
    const mensagem = `Olá ${nomeCliente}. Gostaríamos de lembrar amigavelmente sobre uma pendência financeira referente à(o) ${t.descricao} no valor de ${valorMsg}. O acerto tempestivo é fundamental para mantermos nossa excelência no atendimento. Aguardamos o seu retorno e estamos à disposição para eventuais dúvidas.`;
    
    const url = `https://wa.me/?text=${encodeURIComponent(mensagem)}`;
    window.open(url, '_blank');
  };

  const hojeStr = getDateInputInTimeZone();
  const contasPendentes = transacoes.filter(t => (
    t.status === 'Pendente' &&
    t.formaPagamento !== 'Cartão de Crédito' &&
    t.formaPagamento !== 'Cartão de Débito'
  ));
  const recebimentosHoje = transacoes.filter(t => t.status === 'Paga' && t.dataPagamento === hojeStr);

  const totalPendente = contasPendentes.reduce((acc, curr) => acc + transactionNetAmount(curr), 0);
  const totalRecebidoHoje = recebimentosHoje.reduce((acc, curr) => acc + transactionNetAmount(curr), 0);

  // Agrupa as contas pendentes por cliente. Usa clienteId quando disponivel
  // (vendas/OS finalizadas a partir de 2026-07-29); registros antigos sem
  // clienteId agrupam pelo nome, sem garantia de que seja o mesmo cadastro.
  const gruposPorCliente: GrupoCliente[] = (() => {
    const mapa = new Map<string, GrupoCliente>();
    contasPendentes.forEach((t) => {
      const nome = t.clienteNome?.trim() || 'Cliente não identificado';
      const chave = t.clienteId ? `id:${t.clienteId}` : `nome:${nome.toUpperCase()}`;
      const dataRef = dataReferenciaTransacao(t);
      const diasAtraso = dataRef ? (differenceInCalendarDays(dataRef, hojeStr) ?? 0) : 0;

      let grupo = mapa.get(chave);
      if (!grupo) {
        grupo = {
          chave,
          clienteId: t.clienteId || null,
          clienteNome: nome,
          transacoes: [],
          totalPendente: 0,
          vencimentoMaisAntigo: null,
          diasAtrasoMax: 0,
        };
        mapa.set(chave, grupo);
      }
      grupo.transacoes.push(t);
      grupo.totalPendente += transactionNetAmount(t);
      if (dataRef && (!grupo.vencimentoMaisAntigo || dataRef < grupo.vencimentoMaisAntigo)) {
        grupo.vencimentoMaisAntigo = dataRef;
      }
      grupo.diasAtrasoMax = Math.max(grupo.diasAtrasoMax, diasAtraso);
    });

    return Array.from(mapa.values())
      .filter((g) => !buscaCliente.trim() || g.clienteNome.toLowerCase().includes(buscaCliente.trim().toLowerCase()))
      .sort((a, b) => b.totalPendente - a.totalPendente);
  })();

  const toggleClienteExpandido = (chave: string) => {
    setClientesExpandidos((current) => {
      const next = new Set(current);
      if (next.has(chave)) next.delete(chave);
      else next.add(chave);
      return next;
    });
  };

  const handleCobrarClienteWhatsApp = (grupo: GrupoCliente) => {
    const valorMsg = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(grupo.totalPendente);
    const qtd = grupo.transacoes.length;
    const mensagem = `Olá ${grupo.clienteNome}. Gostaríamos de lembrar amigavelmente sobre ${qtd === 1 ? 'uma pendência financeira' : `${qtd} pendências financeiras`} no valor total de ${valorMsg}. O acerto tempestivo é fundamental para mantermos nossa excelência no atendimento. Aguardamos o seu retorno e estamos à disposição para eventuais dúvidas.`;
    window.open(`https://wa.me/?text=${encodeURIComponent(mensagem)}`, '_blank');
  };

  return (
    <div className="financeiro-page" style={{ padding: '24px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700 }}>Contas a Receber</h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)' }}>Clientes com débito em aberto (Boleto, a Prazo) — cartão fica na tela Banco</p>
        </div>
        <div style={{ display: 'flex', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: 'rgba(16, 185, 129, 0.1)', padding: '12px 24px', borderRadius: 'var(--radius-lg)', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
            <Clock size={24} color="#10b981" />
            <div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Recebido Hoje</div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#10b981' }}>
                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalRecebidoHoje)}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: 'var(--bg-secondary)', padding: '12px 24px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)' }}>
            <Clock size={24} color="#f59e0b" />
            <div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Total a Receber</div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#f59e0b' }}>
                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalPendente)}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="search-bar" style={{ position: 'relative', maxWidth: '360px', marginBottom: '16px' }}>
        <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
        <input
          type="text"
          placeholder="Buscar cliente..."
          value={buscaCliente}
          onChange={(e) => setBuscaCliente(e.target.value)}
          style={{ width: '100%', padding: '10px 14px 10px 40px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
        />
      </div>

      <div className="card" style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
        <div className="table-wrapper">
          <table className="data-table financeiro-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                <th style={{ padding: '16px', width: '32px' }}></th>
                <th style={{ padding: '16px' }}>Cliente</th>
                <th style={{ padding: '16px', textAlign: 'center' }}>Títulos em aberto</th>
                <th style={{ padding: '16px' }}>Vencimento mais antigo</th>
                <th style={{ padding: '16px', textAlign: 'right' }}>Valor pendente (R$)</th>
                <th style={{ padding: '16px', textAlign: 'center' }}>Ação</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '20px' }}>Carregando contas a receber...</td>
                </tr>
              ) : gruposPorCliente.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                    <CheckCircle size={48} color="#10b981" style={{ margin: '0 auto 16px', opacity: 0.5 }} />
                    <div>{buscaCliente.trim() ? 'Nenhum cliente encontrado para essa busca.' : 'Nenhuma conta pendente para conciliação no momento.'}</div>
                  </td>
                </tr>
              ) : (
                gruposPorCliente.map((grupo) => {
                  const expandido = clientesExpandidos.has(grupo.chave);
                  const emAtraso = grupo.diasAtrasoMax > 0;
                  return (
                    <React.Fragment key={grupo.chave}>
                      <tr
                        onClick={() => toggleClienteExpandido(grupo.chave)}
                        style={{ borderBottom: expandido ? 'none' : '1px solid var(--border-color)', cursor: 'pointer', backgroundColor: expandido ? 'var(--bg-tertiary)' : 'transparent' }}
                      >
                        <td style={{ padding: '16px 0 16px 16px', color: 'var(--text-muted)' }}>
                          {expandido ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                        </td>
                        <td style={{ padding: '16px', fontWeight: 600 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <User size={16} style={{ color: 'var(--text-muted)' }} />
                            {grupo.clienteNome}
                          </div>
                        </td>
                        <td style={{ padding: '16px', textAlign: 'center', color: 'var(--text-secondary)' }}>{grupo.transacoes.length}</td>
                        <td style={{ padding: '16px' }}>
                          {grupo.vencimentoMaisAntigo ? (
                            <span style={{ color: emAtraso ? '#ef4444' : 'var(--text-secondary)', fontWeight: emAtraso ? 700 : 400 }}>
                              {grupo.vencimentoMaisAntigo.split('-').reverse().join('/')}
                              {emAtraso && ` (${grupo.diasAtrasoMax} ${grupo.diasAtrasoMax === 1 ? 'dia' : 'dias'} em atraso)`}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>-</span>
                          )}
                        </td>
                        <td style={{ padding: '16px', textAlign: 'right', fontWeight: 700, color: '#f59e0b' }}>
                          {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(grupo.totalPendente)}
                        </td>
                        <td style={{ padding: '16px', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => handleCobrarClienteWhatsApp(grupo)}
                            style={{ backgroundColor: '#25D366', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', borderRadius: '4px', padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '12px' }}
                            title="Cobrar via WhatsApp"
                          >
                            <MessageCircle size={14} /> Cobrar
                          </button>
                        </td>
                      </tr>
                      {expandido && (
                        <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td colSpan={6} style={{ padding: '0 16px 16px 48px', backgroundColor: 'var(--bg-tertiary)' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                              <thead>
                                <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                                  <th style={{ padding: '10px 8px', fontSize: '12px', color: 'var(--text-muted)' }}>Data</th>
                                  <th style={{ padding: '10px 8px', fontSize: '12px', color: 'var(--text-muted)' }}>Descrição / O.S</th>
                                  <th style={{ padding: '10px 8px', fontSize: '12px', color: 'var(--text-muted)' }}>Forma de Pgto.</th>
                                  <th style={{ padding: '10px 8px', fontSize: '12px', color: 'var(--text-muted)', textAlign: 'right' }}>Valor líquido (R$)</th>
                                  <th style={{ padding: '10px 8px', fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center' }}>Ação</th>
                                </tr>
                              </thead>
                              <tbody>
                                {grupo.transacoes.map((t) => (
                                  <tr key={t.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                    <td style={{ padding: '10px 8px', color: 'var(--text-muted)' }}>{t.data ? t.data.split('-').reverse().join('/') : new Date(t.createdAt?.seconds * 1000).toLocaleDateString('pt-BR')}</td>
                                    <td style={{ padding: '10px 8px', fontWeight: 500 }}>{t.descricao}</td>
                                    <td style={{ padding: '10px 8px' }}>
                                      <span style={{ fontSize: '12px', backgroundColor: 'var(--bg-secondary)', padding: '4px 8px', borderRadius: '4px', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}>
                                        {t.formaPagamento || 'Não informada'}
                                      </span>
                                    </td>
                                    <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 600, color: '#10b981' }}>
                                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(transactionNetAmount(t))}
                                    </td>
                                    <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                                        <button
                                          onClick={() => handleCobrarWhatsApp(t)}
                                          style={{ backgroundColor: '#25D366', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', borderRadius: '4px', padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '12px' }}
                                          title="Cobrar via WhatsApp"
                                        >
                                          <MessageCircle size={14} /> Cobrar
                                        </button>
                                        <button
                                          onClick={() => handleConciliar(t)}
                                          style={{ backgroundColor: '#10b981', border: 'none', color: 'white', cursor: 'pointer', borderRadius: '4px', padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '12px' }}
                                        >
                                          <CheckCircle size={14} /> Dar Baixa
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de Conciliação com Crédito */}
      {modalConciliacao.ativo && modalConciliacao.transacao && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
        }}>
          <div className="card" style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: '500px', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-primary)' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Wallet size={20} color="#8b5cf6" /> 
                Crédito Disponível
              </h2>
              <button onClick={fecharModalConciliacao} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={24} />
              </button>
            </div>
            
            <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ padding: '16px', backgroundColor: 'rgba(139, 92, 246, 0.1)', border: '1px solid rgba(139, 92, 246, 0.3)', borderRadius: '8px', color: '#8b5cf6', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <AlertCircle size={32} />
                <div>
                  <strong style={{ fontSize: '15px' }}>O cliente {modalConciliacao.transacao.clienteNome} possui R$ {modalConciliacao.saldoTotal.toFixed(2)} em créditos!</strong>
                  <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-secondary)' }}>Você pode usar esse saldo para abater o valor desta conta.</p>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', backgroundColor: 'var(--bg-tertiary)', padding: '16px', borderRadius: '8px' }}>
                <div>
                  <span style={{color: 'var(--text-muted)', fontSize: '12px'}}>Valor da Conta:</span><br/>
                  <strong style={{fontSize: '18px', color: '#ef4444'}}>R$ {modalConciliacao.transacao.valor.toFixed(2)}</strong>
                </div>
                <div>
                  <span style={{color: 'var(--text-muted)', fontSize: '12px'}}>Saldo de Crédito:</span><br/>
                  <strong style={{fontSize: '18px', color: '#8b5cf6'}}>R$ {modalConciliacao.saldoTotal.toFixed(2)}</strong>
                </div>
              </div>

              <div className="input-group">
                <label style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Quanto do crédito deseja utilizar?</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <input 
                    type="number"
                    min="0"
                    max={Math.min(modalConciliacao.transacao.valor, modalConciliacao.saldoTotal)}
                    step="0.01"
                    value={valorAbater}
                    onChange={(e) => setValorAbater(Number(e.target.value))}
                    style={{ flex: 1, padding: '12px', fontSize: '18px', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)' }}
                  />
                  <button 
                    type="button" 
                    className="btn-secondary" 
                    onClick={() => setValorAbater(Math.min(modalConciliacao.transacao?.valor || 0, modalConciliacao.saldoTotal))}
                    style={{ padding: '12px 16px', height: '100%' }}
                  >
                    Usar Máximo
                  </button>
                </div>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px', display: 'block' }}>
                  Restará R$ {Math.max(0, modalConciliacao.transacao.valor - valorAbater).toFixed(2)} pendente após o abatimento.
                </span>
              </div>
            </div>

            <div style={{ padding: '20px 24px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '12px', backgroundColor: 'var(--bg-primary)' }}>
              <button className="btn-secondary" onClick={() => void confirmarBaixaComCredito(0)}>Receber sem usar crédito</button>
              <button 
                className="btn-primary" 
                disabled={isProcessing}
                onClick={() => void confirmarBaixaComCredito()}
                style={{ backgroundColor: '#10b981', border: 'none', opacity: isProcessing ? 0.7 : 1 }}
              >
                {isProcessing ? 'Processando...' : 'Confirmar Baixa'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ContasReceber;
