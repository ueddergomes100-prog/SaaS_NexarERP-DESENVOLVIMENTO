import React, { useEffect, useState } from 'react';
import { collection, query, onSnapshot, where, doc, serverTimestamp, runTransaction } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError, NexusSwal } from '../../utils/alerts';
import { FileCheck2, CheckCircle, AlertTriangle, Search } from 'lucide-react';
import {
  applyPaymentReceipt,
  fromCents,
  settledFinancialNatureForPayment,
  summarizePayments,
  toCents,
  transactionNetAmount,
  transactionNetCents,
  type ChequeDetails,
  type PaymentMethod,
  type PaymentRecord,
} from '../../utils/financeDomain';
import { differenceInCalendarDays, getDateInputInTimeZone } from '../../utils/dateTime';
import { buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { montarBaixaManual } from '../../utils/baixaFinanceiraDomain';
import { useTenantCollection, type TenantCollectionItem } from '../../hooks/useTenantCollection';
import {
  SITUACAO_TITULO_PADRAO,
  passaNaSituacaoTitulo,
  passaNoPeriodoDoTitulo,
  type SituacaoTitulo,
} from '../../utils/filtroListaDomain';
import { BotaoFiltros, CampoFiltro, CampoPeriodo, PainelFiltros, estiloCampoFiltro } from '../../components/common/PainelFiltros';
import './Financeiro.css';

const ROTULO_SITUACAO_CHEQUE: Record<SituacaoTitulo, string> = {
  abertas: 'A compensar',
  vencidas: 'Vencidos (a compensar)',
  pagas: 'Compensados',
  todas: 'Todos',
};

/**
 * Fila de cheques Pendentes aguardando compensação -- mesmo padrao de
 * "confirmar depois" que Banco.tsx ja usa pra cartao (confirmarRecebimentoCartao),
 * so trocando o filtro pra formaPagamento === 'Cheque' e usando os campos
 * do objeto `cheque` em vez de `cartao`. Nao credita banco na captura (venda
 * ou baixa em Contas a Receber) -- so aqui, quando compensa de verdade.
 */

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
  createdAt?: any;
  clienteNome?: string;
  fornecedorNome?: string;
  dataPrevistaRecebimento?: string;
  dataPagamento?: string;
  cheque?: ChequeDetails | null;
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

const DIAS_AVISO_VENCIMENTO = 3;

const Cheques: React.FC = () => {
  const [transacoes, setTransacoes] = useState<TransacaoData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [situacaoCheque, setSituacaoCheque] = useState<SituacaoTitulo>(SITUACAO_TITULO_PADRAO);
  const [periodoDe, setPeriodoDe] = useState('');
  const [periodoAte, setPeriodoAte] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);
  // Recebidos = cheque de cliente (entra no banco ao compensar). Emitidos = cheque que a
  // empresa deu para pagar despesa (sai do banco ao compensar).
  const [aba, setAba] = useState<'recebidos' | 'emitidos'>('recebidos');
  const { currentUser, tenantId } = useAuth();
  const { items: bancos } = useTenantCollection<Banco>('bancos', tenantId, { sortField: 'ordem' });
  const bancosAtivos = bancos.filter((b) => b.ativo);

  useEffect(() => {
    if (!currentUser) return;
    const q = query(
      collection(db, 'transacoes'),
      where('tenantId', '==', tenantId),
      where('formaPagamento', '==', 'Cheque'),
    );
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const data: TransacaoData[] = [];
      querySnapshot.forEach((docSnap) => {
        data.push({ id: docSnap.id, ...docSnap.data() } as TransacaoData);
      });
      data.sort((a, b) => (a.dataPrevistaRecebimento || a.data || '').localeCompare(b.dataPrevistaRecebimento || b.data || ''));
      setTransacoes(data);
      setLoading(false);
    }, (error) => {
      console.error('Erro ao buscar cheques:', error);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [currentUser, tenantId]);

  const confirmarCompensacao = async (t: TransacaoData) => {
    if (!tenantId || !currentUser || processingId) return;

    let bancoId = t.bancoId;
    let bancoNome = t.bancoNome;
    if (!bancoId) {
      if (bancosAtivos.length === 0) {
        showError('Nenhum banco cadastrado', 'Cadastre um banco em Cadastros > Bancos antes de compensar este cheque.');
        return;
      }
      const bancoResult = await NexusSwal.fire({
        title: 'Em qual banco compensou?',
        text: 'Este cheque não tem banco de destino definido. Selecione onde o valor caiu:',
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
      title: 'Confirmar compensação do cheque?',
      text: `Confirma que o cheque nº ${t.cheque?.numeroCheque || '-'} (R$ ${transactionNetAmount(t).toFixed(2)}, referente a "${t.descricao}") compensou em "${bancoNome}"?`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sim, compensou',
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
        if (!transactionSnap.exists()) throw new Error('Cheque não encontrado.');
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

        const amountCents = Number(transactionData.valorCentavos ?? toCents(transactionData.valor));
        const netCents = transactionNetCents(transactionData);
        const settlementNature = settledFinancialNatureForPayment('Cheque');

        transaction.update(transactionRef, {
          status: 'Paga',
          dataPagamento: paymentDate,
          naturezaFinanceira: settlementNature,
          movimentaCaixaFisico: false,
          bancoId,
          bancoNome: bancoNome || null,
          recebidoEm: serverTimestamp(),
          updatedAt: serverTimestamp(),
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Cheque compensado'),
        });

        transaction.update(bancoRef, {
          saldoCentavos: bancoSaldoAtualCentavos + netCents,
          updatedAt: serverTimestamp(),
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), `Compensação de cheque nº ${transactionData.cheque?.numeroCheque || ''}`),
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
            method: 'Cheque',
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
            statusPagamento: summary.pendingCents === 0
              ? 'Paga'
              : summary.receivedCents > 0 ? 'Parcial' : 'Pendente',
            updatedAt: serverTimestamp(),
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Cheque compensado'),
          });
        }
      });
      showSuccess('Cheque compensado! O valor já entrou no saldo do banco.');
    } catch (error) {
      console.error('Erro ao compensar cheque:', error);
      showError('Erro', error instanceof Error ? error.message : 'Não foi possível confirmar a compensação.');
    } finally {
      setProcessingId(null);
    }
  };

  /**
   * Cheque EMITIDO (a empresa deu para pagar despesa): a compensacao e' manual, aqui.
   * So' agora o banco e' debitado e o titulo vira Pago. A baixa usa a mesma marca do
   * "Dar Baixa" do Contas a Pagar, entao o estorno funciona igual.
   */
  const confirmarCompensacaoEmitido = async (t: TransacaoData) => {
    if (!tenantId || !currentUser || processingId) return;
    if (!t.bancoId) {
      showError('Banco do cheque não informado', 'Este cheque emitido não tem o banco da conta. Lance a despesa de novo informando o banco do cheque.');
      return;
    }
    const escolha = await NexusSwal.fire({
      title: 'Confirmar compensação do cheque?',
      html: `O cheque nº <strong>${t.cheque?.numeroCheque || '-'}</strong> (R$ ${transactionNetAmount(t).toFixed(2)}, "${t.descricao}") saiu do banco <strong>${t.bancoNome || ''}</strong>?<br/><br/>O valor será debitado do saldo do banco. Informe o dia em que compensou:`,
      icon: 'question',
      input: 'date',
      inputValue: getDateInputInTimeZone(),
      showCancelButton: true,
      confirmButtonText: 'Sim, compensou',
      cancelButtonText: 'Cancelar',
      inputValidator: (valor) => (/^\d{4}-\d{2}-\d{2}$/.test(String(valor || '')) ? undefined : 'Informe a data em que o cheque compensou.'),
    });
    if (!escolha.isConfirmed) return;
    const dataPagamento = String(escolha.value);
    const bancoId = t.bancoId;

    setProcessingId(t.id);
    try {
      await runTransaction(db, async (transaction) => {
        const transacaoRef = doc(db, 'transacoes', t.id);
        const bancoRef = doc(db, 'bancos', bancoId);
        const transacaoSnap = await transaction.get(transacaoRef);
        if (!transacaoSnap.exists()) throw new Error('Cheque não encontrado.');
        const dados = transacaoSnap.data();
        if (dados.status === 'Paga') return;
        if (dados.status === 'Cancelada') throw new Error('Um título cancelado não pode ser compensado.');
        const bancoSnap = await transaction.get(bancoRef);
        if (!bancoSnap.exists()) throw new Error('O banco do cheque não foi encontrado. Confira o cadastro de bancos.');
        const valorCentavos = Number(dados.valorCentavos ?? toCents(dados.valor));
        transaction.update(transacaoRef, {
          status: 'Paga',
          dataPagamento,
          valorCentavos,
          baixaManual: montarBaixaManual({
            origem: 'contas_pagar',
            formaPagamento: 'Cheque',
            dataPagamento,
            valorCentavos,
            bancoId,
            movimentoBancoCentavos: -valorCentavos,
          }),
          updatedAt: serverTimestamp(),
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Cheque emitido compensado'),
        });
        transaction.update(bancoRef, {
          saldoCentavos: Number(bancoSnap.data().saldoCentavos || 0) - valorCentavos,
          updatedAt: serverTimestamp(),
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), `Compensação do cheque nº ${dados.cheque?.numeroCheque || ''} (${dados.descricao || ''})`),
        });
      });
      showSuccess('Cheque compensado! O valor já saiu do saldo do banco.');
    } catch (error) {
      console.error('Erro ao compensar cheque emitido:', error);
      showError('Erro', error instanceof Error ? error.message : 'Não foi possível confirmar a compensação.');
    } finally {
      setProcessingId(null);
    }
  };

  const hojeStr = getDateInputInTimeZone();
  // Cada aba enxerga so' os seus: cheque de saida nunca cai na fila de recebimento (creditaria o banco).
  const transacoesDaAba = transacoes.filter((t) => (t.tipo === 'saida') === (aba === 'emitidos'));
  const chequesPendentes = transacoesDaAba
    .filter((t) => t.status === 'Pendente')
    .filter((t) => !searchTerm.trim() || `${t.descricao} ${t.clienteNome || t.fornecedorNome || ''} ${t.cheque?.numeroCheque || ''}`.toLowerCase().includes(searchTerm.trim().toLowerCase()));

  // O que a tabela mostra: situacao + periodo + busca. O total e o aviso de
  // vencimento acima olham so' os a compensar -- nao mudam com o filtro.
  const buscaTexto = searchTerm.trim().toLowerCase();
  const chequesLista = transacoesDaAba.filter((t) => {
    const titulo = { status: t.status, data: t.dataPrevistaRecebimento || t.data, dataPagamento: t.dataPagamento };
    return passaNaSituacaoTitulo(titulo, hojeStr, situacaoCheque)
      && passaNoPeriodoDoTitulo(titulo, situacaoCheque, periodoDe, periodoAte)
      && (!buscaTexto || `${t.descricao} ${t.clienteNome || t.fornecedorNome || ''} ${t.cheque?.numeroCheque || ''}`.toLowerCase().includes(buscaTexto));
  });
  const filtrosAtivos = (situacaoCheque !== SITUACAO_TITULO_PADRAO ? 1 : 0) + (periodoDe || periodoAte ? 1 : 0);
  const limparFiltros = () => {
    setSituacaoCheque(SITUACAO_TITULO_PADRAO);
    setPeriodoDe('');
    setPeriodoAte('');
  };

  const totalPendente = chequesPendentes.reduce((acc, t) => acc + transactionNetAmount(t), 0);
  const chequesVencendoEmBreve = chequesPendentes.filter((t) => {
    const dias = differenceInCalendarDays(hojeStr, t.dataPrevistaRecebimento || t.data);
    return dias !== null && dias <= DIAS_AVISO_VENCIMENTO;
  });

  return (
    <div className="financeiro-page" style={{ padding: '24px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px', alignItems: 'center' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700 }}>Cheques</h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)' }}>
            {aba === 'recebidos'
              ? 'Cheques recebidos aguardando compensação -- entram no banco só quando confirmados aqui'
              : 'Cheques emitidos para pagar despesas -- saem do banco só quando você confirma a compensação aqui'}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: 'rgba(139, 92, 246, 0.1)', padding: '12px 24px', borderRadius: 'var(--radius-lg)', border: '1px solid rgba(139, 92, 246, 0.2)' }}>
          <FileCheck2 size={24} color="#8b5cf6" />
          <div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{aba === 'recebidos' ? 'Total a compensar' : 'Total a sair do banco'}</div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: '#8b5cf6' }}>
              {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalPendente)}
            </div>
          </div>
        </div>
      </div>

      <div role="tablist" style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        {([['recebidos', 'Recebidos (de clientes)'], ['emitidos', 'Emitidos (para pagar despesas)']] as const).map(([chave, rotulo]) => (
          <button
            key={chave}
            type="button"
            role="tab"
            aria-selected={aba === chave}
            onClick={() => setAba(chave)}
            style={{ padding: '10px 18px', borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)', backgroundColor: aba === chave ? 'var(--accent-purple)' : 'var(--bg-secondary)' }}
          >
            {rotulo}
          </button>
        ))}
      </div>

      {chequesVencendoEmBreve.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: 'var(--radius-lg)', padding: '14px 20px', marginBottom: '16px', color: '#f59e0b' }}>
          <AlertTriangle size={20} />
          <span>
            <strong>{chequesVencendoEmBreve.length}</strong> cheque(s) vencendo nos próximos {DIAS_AVISO_VENCIMENTO} dias (ou já vencido(s)) -- confira e compense assim que possível.
          </span>
        </div>
      )}

      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div className="search-bar" style={{ position: 'relative', width: '360px', maxWidth: '100%' }}>
          <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Buscar cliente, descrição ou nº do cheque..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ width: '100%', padding: '10px 14px 10px 40px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
          />
        </div>
        <BotaoFiltros aberto={filtrosAbertos} onToggle={() => setFiltrosAbertos((v) => !v)} quantidadeAtiva={filtrosAtivos} />
      </div>
      <PainelFiltros aberto={filtrosAbertos} quantidadeAtiva={filtrosAtivos} onLimpar={limparFiltros}>
        <CampoFiltro rotulo="Situação">
          <select value={situacaoCheque} onChange={(e) => setSituacaoCheque(e.target.value as SituacaoTitulo)} style={estiloCampoFiltro}>
            {(Object.keys(ROTULO_SITUACAO_CHEQUE) as SituacaoTitulo[]).map((chave) => (
              <option key={chave} value={chave}>{ROTULO_SITUACAO_CHEQUE[chave]}</option>
            ))}
          </select>
        </CampoFiltro>
        <CampoPeriodo
          rotulo={situacaoCheque === 'pagas' ? 'Compensado em' : 'Compensação prevista'}
          de={periodoDe}
          ate={periodoAte}
          onChangeDe={setPeriodoDe}
          onChangeAte={setPeriodoAte}
        />
      </PainelFiltros>

      <div className="card" style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
        <div className="table-wrapper">
          <table className="data-table financeiro-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                <th style={{ padding: '16px' }}>{aba === 'recebidos' ? 'Cliente/Fornecedor' : 'Fornecedor'}</th>
                <th style={{ padding: '16px' }}>Descrição</th>
                <th style={{ padding: '16px' }}>{aba === 'recebidos' ? 'Banco emissor' : 'Banco da empresa'}</th>
                <th style={{ padding: '16px' }}>Nº cheque</th>
                <th style={{ padding: '16px' }}>Compensação prevista</th>
                <th style={{ padding: '16px', textAlign: 'right' }}>Valor (R$)</th>
                <th style={{ padding: '16px', textAlign: 'center' }}>Ação</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '20px' }}>Carregando cheques...</td>
                </tr>
              ) : chequesLista.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                    <CheckCircle size={48} color="#10b981" style={{ margin: '0 auto 16px', opacity: 0.5 }} />
                    <div>{searchTerm.trim() || filtrosAtivos > 0 ? 'Nenhum cheque encontrado com essa busca e esses filtros.' : (aba === 'recebidos' ? 'Nenhum cheque aguardando compensação no momento.' : 'Nenhum cheque emitido aguardando compensação. Eles nascem ao lançar uma despesa (ou uma nota de entrada) pagando em cheque.')}</div>
                  </td>
                </tr>
              ) : (
                chequesLista.map((t) => {
                  const dias = differenceInCalendarDays(hojeStr, t.dataPrevistaRecebimento || t.data);
                  const vencido = t.status === 'Pendente' && dias !== null && dias < 0;
                  const venceLogo = t.status === 'Pendente' && dias !== null && dias >= 0 && dias <= DIAS_AVISO_VENCIMENTO;
                  return (
                    <tr key={t.id} style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: vencido ? 'rgba(239, 68, 68, 0.06)' : venceLogo ? 'rgba(245, 158, 11, 0.06)' : undefined }}>
                      <td style={{ padding: '16px', fontWeight: 600 }}>{t.clienteNome || t.fornecedorNome || 'Não identificado'}</td>
                      <td style={{ padding: '16px' }}>{t.descricao}</td>
                      <td style={{ padding: '16px' }}>{t.tipo === 'saida' ? (t.bancoNome || t.cheque?.bancoEmissor || '-') : (t.cheque?.bancoEmissor || '-')}</td>
                      <td style={{ padding: '16px' }}>{t.cheque?.numeroCheque || '-'}</td>
                      <td style={{ padding: '16px' }}>
                        {t.dataPrevistaRecebimento ? (
                          <span style={{ color: vencido ? '#ef4444' : venceLogo ? '#f59e0b' : 'var(--text-secondary)', fontWeight: (vencido || venceLogo) ? 700 : 400 }}>
                            {t.dataPrevistaRecebimento.split('-').reverse().join('/')}
                            {vencido && ` (${Math.abs(dias!)} ${Math.abs(dias!) === 1 ? 'dia' : 'dias'} em atraso)`}
                            {!vencido && venceLogo && ` (em ${dias} ${dias === 1 ? 'dia' : 'dias'})`}
                          </span>
                        ) : '-'}
                      </td>
                      <td style={{ padding: '16px', textAlign: 'right', fontWeight: 700, color: '#8b5cf6' }}>
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(transactionNetAmount(t))}
                      </td>
                      <td style={{ padding: '16px', textAlign: 'center' }}>
                        {t.status === 'Paga' ? (
                          <span style={{ fontSize: '12px', color: '#10b981', fontWeight: 600 }}>
                            Compensado{t.dataPagamento ? ` em ${t.dataPagamento.split('-').reverse().join('/')}` : ''}
                          </span>
                        ) : (
                        <button
                          onClick={() => (t.tipo === 'saida' ? confirmarCompensacaoEmitido(t) : confirmarCompensacao(t))}
                          disabled={processingId === t.id}
                          style={{ backgroundColor: '#10b981', border: 'none', color: 'white', cursor: 'pointer', borderRadius: '4px', padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '12px', opacity: processingId === t.id ? 0.6 : 1 }}
                        >
                          <CheckCircle size={14} /> {processingId === t.id ? 'Confirmando...' : 'Confirmar compensação'}
                        </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Cheques;
