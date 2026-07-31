import React, { useEffect, useState } from 'react';
import { collection, query, onSnapshot, where, doc, serverTimestamp, runTransaction } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError, NexusSwal } from '../../utils/alerts';
import { Landmark, CreditCard, CheckCircle, Calendar, Search, Clock } from 'lucide-react';
import {
  applyPaymentReceipt,
  fromCents,
  settledFinancialNatureForPayment,
  summarizePayments,
  toCents,
  transactionMovesPhysicalCash,
  transactionNetAmount,
  transactionNetCents,
  type PaymentMethod,
  type PaymentRecord,
} from '../../utils/financeDomain';
import { dateInputToUtcStart, getDateInputInTimeZone } from '../../utils/dateTime';
import { buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { useTenantCollection, type TenantCollectionItem } from '../../hooks/useTenantCollection';
import './Financeiro.css';

interface CartaoInfo {
  bandeira?: string;
  numero?: number;
  totalParcelas?: number;
  valorTaxaCentavos?: number;
  valorLiquidoCentavos?: number;
}

interface TransacaoData {
  id: string;
  data: string;
  descricao: string;
  categoria: string;
  valor: number;
  valorCentavos?: number;
  tipo: 'entrada' | 'saida';
  status: 'Paga' | 'Pendente' | 'Cancelada';
  formaPagamento?: string;
  osId?: string;
  pedidoId?: string;
  paymentIndex?: number;
  dataPagamento?: string;
  createdAt?: any;
  clienteNome?: string;
  movimentaCaixaFisico?: boolean;
  naturezaFinanceira?: string;
  dataPrevistaRecebimento?: string;
  cartao?: CartaoInfo | null;
  bancoId?: string;
  bancoNome?: string;
}

interface Banco extends TenantCollectionItem {
  nome: string;
  ativo: boolean;
  ordem: number;
  saldoCentavos: number;
}

const legacyPaymentForTransaction = (
  transactionId: string,
  transactionData: Record<string, any>,
): PaymentRecord => {
  const method = (transactionData.formaPagamento || 'Outros') as PaymentMethod;
  const valueCents = Number(transactionData.valorCentavos ?? toCents(transactionData.valor));
  return {
    id: transactionId,
    indice: Number(transactionData.paymentIndex || 1),
    formaPagamento: method,
    condicaoPagamento: 'avista',
    valorCentavos: valueCents,
    valor: fromCents(valueCents),
    status: 'pendente',
    naturezaFinanceira: 'contas_receber',
    movimentaCaixaFisico: false,
    transactionId,
  };
};

const transactionDate = (transaction: TransacaoData) => {
  if (transaction.dataPagamento) {
    const date = dateInputToUtcStart(transaction.dataPagamento);
    if (date) return date;
  }
  if (transaction.data) {
    const date = dateInputToUtcStart(transaction.data);
    if (date) return date;
  }
  if (transaction.createdAt?.toDate) return transaction.createdAt.toDate() as Date;
  if (transaction.createdAt?.seconds) return new Date(transaction.createdAt.seconds * 1000);
  return null;
};

const isCardMethod = (formaPagamento?: string) => (
  formaPagamento === 'Cartão de Crédito' || formaPagamento === 'Cartão de Débito'
);

const Banco: React.FC = () => {
  const [transacoes, setTransacoes] = useState<TransacaoData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [diasFiltro, setDiasFiltro] = useState<number>(30);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const { currentUser, tenantId } = useAuth();
  const { items: bancos } = useTenantCollection<Banco>('bancos', tenantId, { sortField: 'ordem' });
  const bancosAtivos = bancos.filter((b) => b.ativo);

  useEffect(() => {
    if (!currentUser) return;
    const q = query(collection(db, 'transacoes'), where('tenantId', '==', tenantId));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const data: TransacaoData[] = [];
      querySnapshot.forEach((docSnap) => {
        data.push({ id: docSnap.id, ...docSnap.data() } as TransacaoData);
      });
      data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setTransacoes(data);
      setLoading(false);
    }, (error) => {
      console.error('Erro ao buscar transações do Banco:', error);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [currentUser, tenantId]);

  const confirmarRecebimentoCartao = async (t: TransacaoData) => {
    if (!tenantId || !currentUser || processingId) return;

    let bancoId = t.bancoId;
    let bancoNome = t.bancoNome;
    if (!bancoId) {
      if (bancosAtivos.length === 0) {
        showError('Nenhum banco cadastrado', 'Cadastre um banco em Cadastros > Bancos antes de conciliar este título.');
        return;
      }
      const bancoResult = await NexusSwal.fire({
        title: 'Em qual banco caiu?',
        text: 'Esta venda não tem banco de destino definido (venda antiga). Selecione onde o valor caiu:',
        input: 'select',
        inputOptions: Object.fromEntries(bancosAtivos.map((b) => [b.id, b.nome])),
        inputPlaceholder: 'Selecione o banco',
        showCancelButton: true,
        confirmButtonText: 'Continuar',
        cancelButtonText: 'Cancelar',
        inputValidator: (value) => (value ? undefined : 'Selecione um banco.'),
      });
      if (!bancoResult.isConfirmed) return;
      bancoId = bancoResult.value as string;
      bancoNome = bancosAtivos.find((b) => b.id === bancoId)?.nome;
    }

    const confirmacao = await NexusSwal.fire({
      title: 'Confirmar recebimento no banco?',
      text: `Confirma que o valor líquido de R$ ${transactionNetAmount(t).toFixed(2)} referente a "${t.descricao}" caiu em "${bancoNome}"?`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sim, confirmar',
      cancelButtonText: 'Cancelar',
    });
    if (!confirmacao.isConfirmed) return;

    setProcessingId(t.id);
    const transactionRef = doc(db, 'transacoes', t.id);
    const bancoRef = doc(db, 'bancos', bancoId);
    const paymentDate = getDateInputInTimeZone();

    try {
      await runTransaction(db, async (transaction) => {
        const transactionSnap = await transaction.get(transactionRef);
        if (!transactionSnap.exists()) throw new Error('Título não encontrado.');
        const transactionData = transactionSnap.data();
        if (transactionData.status === 'Paga') return;
        if (transactionData.status === 'Cancelada') {
          throw new Error('Um título cancelado não pode ser conciliado.');
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

        const bancoSnap = await transaction.get(bancoRef);
        if (!bancoSnap.exists()) throw new Error('O banco selecionado não foi encontrado.');
        const bancoSaldoAtualCentavos = Number(bancoSnap.data().saldoCentavos || 0);

        const formaPgto = (transactionData.formaPagamento || t.formaPagamento) as PaymentMethod;
        const amountCents = Number(transactionData.valorCentavos ?? toCents(transactionData.valor));
        const settlementNature = settledFinancialNatureForPayment(formaPgto);
        const netCents = transactionNetCents(transactionData);

        transaction.update(transactionRef, {
          status: 'Paga',
          dataPagamento: paymentDate,
          naturezaFinanceira: settlementNature,
          movimentaCaixaFisico: false,
          bancoId,
          bancoNome: bancoNome || null,
          recebidoEm: serverTimestamp(),
          updatedAt: serverTimestamp(),
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Cartão conciliado no banco'),
        });

        transaction.update(bancoRef, {
          saldoCentavos: bancoSaldoAtualCentavos + netCents,
          updatedAt: serverTimestamp(),
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Recebimento de cartão conciliado'),
        });

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
              : summary.receivedCents > 0 ? 'Parcial' : 'Pendente',
            updatedAt: serverTimestamp(),
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Recebimento de cartão conciliado no banco'),
          });
        }
      });
      showSuccess('Recebimento conciliado com o banco!');
    } catch (error) {
      console.error('Erro ao conciliar recebimento de cartão:', error);
      showError('Erro', error instanceof Error ? error.message : 'Não foi possível confirmar o recebimento.');
    } finally {
      setProcessingId(null);
    }
  };

  const isWithinSelectedDays = (transaction: TransacaoData) => {
    if (diasFiltro === 0) return true;
    const date = transactionDate(transaction);
    if (!date) return true;
    const limit = new Date();
    limit.setDate(limit.getDate() - diasFiltro);
    return date >= limit;
  };

  const pendentesCartao = transacoes
    .filter((t) => t.status === 'Pendente' && isCardMethod(t.formaPagamento))
    .filter((t) => !searchTerm.trim() || `${t.descricao} ${t.clienteNome || ''}`.toLowerCase().includes(searchTerm.trim().toLowerCase()))
    .sort((a, b) => (a.dataPrevistaRecebimento || a.data || '').localeCompare(b.dataPrevistaRecebimento || b.data || ''));

  const totalPendenteCartao = pendentesCartao.reduce((acc, t) => acc + transactionNetAmount(t), 0);

  const extratoDigital = transacoes.filter((t) => (
    t.status === 'Paga' &&
    !transactionMovesPhysicalCash(t) &&
    t.formaPagamento !== 'Crédito de Devolução' &&
    isWithinSelectedDays(t)
  ));

  return (
    <div className="financeiro-page" style={{ padding: '24px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Landmark size={26} color="#37d7ff" />
            Banco
          </h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)' }}>
            Conciliação de cartão e extrato digital (Pix, Transferência, cartão de crédito/débito)
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {bancosAtivos.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: 'rgba(55, 215, 255, 0.1)', padding: '12px 24px', borderRadius: 'var(--radius-lg)', border: '1px solid rgba(55, 215, 255, 0.2)' }}>
              <CheckCircle size={24} color="#37d7ff" />
              <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Nenhum banco cadastrado ainda</div>
            </div>
          ) : (
            bancosAtivos.map((banco) => (
              <div key={banco.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: 'rgba(55, 215, 255, 0.1)', padding: '12px 24px', borderRadius: 'var(--radius-lg)', border: '1px solid rgba(55, 215, 255, 0.2)' }}>
                <CheckCircle size={24} color="#37d7ff" />
                <div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{banco.nome}</div>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: '#37d7ff' }}>
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(fromCents(banco.saldoCentavos || 0))}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="card" style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', padding: '24px', marginBottom: '24px' }}>
        <div className="section-header" style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CreditCard size={20} color="#f59e0b" />
            <h3 style={{ margin: 0 }}>Cartão pendente de conciliação</h3>
          </div>
          <div style={{ fontSize: '14px', color: '#f59e0b', fontWeight: 700 }}>
            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalPendenteCartao)}
          </div>
        </div>

        <div className="search-bar" style={{ position: 'relative', maxWidth: '360px', marginBottom: '16px' }}>
          <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Buscar por descrição ou cliente..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ width: '100%', padding: '10px 14px 10px 40px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
          />
        </div>

        <div className="table-wrapper">
          <table className="data-table financeiro-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                <th style={{ padding: '12px 8px' }}>Vencimento previsto</th>
                <th style={{ padding: '12px 8px' }}>Descrição</th>
                <th style={{ padding: '12px 8px' }}>Cliente</th>
                <th style={{ padding: '12px 8px' }}>Bandeira</th>
                <th style={{ padding: '12px 8px' }}>Banco</th>
                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Valor Bruto</th>
                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Taxa</th>
                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Valor Líquido</th>
                <th style={{ padding: '12px 8px', textAlign: 'center' }}>Ação</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: '20px' }}>Carregando...</td></tr>
              ) : pendentesCartao.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                    <CheckCircle size={40} color="#10b981" style={{ margin: '0 auto 12px', opacity: 0.5, display: 'block' }} />
                    Nenhum cartão pendente de conciliação no momento.
                  </td>
                </tr>
              ) : (
                pendentesCartao.map((t) => {
                  const vencimento = t.dataPrevistaRecebimento || t.data;
                  const parcelaLabel = t.cartao?.numero ? ` (${t.cartao.numero}/${t.cartao.totalParcelas})` : '';
                  return (
                    <tr key={t.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '10px 8px', color: 'var(--text-muted)' }}>{vencimento ? vencimento.split('-').reverse().join('/') : '-'}</td>
                      <td style={{ padding: '10px 8px', fontWeight: 500 }}>{t.descricao}{parcelaLabel}</td>
                      <td style={{ padding: '10px 8px' }}>{t.clienteNome || '-'}</td>
                      <td style={{ padding: '10px 8px' }}>{t.cartao?.bandeira || '-'}</td>
                      <td style={{ padding: '10px 8px' }}>{t.bancoNome || <span style={{ color: 'var(--text-muted)' }}>A definir</span>}</td>
                      <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(t.valor))}
                      </td>
                      <td style={{ padding: '10px 8px', textAlign: 'right', color: '#ef4444' }}>
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(fromCents(t.cartao?.valorTaxaCentavos || 0))}
                      </td>
                      <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 600, color: '#10b981' }}>
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(transactionNetAmount(t))}
                      </td>
                      <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                        <button
                          onClick={() => confirmarRecebimentoCartao(t)}
                          disabled={processingId === t.id}
                          style={{ backgroundColor: '#10b981', border: 'none', color: 'white', cursor: 'pointer', borderRadius: '4px', padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '12px', opacity: processingId === t.id ? 0.7 : 1 }}
                        >
                          <CheckCircle size={14} /> {processingId === t.id ? 'Confirmando...' : 'Confirmar no banco'}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card list-container" style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', padding: '24px' }}>
        <div className="list-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Clock size={20} color="#37d7ff" />
            <h3 style={{ margin: 0 }}>Extrato digital confirmado</h3>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <Calendar size={18} style={{ color: 'var(--text-muted)' }} />
            <select
              value={diasFiltro}
              onChange={(e) => setDiasFiltro(Number(e.target.value))}
              style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '8px 12px', borderRadius: 'var(--radius-md)' }}
            >
              <option value={7}>Últimos 7 dias</option>
              <option value={15}>Últimos 15 dias</option>
              <option value={30}>Últimos 30 dias</option>
              <option value={90}>Últimos 90 dias</option>
              <option value={0}>Todo o período</option>
            </select>
          </div>
        </div>

        <div className="table-wrapper">
          <table className="data-table financeiro-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                <th style={{ padding: '12px 8px' }}>Data</th>
                <th style={{ padding: '12px 8px' }}>Descrição</th>
                <th style={{ padding: '12px 8px' }}>Forma</th>
                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Valor (R$)</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: '20px' }}>Carregando...</td></tr>
              ) : extratoDigital.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>Nenhuma movimentação digital no período selecionado.</td></tr>
              ) : (
                extratoDigital.map((t) => (
                  <tr key={t.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '10px 8px', color: 'var(--text-muted)' }}>{t.data ? t.data.split('-').reverse().join('/') : '-'}</td>
                    <td style={{ padding: '10px 8px', fontWeight: 500 }}>{t.descricao}</td>
                    <td style={{ padding: '10px 8px' }}>
                      <span style={{ fontSize: '12px', backgroundColor: 'var(--bg-tertiary)', padding: '4px 8px', borderRadius: '4px', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}>
                        {t.formaPagamento || 'Não informada'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 600, color: t.tipo === 'entrada' ? '#10b981' : '#ef4444' }}>
                      {t.tipo === 'entrada' ? '+' : '-'} {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(transactionNetAmount(t))}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Banco;
