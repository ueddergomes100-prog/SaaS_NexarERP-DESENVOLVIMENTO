import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { Search, Plus, Building2, Edit, Trash2, X, Loader2, AlertTriangle, History, ArrowLeftRight } from 'lucide-react';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { confirmDelete, showSuccess, showError, NexusSwal } from '../../utils/alerts';
import { hasModuleAccess } from '../../utils/roles';
import { useTenantCollection, type TenantCollectionItem } from '../../hooks/useTenantCollection';
import { fromCents, toCents, validateBankTransfer } from '../../utils/financeDomain';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { useEscapeLayer, useKeyboardShortcuts } from '../../hooks/useKeyboardFlow';
import '../OS/OS.css';

interface Banco extends TenantCollectionItem {
  nome: string;
  banco?: string;
  agencia?: string;
  conta?: string;
  tipoConta?: 'corrente' | 'poupanca' | 'outro';
  saldoInicialCentavos: number;
  saldoCentavos: number;
  ativo: boolean;
  ordem: number;
}

interface LancamentoBancario extends TenantCollectionItem {
  bancoId: string;
  bancoNome: string;
  tipo: 'ajuste' | 'tarifa' | 'transferencia_entrada' | 'transferencia_saida' | 'saldo_inicial';
  direcao: 'credito' | 'debito';
  valorCentavos: number;
  descricao: string;
  data: string;
  transferenciaParId?: string;
  createdAt?: any;
}

const REQUIRED_PERMISSION = 'cadastros.bancos';

const formatBRL = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const emptyBankForm = () => ({
  nome: '',
  banco: '',
  agencia: '',
  conta: '',
  tipoConta: 'corrente' as Banco['tipoConta'],
  ativo: true,
  ordem: 1,
  saldoInicial: '0,00',
});

const emptyLancamentoForm = () => ({
  tipo: 'ajuste' as 'ajuste' | 'tarifa',
  direcao: 'credito' as 'credito' | 'debito',
  valor: '0,00',
  descricao: '',
  data: getDateInputInTimeZone(),
});

const emptyTransferForm = () => ({
  destinoId: '',
  valor: '0,00',
  descricao: '',
  data: getDateInputInTimeZone(),
});

const BancosList: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser, tenantId, userRole, userPermissions, isOwner } = useAuth();
  const canAccess = hasModuleAccess({
    role: userRole,
    isOwner,
    permissions: userPermissions,
    requiredPermission: REQUIRED_PERMISSION,
  });

  const { items: bancos, loading } = useTenantCollection<Banco>('bancos', tenantId, {
    sortField: 'ordem',
    enabled: canAccess,
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [modalForm, setModalForm] = useState(emptyBankForm());
  const [modalLoading, setModalLoading] = useState(false);

  const [ledgerBanco, setLedgerBanco] = useState<Banco | null>(null);
  const [lancamentos, setLancamentos] = useState<LancamentoBancario[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [lancamentoForm, setLancamentoForm] = useState(emptyLancamentoForm());
  const [isSavingLancamento, setIsSavingLancamento] = useState(false);
  const [transferForm, setTransferForm] = useState(emptyTransferForm());
  const [isTransferMode, setIsTransferMode] = useState(false);
  const [isSavingTransfer, setIsSavingTransfer] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEscapeLayer(isModalOpen, () => closeModal());
  useEscapeLayer(!!ledgerBanco, () => closeLedger());
  useKeyboardShortcuts([
    { key: 'F2', handler: () => searchInputRef.current?.focus() },
    { key: 'F6', handler: () => openNewModal() },
  ]);

  useEffect(() => {
    if (!ledgerBanco || !tenantId) {
      setLancamentos([]);
      return undefined;
    }
    setLedgerLoading(true);
    const q = query(
      collection(db, 'lancamentos_bancarios'),
      where('tenantId', '==', tenantId),
      where('bancoId', '==', ledgerBanco.id),
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }) as LancamentoBancario);
      data.sort((a, b) => (b.data || '').localeCompare(a.data || ''));
      setLancamentos(data);
      setLedgerLoading(false);
    }, () => setLedgerLoading(false));
    return () => unsubscribe();
  }, [ledgerBanco, tenantId]);

  const openNewModal = () => {
    setEditingId(null);
    setModalForm({ ...emptyBankForm(), ordem: bancos.length + 1 });
    setIsModalOpen(true);
  };

  const openEditModal = (banco: Banco) => {
    setEditingId(banco.id);
    setModalForm({
      nome: banco.nome,
      banco: banco.banco || '',
      agencia: banco.agencia || '',
      conta: banco.conta || '',
      tipoConta: banco.tipoConta || 'corrente',
      ativo: banco.ativo,
      ordem: banco.ordem,
      saldoInicial: fromCents(banco.saldoInicialCentavos || 0).toFixed(2).replace('.', ','),
    });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalForm.nome.trim()) {
      showError('Erro', 'Informe o nome do banco.');
      return;
    }
    if (!currentUser) return;

    setModalLoading(true);
    try {
      if (editingId) {
        await updateDoc(doc(db, 'bancos', editingId), {
          nome: modalForm.nome.trim(),
          banco: modalForm.banco.trim(),
          agencia: modalForm.agencia.trim(),
          conta: modalForm.conta.trim(),
          tipoConta: modalForm.tipoConta,
          ativo: modalForm.ativo,
          ordem: Number(modalForm.ordem) || 0,
          updatedAt: serverTimestamp(),
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp()),
        });
        showSuccess('Banco atualizado!');
      } else {
        const saldoInicialCentavos = toCents(modalForm.saldoInicial);
        const novoBancoRef = await addDoc(collection(db, 'bancos'), {
          nome: modalForm.nome.trim(),
          banco: modalForm.banco.trim(),
          agencia: modalForm.agencia.trim(),
          conta: modalForm.conta.trim(),
          tipoConta: modalForm.tipoConta,
          ativo: modalForm.ativo,
          ordem: Number(modalForm.ordem) || 0,
          saldoInicialCentavos,
          saldoCentavos: saldoInicialCentavos,
          tenantId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
        });
        if (saldoInicialCentavos !== 0) {
          await addDoc(collection(db, 'lancamentos_bancarios'), {
            tenantId,
            bancoId: novoBancoRef.id,
            bancoNome: modalForm.nome.trim(),
            tipo: 'saldo_inicial',
            direcao: saldoInicialCentavos >= 0 ? 'credito' : 'debito',
            valorCentavos: Math.abs(saldoInicialCentavos),
            descricao: 'Saldo inicial no cadastro',
            data: getDateInputInTimeZone(),
            createdBy: currentUser?.uid || null,
            createdAt: serverTimestamp(),
          });
        }
        showSuccess('Banco cadastrado!');
      }
      closeModal();
    } catch (error) {
      console.error(error);
      showError('Erro', 'Não foi possível salvar o banco.');
    } finally {
      setModalLoading(false);
    }
  };

  const handleDelete = async (banco: Banco) => {
    if ((banco.saldoCentavos || 0) !== 0) {
      showError('Não é possível excluir', 'Este banco tem saldo diferente de zero. Faça uma transferência ou ajuste para zerar o saldo antes de excluir.');
      return;
    }
    const isConfirmed = await confirmDelete(`o banco (${banco.nome})`);
    if (!isConfirmed) return;

    try {
      await deleteDoc(doc(db, 'bancos', banco.id));
      showSuccess('Banco excluído!');
    } catch (error) {
      console.error(error);
      showError('Erro', 'Não foi possível excluir o banco.');
    }
  };

  const openLedger = (banco: Banco) => {
    setLedgerBanco(banco);
    setLancamentoForm(emptyLancamentoForm());
    setTransferForm(emptyTransferForm());
    setIsTransferMode(false);
  };

  const closeLedger = () => {
    setLedgerBanco(null);
    setLancamentos([]);
  };

  const handleSaveLancamento = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ledgerBanco || !currentUser) return;

    const valorCentavos = toCents(lancamentoForm.valor);
    if (!Number.isInteger(valorCentavos) || valorCentavos <= 0) {
      showError('Erro', 'Informe um valor maior que zero.');
      return;
    }
    if (!lancamentoForm.descricao.trim()) {
      showError('Erro', 'Informe uma descrição para o lançamento.');
      return;
    }

    setIsSavingLancamento(true);
    const bancoRef = doc(db, 'bancos', ledgerBanco.id);
    try {
      await runTransaction(db, async (transaction) => {
        const bancoSnap = await transaction.get(bancoRef);
        if (!bancoSnap.exists()) throw new Error('Banco não encontrado.');

        const currentCents = Number(bancoSnap.data().saldoCentavos || 0);
        const delta = lancamentoForm.direcao === 'credito' ? valorCentavos : -valorCentavos;

        const ledgerRef = doc(collection(db, 'lancamentos_bancarios'));
        transaction.set(ledgerRef, {
          tenantId,
          bancoId: ledgerBanco.id,
          bancoNome: ledgerBanco.nome,
          tipo: lancamentoForm.tipo,
          direcao: lancamentoForm.direcao,
          valorCentavos,
          descricao: lancamentoForm.descricao.trim(),
          data: lancamentoForm.data,
          createdBy: currentUser?.uid || null,
          createdAt: serverTimestamp(),
        });
        transaction.update(bancoRef, {
          saldoCentavos: currentCents + delta,
          updatedAt: serverTimestamp(),
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Lançamento manual registrado'),
        });
      });
      showSuccess('Lançamento registrado!');
      setLancamentoForm(emptyLancamentoForm());
    } catch (error) {
      console.error(error);
      showError('Erro', error instanceof Error ? error.message : 'Não foi possível registrar o lançamento.');
    } finally {
      setIsSavingLancamento(false);
    }
  };

  const handleSaveTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ledgerBanco || !currentUser) return;

    const destino = bancos.find((b) => b.id === transferForm.destinoId);
    const valorCentavos = toCents(transferForm.valor);

    try {
      validateBankTransfer({ originId: ledgerBanco.id, destinationId: transferForm.destinoId, amountCents: valorCentavos });
    } catch (error) {
      showError('Erro', error instanceof Error ? error.message : 'Transferência inválida.');
      return;
    }
    if (!destino) {
      showError('Erro', 'Selecione o banco de destino.');
      return;
    }

    const confirmacao = await NexusSwal.fire({
      title: 'Confirmar transferência?',
      text: `Transferir ${formatBRL(fromCents(valorCentavos))} de "${ledgerBanco.nome}" para "${destino.nome}"?`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sim, transferir',
      cancelButtonText: 'Cancelar',
    });
    if (!confirmacao.isConfirmed) return;

    setIsSavingTransfer(true);
    const originRef = doc(db, 'bancos', ledgerBanco.id);
    const destinationRef = doc(db, 'bancos', destino.id);
    try {
      await runTransaction(db, async (transaction) => {
        const originSnap = await transaction.get(originRef);
        const destinationSnap = await transaction.get(destinationRef);
        if (!originSnap.exists() || !destinationSnap.exists()) {
          throw new Error('Banco de origem ou destino não encontrado.');
        }

        const originCents = Number(originSnap.data().saldoCentavos || 0);
        const destinationCents = Number(destinationSnap.data().saldoCentavos || 0);

        const outRef = doc(collection(db, 'lancamentos_bancarios'));
        const inRef = doc(collection(db, 'lancamentos_bancarios'));
        const descricao = transferForm.descricao.trim() || `Transferência para ${destino.nome}`;

        transaction.set(outRef, {
          tenantId,
          bancoId: ledgerBanco.id,
          bancoNome: ledgerBanco.nome,
          tipo: 'transferencia_saida',
          direcao: 'debito',
          valorCentavos,
          descricao,
          data: transferForm.data,
          transferenciaParId: inRef.id,
          createdBy: currentUser?.uid || null,
          createdAt: serverTimestamp(),
        });
        transaction.set(inRef, {
          tenantId,
          bancoId: destino.id,
          bancoNome: destino.nome,
          tipo: 'transferencia_entrada',
          direcao: 'credito',
          valorCentavos,
          descricao: transferForm.descricao.trim() || `Transferência de ${ledgerBanco.nome}`,
          data: transferForm.data,
          transferenciaParId: outRef.id,
          createdBy: currentUser?.uid || null,
          createdAt: serverTimestamp(),
        });
        transaction.update(originRef, {
          saldoCentavos: originCents - valorCentavos,
          updatedAt: serverTimestamp(),
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), `Transferência para ${destino.nome}`),
        });
        transaction.update(destinationRef, {
          saldoCentavos: destinationCents + valorCentavos,
          updatedAt: serverTimestamp(),
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), `Transferência de ${ledgerBanco.nome}`),
        });
      });
      showSuccess('Transferência realizada!');
      setTransferForm(emptyTransferForm());
      setIsTransferMode(false);
    } catch (error) {
      console.error(error);
      showError('Erro', error instanceof Error ? error.message : 'Não foi possível realizar a transferência.');
    } finally {
      setIsSavingTransfer(false);
    }
  };

  const filteredBancos = bancos.filter((b) => b.nome.toLowerCase().includes(searchTerm.toLowerCase()));
  const ledgerBancoAtual = ledgerBanco ? bancos.find((b) => b.id === ledgerBanco.id) || ledgerBanco : null;
  const outrosBancosAtivos = bancos.filter((b) => b.ativo && b.id !== ledgerBanco?.id);

  const lancamentoTipoLabel: Record<LancamentoBancario['tipo'], string> = {
    ajuste: 'Ajuste',
    tarifa: 'Tarifa',
    transferencia_entrada: 'Transferência recebida',
    transferencia_saida: 'Transferência enviada',
    saldo_inicial: 'Saldo inicial',
  };

  if (!canAccess) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', padding: '20px', borderRadius: '50%', backgroundColor: 'rgba(239, 68, 68, 0.1)', marginBottom: '20px' }}>
          <AlertTriangle size={48} color="#ef4444" />
        </div>
        <h2 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '12px', color: 'var(--text-primary)' }}>Acesso Negado</h2>
        <p style={{ color: 'var(--text-muted)', maxWidth: '500px', margin: '0 auto 24px' }}>
          Você não possui permissão para gerenciar os bancos da empresa. Solicite ao administrador para liberar o módulo "Cadastros: Bancos".
        </p>
        <button className="btn-primary" onClick={() => navigate('/dashboard')}>
          Ir para o Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>Bancos</h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)' }}>Contas bancárias da empresa, saldo e lançamentos</p>
        </div>
        <button className="btn-primary" onClick={openNewModal} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Plus size={18} /> Novo Banco
        </button>
      </div>

      <div className="card list-container" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div className="list-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
          <div className="search-box" style={{ position: 'relative', width: '350px' }}>
            <Search size={18} style={{ position: 'absolute', left: '12px', top: '10px', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Buscar banco..."
              ref={searchInputRef}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: '100%', padding: '10px 16px 10px 40px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
            />
          </div>
          <div className="shortcuts-hint">
            <span><kbd>F2</kbd> Buscar</span>
            <span><kbd>F6</kbd> Novo</span>
            <span><kbd>Esc</kbd> Fechar</span>
          </div>
        </div>

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Instituição</th>
                <th>Agência / Conta</th>
                <th style={{ textAlign: 'right' }}>Saldo</th>
                <th style={{ width: '15%' }}>Status</th>
                <th style={{ width: '15%' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: '20px' }}>Carregando...</td></tr>
              ) : filteredBancos.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                    <Building2 size={48} style={{ margin: '0 auto 16px', opacity: 0.2 }} />
                    <p>Nenhum banco cadastrado.</p>
                  </td>
                </tr>
              ) : (
                filteredBancos.map((banco) => (
                  <tr key={banco.id}>
                    <td className="font-medium">{banco.nome}</td>
                    <td>{banco.banco || '-'}</td>
                    <td>{banco.agencia || '-'} / {banco.conta || '-'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600, color: (banco.saldoCentavos || 0) >= 0 ? '#10b981' : '#ef4444' }}>
                      {formatBRL(fromCents(banco.saldoCentavos || 0))}
                    </td>
                    <td>
                      <span className="status-badge" style={{
                        backgroundColor: banco.ativo ? '#10b98120' : 'rgba(255,255,255,0.05)',
                        color: banco.ativo ? '#10b981' : 'var(--text-muted)',
                      }}>
                        {banco.ativo ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="icon-btn" title="Editar" onClick={() => openEditModal(banco)}>
                          <Edit size={16} />
                        </button>
                        <button className="icon-btn" title="Lançamentos" style={{ color: '#37d7ff' }} onClick={() => openLedger(banco)}>
                          <History size={16} />
                        </button>
                        <button className="icon-btn" title="Excluir" style={{ color: '#ef4444' }} onClick={() => handleDelete(banco)}>
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999, padding: '20px',
        }}>
          <div style={{
            width: '100%', maxWidth: '480px', backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)',
            padding: '24px', position: 'relative', boxShadow: 'var(--shadow-card)',
            animation: 'pageFadeIn 0.2s ease-out',
          }}>
            <button
              onClick={closeModal}
              style={{ position: 'absolute', top: '16px', right: '16px', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              <X size={20} />
            </button>

            <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Building2 size={20} color="#37d7ff" />
              {editingId ? 'Editar Banco' : 'Novo Banco'}
            </h3>

            <form onSubmit={handleSave}>
              <div className="input-group" style={{ marginBottom: '16px' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Nome / Apelido *</label>
                <input
                  type="text"
                  placeholder="Ex: Conta principal, Nubank PJ"
                  value={modalForm.nome}
                  onChange={(e) => setModalForm({ ...modalForm, nome: e.target.value })}
                  required
                  style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 14px', color: 'var(--text-primary)' }}
                />
              </div>

              <div className="input-group" style={{ marginBottom: '16px' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Instituição</label>
                <input
                  type="text"
                  placeholder="Ex: Itaú, Nubank, Bradesco"
                  value={modalForm.banco}
                  onChange={(e) => setModalForm({ ...modalForm, banco: e.target.value })}
                  style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 14px', color: 'var(--text-primary)' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                <div className="input-group">
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Agência</label>
                  <input
                    type="text"
                    value={modalForm.agencia}
                    onChange={(e) => setModalForm({ ...modalForm, agencia: e.target.value })}
                    style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 14px', color: 'var(--text-primary)' }}
                  />
                </div>
                <div className="input-group">
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Conta</label>
                  <input
                    type="text"
                    value={modalForm.conta}
                    onChange={(e) => setModalForm({ ...modalForm, conta: e.target.value })}
                    style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 14px', color: 'var(--text-primary)' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                <div className="input-group">
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Tipo de conta</label>
                  <select
                    value={modalForm.tipoConta}
                    onChange={(e) => setModalForm({ ...modalForm, tipoConta: e.target.value as Banco['tipoConta'] })}
                    style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 14px', color: 'var(--text-primary)' }}
                  >
                    <option value="corrente">Conta Corrente</option>
                    <option value="poupanca">Poupança</option>
                    <option value="outro">Outro</option>
                  </select>
                </div>
                <div className="input-group">
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Ordem de exibição</label>
                  <input
                    type="number"
                    min="1"
                    value={modalForm.ordem}
                    onChange={(e) => setModalForm({ ...modalForm, ordem: Number(e.target.value) })}
                    style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 14px', color: 'var(--text-primary)' }}
                  />
                </div>
              </div>

              {!editingId && (
                <div className="input-group" style={{ marginBottom: '16px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Saldo inicial (R$)</label>
                  <input
                    type="text"
                    value={modalForm.saldoInicial}
                    onChange={(e) => setModalForm({ ...modalForm, saldoInicial: e.target.value })}
                    style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 14px', color: 'var(--text-primary)' }}
                  />
                </div>
              )}
              {editingId && (
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 16px' }}>
                  O saldo é ajustado por lançamentos/transferências (ícone de histórico na lista), não é editável aqui.
                </p>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px', marginBottom: '24px' }}>
                <input
                  type="checkbox"
                  id="bancoAtivo"
                  checked={modalForm.ativo}
                  onChange={(e) => setModalForm({ ...modalForm, ativo: e.target.checked })}
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                />
                <label htmlFor="bancoAtivo" style={{ cursor: 'pointer', fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}>
                  Ativo (disponível para seleção em novas vendas)
                </label>
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                <button type="button" className="btn-secondary" onClick={closeModal} disabled={modalLoading}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary" disabled={modalLoading} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {modalLoading && <Loader2 size={16} className="spin-icon" />}
                  {modalLoading ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {ledgerBancoAtual && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999, padding: '20px',
        }}>
          <div style={{
            width: '100%', maxWidth: '680px', backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)',
            padding: '24px', position: 'relative', boxShadow: 'var(--shadow-card)',
            animation: 'pageFadeIn 0.2s ease-out', maxHeight: '90vh', overflowY: 'auto',
          }}>
            <button
              onClick={closeLedger}
              style={{ position: 'absolute', top: '16px', right: '16px', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              <X size={20} />
            </button>

            <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <History size={20} color="#37d7ff" />
              Lançamentos — {ledgerBancoAtual.nome}
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '20px' }}>
              Saldo atual: <strong style={{ color: 'var(--text-primary)' }}>{formatBRL(fromCents(ledgerBancoAtual.saldoCentavos || 0))}</strong>
            </p>

            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
              <button
                type="button"
                className={isTransferMode ? 'btn-secondary' : 'btn-primary'}
                onClick={() => setIsTransferMode(false)}
                style={{ fontSize: '13px' }}
              >
                Novo lançamento
              </button>
              <button
                type="button"
                className={isTransferMode ? 'btn-primary' : 'btn-secondary'}
                onClick={() => setIsTransferMode(true)}
                style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <ArrowLeftRight size={14} /> Transferência entre bancos
              </button>
            </div>

            {!isTransferMode ? (
              <form onSubmit={handleSaveLancamento} style={{ marginBottom: '24px', padding: '16px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                  <div className="input-group">
                    <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Tipo</label>
                    <select
                      value={lancamentoForm.tipo}
                      onChange={(e) => setLancamentoForm({ ...lancamentoForm, tipo: e.target.value as 'ajuste' | 'tarifa' })}
                      style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}
                    >
                      <option value="ajuste">Ajuste de saldo</option>
                      <option value="tarifa">Tarifa bancária</option>
                    </select>
                  </div>
                  <div className="input-group">
                    <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Direção</label>
                    <select
                      value={lancamentoForm.direcao}
                      onChange={(e) => setLancamentoForm({ ...lancamentoForm, direcao: e.target.value as 'credito' | 'debito' })}
                      style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}
                    >
                      <option value="credito">Crédito (+ saldo)</option>
                      <option value="debito">Débito (- saldo)</option>
                    </select>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                  <div className="input-group">
                    <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Valor (R$)</label>
                    <input
                      type="text"
                      value={lancamentoForm.valor}
                      onChange={(e) => setLancamentoForm({ ...lancamentoForm, valor: e.target.value })}
                      style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}
                    />
                  </div>
                  <div className="input-group">
                    <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Data</label>
                    <input
                      type="date"
                      value={lancamentoForm.data}
                      onChange={(e) => setLancamentoForm({ ...lancamentoForm, data: e.target.value })}
                      style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}
                    />
                  </div>
                </div>
                <div className="input-group" style={{ marginBottom: '12px' }}>
                  <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Descrição *</label>
                  <input
                    type="text"
                    placeholder="Ex: Tarifa de manutenção de conta"
                    value={lancamentoForm.descricao}
                    onChange={(e) => setLancamentoForm({ ...lancamentoForm, descricao: e.target.value })}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}
                  />
                </div>
                <button type="submit" className="btn-primary" disabled={isSavingLancamento} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {isSavingLancamento && <Loader2 size={16} className="spin-icon" />}
                  {isSavingLancamento ? 'Salvando...' : 'Registrar lançamento'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleSaveTransfer} style={{ marginBottom: '24px', padding: '16px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
                <div className="input-group" style={{ marginBottom: '12px' }}>
                  <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Transferir desta conta para</label>
                  <select
                    value={transferForm.destinoId}
                    onChange={(e) => setTransferForm({ ...transferForm, destinoId: e.target.value })}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}
                  >
                    <option value="">Selecione o banco de destino</option>
                    {outrosBancosAtivos.map((b) => (
                      <option key={b.id} value={b.id}>{b.nome}</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                  <div className="input-group">
                    <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Valor (R$)</label>
                    <input
                      type="text"
                      value={transferForm.valor}
                      onChange={(e) => setTransferForm({ ...transferForm, valor: e.target.value })}
                      style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}
                    />
                  </div>
                  <div className="input-group">
                    <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Data</label>
                    <input
                      type="date"
                      value={transferForm.data}
                      onChange={(e) => setTransferForm({ ...transferForm, data: e.target.value })}
                      style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}
                    />
                  </div>
                </div>
                <div className="input-group" style={{ marginBottom: '12px' }}>
                  <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Descrição (opcional)</label>
                  <input
                    type="text"
                    value={transferForm.descricao}
                    onChange={(e) => setTransferForm({ ...transferForm, descricao: e.target.value })}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}
                  />
                </div>
                <button type="submit" className="btn-primary" disabled={isSavingTransfer} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {isSavingTransfer && <Loader2 size={16} className="spin-icon" />}
                  {isSavingTransfer ? 'Transferindo...' : 'Confirmar transferência'}
                </button>
              </form>
            )}

            <h4 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '10px' }}>Histórico</h4>
            <div className="table-wrapper">
              <table className="data-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Tipo</th>
                    <th>Descrição</th>
                    <th style={{ textAlign: 'right' }}>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgerLoading ? (
                    <tr><td colSpan={4} style={{ textAlign: 'center', padding: '16px' }}>Carregando...</td></tr>
                  ) : lancamentos.length === 0 ? (
                    <tr><td colSpan={4} style={{ textAlign: 'center', padding: '16px', color: 'var(--text-muted)' }}>Nenhum lançamento manual registrado.</td></tr>
                  ) : (
                    lancamentos.map((l) => (
                      <tr key={l.id}>
                        <td style={{ color: 'var(--text-muted)' }}>{l.data ? l.data.split('-').reverse().join('/') : '-'}</td>
                        <td>{lancamentoTipoLabel[l.tipo] || l.tipo}</td>
                        <td>{l.descricao}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600, color: l.direcao === 'credito' ? '#10b981' : '#ef4444' }}>
                          {l.direcao === 'credito' ? '+' : '-'} {formatBRL(fromCents(l.valorCentavos))}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BancosList;
