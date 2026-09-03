import React, { useEffect, useState } from 'react';
import { collection, query, onSnapshot, where, doc, updateDoc, addDoc, serverTimestamp, getDoc, getDocs, deleteDoc, runTransaction } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError, NexusSwal } from '../../utils/alerts';
import { toCents } from '../../utils/financeDomain';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { CheckCircle, Clock, Plus, X, ArrowDownCircle, Loader2, Calendar, Edit, XCircle, ChevronDown, ChevronRight, Search, Truck, Tag } from 'lucide-react';
import { differenceInCalendarDays, getDateInputInTimeZone } from '../../utils/dateTime';
import './Financeiro.css';

interface TransacaoData {
  id: string;
  data: string;
  descricao: string;
  categoria: string;
  valor: number;
  tipo: 'entrada' | 'saida';
  status: 'Paga' | 'Pendente' | 'Cancelada';
  formaPagamento?: string;
  osId?: string;
  vendaId?: string;
  dataPagamento?: string;
  createdAt?: any;
  bancoId?: string;
  bancoNome?: string;
  fornecedorId?: string | null;
  fornecedorNome?: string;
}

// Espelha GrupoCliente de ContasReceber.tsx. Diferenca deliberada: uma
// despesa nem sempre tem fornecedor -- compras importadas de XML gravam
// fornecedorId/fornecedorNome (ver EntradaNFE.tsx), mas despesa lancada a
// mao (aluguel, luz, salario) so tem categoria. Por isso o grupo cai pra
// categoria quando nao ha fornecedor, em vez de jogar tudo num balde
// "sem fornecedor" -- `porFornecedor` diz qual dos dois foi usado.
interface GrupoDespesa {
  chave: string;
  fornecedorId: string | null;
  titulo: string;
  porFornecedor: boolean;
  transacoes: TransacaoData[];
  totalPendente: number;
  vencimentoMaisAntigo: string | null;
  diasAtrasoMax: number;
}

const ContasPagar: React.FC = () => {
  const [transacoes, setTransacoes] = useState<TransacaoData[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [gruposExpandidos, setGruposExpandidos] = useState<Set<string>>(new Set());
  const [buscaGrupo, setBuscaGrupo] = useState('');
  const { currentUser, tenantId } = useAuth();

  // Categorias de despesa do plano de contas
  const [categoriasDespesa, setCategoriasDespesa] = useState<string[]>(['Aluguel', 'Água/Luz/Internet', 'Salários', 'Fornecedores de Peças', 'Outros']);

  const [formData, setFormData] = useState({
    descricao: '',
    data: new Date().toISOString().split('T')[0],
    valor: '',
    categoria: '',
    status: 'Pendente' as 'Paga' | 'Pendente'
  });

  useEffect(() => {
    if (!currentUser) return;
    
    // Escutar TODAS as transacoes de saída para poder calcular os pagamentos de hoje
    const q = query(
      collection(db, 'transacoes'), 
      where('tenantId', '==', tenantId),
      where('tipo', '==', 'saida')
    );

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const data: TransacaoData[] = [];
      querySnapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() } as TransacaoData);
      });
      data.sort((a, b) => {
        const dateA = a.data || '';
        const dateB = b.data || '';
        return dateA.localeCompare(dateB); // Ordenar por vencimento (mais próximos primeiro)
      });
      setTransacoes(data);
      setLoading(false);
    }, (error) => {
      console.error("Erro ao buscar contas a pagar:", error);
      setLoading(false);
    });

    // Buscar Plano de Contas das configurações
    const fetchConfig = async () => {
      try {
        const configRef = doc(db, 'configuracoes', tenantId || '');
        const configSnap = await getDoc(configRef);
        if (configSnap.exists()) {
          const data = configSnap.data();
          if (data.planoContasDespesas) {
            setCategoriasDespesa(Array.isArray(data.planoContasDespesas) ? data.planoContasDespesas : data.planoContasDespesas.split('\n').filter((c: string) => c.trim() !== ''));
          }
        }
      } catch (err) {
        console.error("Erro ao buscar plano de contas", err);
      }
    };
    
    fetchConfig();

    return () => unsubscribe();
  }, [currentUser]);

  const handleConciliar = async (t: TransacaoData) => {
    const result = await NexusSwal.fire({
      title: 'Confirmar Pagamento?',
      text: `Selecione como foi pago o valor de R$ ${Number(t.valor).toFixed(2)} referente a ${t.descricao}:`,
      icon: 'question',
      input: 'select',
      inputOptions: {
        'Dinheiro': 'Dinheiro',
        'Pix': 'Pix',
        'Cartão de Crédito': 'Cartão de Crédito',
        'Cartão de Débito': 'Cartão de Débito',
        'Transferência': 'Transferência',
        'Boleto': 'Boleto',
        'Outros': 'Outros'
      },
      inputPlaceholder: 'Como foi pago?',
      inputValue: t.formaPagamento && ['Dinheiro', 'Pix', 'Cartão de Crédito', 'Cartão de Débito', 'Transferência', 'Boleto', 'Outros'].includes(t.formaPagamento) ? t.formaPagamento : '',
      showCancelButton: true,
      confirmButtonText: 'Sim, confirmar pagamento',
      cancelButtonText: 'Cancelar',
      inputValidator: (value) => {
        if (!value) {
          return 'Você precisa selecionar uma forma de pagamento!'
        }
      }
    });

    if (!result.isConfirmed) return;
    if (!currentUser) return;
    const formaPgto = result.value as string;

    let bancoId: string | undefined;
    let bancoNome: string | undefined;
    if (formaPgto !== 'Dinheiro') {
      const qBancos = query(
        collection(db, 'bancos'),
        where('tenantId', '==', tenantId),
        where('ativo', '==', true),
      );
      const snapBancos = await getDocs(qBancos);
      const bancosDisponiveis = snapBancos.docs.map((d) => ({ id: d.id, nome: String(d.data().nome || '') }));
      if (bancosDisponiveis.length === 0) {
        showError('Nenhum banco cadastrado', 'Cadastre um banco em Cadastros > Bancos antes de confirmar este pagamento.');
        return;
      }
      const bancoResult = await NexusSwal.fire({
        title: 'De qual banco saiu?',
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
      const docRef = doc(db, 'transacoes', t.id);
      const dataPagamento = new Date().toISOString().split('T')[0];
      const valorCentavos = toCents(t.valor);

      if (bancoId) {
        const bancoRef = doc(db, 'bancos', bancoId);
        await runTransaction(db, async (transaction) => {
          const bancoSnap = await transaction.get(bancoRef);
          if (!bancoSnap.exists()) throw new Error('O banco selecionado não foi encontrado.');
          const saldoAtualCentavos = Number(bancoSnap.data().saldoCentavos || 0);

          transaction.update(docRef, {
            status: 'Paga',
            formaPagamento: formaPgto,
            dataPagamento,
            valorCentavos,
            bancoId,
            bancoNome: bancoNome || null,
            updatedAt: serverTimestamp(),
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Pagamento confirmado'),
          });
          transaction.update(bancoRef, {
            saldoCentavos: saldoAtualCentavos - valorCentavos,
            updatedAt: serverTimestamp(),
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), `Débito da despesa "${t.descricao}"`),
          });
        });
      } else {
        await updateDoc(docRef, {
          status: 'Paga',
          formaPagamento: formaPgto,
          dataPagamento,
          valorCentavos,
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp()),
        });
      }
      showSuccess('Pagamento registrado no Fluxo de Caixa!');
    } catch (err) {
      console.error(err);
      showError('Erro', err instanceof Error ? err.message : 'Não foi possível confirmar o pagamento.');
    }
  };

  const handleOpenModal = () => {
    setFormData({
      descricao: '',
      data: new Date().toISOString().split('T')[0],
      valor: '',
      categoria: categoriasDespesa[0] || '',
      status: 'Pendente'
    });
    setEditingId(null);
    setIsModalOpen(true);
  };

  const handleEdit = (t: TransacaoData) => {
    setFormData({
      descricao: t.descricao,
      data: t.data,
      valor: t.valor.toString().replace('.', ','),
      categoria: t.categoria,
      status: t.status === 'Paga' ? 'Paga' : 'Pendente'
    });
    setEditingId(t.id);
    setIsModalOpen(true);
  };

  const handleCancelar = async (t: TransacaoData) => {
    if (!currentUser) return;
    const result = await NexusSwal.fire({
      title: 'Cancelar Lançamento?',
      text: `Para cancelar a despesa "${t.descricao}", digite o motivo (mínimo 12 caracteres). O lançamento continua registrado, só sai da lista de pendentes/pagas.`,
      input: 'text',
      inputAttributes: {
        minlength: '12',
        required: 'true',
        placeholder: 'Motivo do cancelamento...'
      },
      showCancelButton: true,
      confirmButtonText: 'Confirmar Cancelamento',
      cancelButtonText: 'Voltar',
      confirmButtonColor: '#ef4444',
      preConfirm: (motivo) => {
        if (!motivo || motivo.trim().length < 12) {
          NexusSwal.showValidationMessage('O motivo deve ter pelo menos 12 caracteres.');
          return false;
        }
        return motivo;
      }
    });

    if (result.isConfirmed) {
      try {
        await updateDoc(doc(db, 'transacoes', t.id), {
          status: 'Cancelada',
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), `Lançamento cancelado: ${result.value}`),
        });
        try {
          const { createAuditLog } = await import('../../services/logService');
          createAuditLog({
            tenantId: tenantId || '',
            usuarioId: currentUser.uid,
            usuarioEmail: currentUser.email || currentUser.uid,
            modulo: 'financeiro',
            acao: 'cancelamento',
            descricao: `Despesa "${t.descricao}" cancelada. Motivo: ${result.value}`,
            registroRelacionadoId: t.id,
            status: 'sucesso',
            critical: true,
          });
        } catch {
          // ignore audit log error
        }
        showSuccess('Despesa cancelada com sucesso!');
      } catch (err) {
        showError('Erro', 'Não foi possível cancelar o lançamento.');
      }
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    if (!formData.descricao || !formData.valor || !formData.categoria) {
      showError('Atenção', 'Preencha todos os campos obrigatórios.');
      return;
    }

    setIsSaving(true);
    try {
      const valorNum = parseFloat(formData.valor.toString().replace(',', '.'));
      if (editingId) {
        await updateDoc(doc(db, 'transacoes', editingId), {
          descricao: formData.descricao.toUpperCase().trim(),
          data: formData.data,
          valor: valorNum,
          categoria: formData.categoria.toUpperCase().trim(),
          status: formData.status,
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp()),
        });
        showSuccess('Conta atualizada com sucesso!');
      } else {
        await addDoc(collection(db, 'transacoes'), {
          descricao: formData.descricao.toUpperCase().trim(),
          data: formData.data,
          valor: valorNum,
          categoria: formData.categoria.toUpperCase().trim(),
          status: formData.status,
          tipo: 'saida',
          tenantId,
          createdAt: serverTimestamp(),
          ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
        });
        showSuccess('Conta a pagar lançada com sucesso!');
      }
      setIsModalOpen(false);
    } catch (error) {
      console.error("Erro ao salvar conta a pagar:", error);
      showError('Erro', 'Ocorreu um erro ao salvar o lançamento.');
    } finally {
      setIsSaving(false);
    }
  };

  // Usa o helper de fuso do projeto (America/Sao_Paulo, Secao 1.4 do plano)
  // em vez de new Date().toISOString(), que e' UTC -- de madrugada o UTC ja
  // virou o dia seguinte e "Pago Hoje"/dias de atraso saiam errados.
  const hojeStr = getDateInputInTimeZone();
  const contasPendentes = transacoes.filter(t => t.status === 'Pendente');
  const pagamentosHoje = transacoes.filter(t => t.status === 'Paga' && t.dataPagamento === hojeStr);

  const totalPendente = contasPendentes.reduce((acc, curr) => acc + curr.valor, 0);
  const totalPagoHoje = pagamentosHoje.reduce((acc, curr) => acc + curr.valor, 0);

  // Agrupa as contas pendentes por fornecedor (compras de XML) ou, na falta
  // dele, pela categoria da despesa. Mesmo padrao de gruposPorCliente em
  // ContasReceber.tsx.
  const gruposPorFornecedor: GrupoDespesa[] = (() => {
    const mapa = new Map<string, GrupoDespesa>();
    contasPendentes.forEach((t) => {
      const nomeFornecedor = t.fornecedorNome?.trim();
      const porFornecedor = Boolean(t.fornecedorId || nomeFornecedor);
      const titulo = porFornecedor
        ? (nomeFornecedor || 'Fornecedor não identificado')
        : (t.categoria?.trim() || 'Sem categoria');
      const chave = t.fornecedorId
        ? `forn:${t.fornecedorId}`
        : porFornecedor
          ? `forn-nome:${titulo.toUpperCase()}`
          : `cat:${titulo.toUpperCase()}`;
      const diasAtraso = t.data ? (differenceInCalendarDays(t.data, hojeStr) ?? 0) : 0;

      let grupo = mapa.get(chave);
      if (!grupo) {
        grupo = {
          chave,
          fornecedorId: t.fornecedorId || null,
          titulo,
          porFornecedor,
          transacoes: [],
          totalPendente: 0,
          vencimentoMaisAntigo: null,
          diasAtrasoMax: 0,
        };
        mapa.set(chave, grupo);
      }
      grupo.transacoes.push(t);
      grupo.totalPendente += Number(t.valor || 0);
      if (t.data && (!grupo.vencimentoMaisAntigo || t.data < grupo.vencimentoMaisAntigo)) {
        grupo.vencimentoMaisAntigo = t.data;
      }
      grupo.diasAtrasoMax = Math.max(grupo.diasAtrasoMax, diasAtraso);
    });

    return Array.from(mapa.values())
      .filter((g) => !buscaGrupo.trim() || g.titulo.toLowerCase().includes(buscaGrupo.trim().toLowerCase()))
      .sort((a, b) => b.totalPendente - a.totalPendente);
  })();

  const toggleGrupoExpandido = (chave: string) => {
    setGruposExpandidos((current) => {
      const next = new Set(current);
      if (next.has(chave)) next.delete(chave);
      else next.add(chave);
      return next;
    });
  };

  return (
    <div className="financeiro-page" style={{ padding: '24px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px', alignItems: 'center' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, margin: 0 }}>Contas a Pagar</h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)', margin: 0 }}>Gestão de custos, boletos e despesas agendadas</p>
        </div>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: 'rgba(239, 68, 68, 0.1)', padding: '12px 24px', borderRadius: 'var(--radius-lg)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
            <Clock size={24} color="#ef4444" />
            <div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Pago Hoje</div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#ef4444' }}>
                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalPagoHoje)}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: 'var(--bg-secondary)', padding: '12px 24px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)' }}>
            <Clock size={24} color="#ef4444" />
            <div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Total Pendente</div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#ef4444' }}>
                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalPendente)}
              </div>
            </div>
          </div>
          <button className="btn-primary" onClick={handleOpenModal} style={{ backgroundColor: '#ef4444', borderColor: '#ef4444', boxShadow: '0 0 15px rgba(239, 68, 68, 0.4)' }}>
            <Plus size={18} style={{ marginRight: 8 }} />
            Lançar Despesa
          </button>
        </div>
      </div>

      <div className="search-bar" style={{ position: 'relative', maxWidth: '360px', marginBottom: '16px' }}>
        <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
        <input
          type="text"
          placeholder="Buscar fornecedor ou categoria..."
          value={buscaGrupo}
          onChange={(e) => setBuscaGrupo(e.target.value)}
          style={{ width: '100%', padding: '10px 14px 10px 40px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
        />
      </div>

      <div className="card" style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
        <div className="table-wrapper">
          <table className="data-table financeiro-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                <th style={{ padding: '16px', width: '32px' }}></th>
                <th style={{ padding: '16px' }}>Fornecedor / Categoria</th>
                <th style={{ padding: '16px', textAlign: 'center' }}>Títulos em aberto</th>
                <th style={{ padding: '16px' }}>Vencimento mais antigo</th>
                <th style={{ padding: '16px', textAlign: 'right' }}>Valor pendente (R$)</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '20px' }}>Carregando contas a pagar...</td>
                </tr>
              ) : gruposPorFornecedor.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                    <CheckCircle size={48} color="#10b981" style={{ margin: '0 auto 16px', opacity: 0.5 }} />
                    <div>{buscaGrupo.trim() ? 'Nenhum fornecedor ou categoria encontrado para essa busca.' : 'Tudo em dia! Nenhuma conta pendente para pagamento.'}</div>
                  </td>
                </tr>
              ) : (
                gruposPorFornecedor.map((grupo) => {
                  const expandido = gruposExpandidos.has(grupo.chave);
                  const emAtraso = grupo.diasAtrasoMax > 0;
                  return (
                    <React.Fragment key={grupo.chave}>
                      <tr
                        onClick={() => toggleGrupoExpandido(grupo.chave)}
                        style={{ borderBottom: expandido ? 'none' : '1px solid var(--border-color)', cursor: 'pointer', backgroundColor: expandido ? 'var(--bg-tertiary)' : 'transparent' }}
                      >
                        <td style={{ padding: '16px 0 16px 16px', color: 'var(--text-muted)' }}>
                          {expandido ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                        </td>
                        <td style={{ padding: '16px', fontWeight: 600 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {grupo.porFornecedor
                              ? <Truck size={16} style={{ color: 'var(--text-muted)' }} />
                              : <Tag size={16} style={{ color: 'var(--text-muted)' }} />}
                            {grupo.titulo}
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
                        <td style={{ padding: '16px', textAlign: 'right', fontWeight: 700, color: '#ef4444' }}>
                          {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(grupo.totalPendente)}
                        </td>
                      </tr>
                      {expandido && (
                        <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td colSpan={5} style={{ padding: '0 16px 16px 48px', backgroundColor: 'var(--bg-tertiary)' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                              <thead>
                                <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                                  <th style={{ padding: '10px 8px', fontSize: '12px', color: 'var(--text-muted)' }}>Vencimento</th>
                                  <th style={{ padding: '10px 8px', fontSize: '12px', color: 'var(--text-muted)' }}>Descrição</th>
                                  <th style={{ padding: '10px 8px', fontSize: '12px', color: 'var(--text-muted)' }}>Categoria</th>
                                  <th style={{ padding: '10px 8px', fontSize: '12px', color: 'var(--text-muted)', textAlign: 'right' }}>Valor (R$)</th>
                                  <th style={{ padding: '10px 8px', fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center' }}>Ação</th>
                                </tr>
                              </thead>
                              <tbody>
                                {grupo.transacoes.map((t) => (
                                  <tr key={t.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                    <td style={{ padding: '10px 8px', color: 'var(--text-muted)' }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <Calendar size={14} />
                                        {t.data ? t.data.split('-').reverse().join('/') : '-'}
                                      </div>
                                    </td>
                                    <td style={{ padding: '10px 8px', fontWeight: 500 }}>{t.descricao}</td>
                                    <td style={{ padding: '10px 8px' }}>
                                      <span style={{ fontSize: '12px', backgroundColor: 'var(--bg-secondary)', padding: '4px 8px', borderRadius: '4px', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}>
                                        {t.categoria}
                                      </span>
                                    </td>
                                    <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 600, color: '#ef4444' }}>
                                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(t.valor))}
                                    </td>
                                    <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                                        {(!t.osId && !t.vendaId) && (
                                          <>
                                            <button
                                              onClick={() => handleEdit(t)}
                                              style={{ backgroundColor: '#f59e0b', border: 'none', color: 'white', cursor: 'pointer', borderRadius: '4px', padding: '6px 10px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '12px', transition: 'filter 0.2s' }}
                                              title="Editar Despesa"
                                              onMouseOver={(e) => e.currentTarget.style.filter = 'brightness(1.1)'}
                                              onMouseOut={(e) => e.currentTarget.style.filter = 'brightness(1)'}
                                            >
                                              <Edit size={14} />
                                            </button>
                                            <button
                                              onClick={() => handleCancelar(t)}
                                              style={{ backgroundColor: '#ef4444', border: 'none', color: 'white', cursor: 'pointer', borderRadius: '4px', padding: '6px 10px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '12px', transition: 'filter 0.2s' }}
                                              title="Cancelar Despesa"
                                              onMouseOver={(e) => e.currentTarget.style.filter = 'brightness(1.1)'}
                                              onMouseOut={(e) => e.currentTarget.style.filter = 'brightness(1)'}
                                            >
                                              <XCircle size={14} />
                                            </button>
                                          </>
                                        )}
                                        <button
                                          onClick={() => handleConciliar(t)}
                                          style={{ backgroundColor: '#10b981', border: 'none', color: 'white', cursor: 'pointer', borderRadius: '4px', padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '12px', transition: 'filter 0.2s' }}
                                          onMouseOver={(e) => e.currentTarget.style.filter = 'brightness(1.1)'}
                                          onMouseOut={(e) => e.currentTarget.style.filter = 'brightness(1)'}
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

      {/* Modal de Novo Lançamento */}
      {isModalOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
          display: 'flex', justifyContent: 'center', alignItems: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: '500px',
            border: '1px solid var(--border-color)', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.5)', overflow: 'hidden'
          }}>
            <div style={{
              padding: '20px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
            }}>
              <h2 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', color: '#ef4444' }}>
                <ArrowDownCircle size={24} />
                {editingId ? 'Editar Despesa' : 'Lançar Conta a Pagar'}
              </h2>
              <button onClick={() => setIsModalOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={24} />
              </button>
            </div>
            
            <form onSubmit={handleSave} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Descrição / Fornecedor</label>
                <input 
                  type="text" 
                  value={formData.descricao} 
                  onChange={(e) => setFormData({...formData, descricao: e.target.value})} 
                  placeholder="Ex: ALUGUEL MAIO, FORNECEDOR PEÇAS X, LUZ..." 
                  style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px', color: 'var(--text-primary)', textTransform: 'uppercase' }}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Valor (R$)</label>
                  <input 
                    type="number" 
                    step="0.01"
                    value={formData.valor} 
                    onChange={(e) => setFormData({...formData, valor: e.target.value})} 
                    placeholder="0,00" 
                    style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px', color: 'var(--text-primary)', fontWeight: 600, fontSize: '16px' }}
                    required
                  />
                </div>
                <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Data de Vencimento</label>
                  <input 
                    type="date" 
                    value={formData.data} 
                    onChange={(e) => setFormData({...formData, data: e.target.value})} 
                    style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px', color: 'var(--text-primary)' }}
                    required
                  />
                </div>
              </div>

              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Categoria (Plano de Contas)</label>
                <select 
                  value={formData.categoria} 
                  onChange={(e) => setFormData({...formData, categoria: e.target.value})}
                  style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px', color: 'var(--text-primary)' }}
                  required
                >
                  <option value="">Selecione uma categoria...</option>
                  {categoriasDespesa.map((cat, idx) => (
                    <option key={idx} value={cat}>{cat.toUpperCase()}</option>
                  ))}
                </select>
              </div>

              <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button type="button" className="btn-secondary" onClick={() => setIsModalOpen(false)}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={isSaving} style={{ backgroundColor: '#ef4444', borderColor: '#ef4444' }}>
                  {isSaving ? <Loader2 size={18} className="spin-animation" /> : <CheckCircle size={18} />}
                  Salvar Conta
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ContasPagar;
